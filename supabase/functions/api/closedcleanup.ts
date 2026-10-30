// deno-lint-ignore-file no-explicit-any
// 30 Oct 2026: "Low Budget" and "Not Interested" stop being statuses of their own: such a lead becomes status Lost with the lost reason
// ("Low Budget" / "Not Interested", or the reason it already had). The reports already counted all three as lost, so the totals must not move:
// the dry run rebuilds the report counts (lost, open, lost reasons, per owner / source / project / month) before and after and says whether
// they are identical. The apply refuses to run unless they are. The old status is kept on the lead (legacyStatus) so it can be put back.
import { admin, nowIso, pageAll, rid } from "./lib.ts";

const OLD = ["Low Budget", "Not Interested"];
const LOST_BEFORE = ["Lost", "Low Budget", "Not Interested"];
const CLOSED = ["Won", "Lost", "Not Interested", "Low Budget", "Wrong Number", "Duplicate", "Invalid", "Closed"];

const convert = (d: any) => ({ ...d, status: "Lost", lostReason: d.lostReason || d.status, legacyStatus: d.status });
const reasonOf = (d: any, wasOld: boolean) => wasOld ? (d.lostReason || d.status) : (d.lostReason || d.lostCategory || "Not recorded");

function tally(rows: any[], after: boolean) {
  const t: Record<string, number> = {};
  const add = (k: string) => { t[k] = (t[k] || 0) + 1; };
  for (const r of rows) {
    const d0 = r.data || {};
    const wasOld = OLD.includes(r.status);
    const d = after && wasOld ? convert({ ...d0, status: r.status }) : { ...d0, status: r.status };
    const lost = after ? d.status === "Lost" : LOST_BEFORE.includes(d.status);
    const won = d.status === "Won";
    const open = !won && !lost && !CLOSED.includes(d.status);
    const owner = String(d0.assignedSalespersonName || "—"), src = String(d0.source || "—"), prj = String(d0.project || "—"), mon = String(d0.date || "").slice(0, 7) || "—";
    add("all"); if (lost) add("lost"); if (won) add("won"); if (open) add("open");
    if (lost) { add(`lost|owner|${owner}`); add(`lost|source|${src}`); add(`lost|project|${prj}`); add(`lost|month|${mon}`); add(`reason|${after ? reasonOf(d, false) : reasonOf({ ...d0, status: r.status }, wasOld)}`); }
    if (open) add(`open|owner|${owner}`);
    if (won) add(`won|owner|${owner}`);
  }
  return t;
}

export async function closedStatusCleanup(c: { id: string; name: string }, apply: boolean) {
  const rows: any[] = await pageAll((a, b) => admin.from("crm_leads").select("id,status,data,updated_at").is("deleted_at", null).order("id").range(a, b), 50000) as any[];
  const before = tally(rows, false), after = tally(rows, true);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diffs = [...keys].filter((k) => (before[k] || 0) !== (after[k] || 0)).map((k) => ({ key: k, before: before[k] || 0, after: after[k] || 0 }));
  const hit = rows.filter((r) => OLD.includes(r.status));
  const byStatus: Record<string, number> = {};
  for (const r of hit) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const withOtherReason = hit.filter((r) => r.data?.lostReason && r.data.lostReason !== r.status).length;
  const out: any = { leads: rows.length, toConvert: hit.length, byStatus, withOtherReason, identical: diffs.length === 0, differences: diffs.slice(0, 30), totals: { lost: before.lost || 0, open: before.open || 0, won: before.won || 0 } };
  if (!apply) return out;
  if (diffs.length) return { ...out, applied: 0, refused: "report totals would change" };
  const now = nowIso();
  let done = 0, skipped = 0;
  for (let i = 0; i < hit.length; i += 25) {
    await Promise.all(hit.slice(i, i + 25).map(async (r: any) => {
      const d = convert({ ...r.data, status: r.status });
      d.lastUpdated = now;
      d.timeline = [...(r.data?.timeline || []), { id: rid(), timestamp: now, type: "Status Change", user: "System", title: "Status tidied", description: `"${r.status}" is now Lost with the lost reason "${d.lostReason}".` }];
      const u = await admin.from("crm_leads").update({ data: d, status: "Lost" }).eq("id", r.id).eq("updated_at", r.updated_at).select("id");
      if (u.data?.length) { done++; await admin.from("crm_lead_audit").insert({ lead_id: r.id, actor_id: c.id, actor_name: c.name, action: "status", from_value: r.status, to_value: "Lost", note: "closed status cleanup" }); } else skipped++;
    }));
  }
  return { ...out, applied: done, skippedChangedMeanwhile: skipped };
}
