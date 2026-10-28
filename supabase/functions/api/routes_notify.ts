// deno-lint-ignore-file no-explicit-any
// The bell (per-user notifications), "forgot password" with an e-mailed code, and the reminder schedule.
import { admin, body, getConfig, needAdmin, setConfig, bad, escHtml, getSecret, HttpError, isObj, logActivity, normEmail, nowIso, rateLimit, safeEqual, str } from "./lib.ts";
import { route } from "./router.ts";
import { loadEws, sendMail } from "./ews.ts";
import { crmScope, needCrm as _nc } from "./lib.ts";
import { SPECS, teamIds } from "./routes_crm.ts";
import { fillPool } from "./pool.ts";
import { usageGuard } from "./usage.ts";
import { appBase, escalateCallCenter, notifyOnHold, resetHoldCache, runReminders, sendAssignDigest } from "./notify.ts";

// ---------------------------------------------------------------------------------------------
// the bell
// ---------------------------------------------------------------------------------------------
route("GET", "/crm/my-notifications", async ({ c, query }) => {
  const limit = Math.max(1, Math.min(Number(query.get("limit")) || 40, 100));
  const [list, unread] = await Promise.all([
    admin.from("crm_notifications").select("id,type,lead_id,title,body,created_at,read_at").eq("user_id", c.id).order("created_at", { ascending: false }).limit(limit),
    admin.from("crm_notifications").select("id", { count: "exact", head: true }).eq("user_id", c.id).is("read_at", null),
  ]);
  return { unread: unread.count || 0, items: (list.data || []).map((n: any) => ({ id: n.id, type: n.type, leadId: n.lead_id, title: n.title, body: n.body, at: n.created_at, read: !!n.read_at })) };
});

route("POST", "/crm/notifications/read", async ({ req, c }) => {
  const b = await body(req, 20_000);
  let q = admin.from("crm_notifications").update({ read_at: nowIso() }).eq("user_id", c.id).is("read_at", null);
  if (!b.all) {
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter((x: any) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
    if (!ids.length) return { success: true };
    q = q.in("id", ids);
  }
  await q;
  return { success: true };
});

// hold / unhold every bell notification and reminder/assignment e-mail (the password-reset code is never held)
route("GET", "/admin/notify-hold", async ({ c }) => { needAdmin(c); return { hold: await getConfig<any>("notify_hold", true) !== false }; });
route("POST", "/admin/notify-hold", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 500);
  await setConfig("notify_hold", b.hold !== false);
  resetHoldCache();
  await logActivity(c, "Notifications", b.hold !== false ? "Notifications and e-mails put on hold" : "Notifications and e-mails switched on", "admin");
  return { hold: b.hold !== false };
});

// ---------------------------------------------------------------------------------------------
// forgot password: a 6-digit code to the work e-mail (from the no-reply mailbox), then a new password
// ---------------------------------------------------------------------------------------------
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((x) => x.toString(16).padStart(2, "0")).join("");
const pepper = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CODE_MINUTES = 15;

route("POST", "/auth/forgot", async ({ req }) => {
  const b = await body(req, 2000);
  const email = normEmail(str(b.email, 254));
  const generic = { success: true, message: "If this e-mail belongs to an active account, a code was sent to it." };   // never says whether the account exists
  if (!email || !email.includes("@")) return generic;
  await rateLimit(`forgot:${email}`, 3600, 4);
  await rateLimit("forgot:all", 3600, 120);
  const { data: u } = await admin.from("app_users").select("id,name,email,active").ilike("email", email.replace(/[%_\\]/g, (m) => "\\" + m)).limit(1).maybeSingle();
  if (!u || u.active === false || normEmail(u.email) !== email) { await logActivity(null, "Password reset: no active account", `${email} asked for a code but no active account has this e-mail`, "security").catch(() => {}); return generic; }
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  await admin.from("pw_resets").upsert({ email, code_hash: await sha(`${code}:${email}:${pepper()}`), expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), tries: 0, created_at: nowIso() });
  try {
    const base = await appBase();
    await sendMail(await loadEws(), {
      to: [u.email], subject: "Your SDM Sales Leads password reset code",
      html: `<div style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:520px;margin:20px auto;border:1px solid #e1e1e1;border-radius:8px;overflow:hidden">
<div style="background:#A6192E;padding:16px 22px;color:#fff;font-size:18px;font-weight:600">SDM Sales Leads</div>
<div style="padding:24px;color:#333;line-height:1.6;font-size:15px"><p>Hello ${escHtml(u.name || "")},</p>
<p>Use this code to set a new password. It is valid for ${CODE_MINUTES} minutes and works once.</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#A6192E;margin:18px 0">${code}</p>
<p><a href="${escHtml(base)}#reset=${encodeURIComponent(email)}" style="color:#A6192E;font-weight:700">Open the reset page</a> and enter the code there.</p>
<p style="color:#888;font-size:13px">If you did not ask for this, ignore this e-mail: your password stays as it is.</p></div></div>`,
    });
    await logActivity(null, "Password reset code sent", `${email}`, "security").catch(() => {});
  } catch (e: any) {
    // the user still gets the same answer, but the admin can now see why no mail arrived (Settings > activity log)
    await logActivity(null, "Password reset mail FAILED", `${email}: ${String(e?.message || e).slice(0, 220)}`, "error").catch(() => {});
  }
  return generic;
}, { public: true });

route("POST", "/auth/reset", async ({ req }) => {
  const b = await body(req, 4000);
  const email = normEmail(str(b.email, 254));
  const code = str(b.code, 12).replace(/\s/g, "");
  const password = typeof b.password === "string" ? b.password : "";
  if (!email || !/^\d{6}$/.test(code)) throw bad("Enter the 6-digit code from the e-mail");
  if (password.length < 8 || password.length > 100 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw bad("The new password needs at least 8 characters, with letters and numbers");
  await rateLimit(`reset:${email}`, 3600, 12);
  const { data: r } = await admin.from("pw_resets").select("*").eq("email", email).maybeSingle();
  const wrong = new HttpError(400, "The code is wrong or has expired. Ask for a new one.");
  if (!r || new Date(r.expires_at).getTime() < Date.now() || r.tries >= 5) throw wrong;
  if (!safeEqual(await sha(`${code}:${email}:${pepper()}`), r.code_hash)) {
    await admin.from("pw_resets").update({ tries: r.tries + 1 }).eq("email", email);
    throw wrong;
  }
  const { data: u } = await admin.from("app_users").select("id,name,active").ilike("email", email.replace(/[%_\\]/g, (m) => "\\" + m)).limit(1).maybeSingle();
  if (!u || u.active === false) throw wrong;
  const up = await admin.auth.admin.updateUserById(u.id, { password });
  if (up.error) throw new HttpError(400, "That password was not accepted. Try a longer one.");
  await admin.from("pw_resets").delete().eq("email", email);                    // the code works once
  await admin.from("app_users").update({ must_change_password: false }).eq("id", u.id);
  await logActivity(null, "Password reset", `${u.name || email} reset the password with an e-mailed code`, "security");
  return { success: true };
}, { public: true });

// ---------------------------------------------------------------------------------------------
// bulk e-mail to customers: one personal mail each (never a visible list of addresses), sent from the system mailbox with the
// salesperson as Reply-To. Up to 25 leads per call; the page calls it in rounds. Switched off while notifications are on hold.
// ---------------------------------------------------------------------------------------------
route("POST", "/crm/bulk-email", async ({ req, c }) => {
  _nc(c);
  throw bad("Customer e-mails are not sent from the system. Use your own mailbox: download the e-mail file or open it in your e-mail program.");
  if (await notifyOnHold()) throw bad("E-mails to customers are switched off during testing. Use \"Open in my own e-mail\" instead.");
  await rateLimit(`bulkmail:${c.id}`, 3600, 600);
  const b = await body(req, 200_000);
  const ids = (Array.isArray(b.leadIds) ? b.leadIds : []).map((x: any) => str(x, 60)).filter(Boolean).slice(0, 25);
  const subject = str(b.subject, 200).trim(), text = str(b.message, 8000).trim();
  if (!ids.length) throw bad("Choose at least one lead");
  if (!subject || !text) throw bad("Write a subject and a message");
  const scope = crmScope(c);
  const team = scope === "team" ? await teamIds(c) : [];
  const { data: rows } = await admin.from("crm_leads").select("*").in("id", ids).is("deleted_at", null);
  const cfg = await loadEws();
  const { data: me } = await admin.from("app_users").select("email,name").eq("id", c.id).maybeSingle();
  const results: { id: string; ok: boolean; reason?: string }[] = [];
  for (const id of ids) {
    const r = (rows || []).find((x: any) => x.id === id);
    if (!r || !SPECS.leads.owns(c, scope, team, r)) { results.push({ id, ok: false, reason: "not allowed" }); continue; }
    const to = String(r.data?.email || "").trim();
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(to)) { results.push({ id, ok: false, reason: "no valid e-mail" }); continue; }
    const fill = (t: string) => t.replace(/\{name\}/g, r.data?.customerName || "").replace(/\{company\}/g, r.data?.companyName || "").replace(/\{project\}/g, r.data?.project || "our industrial cities").replace(/\{rep\}/g, me?.name || c.name || "");
    const html = `<div style="font-family:Segoe UI,Tahoma,Arial,sans-serif;font-size:15px;line-height:1.6;color:#222" dir="auto">${escHtml(fill(text)).replace(/\n/g, "<br>")}<br><br><span style="color:#888;font-size:12px">${escHtml(me?.name || "")} · Elsewedy Industrial Development</span></div>`;
    try { await sendMail(cfg, { to: [to], subject: fill(subject), html, replyTo: me?.email || undefined }); results.push({ id, ok: true }); }
    catch (e: any) { results.push({ id, ok: false, reason: String(e?.message || "send failed").slice(0, 80) }); if (/rejected|HTTP 5|throttl/i.test(String(e?.message))) break; }
  }
  await logActivity(c, "Bulk e-mail", `${results.filter((x) => x.ok).length} of ${ids.length} sent`, "ticket");
  return { results };
});

// ---------------------------------------------------------------------------------------------
// reminders: the scheduler calls this every 5 minutes
// ---------------------------------------------------------------------------------------------
route("POST", "/cron/reminders", async ({ req }) => {
  const given = req.headers.get("x-cron-secret") || "";
  const want = await getSecret("cron_secret");
  if (!want || !safeEqual(given, want)) throw new HttpError(401, "Not allowed");
  const { data } = await admin.from("system_config").select("value").eq("key", "ingest_auto").maybeSingle();
  if (data?.value !== true) return { skipped: true, reason: "automatic jobs are off" };
  // nobody is at work between 22:00 and 07:00 Cairo time: no escalations, pool hand-outs or digests to prepare.
  // Reminders (meetings, follow-ups, tasks) run until 23:00 (confirmed rule); this gate used to stop them at 22:00.
  const hourNow = +new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hourCycle: "h23" }).format(new Date());
  if (hourNow < 7 || hourNow >= 23) return { skipped: true, reason: "night" };
  const T: Record<string, number> = {}; const lap = async <X,>(k: string, f: () => Promise<X>): Promise<X> => { const t0 = Date.now(); try { return await f(); } finally { T[k] = Date.now() - t0; } };
  let r: any = {}; try { r = await lap("reminders", () => runReminders()); } catch (e: any) { r = { remindersError: String(e?.message || e).slice(0, 120) }; }
  if (hourNow >= 22) return { ...r, late: "22:00-23:00: reminders only", ms: T };
  // the 24-hour call-center limits do not need a look every 5 minutes: every half hour is plenty (it reads the last 3 days of call-center leads)
  let cc: any = {}; if (new Date().getMinutes() % 30 < 5) { try { cc = await lap("callcenter", () => escalateCallCenter()); } catch (e: any) { cc = { ccError: String(e?.message || e).slice(0, 120) }; } } else cc = { ccSkipped: "every 30 min" };
  let pool: any = {}; try { pool = await lap("pool", () => fillPool(300)); } catch (e: any) { pool = { poolError: String(e?.message || e).slice(0, 120) }; }
  let dg: any = {}; try { dg = await lap("digest", () => sendAssignDigest()); } catch (e: any) { dg = { digestError: String(e?.message || e).slice(0, 120) }; }
  let ug: any = {}; try { if (+new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hourCycle: "h23" }).format(new Date()) >= 8) ug = await lap("usage", () => usageGuard()); } catch { /* ignore */ }
  return { ...r, ...cc, pool, ...dg, ...ug, ms: T };
}, { public: true });

void isObj;
