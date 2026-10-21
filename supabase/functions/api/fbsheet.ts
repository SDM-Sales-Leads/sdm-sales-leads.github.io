// deno-lint-ignore-file no-explicit-any
// Facebook / Instagram lead-form leads from the shared Google Sheet "SDM MTEA Leads" (read only, link-shared as viewer).
// Every run: find the newest tab, read it, and create a lead for each row that is new (by Facebook lead id).
// Same rules as the mailbox: duplicate by phone/e-mail is skipped and logged, routing follows the Routing settings page.
import { admin, getConfig, normPhone, nowIso, setConfig, str, tryLock, unlock } from "./lib.ts";
import { canonicalPark } from "./parks.ts";
import { createLeadFromParsed, findDuplicate, logMail, type Parsed } from "./ingest.ts";

export const FB_SHEET_ID = "1-QGJdEchcJbfkUL8Utk0Kjca7gRkzn1AosAtE2THnmw";
const BASE = "https://docs.google.com/spreadsheets/d/";
const MAX_PER_RUN = 15; // routing looks at every open lead per new lead, so a run stays small; the next run continues

/** small CSV reader (quotes, commas and line breaks inside quotes) */
export function parseCsv(t: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (ch !== "\r") f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/** tab names, in order, read from the sheet's public page (the newest tab is the last one) */
async function tabNames(): Promise<string[]> {
  const r = await fetch(`${BASE}${FB_SHEET_ID}/edit`, { redirect: "follow" });
  if (!r.ok) throw new Error("sheet page " + r.status);
  const html = await r.text();
  const names: string[] = [];
  for (const m of html.matchAll(/\[0,0,\\"([^"\\]{1,60})\\"\]/g)) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}
async function tabRows(name: string): Promise<string[][]> {
  const r = await fetch(`${BASE}${FB_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error("sheet tab " + r.status);
  return parseCsv(await r.text());
}

const ALIAS: Record<string, string[]> = {
  id: ["id"], time: ["created_time"], campaign: ["campaign_name"], platform: ["platform"],
  project: ["المشروع_المهتم_به", "project_of_interest"], size: ["المساحة_المطلوبة_للأرض", "required_land_size"],
  job: ["المسمى_الوظيفي", "job_title"], inquiry: ["الاستفسارات", "inquiries"],
  name: ["full_name"], company: ["company_name"], email: ["email"], phone: ["phone_number"],
};
const clean = (v: string) => String(v ?? "").trim().replace(/^(l|p|e|ag|as|c|f):(?=\S)/, "").trim();

function cairoDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return nowIso().slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function projectOf(raw: string): { project: string; note: string } {
  const t = raw.replace(/_/g, " ").trim();
  if (!t || /^<test/i.test(t)) return { project: "", note: "" };
  if (/d\s*-?\s*75/i.test(t)) return { project: "Industria Asher", note: "Asher D75" };           // owner: d75 = new project in Asher
  if (/العاشر|asher/i.test(t) && !/^(إ|ا)ندستريا (إ|ا)يست/.test(t)) return { project: "Industria Asher", note: "Asher plots 10 & 11" };
  if (/دمياط|damietta/i.test(t)) return { project: "Industria New Damietta", note: "" };
  const park = canonicalPark(t);
  return { project: park || t, note: park ? "" : "" };
}
function sizeOf(raw: string): { size: number | null; text: string } {
  const t = raw.replace(/_/g, " ").trim();
  const m = t.match(/\d[\d,]*/);
  const n = m ? parseInt(m[0].replace(/,/g, ""), 10) : NaN;
  return { size: Number.isFinite(n) && n > 0 ? n : null, text: t };
}
function phoneOf(raw: string): string {
  const n = normPhone(clean(raw).replace(/\s+/g, ""));
  return /^0\d{10}$/.test(n) ? "+2" + n : n ? (clean(raw).startsWith("+") ? "+" + n : n) : "";
}

export interface FbRow { fbId: string; time: string; parsed: Parsed; text: string }

export function rowsOf(table: string[][]): FbRow[] {
  const head = (table[0] || []).map((h) => String(h).trim().toLowerCase());
  const ix: Record<string, number> = {};
  for (const [k, names] of Object.entries(ALIAS)) { const i = head.findIndex((h) => names.map((n) => n.toLowerCase()).includes(h)); if (i >= 0) ix[k] = i; }
  if (ix.id === undefined || ix.time === undefined || ix.phone === undefined) return [];
  const out: FbRow[] = [];
  for (const r of table.slice(1)) {
    const g = (k: string) => (ix[k] === undefined ? "" : clean(r[ix[k]] ?? ""));
    let time = g("time"), id = g("id");
    // a few rows were pasted in the other column layout: the time is then in the ad_id column
    if (!/^\d{4}-\d\d-\d\dT/.test(time)) { const alt = r.find((c) => /^\d{4}-\d\d-\d\dT/.test(String(c).trim())); if (alt) time = String(alt).trim(); else continue; }
    if (!id || !/^\d{6,}$/.test(id)) continue;
    const raw = r.join(" ");
    if (/<test lead|dummy data/i.test(raw)) continue;
    const pr = projectOf(g("project")), sz = sizeOf(g("size"));
    const plat = g("platform") === "ig" ? "Instagram" : "Facebook";
    const lines = [
      `${plat} lead form${g("campaign") && !/permission/i.test(g("campaign")) ? " · " + g("campaign") : ""}`,
      pr.note ? `Project of interest: ${pr.note}` : g("project") ? `Project of interest: ${g("project").replace(/_/g, " ")}` : "",
      sz.text ? `Land size wanted: ${sz.text}` : "", g("job") ? `Job title: ${g("job")}` : "", g("inquiry") ? `Inquiry: ${g("inquiry")}` : "",
    ].filter(Boolean);
    out.push({
      fbId: "fb:" + id, time,
      text: lines.join("\n"),
      parsed: {
        customerName: str(g("name"), 120), phoneNumber: phoneOf(r[ix.phone] ?? ""), email: str(g("email"), 254).toLowerCase(),
        companyName: str(g("company"), 120), project: pr.project, plotType: "", requiredSize: sz.size, budget: null,
        priority: "Medium", source: plat === "Instagram" ? "Instagram" : "Facebook", description: str(lines.join("\n"), 2000), inquiryType: "",
      },
    });
  }
  return out;
}

export async function syncFacebook(opts: { since?: string; byUser?: string } = {}) {
  if (!(await tryLock("fbsync", 120))) return { fbNew: 0, fbSkipped: true };
  try {
    const cfg = await getConfig<any>("fb_sheet", {});
    if (cfg.enabled === false) return { fbNew: 0, fbOff: true };
    // leads created before this moment are not imported (set on the first run, or by an administrator to back-fill)
    const since = opts.since || cfg.since || nowIso();
    if (!cfg.since || opts.since) await setConfig("fb_sheet", { ...cfg, enabled: cfg.enabled !== false, since });

    // a new tab can appear at any time (Sheet6 was missed for hours with a 6 h cache): ask the sheet's page for the tab list every 10 minutes.
    // If that page cannot be read, keep the last known list and also try the next tab names (SheetN+1, N+2), so a new tab is never missed
    let names: string[] = Array.isArray(cfg.tabs) && cfg.tabsAt && Date.now() - Date.parse(cfg.tabsAt) < 10 * 60_000 ? cfg.tabs : [];
    if (!names.length) {
      const fresh = await tabNames().catch(() => [] as string[]);
      if (fresh.length) { names = fresh; await setConfig("fb_sheet", { ...(await getConfig<any>("fb_sheet", {})), tabs: names, tabsAt: nowIso() }); }
      else {
        names = Array.isArray(cfg.tabs) ? cfg.tabs : [];
        const last = names[names.length - 1] || "", m = last.match(/^(Sheet)(\d+)$/);
        if (m) for (const k of [1, 2]) names = names.concat(m[1] + (Number(m[2]) + k));   // page unreadable: also try the next tab names
      }
    }
    if (!names.length && cfg.lastTab) names = [cfg.lastTab];
    if (!names.length) return { fbNew: 0, fbError: "Could not read the sheet's tabs" };
    const tabs = names.slice(-4);                                   // the newest tabs: a month change, or an empty tab just created, never hides leads
    let rows: FbRow[] = [];
    for (const t of tabs) rows = rows.concat(rowsOf(await tabRows(t).catch(() => [])));
    const seenIds = new Set<string>(); rows = rows.filter((r) => !seenIds.has(r.fbId) && seenIds.add(r.fbId));
    // only leads newer than the last one handled. The sheet can receive a lead many hours after it was created (the Facebook connector is slow,
    // and created_time mixes time zones), so look back 3 days from the newest lead seen: the lead id and the phone/e-mail check prevent doubles
    const from = opts.since ? Date.parse(since) : Math.max(Date.parse(since), cfg.cursor && !isNaN(Date.parse(cfg.cursor)) ? Date.parse(cfg.cursor) - 72 * 3600_000 : 0);
    rows = rows.filter((r) => Date.parse(r.time) > from).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    if (!rows.length) { await setConfig("fb_sheet", { ...(await getConfig<any>("fb_sheet", {})), lastTab: tabs[tabs.length - 1], lastRun: nowIso() }); return { fbNew: 0, fbTab: tabs[tabs.length - 1] }; }

    const known = new Set<string>();
    for (let i = 0; i < rows.length; i += 100) {
      const ids = rows.slice(i, i + 100).map((r) => r.fbId);
      // only a lead that was really created counts as known: rows logged as Duplicate or Failed are looked at again (the rules may have changed)
      ((await admin.from("crm_email_logs").select("id").in("id", ids).eq("data->>status", "Success")).data || []).forEach((r: any) => known.add(r.id));
      ((await admin.from("crm_leads").select("email_id").in("email_id", ids)).data || []).forEach((r: any) => known.add(r.email_id));
    }
    const todo = rows.filter((r) => !known.has(r.fbId));
    let created = 0, dups = 0, failed = 0;
    const leads: { id: string; name: string }[] = [];
    for (const r of todo.slice(0, MAX_PER_RUN)) {
      const base = { id: r.fbId, receivedTime: new Date(r.time).toISOString(), sender: "Facebook Leads (Google Sheet)", subject: `${r.parsed.customerName || r.parsed.phoneNumber} · ${r.parsed.project || "no project"}` };
      try {
        if (!r.parsed.customerName && !r.parsed.phoneNumber) { await logMail(base, "Failed", { ...base, bodyPreview: r.text, error: "No name or phone number" }); failed++; continue; }
        const dup = await findDuplicate(r.parsed, { phoneFirst: true });
        if (dup) { await logMail(base, "Duplicate", { ...base, bodyPreview: r.text, parsedLeadId: dup.id, error: dup.deleted ? "Skipped: matches a lead that was deleted on purpose" : `Duplicate of ${dup.id}` }); dups++; continue; }
        const lead = await createLeadFromParsed(r.parsed, { ...base, channel: "Facebook Leads", origin: "the Facebook leads sheet", leadDate: cairoDate(r.time) } as any, r.text, opts.byUser || "System");
        await logMail(base, "Success", { ...base, bodyPreview: r.text, parsedLeadId: lead.id });
        created++; leads.push({ id: lead.id, name: r.parsed.customerName || r.parsed.phoneNumber });
      } catch (_e) {
        failed++;
        await logMail(base, "Failed", { ...base, bodyPreview: r.text, error: "Unexpected error while saving this lead" }).catch(() => {});
      }
    }
    const newestRow = rows.reduce((m, r) => Math.max(m, Date.parse(r.time)), 0);
    await setConfig("fb_sheet", { ...(await getConfig<any>("fb_sheet", {})), lastTab: tabs[tabs.length - 1], lastRun: nowIso(), ...(todo.length <= MAX_PER_RUN && newestRow ? { cursor: new Date(newestRow).toISOString() } : {}) });
    return { fbNew: created, fbDuplicates: dups, fbFailed: failed, fbRemaining: Math.max(0, todo.length - MAX_PER_RUN), fbLeads: leads, fbTab: tabs[tabs.length - 1] };
  } finally { await unlock("fbsync"); }
}
