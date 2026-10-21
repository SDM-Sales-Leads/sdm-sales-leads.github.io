// deno-lint-ignore-file no-explicit-any
// The pool of unassigned leads. Leads nobody has worked on go back to the pool; whenever a salesperson has fewer open leads than the
// limit (Setup > Routing rules), the oldest pool leads are handed out, fairly by number and size. Call center leads go first and ignore the limit.
import { admin, asUuid, bad, crmScope, getConfig, HttpError, needAdmin, needCrm, nowIso, pageAll, rid, setConfig } from "./lib.ts";
import { isTouched } from "./leadrules.ts";
import { SALES_ROLES } from "./ingest.ts";
import { route } from "./router.ts";
import { chooseAgent, loadQueue } from "./ingest.ts";
import { addNotifications } from "./notify.ts";

const SYSTEM_TEXT = /^(\[merged\]\s*)*(imported from excel|imported via smart paste|auto-assigned|requested area|sole owner set|transferred to|project changed|merged |assigned to |status changed)/i;
const NOT_A_TOUCH = new Set(["Assignment", "Import", "Creation"]);
const isCC = (d: any) => /call center/i.test(String(d?.channel || ""));

/** nobody did anything with this lead: still New, no contact, no real comment, no meeting, no offer, no qualification note, no activity */
export function isUntouched(d: any): boolean {
  if (!d || (d.status || "New") !== "New" || d.touched === true) return false;
  if (d.firstContactAt || d.lastContactDate || d.meetingDate || d.offerSent || d.qualNotes || d.mergedInto) return false;
  if ((d.comments || []).some((c: any) => !SYSTEM_TEXT.test(String(c?.comment || "").trim()))) return false;
  if ((d.timeline || []).some((e: any) => e && !NOT_A_TOUCH.has(e.type))) return false;
  return true;
}

const chunks = <T>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/** one-off: leads brought from the old CRM that nobody touched go back to the pool (their follow-up date was only a default) */
export async function unassignUntouched(dryRun: boolean, everyLead = false) {
  const rows = await pageAll((a, b) => { let q: any = admin.from("crm_leads").select("id,assigned_to,data").is("deleted_at", null).not("assigned_to", "is", null).eq("status", "New"); if (!everyLead) q = q.not("data->>legacyId", "is", null); return q.order("id").range(a, b); }, 20000);
  const hit = (rows || []).filter((r: any) => isUntouched(r.data));
  const byOwner: Record<string, number> = {};
  for (const r of hit) { const n = r.data?.assignedSalespersonName || "?"; byOwner[n] = (byOwner[n] || 0) + 1; }
  if (dryRun) return { scanned: (rows || []).length, toPool: hit.length, byOwner };
  const now = nowIso();
  let done = 0;
  for (const part of chunks(hit, 25)) {
    await Promise.all(part.map(async (r: any) => {
      const d = { ...r.data, assignedSalespersonId: "", assignedSalespersonName: "", assignedDate: "", nextFollowUpDate: "", firstContactAt: "", lastUpdated: now,
        timeline: [...(r.data.timeline || []), { id: rid(), timestamp: now, type: "Assignment", user: "System", title: "Returned to the pool", description: `Not touched by ${r.data?.assignedSalespersonName || "its owner"}: no contact, comment or activity.` }] };
      const u = await admin.from("crm_leads").update({ data: d, assigned_to: null }).eq("id", r.id).eq("assigned_to", r.assigned_to).select("id");
      if (u.data?.length) done++;
    }));
  }
  return { scanned: (rows || []).length, toPool: hit.length, moved: done, byOwner };
}

/** hands out pool leads, oldest first (call center first), to whoever is below the limit, fair by number and size */
export async function fillPool(limit = 300, force = false) {
  const q = await loadQueue();
  if (q.assignmentMethod === "Manual Assignment Only") return { assigned: 0, skipped: "manual assignment only" };
  // when the last run found nobody with a free place, wait 10 minutes before reading the whole pool again (the scheduler calls every 5)
  if (!force) { const st = await getConfig<any>("pool_wait", {}); if (st.until && Date.parse(st.until) > Date.now()) return { assigned: 0, skipped: "nobody has a free place yet" }; }
  const rows = await pageAll((a, b) => admin.from("crm_leads").select("id,data").is("assigned_to", null).is("deleted_at", null).eq("status", "New").order("id").range(a, b), 20000);
  // a touched lead never goes back to the pool automatically (somebody already spoke to the customer)
  const pool = (rows || []).filter((r: any) => !r.data?.mergedInto && !r.data?.assignedSalespersonId && !isTouched(r.data))
    .sort((x: any, y: any) => Number(isCC(y.data)) - Number(isCC(x.data)) || String(x.data?.date || "").localeCompare(String(y.data?.date || "")) || String(x.id).localeCompare(String(y.id)));
  const per: Record<string, { name: string; n: number }> = {};
  let assigned = 0, stop = false;
  for (const part of chunks(pool.slice(0, limit), 40)) {
    if (stop) break;
    const picks: { r: any; agent: { id: string; name: string } }[] = [];
    for (const r of part) {
      const agent = await chooseAgent(r.data, q, { ignoreDaily: true, noBackup: true });
      if (!agent) continue;   // 21 Oct 2026: a lead too big for anyone is skipped, it no longer stops the whole pool
      picks.push({ r, agent });
    }
    const now = nowIso();
    await Promise.all(picks.map(async ({ r, agent }) => {
      const d = { ...r.data, assignedSalespersonId: agent.id, assignedSalespersonName: agent.name, assignedDate: now, lastUpdated: now,
        timeline: [...(r.data.timeline || []), { id: rid(), timestamp: now, type: "Assignment", user: "System", title: "Assigned from the pool", description: `Assigned to ${agent.name} from the pool (oldest first, ${q.assignmentMethod}).` }] };
      const u = await admin.from("crm_leads").update({ data: d, assigned_to: asUuid(agent.id) }).eq("id", r.id).is("assigned_to", null).select("id");
      if (u.data?.length) { assigned++; (per[agent.id] ||= { name: agent.name, n: 0 }).n++; }
    }));
  }
  if (!force) await setConfig("pool_wait", assigned === 0 && pool.length > 0 ? { until: new Date(Date.now() + 10 * 60_000).toISOString() } : {}).catch(() => {});
  const bells = Object.entries(per).map(([userId, v]) => ({ userId, type: "assigned", title: `${v.n} new lead${v.n === 1 ? "" : "s"} assigned to you from the pool`, body: "The oldest waiting leads were handed out first." }));
  if (bells.length) await addNotifications(bells);
  return { assigned, left: Math.max(0, pool.length - assigned), perPerson: Object.fromEntries(Object.values(per).map((v) => [v.name, v.n])) };
}

route("POST", "/admin/unassign-untouched", async ({ req, c }) => {
  needAdmin(c);
  let b: any = {}; try { b = await req.json(); } catch { /* none */ }
  return await unassignUntouched(b?.dryRun !== false && b?.confirm !== "RETURN UNTOUCHED TO THE POOL", b?.everyLead === true);
});

route("GET", "/crm/pool/status", async ({ c }) => {
  needCrm(c);
  if (crmScope(c) !== "all") throw new HttpError(403, "You do not have permission for this action");
  const { count } = await admin.from("crm_leads").select("id", { count: "exact", head: true }).is("assigned_to", null).is("deleted_at", null).eq("status", "New");
  const q = await loadQueue();
  return { unassigned: count || 0, maxOpen: (Number(q.maxTouchedPerSalesperson) || 0) + (Number(q.maxUntouchedPerSalesperson) || 0), maxTouched: Number(q.maxTouchedPerSalesperson) || 0, maxUntouched: Number(q.maxUntouchedPerSalesperson) || 0 };
});

route("POST", "/crm/pool/fill", async ({ c }) => {
  needCrm(c);
  if (crmScope(c) !== "all") throw new HttpError(403, "Only Sales Operation or an administrator can hand out the pool");
  const t0 = Date.now();
  let assigned = 0, last: any = {};
  const per: Record<string, number> = {};
  while (Date.now() - t0 < 80_000) {
    last = await fillPool(200, true);
    assigned += last.assigned || 0;
    for (const [k, v] of Object.entries(last.perPerson || {})) per[k] = (per[k] || 0) + (v as number);
    if (!last.assigned) break;
  }
  void bad;
  return { assigned, left: last.left ?? 0, perPerson: per };
});

// ---------------------------------------------------------------------------------------------
// two pools per salesperson: touched and untouched open leads
// ---------------------------------------------------------------------------------------------
const CLOSED = new Set(["Won", "Lost", "Duplicate", "Invalid", "Not Interested", "Low Budget", "Wrong Number", "Closed"]);

/** one-off and safe to repeat: (1) marks every lead somebody already worked on as touched, (2) a person above the untouched limit
 *  (or above the total) hands the surplus untouched leads back to the pool, newest assignment first. Touched leads are never taken away. */
async function rebalance(dryRun: boolean) {
  const q = await loadQueue();
  const maxT = Number(q.maxTouchedPerSalesperson) || 300, maxU = Number(q.maxUntouchedPerSalesperson) || 300;
  const { data: users } = await admin.from("app_users").select("id,name").in("role", SALES_ROLES).eq("active", true);
  const name = new Map((users || []).map((u: any) => [u.id, u.name]));
  const rows = await pageAll((a, b) => admin.from("crm_leads").select("id,assigned_to,status,data").is("deleted_at", null).not("assigned_to", "is", null).order("id").range(a, b), 20000);
  const mine = (rows || []).filter((r: any) => name.has(r.assigned_to) && !CLOSED.has(r.status || "") && !r.data?.mergedInto);
  const per: Record<string, { name: string; touched: number; untouched: number; back: any[] }> = {};
  const stamp: any[] = [];
  for (const r of mine) {
    const p = (per[r.assigned_to] ||= { name: String(name.get(r.assigned_to)), touched: 0, untouched: 0, back: [] });
    if (isTouched(r.data)) { p.touched++; if (r.data?.touched !== true) stamp.push(r); } else p.untouched++;
  }
  // leads of people who are not active sales users (or closed ones) that were worked on are stamped too
  for (const r of rows || []) if (!mine.includes(r) && !r.data?.mergedInto && r.data?.touched !== true && isTouched(r.data)) stamp.push(r);
  for (const [uid, p] of Object.entries(per)) {
    const allowedU = Math.min(maxU, Math.max(0, maxT + maxU - p.touched));
    const surplus = Math.max(0, p.untouched - allowedU);
    if (surplus) p.back = mine.filter((r: any) => r.assigned_to === uid && !isTouched(r.data))
      .sort((x: any, y: any) => String(y.data?.assignedDate || "").localeCompare(String(x.data?.assignedDate || ""))).slice(0, surplus);
  }
  const report = Object.fromEntries(Object.values(per).map((p) => [p.name, { touched: p.touched, untouched: p.untouched, returnToPool: p.back.length, afterUntouched: p.untouched - p.back.length, overTouchedLimit: Math.max(0, p.touched - maxT) }]));
  if (dryRun) return { dryRun: true, toMarkTouched: stamp.length, report };
  const now = nowIso();
  let marked = 0, returned = 0;
  for (const part of chunks(stamp, 25)) await Promise.all(part.map(async (r: any) => {
    const u = await admin.from("crm_leads").update({ data: { ...r.data, touched: true } }).eq("id", r.id).select("id");
    if (u.data?.length) marked++;
  }));
  for (const p of Object.values(per)) for (const part of chunks(p.back, 25)) await Promise.all(part.map(async (r: any) => {
    const d = { ...r.data, touched: false, assignedSalespersonId: "", assignedSalespersonName: "", assignedDate: "", nextFollowUpDate: "", firstContactAt: "", lastUpdated: now,
      timeline: [...(r.data.timeline || []), { id: rid(), timestamp: now, type: "Assignment", user: "System", title: "Returned to the pool", description: `${p.name} was above the untouched limit (${maxU}); the lead went back to the pool.` }] };
    delete (d as any).touched;
    const u = await admin.from("crm_leads").update({ data: d, assigned_to: null }).eq("id", r.id).eq("assigned_to", r.assigned_to).select("id");
    if (u.data?.length) returned++;
  }));
  return { marked, returned, report };
}

route("POST", "/admin/rebalance", async ({ req, c }) => {
  needAdmin(c);
  let b: any = {}; try { b = await req.json(); } catch { /* none */ }
  return await rebalance(!(b?.dryRun === false && b?.confirm === "REBALANCE"));
});

/** touched / untouched open leads of the caller (reps), their team (team leaders) or everybody (managers) */
route("GET", "/crm/load", async ({ c }) => {
  needCrm(c);
  const q = await loadQueue();
  const scope = crmScope(c);
  let ids: string[] = [];
  if (scope === "own") ids = [c.id];
  else {
    let qq: any = admin.from("app_users").select("id").in("role", SALES_ROLES).eq("active", true);
    if (scope === "team") { const { teamIds } = await import("./routes_crm.ts"); ids = await teamIds(c); qq = qq.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]); }
    ids = ((await qq).data || []).map((u: any) => u.id);
    if (scope === "team" && !ids.includes(c.id) && SALES_ROLES.includes(c.role)) ids.push(c.id);
  }
  const { data: names } = await admin.from("app_users").select("id,name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const rows = ids.length ? await pageAll((a, b) => admin.from("crm_leads").select("assigned_to,status,data->touched").in("assigned_to", ids).is("deleted_at", null).order("id").range(a, b)) : [];
  const per: Record<string, { touched: number; untouched: number }> = {};
  for (const r of rows || []) {
    if (CLOSED.has(r.status || "")) continue;
    const p = (per[r.assigned_to as string] ||= { touched: 0, untouched: 0 });
    if ((r as any).touched === true || (r.status || "New") !== "New") p.touched++; else p.untouched++;
  }
  const people = (names || []).map((u: any) => ({ id: u.id, name: u.name, touched: per[u.id]?.touched || 0, untouched: per[u.id]?.untouched || 0 })).sort((a: any, b: any) => a.name.localeCompare(b.name));
  return { maxTouched: Number(q.maxTouchedPerSalesperson) || 0, maxUntouched: Number(q.maxUntouchedPerSalesperson) || 0, me: people.find((p: any) => p.id === c.id) || { id: c.id, name: c.name, touched: 0, untouched: 0 }, people: scope === "own" ? [] : people };
});

/** how the call center leads were shared (last 30 days, leads of this system) and who is next in line */
route("GET", "/crm/call-center/fairness", async ({ c }) => {
  needCrm(c);
  const scope = crmScope(c);
  if (scope !== "all" && scope !== "viewall" && c.perms?.canViewSalesMail !== true) throw new HttpError(403, "You do not have permission for this action");
  const q = await loadQueue();
  const trace: any[] = [];
  const next = await chooseAgent({ channel: "Call Center" }, q, { sim: {}, trace, ignoreDaily: true, noBackup: true });
  const total = trace.reduce((a, t) => a + t.ccLeads, 0), totalSqm = trace.reduce((a, t) => a + t.ccSqm, 0);
  const { count: waiting } = await admin.from("crm_leads").select("id", { count: "exact", head: true }).is("assigned_to", null).is("deleted_at", null).eq("status", "New").ilike("data->>channel", "%call center%");
  return {
    days: 30, total, totalSqm, waiting: waiting || 0, nextId: next?.id || null, nextName: next?.name || null,
    people: trace.map((t) => ({ id: t.id, name: t.name, leads: t.ccLeads, sqm: t.ccSqm, sharePct: total ? Math.round((t.ccLeads / total) * 100) : null, sqmSharePct: totalSqm ? Math.round((t.ccSqm / totalSqm) * 100) : null }))
      .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name)),
  };
});

/** the status and the owner are stored twice (in columns, used by routing and the counts, and inside the lead); report where they differ */
route("POST", "/admin/lead-consistency", async ({ c }) => {
  needAdmin(c);
  const rows = await pageAll((a, z) => admin.from("crm_leads").select("id,status,assigned_to,data").is("deleted_at", null).order("id").range(a, z), 30000);
  const statusPairs: Record<string, number> = {}, byOwner: Record<string, number> = {};
  let different = 0;
  for (const r of rows || []) {
    const ds = r.data?.status || "New", cs = r.status || "New";
    const od = asUuid(r.data?.assignedSalespersonId) || null, oc = r.assigned_to || null;
    if (ds !== cs || od !== oc) {
      different++;
      if (ds !== cs) { const k = `${cs} (column) vs ${ds} (lead)`; statusPairs[k] = (statusPairs[k] || 0) + 1; }
      const n = r.data?.assignedSalespersonName || "(none)"; byOwner[n] = (byOwner[n] || 0) + 1;
    }
  }
  return { scanned: (rows || []).length, different, statusPairs, byOwner };
});
