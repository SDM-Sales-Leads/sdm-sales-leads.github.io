// deno-lint-ignore-file no-explicit-any
// 2 Nov 2026: one-off (re-runnable) clean-up of the project names on existing leads: every spelling of a park becomes the Land Bank name from parks.ts.
// Names that match no park, or two parks, are left exactly as typed and listed. Dry run first ({apply:false}); the old name is kept in data.legacyProject.
import { admin, nowIso, pageAll } from "./lib.ts";
import { canonicalPark } from "./parks.ts";

const NOT_A_PROJECT = /^(of interest|plan your visit|opportunities page|contact us|n\/a|none|-)$/i;
const D75_NOTE = /Project of interest:\s*Asher D75/i;

function target(d: any): { to: string; why: string } | null {
  const raw = String(d?.project ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return null;
  if (NOT_A_PROJECT.test(raw)) return { to: "", why: "not a project" };
  const park = canonicalPark(raw);
  if (park && park !== raw) return { to: park, why: "spelling" };
  if (park === "Industria Asher" && D75_NOTE.test(String(d.description || ""))) return { to: "Asher D75", why: "D75 note" };
  return null;
}

export async function projectCleanup(c: { id: string; name: string }, apply: boolean, withD75Notes: boolean, fillBlanks = false, excludeIds: string[] = []) {
  const rows: any[] = await pageAll((a, b) => admin.from("crm_leads").select("id,data,updated_at").is("deleted_at", null).order("id").range(a, b), 50000) as any[];
  const moves: Record<string, number> = {}, left: Record<string, number> = {}, after: Record<string, number> = {};
  const todo: { r: any; to: string }[] = [];
  let d75Notes = 0, blanksFound = 0;
  const blankSamples: any[] = [];
  for (const r of rows) {
    const raw = String(r.data?.project ?? "").trim().replace(/\s+/g, " ");
    const t = target(r.data);
    let to = t ? t.to : raw;
    if (t?.why === "D75 note") { d75Notes++; if (!withD75Notes) to = raw; }
    // blank project, but the customer's own message names exactly one park (call center / app / website mails): offered separately, applied only on {fillBlanks:true}
    if (!raw && !t) {
      const guess = canonicalPark(String(r.data?.description || ""));
      if (guess) { blanksFound++; if (blankSamples.length < 12) blankSamples.push({ id: r.id, park: guess, text: String(r.data.description).replace(/\s+/g, " ").slice(0, 110) }); if (fillBlanks && !excludeIds.includes(String(r.id))) to = guess; }
    }
    if (to !== raw) { moves[`${raw || "(blank)"} -> ${to || "(blank)"}`] = (moves[`${raw || "(blank)"} -> ${to || "(blank)"}`] || 0) + 1; todo.push({ r, to }); }
    else if (raw && !canonicalPark(raw)) left[raw] = (left[raw] || 0) + 1;
    after[to || "(blank)"] = (after[to || "(blank)"] || 0) + 1;
  }
  const sort = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const out: any = { leads: rows.length, toChange: todo.length, d75FromNotes: d75Notes, d75NotesIncluded: withD75Notes, blanksNamingOnePark: blanksFound, blanksIncluded: fillBlanks, blankSamples, moves: sort(moves), leftAsTyped: sort(left), projectsAfter: sort(after) };
  if (!apply) return out;
  const now = nowIso();
  let done = 0, skipped = 0;
  for (let i = 0; i < todo.length; i += 25) {
    await Promise.all(todo.slice(i, i + 25).map(async ({ r, to }) => {
      const raw = String(r.data?.project ?? "");
      const d = { ...r.data, project: to, legacyProject: r.data?.legacyProject || raw, lastUpdated: now };
      const u = await admin.from("crm_leads").update({ data: d }).eq("id", r.id).eq("updated_at", r.updated_at).select("id");
      if (u.data?.length) { done++; await admin.from("crm_lead_audit").insert({ lead_id: r.id, actor_id: c.id, actor_name: c.name, action: "edit", from_value: `project=${raw}`, to_value: `project=${to}`, note: "project name cleanup" }); } else skipped++;
    }));
  }
  return { ...out, applied: done, skippedChangedMeanwhile: skipped };
}
