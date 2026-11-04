// deno-lint-ignore-file no-explicit-any
// 4 Nov 2026: the OLD LEADS wallet. The Excel the sales operation used before the CRM (Jan-Jul 2026) is loaded here, cleaned beforehand.
//  - a lead whose phone (or second phone) is already in the system is NEVER loaded and the lead in the system is never touched (reported instead)
//  - the rest is loaded for the salesperson written in the sheet, flagged data.oldLead: second priority, outside the 300 / 600 / 50 limits, never notified,
//    no call-center clock, never handed out. Won rows are loaded as Won with their deal value (cash status "pending" = not confirmed by AR yet).
//  - every lead carries the batch tag (data.importBatch) so a whole batch can be taken back with /crm/import-batch-archive.
// Dry run first ({apply:false}); the leads are read-only data sent by the admin, never executed.
import { admin, normEmail, normPhone, nowIso, pageAll, str } from "./lib.ts";
import { canonicalPark } from "./parks.ts";
import { ensureContactsAndCompaniesBulk, leadColumns, nextId } from "./ingest.ts";

const isoDay = (s: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : "");
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };

export async function oldLeadsImport(c: { id: string; name: string }, b: { apply: boolean; batch: string; allowDupRows?: number[]; leads: any[] }) {
  const tag = String(b.batch || "").slice(0, 80);
  if (!tag) return { error: "batch is required" };
  const input: any[] = Array.isArray(b.leads) ? b.leads.slice(0, 1500) : [];
  if (!input.length) return { error: "no leads" };
  const allow = new Set<number>((b.allowDupRows || []).map(Number));

  // ---- who is in the system already (phones and second phones)
  const existing: any[] = await pageAll((a, z) => admin.from("crm_leads").select("id,status,deleted_at,phone_norm,data->>customerName,data->>phone2").order("id").range(a, z), 50000) as any[];
  const byPhone = new Map<string, any>();
  for (const r of existing) {
    if (r.deleted_at) continue;
    for (const p of [r.phone_norm, normPhone((r as any).phone2)]) if (p && !byPhone.has(p)) byPhone.set(p, r);
  }
  const users: any[] = ((await admin.from("app_users").select("id,name,role,active")).data || []) as any[];
  const userByName = new Map<string, any>(users.filter((u) => u.active !== false).map((u) => [String(u.name).trim().toLowerCase(), u]));

  const out: any = { batch: tag, received: input.length, toImport: 0, duplicates: [] as any[], ownerNotFound: [] as any[], invalid: [] as any[], perOwner: {} as Record<string, number>, perStatus: {} as Record<string, number>, perProject: {} as Record<string, number> };
  const seen = new Set<string>();
  const todo: any[] = [];
  for (const l of input) {
    const row = Number(l.row) || 0;
    const name = str(l.name, 120);
    if (!name) { out.invalid.push({ row, why: "no name" }); continue; }
    const date = isoDay(l.date);
    if (!date) { out.invalid.push({ row, name, why: "no valid lead date" }); continue; }
    const owner = userByName.get(String(l.owner || "").trim().toLowerCase());
    if (!owner) { out.ownerNotFound.push({ row, name, owner: l.owner }); continue; }
    const phones = [l.phone, l.phone2].map((p) => normPhone(p)).filter(Boolean) as string[];
    const hit = phones.map((p) => byPhone.get(p)).find(Boolean);
    if (hit && !allow.has(row)) { out.duplicates.push({ row, serial: l.serial, name, phone: l.phone, status: l.status || "New", existingId: hit.id, existingStatus: hit.status, existingName: (hit as any).customerName }); continue; }
    if (phones.some((p) => seen.has(p)) && !allow.has(row)) { out.duplicates.push({ row, serial: l.serial, name, phone: l.phone, why: "twice in this upload" }); continue; }
    phones.forEach((p) => seen.add(p));
    todo.push({ l, owner, name, date });
  }
  const park = (p: any) => { const t = String(p || "").trim(); return t ? (canonicalPark(t) || t) : ""; };
  for (const t of todo) {
    out.perOwner[t.owner.name] = (out.perOwner[t.owner.name] || 0) + 1;
    const st = t.l.status === "Won" ? "Won" : "New"; out.perStatus[st] = (out.perStatus[st] || 0) + 1;
    const pr = park(t.l.project) || "(blank)"; out.perProject[pr] = (out.perProject[pr] || 0) + 1;
  }
  out.toImport = todo.length;
  if (!b.apply) return out;

  // ---- write
  const now = nowIso();
  const built: any[] = [];
  for (let i = 0; i < todo.length; i += 25) {
    const part = todo.slice(i, i + 25);
    const ids = await Promise.all(part.map(() => nextId("lead")));
    part.forEach((t, k) => {
      const l = t.l; const won = l.status === "Won";
      const lead: any = {
        id: ids[k], date: t.date, source: str(l.source, 60), project: park(l.project), customerName: t.name, phoneNumber: str(l.phone, 40), email: normEmail(l.email),
        requiredSize: num(l.area) ?? "", priority: "Medium", status: won ? "Won" : "New", lastUpdated: now, expectedClosingDate: "", description: "", comments: [], attachments: [],
        createdBy: "Old Excel import", oldLead: true, importBatch: tag, refNo: str(l.serial, 30),
        assignedSalespersonId: t.owner.id, assignedSalespersonName: t.owner.name, assignedDate: `${t.date}T09:00:00.000Z`,
      };
      if (str(l.company, 160)) lead.companyName = str(l.company, 160);
      if (str(l.phone2, 40)) lead.phone2 = str(l.phone2, 40);
      if (str(l.industry, 60)) lead.industry = str(l.industry, 60);
      if (str(l.notes, 1000)) lead.notes = str(l.notes, 1000);
      if (won) {
        const v = num(l.dealValue);
        if (v) { lead.dealValue = v; lead.totalSoldValue = v; lead.cashStatus = "pending"; }
        lead.eoiApplicable = true;
        if (isoDay(l.eoiDate)) lead.eoiDate = isoDay(l.eoiDate);
        lead.wonDate = isoDay(l.wonDate) || isoDay(l.eoiDate) || t.date;
      }
      lead.timeline = [{ id: "imp_" + ids[k], timestamp: now, type: "Import", user: c.name, title: `Imported from the old Excel sheet (${lead.refNo})`,
        description: `Row ${l.row} of the old Excel sheet. Owner in the sheet: ${l.ownerRaw || t.owner.name}.` + (l.dateNote ? ` ${l.dateNote}` : "") }];
      built.push(lead);
    });
  }
  let saved = 0; const failed: any[] = [];
  for (let i = 0; i < built.length; i += 100) {
    const part = built.slice(i, i + 100);
    const ins = await admin.from("crm_leads").insert(part.map((lead) => ({ id: lead.id, data: lead, ...leadColumns(lead) }))).select("id");
    if (ins.error) { for (const lead of part) { const one = await admin.from("crm_leads").insert({ id: lead.id, data: lead, ...leadColumns(lead) }).select("id"); if (one.error) failed.push({ id: lead.id, refNo: lead.refNo }); else saved++; } }
    else saved += ins.data?.length || 0;
  }
  const okIds = new Set(built.map((l) => l.id)); failed.forEach((f) => okIds.delete(f.id));
  const good = built.filter((l) => okIds.has(l.id));
  await ensureContactsAndCompaniesBulk(good).catch(() => {});
  for (let i = 0; i < good.length; i += 200) {
    await admin.from("crm_lead_audit").insert(good.slice(i, i + 200).map((l) => ({ lead_id: l.id, actor_id: c.id, actor_name: c.name, action: "edit", note: `Old lead imported (${l.refNo}) for ${l.assignedSalespersonName}`.slice(0, 300) })));
  }
  return { ...out, saved, failed };
}
