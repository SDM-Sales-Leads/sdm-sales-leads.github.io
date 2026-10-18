// deno-lint-ignore-file no-explicit-any
// Session, users, roles, settings, e-mail, logs, reference data (categories, SLA, articles), notifications.
import {
  admin, asUuid, bad, body, can, clean, escHtml, forbidden, getConfig, hasSecret, HttpError, isAdmin, isEmail, isManager, logActivity,
  getSecret, need, needAdmin, notFound, nowIso, rateLimit, setConfig, setSecret, str, UUID_RE, Caller, isObj,
} from "./lib.ts";
import { route } from "./router.ts";
import { loadEws, sendMail, validHost, verify } from "./ews.ts";
import { canSeeTicket } from "./routes_tickets.ts";

declare const Deno: any;

// ---------------------------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------------------------
const publicUser = (c: Caller) => ({
  id: c.id, name: c.name, email: c.email, role: c.role, department: c.department || undefined,
  teamLeaderId: c.teamLeaderId || undefined, mustChangePassword: c.mustChangePassword,
});

route("GET", "/me", async ({ c }) => ({ user: publicUser(c), permissions: { role: c.role, ...c.perms } }));

route("GET", "/auth/permissions/:role", async ({ c, params }) => {
  // you may read your own role's permissions; managers may read any
  if (params.role !== c.role && !isManager(c)) throw forbidden();
  const { data } = await admin.from("role_permissions").select("perms").eq("role", params.role).maybeSingle();
  return { role: params.role, ...(data?.perms || { canViewDashboard: true, canViewTickets: true, canViewKnowledgeBase: true }) };
});

route("POST", "/me/password-changed", async () => {
  // the flag is only cleared by /auth/reset, which needs the code e-mailed to the user
  throw bad("Use the 6-digit code from your e-mail to choose a new password");
});

// ---------------------------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------------------------
const userOut = (u: any) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, department: u.department || undefined,
  teamLeaderId: u.team_leader_id || undefined, active: u.active, leave: u.on_leave, annualTarget: u.annual_target ?? undefined,
});

route("GET", "/users", async () => {
  const { data } = await admin.from("app_users").select("*").order("name");
  return (data || []).map(userOut);
});

route("GET", "/technicians", async () => {
  const { data } = await admin.from("app_users").select("*").in("role", ["Technician", "Admin"]).eq("active", true).order("name");
  return (data || []).map(userOut);
});

function strongPassword(p: string) {
  return p.length >= 10 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p);
}
function randomPassword() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const r = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(r, (n) => abc[n % abc.length]).join("") + "7";
}
async function roleExists(role: string) {
  if (role === "Admin" || role === "Requester") return true;
  const { data } = await admin.from("role_permissions").select("role").eq("role", role).maybeSingle();
  return !!data;
}
async function otherActiveAdmins(exceptId: string) {
  const { count } = await admin.from("app_users").select("id", { count: "exact", head: true }).eq("role", "Admin").eq("active", true).neq("id", exceptId);
  return count || 0;
}

route("POST", "/users", async ({ req, c }) => {
  need(c, "canViewAdminPanel");
  const b = await body(req);
  const email = str(b.email, 254).toLowerCase();
  const name = str(b.name, 120);
  const role = str(b.role, 60) || "Requester";
  if (!name) throw bad("Name is required");
  if (!isEmail(email)) throw bad("A valid e-mail is required");
  if (!(await roleExists(role))) throw bad("Unknown role");
  if (role === "Admin" && !isAdmin(c)) throw forbidden("Only an administrator can create administrators");
  const tl = b.teamLeaderId ? asUuid(b.teamLeaderId) : null;
  if (b.teamLeaderId && !tl) throw bad("Invalid team leader");
  let password = str(b.password, 72);
  let generated = false;
  if (!password) { password = randomPassword(); generated = true; }
  else if (!strongPassword(password)) throw bad("Password needs at least 10 characters, with letters and digits");

  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created?.user) throw bad(error?.message?.includes("already") ? "This e-mail already has an account" : "Could not create the login");
  const row = {
    id: created.user.id, email, name, role, department: str(b.department, 80) || null, team_leader_id: tl,
    active: true, on_leave: false, must_change_password: true,
    annual_target: b.annualTarget !== undefined && Number.isFinite(Number(b.annualTarget)) && Number(b.annualTarget) >= 0 ? Number(b.annualTarget) : null,
  };
  const ins = await admin.from("app_users").insert(row);
  if (ins.error) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw new HttpError(500, "Could not save the user");
  }
  await logActivity(c, "Create User", `User ${name} (${role}) created`, "admin");
  // leads imported from the previous CRM carry the owner's name: attach them to this person
  const { data: linked } = await admin.rpc("crm_link_owner", { p_user: row.id, p_name: name });
  return { ...userOut(row), ...(generated ? { temporaryPassword: password } : {}), linkedLeads: Number(linked) || 0 };
});

// Create a whole team in one go (used to move the people and the reporting lines of the previous CRM). Admin only.
// Each person gets a temporary password (shown once) and must choose their own at first sign-in.
route("POST", "/users/bulk", async ({ req, c }) => {
  needAdmin(c);
  await rateLimit(`bulkusers:${c.id}`, 3600, 10);
  const b = await body(req, 200_000);
  const list: any[] = Array.isArray(b.users) ? b.users : [];
  if (!list.length || list.length > 100) throw bad("Send 1-100 users");
  const results: any[] = [];
  const byEmail: Record<string, string> = {};
  const { data: existing } = await admin.from("app_users").select("id,email");
  for (const u of existing || []) byEmail[String(u.email).toLowerCase()] = u.id;
  for (const u of list) {
    const email = str(u?.email, 254).toLowerCase(), name = str(u?.name, 120), role = str(u?.role, 60);
    if (!name || !isEmail(email)) { results.push({ email, name, status: "skipped: name or e-mail invalid" }); continue; }
    if (byEmail[email]) { results.push({ email, name, status: "already exists" }); continue; }
    if (!(await roleExists(role))) { results.push({ email, name, status: `skipped: role "${role}" does not exist (run the migration first)` }); continue; }
    const password = randomPassword();
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created?.user) { results.push({ email, name, status: "failed: could not create the login" }); continue; }
    const t = Number(u.annualTarget);
    const row = { id: created.user.id, email, name, role, department: str(u.department, 80) || null, team_leader_id: null, active: true, on_leave: false, must_change_password: true, annual_target: Number.isFinite(t) && t > 0 ? t : null };
    const ins = await admin.from("app_users").insert(row);
    if (ins.error) { await admin.auth.admin.deleteUser(created.user.id); results.push({ email, name, status: "failed: could not save" }); continue; }
    byEmail[email] = created.user.id;
    const { data: linked } = await admin.rpc("crm_link_owner", { p_user: row.id, p_name: name });
    results.push({ email, name, role, status: "created", temporaryPassword: password, linkedLeads: Number(linked) || 0 });
  }
  // reporting lines, after everybody exists
  for (const u of list) {
    const email = str(u?.email, 254).toLowerCase(), boss = str(u?.reportsToEmail, 254).toLowerCase();
    if (!boss || !byEmail[email] || !byEmail[boss] || byEmail[email] === byEmail[boss]) continue;
    const r = results.find((x) => x.email === email);
    if (r?.status !== "created") continue; // never rewire people that already existed
    await admin.from("app_users").update({ team_leader_id: byEmail[boss] }).eq("id", byEmail[email]);
    r.reportsTo = boss;
  }
  await logActivity(c, "Bulk create users", `${results.filter((x) => x.status === "created").length} user(s) created`, "admin");
  return { success: true, results };
});

route("PUT", "/users/:id", async ({ req, c, params }) => {
  need(c, "canViewAdminPanel");
  if (!UUID_RE.test(params.id)) throw bad("Invalid user id");
  const b = await body(req);
  const { data: cur } = await admin.from("app_users").select("*").eq("id", params.id).maybeSingle();
  if (!cur) throw notFound("User not found");
  const upd: any = {};
  if (b.name !== undefined) { upd.name = str(b.name, 120); if (!upd.name) throw bad("Name is required"); }
  if (b.department !== undefined) upd.department = str(b.department, 80) || null;
  if (b.teamLeaderId !== undefined) {
    const tl = b.teamLeaderId ? asUuid(b.teamLeaderId) : null;
    if (b.teamLeaderId && !tl) throw bad("Invalid team leader");
    if (tl === params.id) throw bad("A person cannot lead their own team");
    upd.team_leader_id = tl;
  }
  if (b.leave !== undefined) upd.on_leave = !!b.leave;
  if (b.annualTarget !== undefined) {
    const t = b.annualTarget === null || b.annualTarget === "" ? null : Number(b.annualTarget);
    if (t !== null && (!Number.isFinite(t) || t < 0 || t > 1e12)) throw bad("Invalid target");
    upd.annual_target = t;
  }
  if (b.role !== undefined) {
    const role = str(b.role, 60);
    if (!(await roleExists(role))) throw bad("Unknown role");
    if ((role === "Admin" || cur.role === "Admin") && !isAdmin(c)) throw forbidden("Only an administrator can change administrator roles");
    if (cur.role === "Admin" && role !== "Admin" && (await otherActiveAdmins(cur.id)) === 0) throw bad("This is the last administrator");
    upd.role = role;
  }
  if (b.active !== undefined) {
    const active = !!b.active;
    if (!active && cur.id === c.id) throw bad("You cannot disable your own account");
    if (!active && cur.role === "Admin" && (await otherActiveAdmins(cur.id)) === 0) throw bad("This is the last administrator");
    upd.active = active;
    await admin.auth.admin.updateUserById(cur.id, { ban_duration: active ? "none" : "876000h" });
  }
  if (b.email !== undefined) {
    const email = str(b.email, 254).toLowerCase();
    if (!isEmail(email)) throw bad("A valid e-mail is required");
    if (email !== cur.email) {
      if (cur.role === "Admin" && !isAdmin(c)) throw forbidden();
      const r = await admin.auth.admin.updateUserById(cur.id, { email, email_confirm: true });
      if (r.error) throw bad("Could not change the e-mail (already used?)");
      upd.email = email;
    }
  }
  let temporaryPassword: string | undefined;
  if (b.password) {
    const p = str(b.password, 72);
    if (!strongPassword(p)) throw bad("Password needs at least 10 characters, with letters and digits");
    if (cur.role === "Admin" && !isAdmin(c)) throw forbidden();
    const r = await admin.auth.admin.updateUserById(cur.id, { password: p });
    if (r.error) throw bad("Could not change the password");
    upd.must_change_password = cur.id !== c.id;
  } else if (b.resetPassword === true) {
    if (cur.role === "Admin" && !isAdmin(c)) throw forbidden();
    temporaryPassword = randomPassword();
    await admin.auth.admin.updateUserById(cur.id, { password: temporaryPassword });
    upd.must_change_password = true;
  }
  if (Object.keys(upd).length) {
    const r = await admin.from("app_users").update(upd).eq("id", cur.id);
    if (r.error) throw new HttpError(500, "Could not save the user");
  }
  await logActivity(c, "Update User", `User ${cur.name} updated`, "admin");
  if (upd.name) await admin.rpc("crm_link_owner", { p_user: cur.id, p_name: upd.name });
  const { data: fresh } = await admin.from("app_users").select("*").eq("id", cur.id).single();
  return { ...userOut(fresh), ...(temporaryPassword ? { temporaryPassword } : {}) };
});

route("DELETE", "/users/:id", async ({ c, params }) => {
  need(c, "canViewAdminPanel");
  if (!UUID_RE.test(params.id)) throw bad("Invalid user id");
  if (params.id === c.id) throw bad("You cannot delete your own account");
  const { data: cur } = await admin.from("app_users").select("*").eq("id", params.id).maybeSingle();
  if (!cur) throw notFound("User not found");
  if (cur.role === "Admin") {
    needAdmin(c);
    if ((await otherActiveAdmins(cur.id)) === 0) throw bad("This is the last administrator");
  }
  const r = await admin.auth.admin.deleteUser(params.id);
  if (r.error) throw new HttpError(500, "Could not delete the login");
  await logActivity(c, "Delete User", `User ${cur.name} (${cur.email}) deleted`, "admin");
  return { success: true };
});

// ---------------------------------------------------------------------------------------------
// role permissions
// ---------------------------------------------------------------------------------------------
route("GET", "/admin/role-permissions", async ({ c }) => {
  need(c, "canViewAdminPanel");
  const { data } = await admin.from("role_permissions").select("*").order("role");
  return (data || []).map((r: any) => ({ id: r.role, role: r.role, ...r.perms }));
});

route("POST", "/admin/role-permissions", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req);
  const list = Array.isArray(b.permissions) ? b.permissions : null;
  if (!list || list.length > 60) throw bad("permissions must be a list");
  const rows: any[] = [];
  for (const p of list) {
    const role = str(p?.role, 60);
    if (!role) throw bad("Every entry needs a role name");
    const { id: _i, role: _r, ...perms } = clean(p);
    for (const [k, v] of Object.entries(perms)) {
      const ok = typeof v === "boolean" || (Array.isArray(v) && v.every((x) => typeof x === "string"));
      if (!ok) throw bad(`Invalid value for ${k}`);
    }
    if (role === "Admin") { perms.canViewAdminPanel = true; }
    rows.push({ role, perms, updated_at: nowIso() });
  }
  if (!rows.some((r) => r.role === "Admin")) throw bad("The Admin role must stay");
  const up = await admin.from("role_permissions").upsert(rows);
  if (up.error) throw new HttpError(500, "Could not save permissions");
  // remove roles that were deleted in the editor, but only when nobody still has that role
  const keep = rows.map((r) => r.role);
  const { data: all } = await admin.from("role_permissions").select("role");
  for (const r of all || []) {
    if (keep.includes(r.role)) continue;
    const { count } = await admin.from("app_users").select("id", { count: "exact", head: true }).eq("role", r.role);
    if (!count) await admin.from("role_permissions").delete().eq("role", r.role);
  }
  await logActivity(c, "Update Permissions", `Role permissions updated for ${rows.length} roles`, "admin");
  return { success: true };
});

// ---------------------------------------------------------------------------------------------
// settings (look & feel), AI key, e-mail account
// ---------------------------------------------------------------------------------------------
const DEFAULT_UI = {
  theme: "glass", primaryColor: "#A6192E", backgroundColor: "#F2F2F2", effectColor: "#A6192E", fontFamily: "Inter", fontSize: "sm",
  backgroundEffect: "all", gridPattern: "lines", particleShape: "circle", backgroundIntensity: 50, borderRadius: "xl",
  glassIntensity: 70, animationSpeed: "normal",
};
// look & feel only (colours, fonts): needed on the sign-in page, contains nothing private
route("GET", "/settings", async () => ({ ...DEFAULT_UI, ...(await getConfig<any>("ui_settings", {})) }), { public: true });
route("POST", "/admin/settings", async ({ req, c }) => {
  need(c, "canViewAdminPanel");
  const b = await body(req);
  if (!isObj(b.settings)) throw bad("settings missing");
  const s: any = {};
  for (const k of Object.keys(DEFAULT_UI)) if (b.settings[k] !== undefined) s[k] = b.settings[k];
  for (const k of ["primaryColor", "backgroundColor", "effectColor"]) if (s[k] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(s[k]))) throw bad(`Invalid ${k}`);
  for (const k of ["backgroundIntensity", "glassIntensity"]) if (s[k] !== undefined) s[k] = Math.max(0, Math.min(100, Number(s[k]) || 0));
  for (const k of ["theme", "fontFamily", "fontSize", "backgroundEffect", "gridPattern", "particleShape", "borderRadius", "animationSpeed"])
    if (s[k] !== undefined) s[k] = str(s[k], 40);
  await setConfig("ui_settings", { ...DEFAULT_UI, ...s });
  await logActivity(c, "Update Settings", "Look & feel settings updated", "admin");
  return { success: true, settings: { ...DEFAULT_UI, ...s } };
});

route("GET", "/admin/config", async ({ c }) => {
  need(c, "canViewAdminPanel");
  return { geminiKeySet: await hasSecret("gemini_key"), ewsPasswordSet: await hasSecret("ews_password") };
});
route("POST", "/admin/config", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req);
  if (typeof b.geminiKey === "string") {
    const k = b.geminiKey.trim();
    if (k && !/^[A-Za-z0-9._-]{20,200}$/.test(k)) throw bad("That does not look like a Gemini API key");
    await setSecret("gemini_key", k);
    await logActivity(c, "Update Configuration", k ? "AI key saved" : "AI key removed", "admin");
  }
  return { success: true, message: "Configuration updated" };
});

route("GET", "/admin/email-config", async ({ c }) => {
  need(c, "canViewAdminPanel");
  const cfg = await getConfig<any>("email_config", {});
  return { provider: "Exchange", host: cfg.host || "", user: cfg.user || "", hasPassword: await hasSecret("ews_password") };
});
route("POST", "/admin/email-config", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req);
  const host = str(b.host, 253).toLowerCase();
  const user = str(b.user, 254);
  if (!validHost(host)) throw bad("Enter the mail server host name (for example mail.company.com)");
  if (!user) throw bad("Enter the mailbox user name");
  await setConfig("email_config", { host, user });
  if (typeof b.pass === "string" && b.pass !== "") await setSecret("ews_password", b.pass);
  await logActivity(c, "Update Email Configuration", `Mail account set to ${user} @ ${host}`, "admin");
  let verified = false, error: string | null = null;
  try { await verify(await loadEws()); verified = true; } catch (e: any) { error = e?.message || "Could not verify"; }
  return { success: true, verified, error, logs: [] };
});
route("POST", "/admin/test-email", async ({ req, c }) => {
  needAdmin(c);
  await rateLimit(`testmail:${c.id}`, 3600, 10);
  const b = await body(req);
  const to = str(b.to, 254).toLowerCase();
  if (!isEmail(to)) throw bad("Enter a valid recipient e-mail");
  try {
    await sendMail(await loadEws(), { to: [to], subject: "SDM Sales Leads: e-mail test", text: "If you can read this, the e-mail account works." });
    return { success: true, messageId: "sent", logs: [] };
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || "Failed", logs: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
});

// ---------------------------------------------------------------------------------------------
// health, diagnostics, logs
// ---------------------------------------------------------------------------------------------
route("GET", "/health", async () => ({ status: "ok", database: "supabase" }), { public: true });

route("GET", "/admin/diagnostics", async ({ c, query }) => {
  need(c, "canViewAdminPanel");
  const t0 = Date.now();
  const ping = query.get("ping") === "true";
  const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const head = (t: string, f?: (q: any) => any) => {
    const q = admin.from(t).select("*", { count: "exact", head: true });
    return Promise.resolve(f ? f(q) : q).then((r: any) => ({ n: r.error ? null : (r.count ?? 0), err: !!r.error }));
  };
  const live = (q: any) => q.is("deleted_at", null);

  // every independent read runs at the same time
  const [
    users, tickets, wf, leads, contacts, companies, mailLogs, leadAudit,
    noOwner, unlinked, noPhone, withPhone, leads24, mail24, lastMail, ingestAuto, cfg, hasKey, hasPass, snap, prints24,
  ] = await Promise.all([
    head("app_users"), head("tickets"), head("workflow_requests"),
    head("crm_leads", live), head("crm_contacts", live), head("crm_companies", live),
    head("crm_email_logs"), head("crm_lead_audit"),
    head("crm_leads", (q) => live(q).is("assigned_to", null)),
    head("crm_leads", (q) => live(q).is("assigned_to", null).not("data->>legacyOwnerName", "is", null).neq("data->>legacyOwnerName", "")),
    head("crm_leads", (q) => live(q).is("phone_norm", null)),
    head("crm_leads", (q) => live(q).not("phone_norm", "is", null)),
    head("crm_leads", (q) => live(q).not("email_id", "is", null).gte("created_at", since24)),
    head("crm_email_logs", (q) => q.gte("created_at", since24)),
    admin.from("crm_email_logs").select("created_at,received_at,data").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("system_config").select("value").eq("key", "ingest_auto").maybeSingle(),
    getConfig<any>("email_config", {}),
    hasSecret("gemini_key"),
    hasSecret("ews_password"),
    admin.from("plots_snapshot").select("generated_at,updated_at,plot_count").eq("id", 1).maybeSingle(),
    head("crm_offer_prints", (q) => q.gte("printed_at", since24)),
  ]);

  const counts = { users: users.n, tickets: tickets.n, workflowRequests: wf.n, leads: leads.n, contacts: contacts.n, companies: companies.n, mailLogs: mailLogs.n, leadAudit: leadAudit.n };
  const dbError = [users, tickets, wf, leads, contacts, companies, mailLogs, leadAudit].some((x) => x.err) ? "Some database reads failed" : null;

  // duplicates: same phone on more than one live lead (reads only the phone column, pages in parallel)
  let dupGroups: number | null = null, dupLeads: number | null = null;
  const nPhone = withPhone.n ?? 0;
  if (!withPhone.err && nPhone > 0) {
    try {
      const pages = Math.min(50, Math.ceil(nPhone / 1000));
      const parts = await Promise.all(Array.from({ length: pages }, (_, i) =>
        admin.from("crm_leads").select("phone_norm").is("deleted_at", null).not("phone_norm", "is", null).order("id").range(i * 1000, i * 1000 + 999)));
      const seen = new Map<string, number>();
      for (const p of parts) { if (p.error) throw new Error("read failed"); for (const r of p.data || []) seen.set(r.phone_norm, (seen.get(r.phone_norm) || 0) + 1); }
      dupGroups = 0; dupLeads = 0;
      for (const v of seen.values()) if (v > 1) { dupGroups++; dupLeads += v; }
    } catch { dupGroups = null; dupLeads = null; }
  }

  // the two live tests (only when asked)
  let emailStatus = "Not Configured", emailError: string | null = null;
  if (cfg.host && hasPass) emailStatus = "Configured (not tested)";
  let aiStatus = hasKey ? "Key saved" : "Missing Key", aiError: string | null = null;
  if (ping) {
    const tasks: Promise<void>[] = [];
    if (cfg.host && hasPass) tasks.push(loadEws().then((e) => verify(e)).then(() => { emailStatus = "Operational"; }).catch((e: any) => { emailStatus = "Error"; emailError = e?.message || "failed"; }));
    if (hasKey) tasks.push((async () => {
      const key = await getSecret("gemini_key");
      try {
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent", {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key || "" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with the single word OK" }] }], generationConfig: { maxOutputTokens: 8 } }),
          signal: AbortSignal.timeout(12000),
        });
        if (res.ok) aiStatus = "Operational"; else { aiStatus = "Error"; aiError = `Gemini answered HTTP ${res.status}`; }
      } catch (e: any) { aiStatus = "Error"; aiError = e?.name === "TimeoutError" ? "Gemini did not answer in 12 s" : "Could not reach Gemini"; }
    })());
    await Promise.all(tasks);
  }

  const last: any = lastMail.data || null;
  return {
    timestamp: nowIso(),
    serverMs: Date.now() - t0,
    database: { connected: !dbError, error: dbError, counts },
    environment: { hasGeminiKey: hasKey, aiStatus, aiError },
    email: { status: emailStatus, error: emailError, host: cfg.host || "", mailbox: cfg.user || "" },
    ingestion: {
      auto: ingestAuto.data?.value === true,
      lastLogAt: last ? (last.created_at || last.received_at || null) : null,
      lastLogStatus: last?.data?.status || null,
      mailLogs24h: mail24.n,
      leadsFromMail24h: leads24.n,
    },
    integration: {
      landBank: {
        snapshotAt: (snap as any).data?.generated_at || (snap as any).data?.updated_at || null,
        count: (snap as any).data?.plot_count ?? 0,
        ageHours: (snap as any).data?.updated_at ? Math.round((Date.now() - new Date((snap as any).data.updated_at).getTime()) / 360000) / 10 : null,
        offerPrints24h: prints24.n,
      },
    },
    leadsHealth: {
      total: leads.n, noOwner: noOwner.n, unlinkedImportedOwners: unlinked.n, missingPhone: noPhone.n,
      duplicatePhoneGroups: dupGroups, duplicatePhoneLeads: dupLeads,
    },
  };
});

route("GET", "/admin/activity", async ({ c, query }) => {
  need(c, "canViewAdminPanel");
  const page = Math.max(1, parseInt(query.get("page") || "1") || 1);
  const limit = Math.max(1, Math.min(100, parseInt(query.get("limit") || "30") || 30));
  const from = (page - 1) * limit;
  const { data, count, error } = await admin.from("activity_logs").select("id,at,user_id,user_name,action,details,type", { count: "exact" }).order("at", { ascending: false }).range(from, from + limit - 1);
  if (error) throw new HttpError(500, "Could not read the activity log");
  return {
    logs: (data || []).map((r: any) => ({ id: r.id, timestamp: r.at, userId: r.user_id || "", userName: r.user_name || "", action: r.action, details: r.details || "", type: r.type })),
    total: count || 0, page, limit,
  };
});

route("POST", "/activity-logs", async ({ req, c }) => {
  await rateLimit(`actlog:${c.id}`, 60, 60);
  const b = await body(req, 20_000);
  const type = ["auth", "ticket", "workflow", "admin", "system"].includes(b.type) ? b.type : "system";
  await logActivity(c, str(b.action, 120) || "Action", str(b.details, 600), type);
  return { success: true };
});

route("POST", "/admin/report-error", async ({ req, c }) => {
  await rateLimit(`reperr:${c.id}`, 60, 20);
  const b = await body(req, 10_000);
  await logActivity(c, "Client error", `${str(b.type, 20)}: ${str(b.message, 400)}`, "system");
  return { success: true };
});

const purge = async ({ c }: { c: Caller }) => {
  needAdmin(c);
  const { count } = await admin.from("notification_logs").select("id", { count: "exact", head: true });
  await admin.from("notification_logs").delete().not("id", "is", null);
  await logActivity(c, "Purge Notification Logs", `${count || 0} notification log rows removed`, "admin");
  return { success: true, message: "All notification logs purged.", count: count || 0 };
};
route("POST", "/admin/notifications/purge-all", purge);
route("POST", "/crm/notifications/purge-all", purge);

route("GET", "/admin/notifications", async ({ c }) => {
  need(c, "canViewAdminPanel");
  const { data } = await admin.from("notification_logs").select("*").order("at", { ascending: false }).limit(100);
  return (data || []).map((r: any) => ({
    id: r.id, timestamp: r.at, to: r.to_email, subject: r.subject, body: "", status: r.status, error: r.error || undefined,
    ticketId: r.ticket_id || undefined, type: r.type || "", received: r.status === "success",
  }));
});

// The old server ran a "force sync to Firestore". Data is now stored in Supabase directly.
route("POST", "/admin/sync", async ({ c }) => {
  need(c, "canViewAdminPanel");
  return { success: true, message: "Nothing to sync: all data is stored in the Supabase database." };
});

// ---------------------------------------------------------------------------------------------
// reference data: categories, SLA, knowledge base
// ---------------------------------------------------------------------------------------------
route("GET", "/categories", async () => {
  const { data } = await admin.from("categories").select("*").order("type").order("subtype");
  return data || [];
});
route("POST", "/categories", async ({ req, c }) => {
  need(c, "canViewAdminPanel");
  const b = await body(req, 10_000);
  const type = str(b.type, 100), subtype = str(b.subtype, 100);
  if (!type || !subtype) throw bad("Type and sub-type are required");
  const { data, error } = await admin.from("categories").insert({ type, subtype, department: str(b.department, 80) || null }).select().single();
  if (error) throw bad("This category already exists");
  return data;
});
route("DELETE", "/categories/:id", async ({ c, params }) => {
  need(c, "canViewAdminPanel");
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw bad("Invalid id");
  const { data } = await admin.from("categories").delete().eq("id", id).select();
  await logActivity(c, "Delete Category", `Category ${data?.[0]?.type || id} - ${data?.[0]?.subtype || ""} deleted`, "admin");
  return { success: true };
});

route("GET", "/sla", async () => {
  const { data } = await admin.from("sla").select("*");
  const order = ["Critical", "High", "Medium", "Low"];
  return (data || []).sort((a: any, b: any) => order.indexOf(a.priority) - order.indexOf(b.priority));
});
route("PUT", "/sla", async ({ req, c }) => {
  need(c, "canViewAdminPanel");
  const b = await body(req, 5_000);
  const priority = str(b.priority, 20);
  const hours = Number(b.hours);
  if (!["Critical", "High", "Medium", "Low"].includes(priority)) throw bad("Unknown priority");
  if (!Number.isInteger(hours) || hours < 1 || hours > 8760) throw bad("Hours must be a whole number between 1 and 8760");
  await admin.from("sla").upsert({ priority, hours });
  await logActivity(c, "Update SLA", `${priority} SLA set to ${hours} h`, "admin");
  return { priority, hours };
});

const artOut = (a: any) => ({ id: a.id, title: a.title, content: a.content, category: a.category || "", author: a.author || "", views: a.views, createdAt: a.created_at });
route("GET", "/articles", async ({ c }) => {
  need(c, "canViewKnowledgeBase");
  const { data } = await admin.from("articles").select("*").order("created_at", { ascending: false });
  return (data || []).map(artOut);
});
const canWriteKb = (c: Caller) => isManager(c) || can(c, "canManageKnowledgeBase") || ["Technician", "Department Head"].includes(c.role);
route("POST", "/articles", async ({ req, c }) => {
  if (!canWriteKb(c)) throw forbidden();
  const b = await body(req, 300_000);
  const title = str(b.title, 200), content = str(b.content, 100_000);
  if (!title || !content) throw bad("Title and content are required");
  const { data, error } = await admin.from("articles").insert({ title, content, category: str(b.category, 80) || null, author: c.name }).select().single();
  if (error) throw new HttpError(500, "Could not save the article");
  return artOut(data);
});
route("DELETE", "/articles/:id", async ({ c, params }) => {
  if (!canWriteKb(c)) throw forbidden();
  if (!UUID_RE.test(params.id)) throw bad("Invalid id");
  const { data } = await admin.from("articles").delete().eq("id", params.id).select("title");
  await logActivity(c, "Delete Article", `Knowledge article "${data?.[0]?.title || params.id}" deleted`, "admin");
  return { success: true };
});

// ---------------------------------------------------------------------------------------------
// ticket e-mail notifications (cannot be used as a mail relay)
// ---------------------------------------------------------------------------------------------
route("POST", "/notify", async ({ req, c }) => {
  await rateLimit(`notify:${c.id}`, 3600, 60);
  const b = await body(req, 50_000);
  const ticketId = Number(b.ticketId);
  if (!Number.isInteger(ticketId)) throw bad("ticketId is required");
  const { data: t } = await admin.from("tickets").select("id,data,requester_id,assigned_to,department").eq("id", ticketId).maybeSingle();
  if (!t) throw notFound("Ticket not found");
  if (!canSeeTicket(c, t)) throw forbidden();
  // the recipient must be a person on this very ticket
  const ids = [t.requester_id, t.assigned_to].filter(Boolean);
  const { data: people } = await admin.from("app_users").select("email").in("id", ids);
  const allowed = new Set((people || []).map((p: any) => String(p.email).toLowerCase()));
  const to = str(b.to, 254).toLowerCase();
  if (!allowed.has(to)) throw forbidden("You can only notify the people on this ticket");

  const subject = str(b.subject, 150).replace(/[\r\n]+/g, " ") || `Ticket ${ticketId} update`;
  const action = str(b.action, 120);
  const text = str(b.body, 4000);
  const appUrl = (await getConfig<any>("app", {})).url || Deno.env.get("APP_URL") || "https://sdm-sales-leads.github.io/";
  const link = `${String(appUrl).replace(/\/$/, "")}/?ticketId=${ticketId}`;
  const html = `<div style="font-family:Segoe UI,Tahoma,Arial,sans-serif;background:#f9f9f9;padding:0;margin:0">
<div style="max-width:600px;margin:20px auto;background:#fff;border:1px solid #e1e1e1;border-radius:8px;overflow:hidden">
<div style="background:#A6192E;padding:18px;text-align:center"><h1 style="color:#fff;margin:0;font-size:22px">SDM Service Desk</h1></div>
<div style="padding:28px;color:#333;line-height:1.6">
<h2 style="color:#A6192E;margin-top:0">${escHtml(action)}</h2>
<p style="white-space:pre-wrap;font-size:15px">${escHtml(text)}</p>
<p style="margin:18px 0"><strong>Ticket:</strong> #${ticketId}</p>
<p style="text-align:center;margin:26px 0"><a href="${escHtml(link)}" style="background:#A6192E;color:#fff;padding:12px 24px;text-decoration:none;border-radius:5px;font-weight:bold">View ticket</a></p>
</div>
<div style="background:#f1f1f1;padding:12px;text-align:center;font-size:12px;color:#888">Automated message. Please do not reply.</div>
</div></div>`;
  let cfgOk = true;
  try { await loadEws(); } catch { cfgOk = false; }
  if (!cfgOk) {
    await admin.from("notification_logs").insert({ to_email: to, subject, status: "skipped", error: "E-mail not configured", ticket_id: String(ticketId), type: "Ticket Update" });
    return { success: true, simulated: true };
  }
  try {
    await sendMail(await loadEws(), { to: [to], subject, html });
    await admin.from("notification_logs").insert({ to_email: to, subject, status: "success", ticket_id: String(ticketId), type: "Ticket Update" });
    return { success: true };
  } catch (e: any) {
    await admin.from("notification_logs").insert({ to_email: to, subject, status: "error", error: String(e?.message || "failed").slice(0, 300), ticket_id: String(ticketId), type: "Ticket Update" });
    throw new HttpError(502, "Failed to send email");
  }
});

// every browser error is written to the activity log with the short code the user sees on screen, so a screenshot can be traced
route("POST", "/client-error", async ({ req, c }) => {
  await rateLimit(`clierr:${c.id}`, 3600, 40);
  const b = await body(req, 8000);
  await logActivity(c, "Client error", `[${str(b.id, 12)}] ${str(b.kind, 12)}: ${str(b.message, 300)} | ${str(b.url, 140)}`, "error");
  return { ok: true };
});
