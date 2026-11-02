// deno-lint-ignore-file no-explicit-any
// 3 Nov 2026: leads imported from Excel by the old CRM (Sep 2026) carry the Facebook AD name ("BO# 25691 | SDM July | EGY | ...") as the customer name.
// The shared Facebook sheet keeps the real name (full_name) next to the same phone / e-mail. READ-ONLY lookup first ({apply:false}); the apply only writes the
// names found (one clear match) and keeps the old text in data.legacyCustomerName.
import { admin, normEmail, normName, normPhone, nowIso, pageAll } from "./lib.ts";
import { rowsOf, tabNames, tabRows } from "./fbsheet.ts";

export const looksLikeAdName = (n: any) => {
  const t = String(n ?? "");
  return /^BO\s?#/i.test(t) || (t.match(/\|/g) || []).length >= 3 || (/#\s?\d{4,}/.test(t) && t.length > 50);
};

export async function nameRecovery(c: { id: string; name: string }, apply: boolean, excludeIds: string[] = []) {
  const leads: any[] = (await pageAll((a, b) => admin.from("crm_leads").select("id,data,updated_at").is("deleted_at", null).order("id").range(a, b), 50000) as any[]).filter((r) => looksLikeAdName(r.data?.customerName));
  const byPhone = new Map<string, Set<string>>(), byMail = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => { if (!k) return; (m.get(k) || m.set(k, new Set()).get(k)!).add(v); };
  const tabs = await tabNames();
  let sheetRows = 0;
  for (const t of tabs) {
    const rows = rowsOf(await tabRows(t).catch(() => []));
    for (const r of rows) {
      const nm = String(r.parsed.customerName || "").trim();
      if (!nm || looksLikeAdName(nm)) continue;
      sheetRows++;
      add(byPhone, normPhone(r.parsed.phoneNumber), nm); add(byMail, normEmail(r.parsed.email), nm);
    }
  }
  const found: any[] = [], ambiguous: any[] = [], missing: any[] = [];
  for (const l of leads) {
    const ph = normPhone(l.data?.phoneNumber), em = normEmail(l.data?.email);
    const cand = new Set<string>([...(byPhone.get(ph) || []), ...(byMail.get(em) || [])]);
    const one = [...cand];
    if (one.length === 1) found.push({ id: l.id, to: one[0], by: byPhone.has(ph) ? "phone" : "email", row: l });
    else if (one.length > 1) ambiguous.push({ id: l.id, options: one.slice(0, 4) });
    else missing.push(l.id);
  }
  // the contact card made from the same lead usually carries the same wrong name
  const contacts: any[] = (await pageAll((a, b) => admin.from("crm_contacts").select("id,data,phone_norm,updated_at").is("deleted_at", null).order("id").range(a, b), 50000) as any[]).filter((r) => looksLikeAdName(r.data?.name));
  const contactFix = contacts.map((ct) => { const f = found.find((x) => normPhone(x.row.data?.phoneNumber) === ct.phone_norm); return f ? { ct, to: f.to } : null; }).filter(Boolean) as any[];
  const out: any = {
    badNameLeads: leads.length, sheetTabsRead: tabs.length, sheetNamesKnown: sheetRows,
    matched: found.length, byPhone: found.filter((f) => f.by === "phone").length, byEmail: found.filter((f) => f.by === "email").length,
    ambiguous: ambiguous.length, notFound: missing.length, ambiguousSample: ambiguous.slice(0, 8), notFoundIds: missing.slice(0, 80),
    sample: found.slice(0, 12).map((f) => ({ id: f.id, to: f.to, by: f.by })), contactsWithBadName: contacts.length, contactsFixable: contactFix.length,
  };
  if (!apply) return out;
  const now = nowIso();
  let done = 0, skipped = 0, cdone = 0;
  for (const f of found) {
    if (excludeIds.includes(f.id)) continue;
    const d = { ...f.row.data, customerName: f.to, legacyCustomerName: f.row.data.legacyCustomerName || f.row.data.customerName, lastUpdated: now };
    const u = await admin.from("crm_leads").update({ data: d }).eq("id", f.id).eq("updated_at", f.row.updated_at).select("id");
    if (u.data?.length) { done++; await admin.from("crm_lead_audit").insert({ lead_id: f.id, actor_id: c.id, actor_name: c.name, action: "edit", from_value: `customerName=${String(f.row.data.customerName).slice(0, 80)}`, to_value: `customerName=${f.to}`, note: "real name from the Facebook sheet" }); } else skipped++;
  }
  for (const { ct, to } of contactFix) {
    const u = await admin.from("crm_contacts").update({ data: { ...ct.data, name: to, legacyName: ct.data.legacyName || ct.data.name }, name_norm: normName(to) || null }).eq("id", ct.id).eq("updated_at", ct.updated_at).select("id");
    if (u.data?.length) cdone++;
  }
  return { ...out, applied: done, skippedChangedMeanwhile: skipped, contactsFixed: cdone };
}
