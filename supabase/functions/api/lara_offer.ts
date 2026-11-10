// deno-lint-ignore-file no-explicit-any
// Lara — phase 5: initial offers. NO AI.
// An offer = available Land Bank plots at LIST prices (never a deal price, cost or discount), a reference, a validity date, and an
// English PDF (the built-in PDF fonts have no Arabic) with an Arabic or English cover e-mail. Always a draft that a person approves.
// When sent it is recorded in the offer history (crm_offer_prints), so the Land Bank demand page counts it.
import { admin, HttpError, nowIso, str } from "./lib.ts";
import { Pdf, textWidth } from "./pdf.ts";
import { canonicalParks } from "../../../src/lib/parkAliases.ts";
import { firstNameOf } from "../../../src/lib/personName.ts";
import { PARK_AR, plotsAr, preferredLang } from "../../../src/components/crm/smartWriter.ts";
import { sizeRange } from "../../../src/components/crm/smartEngine.ts";

export interface OfferPlot { key: string; park: string; project: string; unit: string; sector: string; landType: string; areaSqm: number; listPriceSqm: number | null; listTotal: number | null }
export interface Offer { ref: string; date: string; validUntil: string; validDays: number; leadId: string; customer: string; company: string; owner: string; plots: OfferPlot[]; total: number | null; missingPrices: number }

const isLatin = (s: string) => !!s && !/[^\x20-\x7E -ſ–—•]/.test(s);   // what the built-in PDF font can draw
const fmt = (n: number | null | undefined, dp = 0) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const cairoDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const niceDate = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

async function snapshot(): Promise<any[]> {
  const { data } = await admin.from("plots_snapshot").select("data").eq("id", 1).maybeSingle();
  return Array.isArray(data?.data) ? data!.data : [];
}
const toPlot = (p: any): OfferPlot => ({
  key: String(p.key), park: String(p.park || ""), project: String(p.project || ""), unit: String(p.unit || ""), sector: String(p.sector || ""), landType: String(p.landType || ""),
  areaSqm: Number(p.areaSqm) || 0, listPriceSqm: typeof p.listPriceSqm === "number" ? p.listPriceSqm : null, listTotal: typeof p.listTotal === "number" ? p.listTotal : null,
});

async function leadFacts(leadId: string) {
  const { data } = await admin.from("crm_leads").select("id,assigned_to,data").eq("id", leadId).is("deleted_at", null).maybeSingle();
  if (!data) throw new HttpError(404, "Lead not found");
  return { id: data.id, owner_id: data.assigned_to, ...(data.data || {}) };
}

/** plots Lara would offer: the ones chosen, else the lead's assigned plots that are still available, else the 3 closest in size in its park */
export async function offerCandidates(leadId: string) {
  const l = await leadFacts(leadId);
  const all = await snapshot();
  const avail = all.filter((p) => p.status === "available" && Number(p.areaSqm) > 0);
  const assigned = new Set((Array.isArray(l.assignedPlots) ? l.assignedPlots : []).map((a: any) => String(a.key)));
  const parks = canonicalParks(l.project || "");
  const r = sizeRange(l.requiredSize);
  const mid = r ? (r[0] + r[1]) / 2 : 0;
  let inPark = avail.filter((p) => parks.includes(p.park));
  if (r) inPark = inPark.filter((p) => p.areaSqm >= r[0] * 0.6 && p.areaSqm <= r[1] * 1.5);
  inPark.sort((a, b) => Math.abs(a.areaSqm - mid) - Math.abs(b.areaSqm - mid));
  const list = [...avail.filter((p) => assigned.has(String(p.key))), ...inPark.filter((p) => !assigned.has(String(p.key)))].slice(0, 25).map(toPlot);
  const suggested = list.filter((p) => assigned.has(p.key)).slice(0, 5).map((p) => p.key);
  if (!suggested.length) suggested.push(...list.slice(0, 3).map((p) => p.key));
  return {
    lead: { id: l.id, customer: l.customerName || "", company: l.companyName || "", project: l.project || "", requiredSize: l.requiredSize || "", email: String(l.email || "").trim(), owner: l.assignedSalespersonName || "" },
    parks, plots: list, suggested, assigned: [...assigned],
  };
}

/** builds the offer object (no write) */
export async function buildOffer(leadId: string, plotKeys: string[] | null, validDays: number): Promise<{ offer: Offer; lead: any }> {
  const l = await leadFacts(leadId);
  const cand = await offerCandidates(leadId);
  const all = await snapshot();
  const byKey = new Map(all.map((p) => [String(p.key), p]));
  const keys = (plotKeys && plotKeys.length ? plotKeys : cand.suggested).slice(0, 10);
  const plots = keys.map((k) => byKey.get(String(k))).filter((p) => p && p.status === "available").map(toPlot);
  if (!plots.length) throw new HttpError(400, "No available plot to offer (check the park and size on the lead, or pick plots)");
  const priced = plots.filter((p) => p.listTotal != null);
  const today = cairoDay();
  const days = Math.max(3, Math.min(60, Math.round(validDays) || 14));
  const valid = cairoDay(new Date(Date.now() + days * 864e5));
  const offer: Offer = {
    ref: `OFF-${leadId}-${today.replace(/-/g, "")}`, date: today, validUntil: valid, validDays: days, leadId,
    customer: str(l.customerName, 120), company: str(l.companyName, 120), owner: str(l.assignedSalespersonName, 80),
    plots, total: priced.length ? priced.reduce((s, p) => s + (p.listTotal || 0), 0) : null, missingPrices: plots.length - priced.length,
  };
  return { offer, lead: l };
}

/** the cover e-mail (Arabic first for Egyptian customers; English for others) */
export function coverText(o: Offer, lead: any, cfg: { nameAr: string; nameEn: string }): { lang: "ar" | "en"; subject: string; body: string } {
  const lang = preferredLang(lead);
  const first = firstNameOf(lead.customerName);
  const parks = [...new Set(o.plots.map((p) => p.park))];
  const areas = o.plots.map((p) => p.areaSqm).sort((a, b) => a - b);
  const span = areas.length === 1 ? fmt(areas[0]) : `${fmt(areas[0])} – ${fmt(areas[areas.length - 1])}`;
  if (lang === "ar") {
    const pk = parks.map((p) => PARK_AR[p] || p).join(" و");
    return {
      lang, subject: `عرض مبدئي — ${pk} — ${o.ref}`,
      body: `السلام عليكم${first ? ` أ. ${first}` : ""}،\n\nمرفق لحضرتك عرض مبدئي بأسعار القائمة لـ${plotsAr(o.plots.length)} متاحة في ${pk} بمساحات ${span} م²، والعرض صالح حتى ${niceDate(o.validUntil)}.\nالعرض مبدئي وغير ملزم، و${o.owner ? `زميلي ${o.owner}، مسؤول المبيعات الخاص بحضرتك،` : "فريق المبيعات"} هيتواصل مع حضرتك لتأكيد التفاصيل وطريقة السداد.\n\nتحب نرتب زيارة للموقع تشوف فيها القطع على الطبيعة؟\n\n${cfg.nameAr}\nالسويدي للتنمية الصناعية`,
    };
  }
  return {
    lang, subject: `Initial offer — ${parks.join(" & ")} — ${o.ref}`,
    body: `${first && isLatin(first) ? `Dear ${first},` : "Good day,"}\n\nPlease find attached an initial offer at list prices for ${o.plots.length} available plot${o.plots.length > 1 ? "s" : ""} in ${parks.join(" and ")} (${span} sqm), valid until ${niceDate(o.validUntil)}.\nThis offer is non-binding. ${o.owner ? `Your account manager, ${o.owner},` : "Our sales team"} will contact you to confirm the details and the payment plan.\n\nWould you like to arrange a site visit to see the plots?\n\nBest regards,\n${cfg.nameEn}\nElsewedy Industrial Development`,
  };
}

/** the offer as a one-page PDF (English, list prices only) */
export function offerPdf(o: Offer): Uint8Array {
  const p = new Pdf();
  const RED = "#A6192E", INK = "#2D2926", GRAY = "#767676", LIGHT = "#F2F2F2";
  const L = 40, R = p.W - 40;
  p.box(0, 0, p.W, 78, RED);
  p.text(L, 34, "ELSEWEDY INDUSTRIAL DEVELOPMENT", { size: 16, bold: true, color: "#FFFFFF" });
  p.text(L, 56, "Initial offer  ·  list prices", { size: 11, color: "#FFFFFF" });
  p.text(R, 34, `Ref. ${o.ref}`, { size: 9, color: "#FFFFFF", align: "right" });
  p.text(R, 50, `Date ${niceDate(o.date)}`, { size: 9, color: "#FFFFFF", align: "right" });
  p.text(R, 66, `Valid until ${niceDate(o.validUntil)}`, { size: 9, bold: true, color: "#FFFFFF", align: "right" });

  const name = isLatin(o.customer) ? o.customer : "";
  const company = isLatin(o.company) ? o.company : "";
  let y = 110;
  p.text(L, y, "PREPARED FOR", { size: 8, bold: true, color: GRAY });
  y += 16; p.text(L, y, name || company || "Valued customer", { size: 13, bold: true });
  if (name && company) { y += 15; p.text(L, y, company, { size: 10 }); }
  y += 15; p.text(L, y, `Reference lead ${o.leadId}`, { size: 9, color: GRAY });
  y += 26;
  y = p.para(L, y, R - L, "Thank you for your interest in Elsewedy Industrial Development. The industrial plots below are available today and match your request. Prices are the current list prices in Egyptian pounds (EGP).", { size: 10, color: INK });

  // table
  y += 8;
  const cols = [
    { k: "park", t: "Park", w: 118 }, { k: "unit", t: "Plot", w: 62 }, { k: "sector", t: "Sector", w: 58 }, { k: "landType", t: "Land type", w: 78 },
    { k: "area", t: "Area (m²)", w: 64, r: true }, { k: "psqm", t: "EGP / m²", w: 56, r: true }, { k: "total", t: "List total (EGP)", w: 79.28, r: true },
  ];
  const clip = (s: string, w: number, size: number) => { if (!s) return ""; let t = isLatin(s) ? s : "—"; while (t.length > 1 && textWidth(t, size) > w - 8) t = t.slice(0, -2) + "…"; return t || "—"; };
  const row = (vals: Record<string, string>, opts: { bold?: boolean; fill?: string; color?: string } = {}) => {
    if (opts.fill) p.box(L, y - 13, R - L, 20, opts.fill);
    let x = L;
    for (const c of cols) {
      const v = clip(vals[c.k] ?? "", c.w, 9);
      p.text(c.r ? x + c.w - 6 : x + 6, y, v, { size: 9, bold: opts.bold, color: opts.color || INK, align: c.r ? "right" : "left" });
      x += c.w;
    }
    y += 20;
  };
  row(Object.fromEntries(cols.map((c) => [c.k, c.t])), { bold: true, fill: LIGHT, color: GRAY });
  o.plots.forEach((pl, i) => {
    row({ park: pl.park, unit: pl.unit, sector: pl.sector || "—", landType: pl.landType || "—", area: fmt(pl.areaSqm, 2), psqm: fmt(pl.listPriceSqm), total: fmt(pl.listTotal) }, { fill: i % 2 ? "#FAFAFA" : undefined });
  });
  p.line(L, y - 12, R, y - 12, "#BFBFBF", 0.8);
  const areaSum = o.plots.reduce((s, x) => s + x.areaSqm, 0);
  row({ park: `Total, ${o.plots.length} plot${o.plots.length > 1 ? "s" : ""}`, unit: "", sector: "", landType: "", area: fmt(areaSum, 2), psqm: "", total: fmt(o.total) }, { bold: true });
  if (o.missingPrices) { y = p.para(L, y + 2, R - L, `${o.missingPrices} plot(s) have no list price yet: the total covers only the plots with a price. Your account manager will confirm.`, { size: 8.5, color: GRAY }); }

  // terms
  y += 14;
  p.text(L, y, "IMPORTANT", { size: 8, bold: true, color: GRAY }); y += 14;
  for (const t of [
    "This is an initial, non-binding offer at list prices. Final price, payment plan and terms are confirmed only in the signed sales contract.",
    "Availability was checked on the date of this offer. A plot is reserved only through the official reservation process.",
    "Utilities, building rules and licensing details are provided by your account manager.",
  ]) { p.text(L, y, "•", { size: 10, color: RED }); y = p.para(L + 12, y, R - L - 12, t, { size: 9, color: INK }) + 2; }

  y += 14;
  p.text(L, y, "YOUR CONTACT", { size: 8, bold: true, color: GRAY }); y += 16;
  p.text(L, y, o.owner && isLatin(o.owner) ? `${o.owner}, account manager` : "Elsewedy Industrial Development sales team", { size: 10, bold: true }); y += 14;
  p.text(L, y, "Prepared by Lara, digital sales assistant, for the sales team.", { size: 9, color: GRAY });

  p.line(L, p.H - 40, R, p.H - 40);
  p.text(L, p.H - 26, `Elsewedy Industrial Development  ·  Initial offer ${o.ref}`, { size: 8, color: GRAY });
  p.text(R, p.H - 26, "Page 1 of 1", { size: 8, color: GRAY, align: "right" });
  return p.bytes();
}

/** after the e-mail is sent: the offer history record (the Land Bank demand page reads it) */
export async function recordOfferPrint(o: Offer, lead: any, approvedBy: string) {
  const ph = String(lead.phoneNumber || "").replace(/\D/g, "");
  const em = String(lead.email || "").trim().toLowerCase();
  let contactId: string | null = null;
  if (em) contactId = (await admin.from("crm_contacts").select("id").eq("email_norm", em).limit(1).maybeSingle()).data?.id || null;
  if (!contactId && ph.length >= 8) contactId = (await admin.from("crm_contacts").select("id").like("phone_norm", `%${ph.slice(-9)}`).limit(1).maybeSingle()).data?.id || null;
  await admin.from("crm_offer_prints").insert({
    contact_id: contactId, lead_id: o.leadId, offer_type: "sales_offer",
    plots: o.plots.map((p) => ({ key: p.key, park: p.park, unit: p.unit, areaSqm: p.areaSqm, status: "available", landType: p.landType, sector: p.sector, listPriceSqm: p.listPriceSqm, project: p.project })),
    total_value: o.total, summary: `Initial offer e-mailed by Lara (approved by ${approvedBy}), valid until ${o.validUntil}`,
    doc_name: `${o.ref}.pdf`, printed_by: null, printed_by_name: `Lara (approved by ${approvedBy})`,
    offer: { ref: o.ref, validUntil: o.validUntil, by: "Lara", plots: o.plots.map((p) => p.key) }, printed_at: nowIso(),
  });
}
