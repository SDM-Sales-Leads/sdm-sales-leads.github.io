// deno-lint-ignore-file no-explicit-any
// Merged-in features of the previous CRM: cash confirmation (accounts receivable), the lead audit trail, owner linking.
import { admin, pageAll, bad, body, can, Caller, crmScope, forbidden, HttpError, logActivity, need, needAdmin, needCrm, nowIso, rateLimit, str } from "./lib.ts";
import { route } from "./router.ts";

async function teamIds(c: Caller): Promise<string[]> {
  const { data } = await admin.from("app_users").select("id").eq("team_leader_id", c.id);
  return [c.id, ...((data || []).map((r: any) => r.id))];
}

/** may this caller see this lead row? (same rule as the list) */
async function visibleLead(c: Caller, id: string) {
  const { data: ex } = await admin.from("crm_leads").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!ex) return null;
  const scope = crmScope(c);
  if (scope === "all" || scope === "viewall") return ex;
  if (scope === "finance") return ex.status === "Won" ? ex : null;
  if (ex.assigned_to === c.id || ex.created_by === c.id) return ex;
  if (scope === "team" && ex.assigned_to && (await teamIds(c)).includes(ex.assigned_to)) return ex;
  return null;
}

// Accounts receivable confirms (or re-opens) the cash value of a won deal. Only people with canConfirmCash.
route("POST", "/crm/leads/:id/cash", async ({ req, c, params }) => {
  needCrm(c);
  if (!(can(c, "canConfirmCash"))) throw forbidden("Only accounts receivable can confirm cash");
  await rateLimit(`cash:${c.id}`, 60, 60);
  const b = await body(req, 2000);
  const action = b.action === "reopen" ? "reopen" : "confirm";
  const ex = await visibleLead(c, params.id);
  if (!ex) throw new HttpError(404, "Lead not found");
  if (ex.status !== "Won") throw bad("Only a won deal has cash to confirm");
  const d = { ...ex.data };
  const now = nowIso();
  const before = d.cashStatus || "pending";
  if (action === "confirm") {
    if (!(Number(d.dealValue) > 0)) throw bad("The deal has no value to confirm");
    d.cashStatus = "confirmed"; d.cashBy = c.name; d.cashDate = now.slice(0, 10);
  } else {
    const reason = str(b.reason, 300);
    if (!reason) throw bad("Say why the cash is re-opened");
    d.cashStatus = "pending"; d.cashBy = ""; d.cashDate = "";
  }
  d.lastUpdated = now;
  d.timeline = [...(d.timeline || []), { id: crypto.randomUUID(), timestamp: now, type: "Approval", user: c.name, title: action === "confirm" ? "Cash confirmed" : "Cash re-opened", description: action === "confirm" ? `EGP ${Number(d.dealValue).toLocaleString("en-US")} confirmed by accounts receivable.` : `Re-opened: ${str(b.reason, 300)}` }];
  const u = await admin.from("crm_leads").update({ data: d }).eq("id", ex.id).eq("updated_at", ex.updated_at).select("*");
  if (u.error || !u.data?.length) throw new HttpError(409, "Someone changed this deal at the same time. Reload and try again.");
  await admin.from("crm_lead_audit").insert({ lead_id: ex.id, actor_id: c.id, actor_name: c.name, action: "cash", from_value: before, to_value: d.cashStatus, note: action === "reopen" ? str(b.reason, 300) : null });
  return { success: true, lead: { ...u.data[0].data, id: ex.id, _rev: u.data[0].updated_at } };
});

// who changed what on one lead
route("GET", "/crm/leads/:id/audit", async ({ c, params }) => {
  needCrm(c);
  if (!(await visibleLead(c, params.id))) throw new HttpError(404, "Lead not found");
  const { data } = await admin.from("crm_lead_audit").select("*").eq("lead_id", params.id).order("at", { ascending: false }).limit(200);
  return data || [];
});

// the whole trail, for operations / admin: filter by action, actor, lead, date
route("GET", "/crm/audit", async ({ c, query }) => {
  needCrm(c);
  if (!(crmScope(c) === "all" || can(c, "canViewSalesAudit"))) throw forbidden();
  await rateLimit(`audit:${c.id}`, 60, 60);
  let q: any = admin.from("crm_lead_audit").select("*").order("at", { ascending: false });
  const action = query.get("action"); if (action) { const list = action.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 30); q = list.length === 1 ? q.eq("action", list[0]) : q.in("action", list); }
  const actor = query.get("actor"); if (actor) q = q.ilike("actor_name", `%${actor.replace(/[%_]/g, "")}%`);
  const lead = query.get("lead"); if (lead) q = q.eq("lead_id", lead);
  const from = query.get("from"); if (from && !isNaN(Date.parse(from))) q = q.gte("at", new Date(from).toISOString());
  const to = query.get("to"); if (to && !isNaN(Date.parse(to))) q = q.lte("at", new Date(to).toISOString());
  const size = Math.min(200, Math.max(10, Number(query.get("size")) || 50));
  const page = Math.max(0, Number(query.get("page")) || 0);
  const { data, error } = await q.range(page * size, page * size + size - 1);
  if (error) throw new HttpError(500, "Could not load the audit trail");
  return { rows: data || [], page, size };
});

// attach imported leads to users by owner name (also runs automatically when a user is created)
route("POST", "/crm/link-owners", async ({ c }) => {
  needAdmin(c);
  const { data: users } = await admin.from("app_users").select("id,name").eq("active", true);
  let total = 0;
  for (const u of users || []) {
    const { data } = await admin.rpc("crm_link_owner", { p_user: u.id, p_name: u.name });
    total += Number(data) || 0;
  }
  const { count } = await admin.from("crm_leads").select("id", { count: "exact", head: true }).is("assigned_to", null).is("deleted_at", null);
  await logActivity(c, "Link imported leads", `${total} lead(s) linked to users`, "admin");
  return { success: true, linked: total, stillUnlinked: count || 0 };
});

// names of imported owners that have no user yet (so the admin knows whom to create)
route("GET", "/crm/unlinked-owners", async ({ c }) => {
  needAdmin(c);
  const data = await pageAll((a, b) => admin.from("crm_leads").select("data").is("assigned_to", null).is("deleted_at", null).order("id").range(a, b));
  const m: Record<string, number> = {};
  for (const r of data || []) { const n = String(r.data?.legacyOwnerName || r.data?.assignedSalespersonName || "").trim(); if (n) m[n] = (m[n] || 0) + 1; }
  return Object.entries(m).map(([name, leads]) => ({ name, leads })).sort((a, b) => b.leads - a.leads);
});
