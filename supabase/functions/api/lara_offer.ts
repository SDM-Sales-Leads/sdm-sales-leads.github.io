// deno-lint-ignore-file no-explicit-any
// Lara — initial offers in the Land Bank's "Sales Offer" format (same layout, park colours, logos, notes, fees, signatures). NO AI.
// Prices (owner, 10 Nov 2026): the customer sees the REAL price + 20% ("list price"), so sales have room; a discount % can be given
// and is printed as its own line, never below the real price. Instalment plans run on the price after discount (same goal-seek
// as the Land Bank's calculator). The real price is only shown inside the system, never in the PDF or the e-mail.
import { admin, getConfig, HttpError, nowIso, str } from "./lib.ts";
import { Pdf, textWidth } from "./pdf.ts";
import { LOGOS, logoKey } from "./lara_logos.ts";
import { canonicalParks } from "../../../src/lib/parkAliases.ts";
import { firstNameOf } from "../../../src/lib/personName.ts";
import { PARK_AR, plotsAr, preferredLang } from "../../../src/components/crm/smartWriter.ts";
import { sizeRange } from "../../../src/components/crm/smartEngine.ts";

export interface OfferPlot { key: string; park: string; project: string; unit: string; sector: string; landType: string; areaSqm: number; listPriceSqm: number | null; listTotal: number | null }
export interface PlanCfg { type: string; adv: number; years: number; rate: number; esc: number; fixPct: number; fixN: number }
export interface Offer {
  ref: string; title: string; date: string; validUntil: string; validText: string; leadId: string;
  client: string; company: string; project: string; sector: string; plotsText: string; landType: string; owner: string; tpl: string;
  plots: OfferPlot[]; area: number;
  realSqm: number; realTotal: number;                 // INTERNAL: never printed
  markupPct: number; listSqm: number; listTotal: number;
  discountPct: number; netSqm: number; netTotal: number;
  mode: "cash" | "plan"; plan: PlanCfg | null;
  planOut: { adv: number; n: number; inst: number; paid: number; label: string; years: number } | null;
  planListPaid: number | null;                        // instalment total at the list price (before the discount), for the printed price block
  due: number;                                       // what the customer pays (cash: net total; plan: advance + instalments)
  total: number;                                     // = due (offer history field)
  missingPrices: number;
}

const f2 = (v: number) => (+v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fA = (v: number) => (+v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const fInt = (v: number) => Math.round(+v || 0).toLocaleString("en-US");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const cairoDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const dTxt = (iso: string) => { const d = new Date(iso + "T12:00:00Z"); return `${d.getUTCDate()}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`; };
const isLatin = (s: string) => !!s && !/[^\x20-\x7E -ſ–—•]/.test(s);
const latin = (s: string) => (isLatin(String(s || "").trim()) ? String(s).trim() : "");

// ---------------------------------------------------------------------------------------------
// the Land Bank's park templates (p7_offers.py SO_TPL) and payment plan (fpPlan)
// ---------------------------------------------------------------------------------------------
const NOTE_UTIL = "Price includes public utilities: Water, Roads, Sewage, Street lighting up to boundaries of land.";
const INS_REFUND = "After the client completes all construction without any damages to our infrastructure , the amount will be refunded.";
const INS_GUAR = "Shall be paid upon handingover as a guarantee for our facilities and infrastructure during the period of construction of the client.";
const SIGN: [string, string][] = [["Sales representative", ""], ["Sales & BD Director", "Yara Adel"], ["CEO", "Eng. Mohamed AL Kammah"]];
const TPL: Record<string, any> = {
  oct: { bar: "#F7C600", ink: "#000000", ins: 1, hand: 15000, con: 0.2, maint: 24, addw: 0, ida: 0, validDays: 2, sign: SIGN,
    notes: ["The client shall hand over all cheques {upon the reservation form}", "The maximum installment period is 3 years with interest", "Price includes Electricty 60 KVA", NOTE_UTIL], insNotes: [INS_GUAR, INS_REFUND] },
  pip: { bar: "#92D050", ink: "#FFFFFF", ins: 3, hand: 0, con: 0.1, maint: 0, addw: 160000, ida: 0, validDays: 2, sign: SIGN,
    notes: ["The contract shall be signed within 3 months from signing the reservation form.", "The client shall hand over all cheques {upon Signing the contract}", "The maximum installment period is 3 years with interest", NOTE_UTIL, "Price includes electricity connections of 17 KVA/1000 Sqm to land boundary."],
    insNotes: [INS_GUAR, "After the client completes all construction without any damages to our infrastructure , we will transfer that amount with interest to the account of annual maintenance expenses."] },
  borg: { bar: "#2F4B7C", ink: "#FFFFFF", ins: 1, hand: 20000, con: 0.2, maint: 30, addw: 0, ida: 4, validDays: 7,
    sign: [["Sales representative", ""], ["Sales & BD Director", "Yara Adel"], ["Chairman and Managing Director", "Eng. Mohamed AL Kammah"]],
    notes: ["The contract shall be signed within 3 months of signing reservation form", "The client shall hand over all cheques {upon the reservation form}", "The maximum installment period is 4 years with interest", NOTE_UTIL, "{The price doesn't include the electricity connections network from the external source to the selected plot.}"], insNotes: [INS_GUAR, INS_REFUND] },
  def: { bar: "#A6192E", ink: "#FFFFFF", ins: 1, hand: 15000, con: 0.1, maint: 0, addw: 0, ida: 0, validDays: 2, sign: SIGN,
    notes: ["The contract shall be signed within 3 months from signing the reservation form.", "The client shall hand over all cheques {upon the reservation form}", "The maximum installment period is 3 years with interest", NOTE_UTIL], insNotes: [INS_GUAR, INS_REFUND] },
};
export const tplOf = (park: string) => { const p = (park || "").toLowerCase(); return /october/.test(p) ? "oct" : /borg/.test(p) ? "borg" : /east|west|asher/.test(p) ? "pip" : "def"; };

const FP_TYPES: Record<string, { ppy: number; m: number; l: string }> = {
  "Monthly": { ppy: 12, m: 1, l: "Monthly" }, "Every 2 Months": { ppy: 6, m: 2, l: "Bi-monthly" }, "Quarterly": { ppy: 4, m: 3, l: "Quarterly" },
  "Semi-Annually": { ppy: 2, m: 6, l: "Semi-annual" }, "Annually": { ppy: 1, m: 12, l: "Annual" },
};
export const PLAN_DEFAULT: PlanCfg = { type: "Quarterly", adv: 30, years: 3, rate: 23, esc: 0, fixPct: 0, fixN: 5 };
/** the Land Bank's payment plan: advance, then equal instalments that retire the balance at the lending rate (goal seek) */
function fpPlan(area: number, price: number, c: PlanCfg) {
  const pt = FP_TYPES[c.type] || FP_TYPES.Quarterly;
  const n = Math.max(0, Math.round((+c.years || 0) * pt.ppy)), rp = (+c.rate || 0) / 100 / pt.ppy;
  const total = area * price, adv = total * (+c.adv || 0) / 100, rem = total - adv, fix = total * (+c.fixPct || 0) / 100, esc = (+c.esc || 0) / 100, fixN = +c.fixN || 0;
  const extra = (i: number) => { const yr = Math.ceil(i / pt.ppy); return i % pt.ppy === 0 && yr <= fixN ? fix : 0; };
  const sim = (g: number) => { let b = rem; for (let i = 1; i <= n; i++) { const yr = Math.ceil(i / pt.ppy); b -= (g * Math.pow(1 + esc, yr - 1) + extra(i)) - b * rp; } return b; };
  let inst = 0;
  if (rem > 0 && n > 0) { let lo = 0, hi = rem * 2; for (let k = 0; k < 200; k++) { inst = (lo + hi) / 2; const b = sim(inst); if (Math.abs(b) < 0.005) break; if (b > 0) lo = inst; else hi = inst; } }
  let paid = adv;
  for (let i = 1; i <= n; i++) { const yr = Math.ceil(i / pt.ppy); paid += inst * Math.pow(1 + esc, yr - 1) + extra(i); }
  return { adv, n, inst, paid: rem > 0 && n === 0 ? total : paid, label: pt.l, years: +c.years || 0 };
}
const cleanPlan = (p: any): PlanCfg => ({
  type: FP_TYPES[p?.type] ? p.type : PLAN_DEFAULT.type,
  adv: Math.max(0, Math.min(100, Number(p?.adv ?? PLAN_DEFAULT.adv))), years: Math.max(0, Math.min(10, Number(p?.years ?? PLAN_DEFAULT.years))),
  rate: Math.max(0, Math.min(60, Number(p?.rate ?? PLAN_DEFAULT.rate))), esc: Math.max(0, Math.min(30, Number(p?.esc ?? 0))),
  fixPct: Math.max(0, Math.min(50, Number(p?.fixPct ?? 0))), fixN: Math.max(0, Math.min(10, Number(p?.fixN ?? 5))),
});
/** "B2-14, B2-15" -> sector "B2", plots "14&15" (the Land Bank's soBlock) */
function block(units: string[]) {
  const parts = units.map((u) => { const m = String(u).match(/^(.*?)[-\s]*(\d+[A-Za-z]?)$/); return m && m[1] ? [m[1], m[2]] : [null, String(u)]; });
  const pre = [...new Set(parts.map((p) => p[0]))];
  if (pre.length === 1 && pre[0]) { const n = parts.map((p) => p[1]); return { sector: pre[0] as string, plots: n.length === 2 ? n.join("&") : n.join(",") }; }
  return { sector: "", plots: units.join(", ") };
}

// ---------------------------------------------------------------------------------------------
// plots and the offer
// ---------------------------------------------------------------------------------------------
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
export async function markupPct(): Promise<number> {
  const v = Number(await getConfig<any>("offer_markup_pct", 20));
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 20;
}

/** plots Lara would offer: plots chosen on the lead (still available), else the closest in size in its park */
export async function offerCandidates(leadId: string) {
  const l = await leadFacts(leadId);
  const avail = (await snapshot()).filter((p) => p.status === "available" && Number(p.areaSqm) > 0);
  const assigned = new Set((Array.isArray(l.assignedPlots) ? l.assignedPlots : []).map((a: any) => String(a.key)));
  const parks = canonicalParks(l.project || "");
  const r = sizeRange(l.requiredSize); const mid = r ? (r[0] + r[1]) / 2 : 0;
  let inPark = avail.filter((p) => parks.includes(p.park));
  if (r) inPark = inPark.filter((p) => p.areaSqm >= r[0] * 0.6 && p.areaSqm <= r[1] * 1.5);
  inPark.sort((a, b) => Math.abs(a.areaSqm - mid) - Math.abs(b.areaSqm - mid));
  const list = [...avail.filter((p) => assigned.has(String(p.key))), ...inPark.filter((p) => !assigned.has(String(p.key)))].slice(0, 25).map(toPlot);
  const suggested = list.filter((p) => assigned.has(p.key)).slice(0, 5).map((p) => p.key);
  if (!suggested.length && list.length) suggested.push(list[0].key);
  return {
    lead: { id: l.id, customer: l.customerName || "", company: l.companyName || "", project: l.project || "", requiredSize: l.requiredSize || "", email: String(l.email || "").trim(), owner: l.assignedSalespersonName || "" },
    parks, plots: list, suggested, assigned: [...assigned], markupPct: await markupPct(), planDefault: PLAN_DEFAULT,
  };
}

export interface OfferInput { plotKeys: string[] | null; discountPct?: number; mode?: "cash" | "plan"; plan?: Partial<PlanCfg> }
/** builds the offer object (no write). Throws when a plot is gone or has no list price. */
export async function buildOffer(leadId: string, inp: OfferInput): Promise<{ offer: Offer; lead: any }> {
  const l = await leadFacts(leadId);
  const cand = await offerCandidates(leadId);
  const byKey = new Map((await snapshot()).map((p) => [String(p.key), p]));
  const keys = (inp.plotKeys && inp.plotKeys.length ? inp.plotKeys : cand.suggested).slice(0, 10);
  const plots = keys.map((k) => byKey.get(String(k))).filter((p) => p && p.status === "available").map(toPlot);
  if (!plots.length) throw new HttpError(400, "No available plot to offer (check the park and size on the lead, or pick plots)");
  const parks = [...new Set(plots.map((p) => p.park))];
  if (parks.length > 1) throw new HttpError(400, "An offer covers one park: pick plots of the same park");
  const noPrice = plots.filter((p) => !(p.listTotal && p.listTotal > 0));
  if (noPrice.length) throw new HttpError(400, `No list price in the Land Bank for ${noPrice.map((p) => p.unit).join(", ")}: it cannot be offered yet`);
  const area = Math.round(plots.reduce((s, p) => s + p.areaSqm, 0) * 100) / 100;
  const realTotal = plots.reduce((s, p) => s + (p.listTotal || 0), 0);
  const realSqm = Math.round(realTotal / area);                               // the Land Bank's soAutoFill: Σ totals ÷ Σ area
  const mk = await markupPct();
  const listSqm = Math.round(realSqm * (1 + mk / 100));
  const maxDisc = listSqm ? Math.floor((1 - realSqm / listSqm) * 10000) / 100 : 0;   // never below the real price
  const discountPct = Math.max(0, Math.min(maxDisc, Math.round((Number(inp.discountPct) || 0) * 100) / 100));
  const netSqm = Math.max(realSqm, Math.round(listSqm * (1 - discountPct / 100)));
  const listTotal = Math.round(area * listSqm * 100) / 100, netTotal = Math.round(area * netSqm * 100) / 100;
  const mode = inp.mode === "plan" ? "plan" : "cash";
  const plan = mode === "plan" ? cleanPlan({ ...PLAN_DEFAULT, ...(inp.plan || {}) }) : null;
  const planOut = plan ? fpPlan(area, netSqm, plan) : null;
  const planListPaid = plan ? Math.round(fpPlan(area, listSqm, plan).paid * 100) / 100 : null;
  const due = Math.round((planOut ? planOut.paid : netTotal) * 100) / 100;
  const tpl = tplOf(parks[0]);
  const today = cairoDay();
  const vd = TPL[tpl].validDays;
  const b = block(plots.map((p) => p.unit));
  const offer: Offer = {
    ref: `OFF-${leadId}-${today.replace(/-/g, "")}`, title: "Sales Offer", date: today, validUntil: cairoDay(new Date(Date.now() + vd * 864e5)), validText: `${vd} days`, leadId,
    client: latin(l.customerName), company: latin(l.companyName), project: parks[0], sector: b.sector || plots[0].sector || "", plotsText: b.plots, landType: plots[0].landType || "",
    owner: latin(l.assignedSalespersonName), tpl, plots, area, realSqm, realTotal, markupPct: mk, listSqm, listTotal, discountPct, netSqm, netTotal,
    mode, plan, planOut, planListPaid, due, total: due, missingPrices: 0,
  };
  return { offer, lead: l };
}

/** the cover e-mail (Arabic first for Egyptian customers; English for others). Customer prices only. */
export function coverText(o: Offer, lead: any, cfg: { nameAr: string; nameEn: string }): { lang: "ar" | "en"; subject: string; body: string } {
  const lang = preferredLang(lead);
  const first = firstNameOf(lead.customerName);
  const areas = o.plots.map((p) => p.areaSqm).sort((a, b) => a - b);
  const span = areas.length === 1 ? fInt(areas[0]) : `${fInt(areas[0])} – ${fInt(areas[areas.length - 1])}`;
  const vu = dTxt(o.validUntil);
  if (lang === "ar") {
    const pk = PARK_AR[o.project] || o.project;
    return {
      lang, subject: `عرض سعر — ${pk} — ${o.ref}`,
      body: `السلام عليكم${first ? ` أ. ${first}` : ""}،\n\nمرفق لحضرتك عرض السعر لـ${plotsAr(o.plots.length)} متاحة في ${pk} بمساحة إجمالية ${fA(o.area)} م² (${span} م²)${o.discountPct ? `، وعليه خصم خاص ${fA(o.discountPct)}%` : ""}${o.mode === "plan" ? "، بنظام تقسيط" : ""}. العرض صالح حتى ${vu}.\n${o.owner ? `زميلي ${o.owner}، مسؤول المبيعات الخاص بحضرتك،` : "فريق المبيعات"} هيتواصل مع حضرتك لتأكيد التفاصيل.\n\nتحب نرتب زيارة للموقع تشوف فيها القطع على الطبيعة؟\n\n${cfg.nameAr}\nالسويدي للتنمية الصناعية`,
    };
  }
  return {
    lang, subject: `Sales offer — ${o.project} — ${o.ref}`,
    body: `${first && isLatin(first) ? `Dear ${first},` : "Good day,"}\n\nPlease find attached our sales offer for ${o.plots.length} available plot${o.plots.length > 1 ? "s" : ""} in ${o.project}, ${fA(o.area)} sqm in total (${span} sqm)${o.discountPct ? `, including a special discount of ${fA(o.discountPct)}%` : ""}${o.mode === "plan" ? ", with an instalment plan" : ""}. The offer is valid until ${vu}.\n${o.owner ? `Your account manager, ${o.owner},` : "Our sales team"} will contact you to confirm the details.\n\nWould you like to arrange a site visit to see the plots?\n\nBest regards,\n${cfg.nameEn}\nElsewedy Industrial Development`,
  };
}

// ---------------------------------------------------------------------------------------------
// the PDF: the Land Bank's soPdf, point for point (A4 in points, Helvetica)
// ---------------------------------------------------------------------------------------------
const PDF_NOTE = "Generated automatically by the SID system. Preliminary version for discussion only - subject to management approval; figures may differ slightly in the final signed offer.";
export function offerPdf(o: Offer): Uint8Array {
  const doc = new Pdf(); const H = doc.H;
  const L = 53, R = 549, C1 = 221, C2 = 318, C3 = 402, GR = [217, 217, 217], BK = [0, 0, 0], RD = [230, 0, 0];
  const t = TPL[o.tpl] || TPL.def;
  const tx = (s: string, x: number, y: number, op: { b?: boolean; i?: boolean; s?: number; c?: number[] | string; a?: "left" | "right" | "center" } = {}) =>
    doc.text(x, y, String(s ?? ""), { size: op.s || 6.8, bold: op.b, italic: op.i, color: op.c || BK, align: op.a || "left", middle: true });
  const box = (x: number, y: number, w: number, h: number, fill?: number[] | string) => doc.rect(x, y, w, h, fill ? { fill, stroke: BK, lw: 0.6 } : { stroke: BK, lw: 0.6 });
  /** text with {red parts} (bold italic red), like the Land Bank's notes */
  const rich = (s: string, x: number, y: number, size = 6.8) => {
    let cx = x;
    String(s).split(/(\{[^}]*\})/).forEach((pz) => {
      if (!pz) return; const red = /^\{.*\}$/.test(pz); const v = red ? pz.slice(1, -1) : pz;
      doc.text(cx, y, v, { size, bold: red, italic: true, color: red ? RD : BK, middle: true }); cx += textWidth(v, size, red) + (red ? 1.5 : 0);
    });
  };
  let y = 0;
  const foot = () => { doc.line(L, H - 26, R, H - 26, [190, 190, 190], 0.4); const ls = doc.split(PDF_NOTE, R - L, 5.6); ls.forEach((l, i) => doc.text((L + R) / 2, H - 18 + (i - (ls.length - 1) / 2) * 6.5, l, { size: 5.6, italic: true, color: [120, 120, 120], align: "center", middle: true })); };
  const need = (h: number) => { if (y + h > H - 40) { foot(); doc.addPage(); y = 40; } };
  const note = (s: string) => {
    const plain = String(s).replace(/[{}]/g, "");
    const lines = /\{/.test(s) ? [s] : doc.split(plain, R - L - 6, 6.8);
    need(lines.length * 10.5);
    const y0 = y + 6.2; tx("*", L - 4, y0); lines.forEach((l, i) => rich(l, L + 3, y0 + i * 9.5));
    y += 12.3 + (lines.length - 1) * 9.5;
  };
  const row4 = (cells: (string | null)[], h: number, op: { fill?: number[]; b?: boolean; xs?: number[]; right?: number[] } = {}) => {
    const xs = op.xs || [L, C1, C2, C3, R]; need(h);
    cells.forEach((c, i) => {
      if (c == null) return; const x0 = xs[i], x1 = xs[i + 1]; box(x0, y, x1 - x0, h, op.fill);
      if (c !== "") { const r = op.right && op.right.includes(i); tx(c, r ? x1 - 4 : (x0 + x1) / 2, y + h / 2, { b: op.b, a: r ? "right" : "center" }); }
    });
    y += h;
  };

  // title bar and logo
  box(L, 30, C3 - L, 14, t.bar); tx(o.title || "Sales Offer", (L + C3) / 2, 37, { b: true, s: 7.5, a: "center", c: t.ink });
  const lg = LOGOS[logoKey(o.project)] || LOGOS.sdm;
  if (lg) { const bw = 112, bh = 34, k = Math.min(bw / lg.w, bh / lg.h); doc.image(logoKey(o.project), lg, R - lg.w * k, 22 + (bh - lg.h * k) / 2, lg.w * k, lg.h * k); }
  // header
  doc.rect(L, 60.5, C3 - L, 11, { fill: GR });
  ([["Client's name :", o.client], ["Company name :", o.company], ["Project name :", o.project], ["Sector :", o.sector], ["Plots no.", o.plotsText], ["Land type:", o.landType]] as [string, string][])
    .forEach(([k, v], i) => { const yy = 66 + i * 12.3; tx(k, L + 3, yy, { b: true }); if (!v) return; const w = textWidth(v, 6.8, true), mw = i === 3 ? 220 : 250; tx(v, 272, yy, { b: true, a: "center", s: w > mw ? Math.max(4.4, 6.8 * mw / w) : 6.8 }); });
  tx("Date :", 440, 66 + 3 * 12.3, { b: true }); tx(dTxt(o.date), 505, 66 + 3 * 12.3, { b: true, a: "center" });
  // price block: customer list price (+markup), then the discount line when there is one
  y = 134;
  const plan = o.mode === "plan" && o.planOut && o.planListPaid;
  const before = plan ? o.planListPaid! : o.listTotal, after = plan ? o.due : o.netTotal;
  const priceRows: [string, string, string, boolean][] = [["Area :", fA(o.area), "M2", false], ["price / SQM", fInt(before / o.area), "EGP", false], ["Total value", fA(Math.round(before)), "EGP", true]];
  if (o.discountPct > 0) priceRows.push([`Special discount (${fA(o.discountPct)}%)`, `- ${fA(Math.round(before - after))}`, "EGP", false], ["Price / SQM after discount", fInt(after / o.area), "EGP", false], ["Total after discount", fA(Math.round(after)), "EGP", true]);
  priceRows.forEach(([k, v, u, last]) => {
    const disc = k.startsWith("Special discount");
    box(L, y, C1 - L, 12.3, GR); box(C1, y, C2 - C1, 12.3, last ? GR : undefined);
    tx(k, L + 3, y + 6.2, { b: !last, i: last, c: disc ? RD : BK }); tx(v, C2 - 4, y + 6.2, { b: true, i: last, a: "right", c: disc ? RD : BK }); tx(u, C2 + 36, y + 6.2, { b: true }); y += 12.3;
  });
  if (plan) { tx("*", L - 4, y + 6.2); rich(`Price with instalments (interest included). {Cash price ${fInt(o.netSqm)} EGP/SQM - total ${fA(Math.round(o.netTotal))} EGP.}`, L + 3, y + 6.2); y += 10; }
  // payment table
  y += 14;
  const rows: { label: string; n: string; amt: number; dur: string; dur2?: string }[] = o.mode === "plan" && o.planOut
    ? [{ label: "Down Payment", n: "1", amt: o.planOut.adv, dur: "Immediately" }, ...(o.planOut.n ? [{ label: "Total Installments", n: String(o.planOut.n), amt: o.planOut.paid - o.planOut.adv, dur: o.planOut.label, dur2: `on ${o.planOut.years} Year${o.planOut.years === 1 ? "" : "s"}` }] : [])]
    : [{ label: "Down Payment", n: "1", amt: o.netTotal, dur: "Within 3 months" }];
  const due = rows.reduce((a, r) => a + (+r.amt || 0), 0);
  row4(["Payment Method", "Installments", "Amount", "Duration"], 12, { fill: GR, b: true });
  rows.forEach((r) => {
    const h = r.dur2 ? 18 : 12; need(h);
    box(L, y, C1 - L, h); tx(r.label, (L + C1) / 2, y + h / 2, { a: "center" }); box(C1, y, C2 - C1, h); tx(r.n, (C1 + C2) / 2, y + h / 2, { a: "center" });
    box(C2, y, C3 - C2, h); tx(f2(r.amt), C3 - 4, y + h / 2, { a: "right" });
    if (r.dur2) { box(C3, y, 460 - C3, h); box(460, y, R - 460, h); tx(r.dur, (C3 + 460) / 2, y + h / 2, { b: true, a: "center" }); tx(r.dur2, (460 + R) / 2, y + h / 2, { b: true, a: "center" }); }
    else { box(C3, y, R - C3, h); tx(r.dur, (C3 + R) / 2, y + h / 2, { b: true, a: "center" }); }
    y += h;
  });
  need(12); box(L, y, C2 - L, 12); tx("Total Amount Due", (L + C2) / 2, y + 6, { b: true, a: "center" }); box(C2, y, C3 - C2, 12); tx(fA(Math.round(due)), C3 - 4, y + 6, { b: true, a: "right" }); box(C3, y, R - C3, 12); y += 12;
  // notes
  y += 3;
  if (o.mode === "plan" && o.planOut && o.planOut.n) { const y0 = y + 6.2; tx("*", L - 4, y0); rich(`The Amount of installment ${o.planOut.label}`, L + 3, y0); tx(fInt(o.planOut.inst), C2 - 10, y0, { b: true, i: true, a: "right" }); tx("EGP", C2 - 5, y0, { i: true }); y += 12.3; }
  (t.notes as string[]).forEach(note);
  // fees (on the value the customer pays)
  const total = o.due; const sec = () => { y += 4; };
  if (t.ins > 0) { sec(); row4(["Item", "Percentage", "Amount", "Notes"], 11, { fill: GR, b: true }); row4(["Infrastructure insurance", fA(t.ins) + "%", f2(total * t.ins / 100), "Upon contract"], 11, { b: true }); (t.insNotes as string[]).forEach(note); }
  if (t.hand > 0) { sec(); row4(["Item", null, "Amount", "Notes"], 11, { fill: GR, b: true, xs: [L, C2, C2, C3, R] }); row4(["Handover fees", null, fA(t.hand), "Upon handover"], 18, { b: true, xs: [L, C2, C2, C3, R] }); tx("(Excluding VAT)", L + 3, y + 7, { b: true, i: true, c: RD }); y += 13; }
  if (t.con > 0) { sec(); row4(["Item", "Percentage", "Amount", "Notes"], 11, { fill: GR, b: true }); row4(["Contract Fees", fA(t.con) + "%", f2(total * t.con / 100), "Upon contract"], 12, { b: true }); note(`Will be paid upon signing the contract and it's equivalent to ${fA(t.con * 10)}/1000 of the land value. {(Excluding VAT)}`); }
  if (t.maint > 0) { sec(); row4(["Item", "Price/SQM", "Amount", "Notes"], 11, { fill: GR, b: true }); row4(["Maintenance deposit", f2(t.maint), f2(o.area * t.maint), "Upon contract"], 11, { b: true }); y += 6; }
  if (t.addw > 0) {
    sec(); need(40); tx("Additional Work :", L + 3, y + 4, { b: true }); doc.line(L + 3, y + 8, L + 3 + textWidth("Additional Work :", 6.8, true), y + 8, BK, 0.5); y += 12;
    row4(["Item", null, "Amount", "Notes"], 11, { fill: GR, b: true, xs: [L, C2, C2, C3, R] }); row4(["Cost of Additional works", null, fA(t.addw), "Upon Contract"], 11, { b: true, xs: [L, C2, C2, C3, R] });
    note("Additional works included (site survey, handover fees, and house connection fees). {(Excluding VAT)}");
  }
  if (t.ida > 0) { sec(); row4(["Item", "Percentage", "Notes", null], 11, { fill: GR, b: true, xs: [L, C1, C2, R, R] }); row4(["IDA approval fees", fA(t.ida) + "%", "Upon Contract", null], 11, { b: true, xs: [L, C1, C2, R, R] }); y += 6; }
  // validity and signatures
  need(150); y += 16;
  doc.rect(L, y, C1 - L, 11, { fill: GR }); tx("Validity :", L + 3, y + 5.5, { b: true }); y += 12;
  doc.rect(L, y, 470 - L, 11, { fill: [255, 255, 0] }); tx("*", L - 4, y + 5.5); tx(`This offer is valid for ${o.validText}`, L + 3, y + 5.5, { b: true, i: true, c: RD }); y += 26;
  const sx = [135, 300, 468];
  const sg = (t.sign as [string, string][]).map((s, i) => (i === 0 && !s[1] && o.owner ? [s[0], o.owner] : s));
  sg.forEach((s, i) => tx(s[0], sx[i], y, { b: true, a: "center" })); y += 17; sg.forEach((s, i) => { if (s[1]) tx(s[1], sx[i], y, { b: true, a: "center" }); }); y += 38;
  doc.rect(L, y, 260 - L, 12, { stroke: BK, lw: 1.2 }); tx("Approved On payment terms and conditions", L + 3, y + 6, { b: true }); y += 26;
  tx("Authorized signature for :", L + 3, y + 5, { b: true }); doc.rect(260, y, R - 260, 10, { fill: GR }); y += 13;
  tx("Name:", L + 3, y + 5, { b: true }); y += 12; tx("Signature:", L + 3, y + 5, { b: true });
  foot();
  return doc.bytes();
}
export const offerFileName = (o: Offer) => `Sales Offer - ${o.project} - ${fInt(o.area)} SQM${o.company ? ` - ${o.company}` : ""}`.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 90) + ".pdf";

/** after the e-mail is sent: the offer history record (the Land Bank demand page reads it). Customer figures only. */
export async function recordOfferPrint(o: Offer, lead: any, approvedBy: string) {
  const ph = String(lead.phoneNumber || "").replace(/\D/g, "");
  const em = String(lead.email || "").trim().toLowerCase();
  let contactId: string | null = null;
  if (em) contactId = (await admin.from("crm_contacts").select("id").eq("email_norm", em).limit(1).maybeSingle()).data?.id || null;
  if (!contactId && ph.length >= 8) contactId = (await admin.from("crm_contacts").select("id").like("phone_norm", `%${ph.slice(-9)}`).limit(1).maybeSingle()).data?.id || null;
  await admin.from("crm_offer_prints").insert({
    contact_id: contactId, lead_id: o.leadId, offer_type: "sales_offer",
    plots: o.plots.map((p) => ({ key: p.key, park: p.park, unit: p.unit, areaSqm: p.areaSqm, status: "available", landType: p.landType, sector: p.sector, listPriceSqm: o.listSqm, project: p.project })),
    total_value: o.due, summary: `Sales offer e-mailed by Lara (approved by ${approvedBy}): list +${o.markupPct}%${o.discountPct ? `, discount ${o.discountPct}%` : ""}, ${o.mode === "plan" ? "instalments" : "cash"}, valid until ${o.validUntil}`,
    doc_name: offerFileName(o), printed_by: null, printed_by_name: `Lara (approved by ${approvedBy})`,
    plan: o.mode === "plan" && o.plan ? { mode: "plan", advancePct: o.plan.adv, years: o.plan.years, paymentsPerYear: (FP_TYPES[o.plan.type] || FP_TYPES.Quarterly).ppy, interestPct: o.plan.rate, instalments: o.planOut?.n, totalPayable: o.due, cashTotal: o.netTotal } : { mode: "cash", cashTotal: o.netTotal },
    offer: { ref: o.ref, validUntil: o.validUntil, by: "Lara", plots: o.plots.map((p) => p.key), markupPct: o.markupPct, discountPct: o.discountPct }, printed_at: nowIso(),
  });
}
