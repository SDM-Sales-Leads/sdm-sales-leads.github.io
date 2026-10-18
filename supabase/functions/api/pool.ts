// deno-lint-ignore-file no-explicit-any
// The pool of unassigned leads. Leads nobody has worked on go back to the pool; whenever a salesperson has fewer open leads than the
// limit (Setup > Routing rules), the oldest pool leads are handed out, fairly by number and size. Call center leads go first and ignore the limit.
import { admin, asUuid, bad, crmScope, HttpError, needAdmin, needCrm, nowIso, pageAll, rid } from "./lib.ts";
import { route } from "./router.ts";
import { chooseAgent, loadQueue } from "./ingest.ts";
import { addNotifications } from "./notify.ts";

const SYSTEM_TEXT = /^(\[merged\]\s*)*(imported from excel|imported via smart paste|auto-assigned|requested area|sole owner set|transferred to|project changed|merged |assigned to |status changed)/i;
const NOT_A_TOUCH = new Set(["Assignment", "Import", "Creation"]);
const isCC = (d: any) => /call center/i.test(String(d?.channel || ""));

/** nobody did anything with this lead: still New, no contact, no real comment, no meeting, no offer, no qualification note, no activity */
export function isUntouched(d: any): boolean {
  if (!d || (d.status || "New") !== "New") return false;
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
export async function fillPool(limit = 300) {
  const q = await loadQueue();
  if (q.assignmentMethod === "Manual Assignment Only") return { assigned: 0, skipped: "manual assignment only" };
  const rows = await pageAll((a, b) => admin.from("crm_leads").select("id,data").is("assigned_to", null).is("deleted_at", null).eq("status", "New").order("id").range(a, b), 20000);
  const pool = (rows || []).filter((r: any) => !r.data?.mergedInto && !r.data?.assignedSalespersonId)
    .sort((x: any, y: any) => Number(isCC(y.data)) - Number(isCC(x.data)) || String(x.data?.date || "").localeCompare(String(y.data?.date || "")) || String(x.id).localeCompare(String(y.id)));
  const per: Record<string, { name: string; n: number }> = {};
  let assigned = 0, stop = false;
  for (const part of chunks(pool.slice(0, limit), 40)) {
    if (stop) break;
    const picks: { r: any; agent: { id: string; name: string } }[] = [];
    for (const r of part) {
      const agent = await chooseAgent(r.data, q, { ignoreDaily: true, noBackup: true });
      if (!agent) { stop = true; break; }
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
  return { unassigned: count || 0, maxOpen: Number(q.maxLeadsPerSalesperson) || 0 };
});

route("POST", "/crm/pool/fill", async ({ c }) => {
  needCrm(c);
  if (crmScope(c) !== "all") throw new HttpError(403, "Only Sales Operation or an administrator can hand out the pool");
  const t0 = Date.now();
  let assigned = 0, last: any = {};
  const per: Record<string, number> = {};
  while (Date.now() - t0 < 80_000) {
    last = await fillPool(200);
    assigned += last.assigned || 0;
    for (const [k, v] of Object.entries(last.perPerson || {})) per[k] = (per[k] || 0) + (v as number);
    if (!last.assigned) break;
  }
  void bad;
  return { assigned, left: last.left ?? 0, perPerson: per };
});
