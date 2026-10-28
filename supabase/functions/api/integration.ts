// deno-lint-ignore-file no-explicit-any
// Integration with the Land Bank system (see docs/INTEGRATION.md).
//  - /integration/* routes taking the Land Bank token are "public" for the router: they verify the token themselves.
//  - /plots, /crm/offer-prints, /integration/config use the normal Sales Leads login.
// No cost / GP / client data is ever stored from the Land Bank: the plot snapshot is whitelisted field by field.
import {
  admin, asUuid, bad, body, can, pageAll, Caller, callerFromEmail, clean, crmScope, forbidden, getConfig, HttpError, isAdmin, isObj,
  logActivity, needAdmin, needCrm, normEmail, normName, normPhone, nowIso, rateLimit, rid, setConfig, str,
} from "./lib.ts";
import { route } from "./router.ts";
import { SPECS, teamIds } from "./routes_crm.ts";

const LB_AUTH_URL = "https://ihjlvxmttvjcciafruya.supabase.co/auth/v1/user";
const LB_PUBLISHABLE_KEY = "sb_publishable_8Q-O8l1q58PmM8kQkEETDQ_g1wwmRbS";
const DEFAULT_LB_URL = "https://sdm-land-bank.github.io/";
const STATUSES = new Set(["available", "reserved", "sold", "eoi", "hold", "nfs", "unknown"]);
const OFFER_TYPES: Record<string, string> = { sales_offer: "Sales offer", financial_offer: "Financial offer", proposal: "Proposal" };
const ID_RE = /^[A-Za-z0-9_.:-]{1,60}$/;
const CLOSED = new Set(["Won", "Lost", "Duplicate", "Invalid", "Closed", "Not Interested", "Wrong Number"]);

// ---------------------------------------------------------------------------------------------
// 1. who is calling (Land Bank token)
// ---------------------------------------------------------------------------------------------
const lbCache = new Map<string, { email: string; until: number }>();
async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function lbCaller(req: Request): Promise<Caller> {
  const h = req.headers.get("authorization") || "";
  const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  if (!token || token.length > 4000) throw new HttpError(401, "Sign in to the Land Bank first");
  const key = await sha(token);
  const now = Date.now();
  let email = lbCache.get(key)?.until! > now ? lbCache.get(key)!.email : "";
  if (!email) {
    await rateLimit(`lbtok:${key.slice(0, 24)}`, 60, 60);
    let res: Response;
    try {
      res = await fetch(LB_AUTH_URL, {
        headers: { apikey: LB_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
    } catch { throw new HttpError(502, "Could not verify the Land Bank sign-in"); }
    if (res.status === 401 || res.status === 403) throw new HttpError(401, "Land Bank session expired, sign in again");
    if (!res.ok) throw new HttpError(502, "Could not verify the Land Bank sign-in");
    const u: any = await res.json().catch(() => null);
    email = normEmail(u?.email);
    if (!email) throw new HttpError(401, "Land Bank session is not valid");
    if (lbCache.size > 400) lbCache.clear();
    lbCache.set(key, { email, until: now + 60_000 });
  }
  const c = await callerFromEmail(email);
  if (!can(c, "canViewSalesCrm")) throw forbidden("Your account has no access to Sales Leads");
  return c;
}

/** public (self-authenticated) route taking the Land Bank token */
function lbRoute(method: string, path: string, fn: (x: { req: Request; c: Caller; query: URLSearchParams; params: Record<string, string> }) => Promise<any>) {
  route(method, path, async ({ req, query, params }) => fn({ req, c: await lbCaller(req), query, params }), { public: true });
}

// ---------------------------------------------------------------------------------------------
// 2. plot snapshot
// ---------------------------------------------------------------------------------------------
const num = (v: any): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);
const isoOrNull = (v: any): string | null => { const s = str(v, 40); return s && !isNaN(Date.parse(s)) ? new Date(s).toISOString() : null; };

function cleanPlot(p: any): any | null {
  if (!isObj(p)) return null;
  const key = str(p.key, 160), unit = str(p.unit, 160);
  if (!key || !unit) return null;
  const status = str(p.status, 20).toLowerCase();
  return {
    key, park: str(p.park, 100), project: str(p.project, 120), unit,
    status: STATUSES.has(status) ? status : "unknown",
    sector: str(p.sector, 120), landType: str(p.landType, 120),
    areaSqm: num(p.areaSqm) ?? 0,
    listPriceSqm: num(p.listPriceSqm), listTotal: num(p.listTotal),
    merged: Array.isArray(p.merged) ? p.merged.slice(0, 60).map((x: any) => str(x, 60)).filter(Boolean) : null,
    holdUntil: isoOrNull(p.holdUntil),
  };
}

lbRoute("GET", "/integration/plots-meta", async ({ c, query }) => {
  await rateLimit(`lbmeta:${c.id}`, 60, 60);
  let { data } = await admin.from("plots_snapshot").select("hash,updated_at,plot_count").eq("id", 1).maybeSingle();
  // the Land Bank page asks with the hash of the list it holds: same hash = the stored list is still current, so say so ("checked just now")
  const h = query.get("hash") || "";
  if (data && h && h === data.hash && (isAdmin(c) || c.role === "Sales Operation")) {
    const at = nowIso();
    await admin.from("plots_snapshot").update({ updated_at: at }).eq("id", 1);
    data = { ...data, updated_at: at };
  }
  return { success: true, hash: data?.hash || "", updatedAt: data?.updated_at || null, count: data?.plot_count || 0 };
});

lbRoute("POST", "/integration/plots-snapshot", async ({ req, c }) => {
  if (!(isAdmin(c) || c.role === "Sales Operation")) throw forbidden("Only Admin or Sales Operation can publish the plot list");
  await rateLimit(`lbsnap:${c.id}`, 600, 20);
  const b = await body(req, 4_000_000);
  if (!isObj(b) || !Array.isArray(b.plots)) throw bad("Send { hash, generatedAt, plots }");
  if (b.plots.length > 6000) throw bad("Too many plots (max 6,000)");
  const plots = b.plots.map(cleanPlot).filter(Boolean);
  const hash = str(b.hash, 128);
  if (!hash) throw bad("A hash is required");
  const r = await admin.from("plots_snapshot").upsert({
    id: 1, hash, generated_at: isoOrNull(b.generatedAt), updated_at: nowIso(), plot_count: plots.length, data: plots,
  });
  if (r.error) throw new HttpError(500, "Could not store the plot list");
  await logActivity(c, "Plot snapshot", `${plots.length} plots published from the Land Bank`, "system");
  return { success: true, count: plots.length };
});

/** the form state needed to rebuild a document: <= 8 KB serialised, otherwise dropped. _v marks that it exists. */
function cleanOffer(o: any): any | null {
  if (!isObj(o)) return null;
  const c = { ...clean(o), _v: 1 };
  const txt = JSON.stringify(c);
  return txt.length <= 8192 ? c : null;
}

function cleanPlan(p: any): any | null {
  if (!isObj(p)) return null;
  const n = (v: any, max: number) => { const x = num(v); return x === null ? null : Math.max(0, Math.min(max, x)); };
  const mode = str(p.mode, 10).toLowerCase();
  return {
    mode: ["cash", "plan", "custom"].includes(mode) ? mode : "cash",
    advancePct: n(p.advancePct, 100), years: n(p.years, 50), paymentsPerYear: n(p.paymentsPerYear, 52), interestPct: n(p.interestPct, 200),
    instalments: n(p.instalments, 1000), escalationPct: n(p.escalationPct, 200), fixedAnnual: p.fixedAnnual === true,
    totalPayable: n(p.totalPayable, 1e13), cashTotal: n(p.cashTotal, 1e13),
  };
}

// ---------------------------------------------------------------------------------------------
// 3. contacts picker
// ---------------------------------------------------------------------------------------------
/** leads a person may see that belong to these contacts (linked by phone / e-mail), live only */
async function linkedLeads(c: Caller, contacts: any[]): Promise<Map<string, any[]>> {
  const out = new Map<string, any[]>();
  const phones = new Set<string>(), emails = new Set<string>();
  for (const k of contacts) { if (k.phone_norm) phones.add(k.phone_norm); if (k.email_norm) emails.add(k.email_norm); }
  const scope = crmScope(c);
  const team = scope === "team" ? await teamIds(c) : [];
  const found = new Map<string, any>();
  const run = async (col: string, vals: string[]) => {
    for (let i = 0; i < vals.length; i += 80) {
      const { data } = await admin.from("crm_leads").select("id,status,assigned_to,created_by,phone_norm,email_norm").is("deleted_at", null).in(col, vals.slice(i, i + 80)).limit(2000);
      for (const l of data || []) if (SPECS.leads.owns(c, scope, team, l)) found.set(l.id, l);
    }
  };
  await Promise.all([run("phone_norm", [...phones]), run("email_norm", [...emails])]);
  for (const k of contacts) {
    out.set(k.id, [...found.values()].filter((l) => (k.phone_norm && l.phone_norm === k.phone_norm) || (k.email_norm && l.email_norm === k.email_norm)));
  }
  return out;
}

function contactVisible(c: Caller, scope: string, k: any, links: any[]): boolean {
  if (scope === "finance") return false;
  if (scope === "all" || scope === "viewall") return true;
  if (links.length) return true;
  const d = k.data || {};
  return (!!d.createdById && d.createdById === c.id) || (!!d.createdByUserId && d.createdByUserId === c.id) || (!!d.createdBy && normName(d.createdBy) === normName(c.name));
}

function contactOut(k: any, links: any[]) {
  const d = k.data || {};
  return {
    id: k.id, serial: str(d.serialNumber, 30), name: str(d.name, 200), phone: str(d.phoneNumber, 40), email: str(d.email, 254),
    company: str(d.company || d.companyName, 200),
    openLeads: links.filter((l) => !CLOSED.has(l.status || "")).length,
    leadIds: links.slice(0, 20).map((l) => l.id),
  };
}

lbRoute("GET", "/integration/contacts", async ({ c, query }) => {
  await rateLimit(`lbcont:${c.id}`, 60, 60);
  if (crmScope(c) === "finance") throw forbidden();
  const q = str(query.get("q"), 80);
  if (q.length < 2) throw bad("Type at least 2 characters");
  const limit = Math.max(1, Math.min(50, parseInt(query.get("limit") || "20") || 20));
  const term = q.replace(/[^\p{L}\p{N} @.+\-]/gu, "").trim();
  if (term.length < 2) return { success: true, contacts: [] };
  const filters: string[] = [`name_norm.ilike.%${normName(term)}%`, `email_norm.ilike.%${term.toLowerCase()}%`, `data->>company.ilike.%${term}%`, `data->>serialNumber.ilike.%${term}%`];
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 4) {
    filters.push(`phone_norm.ilike.%${digits}%`);
    const n = normPhone(term);
    if (n.length >= 4 && n !== digits) filters.push(`phone_norm.ilike.%${n}%`);
  }
  const { data, error } = await admin.from("crm_contacts").select("id,data,phone_norm,email_norm,name_norm").is("deleted_at", null)
    .or(filters.join(",")).order("created_at", { ascending: false }).limit(400);
  if (error) throw new HttpError(500, "Could not search contacts");
  const rows = data || [];
  const links = await linkedLeads(c, rows);
  const scope = crmScope(c);
  const contacts = rows.filter((k: any) => contactVisible(c, scope, k, links.get(k.id) || [])).slice(0, limit).map((k: any) => contactOut(k, links.get(k.id) || []));
  return { success: true, contacts };
});

async function visibleContact(c: Caller, id: string): Promise<{ k: any; links: any[] }> {
  if (!ID_RE.test(id)) throw bad("Unknown contact");
  const { data: k } = await admin.from("crm_contacts").select("id,data,phone_norm,email_norm,name_norm").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!k) throw new HttpError(404, "Contact not found");
  const links = (await linkedLeads(c, [k])).get(k.id) || [];
  if (!contactVisible(c, crmScope(c), k, links)) throw new HttpError(404, "Contact not found");
  return { k, links };
}

lbRoute("POST", "/integration/offer-printed", async ({ req, c }) => {
  await rateLimit(`lbprint:${c.id}`, 60, 30);
  if (crmScope(c) === "finance") throw forbidden();
  const b = clean(await body(req, 60_000));
  if (!isObj(b)) throw bad("Invalid request");
  const offerType = str(b.offerType, 30);
  if (!OFFER_TYPES[offerType]) throw bad("Unknown offer type");
  const plots = (Array.isArray(b.plots) ? b.plots : []).slice(0, 50).filter(isObj).map((p: any) => ({
    key: str(p.key, 160), park: str(p.park, 100), unit: str(p.unit, 160), areaSqm: num(p.areaSqm), status: str(p.status, 20).toLowerCase(),
    project: str(p.project, 120), landType: str(p.landType, 120), sector: str(p.sector, 120), listPriceSqm: num(p.listPriceSqm),
  })).filter((p: any) => p.key || p.unit);
  const { k, links } = await visibleContact(c, str(b.contactId, 60));

  // which lead gets the timeline entry: the given one (if visible and the contact's), else the caller's own open lead of that contact
  let lead: any = null;
  const want = str(b.leadId, 60);
  const scope = crmScope(c), team = scope === "team" ? await teamIds(c) : [];
  const pick = (id: string) => links.find((l) => l.id === id);
  let leadId = want && ID_RE.test(want) && pick(want) ? want : "";
  if (!leadId) leadId = links.find((l) => l.assigned_to === c.id && !CLOSED.has(l.status || ""))?.id || "";
  if (leadId) {
    const { data: ex } = await admin.from("crm_leads").select("*").eq("id", leadId).is("deleted_at", null).maybeSingle();
    if (ex && SPECS.leads.owns(c, scope, team, ex)) lead = ex;
  }

  const total = num(b.totalValue);
  const label = OFFER_TYPES[offerType];
  const codes = plots.map((p: any) => p.unit || p.key).join(", ").slice(0, 300) || "no plots";
  const summary = str(b.summary, 500) || `${label} for ${codes}`;
  const ins = await admin.from("crm_offer_prints").insert({
    contact_id: k.id, lead_id: lead?.id || null, offer_type: offerType, plots, total_value: total && total >= 0 ? total : null,
    summary, plan: cleanPlan(b.plan), offer: cleanOffer(b.offer), doc_name: str(b.docName, 200) || null, printed_by: c.id, printed_by_name: c.name,
  }).select("id").single();
  if (ins.error) throw new HttpError(500, "Could not record the offer");

  if (lead) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = attempt === 0 ? lead : (await admin.from("crm_leads").select("*").eq("id", lead.id).is("deleted_at", null).maybeSingle()).data;
      if (!cur) break;
      const now = nowIso();
      const d = { ...cur.data };
      d.timeline = [...(Array.isArray(d.timeline) ? d.timeline : []), {
        id: rid(), timestamp: now, type: "Offer", user: c.name, title: `Offer printed (${label}) for ${codes}`.slice(0, 200),
        description: `${label} printed in the Land Bank${total ? `, total ${Math.round(total).toLocaleString("en-US")} EGP` : ""}${summary !== `${label} for ${codes}` ? `. ${summary}` : ""}`.slice(0, 600),
      }];
      d.lastUpdated = now;
      const u = await admin.from("crm_leads").update({ data: d }).eq("id", cur.id).eq("updated_at", cur.updated_at).select("id");
      if (u.data?.length) {
        await admin.from("crm_lead_audit").insert({ lead_id: cur.id, actor_id: c.id, actor_name: c.name, action: "offer", to_value: offerType, note: codes.slice(0, 300) });
        break;
      }
    }
  }
  return { success: true, id: ins.data.id };
});

// ---------------------------------------------------------------------------------------------
// 4. Sales Leads client routes (normal login)
// ---------------------------------------------------------------------------------------------
route("GET", "/plots", async ({ c, query }) => {
  needCrm(c);
  if (!can(c, "canViewSalesPlotsInventory") && !can(c, "canViewSalesLeads")) throw forbidden();
  await rateLimit(`plots:${c.id}`, 60, 40);
  const held = str(query.get("hash"), 128);
  const { data } = await admin.from("plots_snapshot").select("hash,updated_at,plot_count" + (held ? "" : ",data")).eq("id", 1).maybeSingle();
  const landBankUrl = await getConfig<string>("landbank_url", DEFAULT_LB_URL);
  if (!data) return { success: true, updatedAt: null, hash: "", count: 0, plots: [], landBankUrl };
  if (held && held === data.hash) return { success: true, unchanged: true };
  if (held) {
    const full = await admin.from("plots_snapshot").select("data").eq("id", 1).maybeSingle();
    return { success: true, updatedAt: data.updated_at, hash: data.hash, count: data.plot_count, plots: full.data?.data || [], landBankUrl };
  }
  return { success: true, updatedAt: data.updated_at, hash: data.hash, count: data.plot_count, plots: data.data || [], landBankUrl };
});

route("GET", "/crm/offer-prints", async ({ c, query }) => {
  needCrm(c);
  await rateLimit(`prints:${c.id}`, 60, 60);
  const scope = crmScope(c);
  if (scope === "finance") throw forbidden();
  const limit = Math.max(1, Math.min(100, parseInt(query.get("limit") || "50") || 50));
  const contactId = str(query.get("contactId"), 60), leadId = str(query.get("leadId"), 60), plotKey = str(query.get("plotKey"), 160);
  let q: any = admin.from("crm_offer_prints").select("*").order("printed_at", { ascending: false }).limit(limit);
  if (contactId) { await visibleContact(c, contactId); q = q.eq("contact_id", contactId); }
  else if (leadId) {
    if (!ID_RE.test(leadId)) throw bad("Unknown lead");
    const { data: ex } = await admin.from("crm_leads").select("id,status,assigned_to,created_by").eq("id", leadId).is("deleted_at", null).maybeSingle();
    const team = scope === "team" ? await teamIds(c) : [];
    if (!ex || !SPECS.leads.owns(c, scope, team, ex)) throw new HttpError(404, "Lead not found");
    q = q.eq("lead_id", leadId);
  } else {
    if (plotKey) q = q.contains("plots", JSON.stringify([{ key: plotKey }]));
    if (scope === "own" || scope === "team") {
      const ids = scope === "team" ? await teamIds(c) : [c.id];
      q = q.in("printed_by", ids);
    }
  }
  const { data, error } = await q;
  if (error) throw new HttpError(500, "Could not load the offers");
  return {
    success: true,
    rows: (data || []).map((r: any) => ({
      id: r.id, contactId: r.contact_id, leadId: r.lead_id, offerType: r.offer_type, plots: r.plots || [], totalValue: r.total_value === null ? null : Number(r.total_value),
      summary: r.summary || "", docName: r.doc_name || "", printedBy: r.printed_by, printedByName: r.printed_by_name || "", printedAt: r.printed_at,
    })),
  };
});

route("GET", "/integration/config", async ({ c }) => {
  needAdmin(c);
  return { success: true, landBankUrl: await getConfig<string>("landbank_url", DEFAULT_LB_URL) };
});
route("POST", "/integration/config", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 2000);
  let u: URL;
  try { u = new URL(str(b.landBankUrl, 300)); } catch { throw bad("Enter the full Land Bank address"); }
  if (u.protocol !== "https:" || u.username || u.password) throw bad("The Land Bank address must be a plain https link");
  const url = u.origin + u.pathname + u.search;
  await setConfig("landbank_url", url);
  await logActivity(c, "Land Bank link", `Land Bank address set to ${u.origin}`, "admin");
  return { success: true, landBankUrl: url };
});

// ---------------------------------------------------------------------------------------------
// 7. demand analytics
// ---------------------------------------------------------------------------------------------
route("POST", "/crm/lb-click", async ({ req, c }) => {
  needCrm(c);
  await rateLimit(`lbclick:${c.id}`, 60, 60);
  const b = await body(req, 2000);
  const kind = b.kind === "hold" ? "hold" : b.kind === "open" ? "open" : "";
  const plotKey = str(b.plotKey, 160);
  if (!kind || !plotKey) throw bad("Invalid request");
  const lead = str(b.leadId, 60);
  await admin.from("crm_lb_clicks").insert({ user_id: c.id, user_name: c.name, plot_key: plotKey, kind, lead_id: lead && ID_RE.test(lead) ? lead : null });
  return { success: true };
});

/** from / to as YYYY-MM-DD (to inclusive) -> ISO bounds, or null */
function range(query: URLSearchParams): { from: string | null; to: string | null } {
  const d = (k: string, end: boolean) => {
    const v = str(query.get(k), 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) return null;
    const t = new Date(v + "T00:00:00Z"); if (end) t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString();
  };
  return { from: d("from", false), to: d("to", true) };
}

route("GET", "/crm/lb-activity", async ({ c, query }) => {
  needCrm(c);
  const scope = crmScope(c);
  if (scope === "finance") throw forbidden();
  await rateLimit(`lbact:${c.id}`, 60, 30);
  const { from, to } = range(query);
  const ids: string[] | null = scope === "own" ? [c.id] : scope === "team" ? await teamIds(c) : null;
  const prints = await pageAll((a, z) => {
    let q: any = admin.from("crm_offer_prints").select("printed_by,printed_by_name,offer_type,contact_id,plots,printed_at").order("printed_at", { ascending: false }).order("id").range(a, z);
    if (from) q = q.gte("printed_at", from); if (to) q = q.lt("printed_at", to);
    if (ids) q = q.in("printed_by", ids);
    return q;
  }, 20000);
  const clicks = await pageAll((a, z) => {
    let q: any = admin.from("crm_lb_clicks").select("user_id,user_name,plot_key,kind,clicked_at").order("clicked_at", { ascending: false }).order("id").range(a, z);
    if (from) q = q.gte("clicked_at", from); if (to) q = q.lt("clicked_at", to);
    if (ids) q = q.in("user_id", ids);
    return q;
  }, 20000);
  const people = new Map<string, any>();
  const get = (id: string | null, name: string | null) => {
    const k = id || "?";
    let r = people.get(k);
    if (!r) { r = { userId: id, name: name || "", salesOffers: 0, financialOffers: 0, proposals: 0, totalPrints: 0, uniqueContacts: 0, uniquePlots: 0, holdClicks: 0, openClicks: 0, lastPrintAt: null, lastClickAt: null, _c: new Set(), _p: new Set() }; people.set(k, r); }
    if (!r.name && name) r.name = name;
    return r;
  };
  for (const p of prints) {
    const r = get(p.printed_by, p.printed_by_name);
    if (p.offer_type === "sales_offer") r.salesOffers++; else if (p.offer_type === "financial_offer") r.financialOffers++; else r.proposals++;
    r.totalPrints++;
    if (p.contact_id) r._c.add(p.contact_id);
    for (const x of Array.isArray(p.plots) ? p.plots : []) if (x?.key) r._p.add(x.key);
    if (!r.lastPrintAt || p.printed_at > r.lastPrintAt) r.lastPrintAt = p.printed_at;
  }
  for (const k of clicks) {
    const r = get(k.user_id, k.user_name);
    if (k.kind === "hold") r.holdClicks++; else r.openClicks++;
    if (!r.lastClickAt || k.clicked_at > r.lastClickAt) r.lastClickAt = k.clicked_at;
  }
  const rows = [...people.values()].map((r) => { r.uniqueContacts = r._c.size; r.uniquePlots = r._p.size; delete r._c; delete r._p; return r; })
    .sort((a, b) => b.totalPrints - a.totalPrints || b.holdClicks + b.openClicks - (a.holdClicks + a.openClicks));
  const totals = rows.reduce((t: any, r: any) => {
    for (const k of ["salesOffers", "financialOffers", "proposals", "totalPrints", "holdClicks", "openClicks"]) t[k] += r[k];
    return t;
  }, { salesOffers: 0, financialOffers: 0, proposals: 0, totalPrints: 0, holdClicks: 0, openClicks: 0 });
  return { success: true, rows, totals };
});

const statsCache = new Map<string, { until: number; data: any }>();
const SIZE_BANDS: [string, number][] = [["< 2,000 m2", 2000], ["2,000 - 5,000 m2", 5000], ["5,000 - 10,000 m2", 10000], ["10,000 - 20,000 m2", 20000], ["20,000+ m2", Infinity]];
const STATS_ROLES = new Set(["Admin", "Sales Operation", "Sales Director", "Executive (View)"]);

/** requests = plots assigned on live leads (assignedAt inside the period when present) */
async function loadRequests(from: string | null, to: string | null): Promise<any[]> {
  const rows = await pageAll((a, z) => admin.from("crm_leads").select("id,status,ap:data->assignedPlots,cn:data->>customerName,co:data->>companyName,ow:data->>assignedSalespersonName,pm:data->>plotMode,ph:phone_norm,em:email_norm")
    .is("deleted_at", null).not("data->assignedPlots", "is", null).order("id").range(a, z), 20000);
  const out: any[] = [];
  for (const l of rows) {
    if (!Array.isArray(l.ap)) continue;
    for (const p of l.ap.slice(0, 20)) {
      const key = str(p?.key, 160);
      if (!key) continue;
      const at = str(p.assignedAt, 40);
      const t = at && !isNaN(Date.parse(at)) ? new Date(at).toISOString() : "";
      if (t && ((from && t < from) || (to && t >= to))) continue;
      out.push({ leadId: l.id, contact: l.ph || l.em || l.id, customer: str(l.cn, 200), company: str(l.co, 200), ownerName: str(l.ow, 120), mode: l.pm === "manual" ? "manual" : "recommend", assignedAt: t || null, plot: p });
    }
  }
  return out;
}

lbRoute("GET", "/integration/offer-stats", async ({ c, query }) => {
  if (!STATS_ROLES.has(c.role)) throw forbidden("Offer demand statistics are for management only");
  await rateLimit(`lbstats:${c.id}`, 60, 20);
  const { from, to } = range(query);
  const ck = `${from || ""}|${to || ""}`;
  const hit = statsCache.get(ck);
  if (hit && hit.until > Date.now()) return hit.data;
  const prints = await pageAll((a, z) => {
    let q: any = admin.from("crm_offer_prints").select("contact_id,offer_type,plots,plan,printed_at").order("printed_at", { ascending: false }).order("id").range(a, z);
    if (from) q = q.gte("printed_at", from); if (to) q = q.lt("printed_at", to);
    return q;
  }, 20000);
  const reqs = await loadRequests(from, to);
  const clicks = await pageAll((a, z) => {
    let q: any = admin.from("crm_lb_clicks").select("plot_key").eq("kind", "hold").order("clicked_at", { ascending: false }).order("id").range(a, z);
    if (from) q = q.gte("clicked_at", from); if (to) q = q.lt("clicked_at", to);
    return q;
  }, 20000);

  const field = (t: string) => (t === "sales_offer" ? "sales" : t === "financial_offer" ? "financial" : "proposal");
  const totals: any = { prints: prints.length, salesOffers: 0, financialOffers: 0, proposals: 0, contacts: 0, plots: 0, requests: 0, requestedPlots: 0 };
  const allContacts = new Set<string>();
  const perPlot = new Map<string, any>();
  const groups = { project: new Map<string, any>(), landType: new Map<string, any>(), sector: new Map<string, any>() };
  const bands = new Map<string, any>(SIZE_BANDS.map(([b]) => [b, { band: b, total: 0, requests: 0, holdClicks: 0 }]));
  const plans = new Map<string, any>(), monthly = new Map<string, number>();
  const mode = { cash: 0, plan: 0, custom: 0 };
  let advSum = 0, advN = 0, yrSum = 0, yrN = 0;

  const plotRow = (key: string, x: any) => {
    let r = perPlot.get(key);
    if (!r) {
      r = { key, project: str(x?.project, 120) || str(x?.park, 100), unit: str(x?.unit, 160), landType: str(x?.landType, 120), sector: str(x?.sector, 120), areaSqm: num(x?.areaSqm) ?? 0,
        sales: 0, financial: 0, proposal: 0, total: 0, requests: 0, holdClicks: 0, _c: new Set(), _rc: new Set(), _rl: new Set(), lastAt: null };
      perPlot.set(key, r);
    }
    return r;
  };
  const grp = (m: Map<string, any>, name: string, label: string) => {
    let g = m.get(name);
    if (!g) { g = { [label]: name, total: 0, sales: 0, financial: 0, proposal: 0, requests: 0, holdClicks: 0, _p: new Set() }; m.set(name, g); }
    return g;
  };
  const bandOf = (area: number) => (SIZE_BANDS.find(([, max]) => area < max) || SIZE_BANDS[SIZE_BANDS.length - 1])[0];
  const names = (r: any) => [[groups.project, r.project || "-", "project"], [groups.landType, r.landType || "-", "landType"], [groups.sector, r.sector || "-", "sector"]] as [Map<string, any>, string, string][];

  for (const p of prints) {
    const f = field(p.offer_type);
    if (f === "sales") totals.salesOffers++; else if (f === "financial") totals.financialOffers++; else totals.proposals++;
    if (p.contact_id) allContacts.add(p.contact_id);
    const month = String(p.printed_at).slice(0, 7);
    monthly.set(month, (monthly.get(month) || 0) + 1);
    const pl = isObj(p.plan) ? p.plan : null;
    if (pl) {
      const m = pl.mode === "plan" ? "plan" : pl.mode === "custom" ? "custom" : "cash";
      mode[m]++;
      if (m === "plan") {
        const label = `${pl.advancePct ?? "?"}% advance, ${pl.years ?? "?"} y, ${pl.paymentsPerYear ?? "?"}/y`;
        const g = plans.get(label) || { label, mode: m, advancePct: pl.advancePct ?? null, years: pl.years ?? null, paymentsPerYear: pl.paymentsPerYear ?? null, count: 0 };
        g.count++; plans.set(label, g);
        if (typeof pl.advancePct === "number") { advSum += pl.advancePct; advN++; }
        if (typeof pl.years === "number") { yrSum += pl.years; yrN++; }
      }
    }
    // a print with several plots adds 1 to each distinct plot / group, but only 1 to the print totals
    const seen = new Set<string>(), seenG = new Set<string>();
    for (const x of Array.isArray(p.plots) ? p.plots : []) {
      const key = str(x?.key, 160) || str(x?.unit, 160);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const r = plotRow(key, x);
      r[f]++; r.total++; if (p.contact_id) r._c.add(p.contact_id);
      if (!r.lastAt || p.printed_at > r.lastAt) r.lastAt = p.printed_at;
      for (const [m, n, lab] of names(r)) { const g = grp(m, n, lab); g._p.add(key); if (!seenG.has(lab + "\u0001" + n)) { seenG.add(lab + "\u0001" + n); g.total++; g[f]++; } }
      const band = bandOf(r.areaSqm);
      if (!seenG.has("b\u0001" + band)) { seenG.add("b\u0001" + band); bands.get(band).total++; }
    }
  }
  // requests: distinct lead x plot
  const seenReq = new Set<string>();
  for (const q of reqs) {
    const key = str(q.plot.key, 160), id = q.leadId + "\u0001" + key;
    if (seenReq.has(id)) continue;
    seenReq.add(id);
    const r = plotRow(key, q.plot);
    r.requests++; r._rl.add(q.leadId); r._rc.add(q.contact);
    for (const [m, n, lab] of names(r)) { const g = grp(m, n, lab); g._p.add(key); g.requests++; }
    bands.get(bandOf(r.areaSqm)).requests++;
  }
  totals.requests = seenReq.size;
  totals.requestedPlots = new Set(reqs.map((q) => str(q.plot.key, 160))).size;
  for (const k of clicks) {
    const key = str(k.plot_key, 160);
    const r = perPlot.get(key);
    if (!r) continue; // a click on a plot nobody offered or requested adds nothing to the ranking
    r.holdClicks++;
    for (const [m, n, lab] of names(r)) grp(m, n, lab).holdClicks++;
    bands.get(bandOf(r.areaSqm)).holdClicks++;
  }
  totals.contacts = allContacts.size; totals.plots = perPlot.size;
  // score = prints + requests + 0.5 x hold clicks
  const score = (o: any) => Math.round((o.total + o.requests + 0.5 * o.holdClicks) * 10) / 10;
  const fin = (m: Map<string, any>, rename?: [string, string]) => [...m.values()].map((r) => {
    const o: any = { ...r, plots: r._p.size }; delete o._p; o.score = score(o); return o;
  }).sort((a, b) => b.score - a.score || b.total - a.total);
  const planList = [...plans.values()].sort((a, b) => b.count - a.count);
  const plotsOut = [...perPlot.values()].map((r) => {
    const o: any = { ...r, contacts: r._c.size, requestContacts: r._rc.size }; delete o._c; delete o._rc; delete o._rl; o.score = score(o); return o;
  }).sort((a, b) => b.score - a.score || b.total - a.total).slice(0, 2000);
  const data = {
    success: true, generatedAt: nowIso(), totals,
    scoreFormula: "score = prints + requests + 0.5 x hold clicks",
    perPlot: plotsOut,
    byProject: fin(groups.project), byLandType: fin(groups.landType), bySector: fin(groups.sector),
    bySizeBand: [...bands.values()].map((b) => ({ ...b, score: score(b) })),
    plans: planList,
    planSummary: {
      ...mode, avgAdvancePct: advN ? Math.round((advSum / advN) * 10) / 10 : null, avgYears: yrN ? Math.round((yrSum / yrN) * 10) / 10 : null,
      mostCommon: planList[0] ? { label: planList[0].label, count: planList[0].count } : null,
    },
    monthly: [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, total]) => ({ month, total })),
  };
  if (statsCache.size > 20) statsCache.clear();
  statsCache.set(ck, { until: Date.now() + 60_000, data });
  return data;
});

// ---------------------------------------------------------------------------------------------
// 8. offer history (Land Bank token)
// ---------------------------------------------------------------------------------------------
const SEE_ALL_ROLES = new Set(["Admin", "Sales Operation", "Sales Director", "Executive (View)"]);
/** null = everybody's prints, otherwise the people whose prints this caller may see (server-side rule, never the page's) */
async function printScope(c: Caller): Promise<string[] | null> {
  const s = crmScope(c);
  if (SEE_ALL_ROLES.has(c.role) || s === "all" || s === "viewall" || s === "finance") return null;
  if (c.role === "Sales Team Leader") return await teamIds(c);
  return [c.id];
}

async function contactMap(ids: string[]): Promise<Map<string, any>> {
  const m = new Map<string, any>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 100) {
    const { data } = await admin.from("crm_contacts").select("id,data").in("id", uniq.slice(i, i + 100));
    for (const k of data || []) m.set(k.id, k.data || {});
  }
  return m;
}
const last4 = (p: any) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 4 ? d.slice(-4) : ""; };

function historyOut(r: any, cm: Map<string, any>, me?: string) {
  const k = cm.get(r.contact_id) || {};
  return {
    id: r.id, printedAt: r.printed_at, offerType: r.offer_type, contactId: r.contact_id,
    contactName: str(k.name, 200), contactCompany: str(k.company || k.companyName, 200), contactPhone: last4(k.phoneNumber),
    plots: (Array.isArray(r.plots) ? r.plots : []).slice(0, 50).map((p: any) => ({ key: p.key, park: p.park, unit: p.unit, areaSqm: p.areaSqm })),
    totalValue: r.total_value === null || r.total_value === undefined ? null : Number(r.total_value),
    plan: r.plan || null, summary: r.summary || "", docName: r.doc_name || "",
    printedBy: r.printed_by, printedByName: r.printed_by_name || "", mine: !!me && r.printed_by === me, hasOffer: !!r.has_offer,
  };
}
const HIST_COLS = "id,printed_at,offer_type,contact_id,plots,total_value,plan,summary,doc_name,printed_by,printed_by_name,has_offer:offer->>_v";

lbRoute("GET", "/integration/offer-history", async ({ c, query }) => {
  await rateLimit(`lbhist:${c.id}`, 60, 60);
  const who = await printScope(c);
  const { from, to } = range(query);
  const limit = Math.max(1, Math.min(100, parseInt(query.get("limit") || "50") || 50));
  const offset = Math.max(0, Math.min(100000, parseInt(query.get("offset") || "0") || 0));
  const type = str(query.get("type"), 20);
  const term = str(query.get("q"), 80).replace(/[^\p{L}\p{N} @.+\-]/gu, "").trim();
  let q: any = admin.from("crm_offer_prints").select(HIST_COLS, { count: "exact" }).order("printed_at", { ascending: false }).order("id").range(offset, offset + limit - 1);
  if (who) q = q.in("printed_by", who);
  if (from) q = q.gte("printed_at", from); if (to) q = q.lt("printed_at", to);
  if (OFFER_TYPES[type]) q = q.eq("offer_type", type);
  if (term.length >= 2) {
    const { data: ks } = await admin.from("crm_contacts").select("id").is("deleted_at", null)
      .or(`name_norm.ilike.%${normName(term)}%,data->>company.ilike.%${term}%`).limit(200);
    const ids = (ks || []).map((k: any) => k.id).filter((x: string) => ID_RE.test(x));
    const f = [`printed_by_name.ilike.%${term}%`, `summary.ilike.%${term}%`, `doc_name.ilike.%${term}%`];
    if (ids.length) f.push(`contact_id.in.(${ids.join(",")})`);
    q = q.or(f.join(","));
  }
  const { data, count, error } = await q;
  if (error) throw new HttpError(500, "Could not load the offers");
  const cm = await contactMap((data || []).map((r: any) => r.contact_id));
  return { success: true, total: count || 0, rows: (data || []).map((r: any) => historyOut(r, cm, c.id)) };
});

lbRoute("GET", "/integration/offer-history/:id", async ({ c, params }) => {
  await rateLimit(`lbhist1:${c.id}`, 60, 60);
  const id = asUuid(params.id);
  if (!id) throw new HttpError(404, "Offer not found");
  const who = await printScope(c);
  const { data: r } = await admin.from("crm_offer_prints").select("*").eq("id", id).maybeSingle();
  if (!r || (who && !who.includes(r.printed_by))) throw new HttpError(404, "Offer not found");
  const cm = await contactMap([r.contact_id]);
  const o = isObj(r.offer) ? { ...r.offer } : null;
  if (o) delete o._v;
  return { success: true, row: historyOut({ ...r, has_offer: r.offer ? 1 : null }, cm, c.id), offer: o };
});

lbRoute("GET", "/integration/offer-stats/plot", async ({ c, query }) => {
  if (!STATS_ROLES.has(c.role)) throw forbidden("Offer demand statistics are for management only");
  await rateLimit(`lbplot:${c.id}`, 60, 60);
  const key = str(query.get("key"), 160);
  if (!key) throw bad("A plot key is required");
  const limit = Math.max(1, Math.min(100, parseInt(query.get("limit") || "50") || 50));
  const { data, count, error } = await admin.from("crm_offer_prints").select("id,printed_at,offer_type,contact_id,total_value,plan,printed_by_name", { count: "exact" })
    .contains("plots", JSON.stringify([{ key }])).order("printed_at", { ascending: false }).limit(limit);
  if (error) throw new HttpError(500, "Could not load the offers");
  const cm = await contactMap((data || []).map((r: any) => r.contact_id));
  const reqs = (await loadRequests(null, null)).filter((q) => str(q.plot.key, 160) === key);
  const seenL = new Set<string>();
  const requests = reqs.filter((q) => (seenL.has(q.leadId) ? false : (seenL.add(q.leadId), true))).slice(0, limit)
    .map((q) => ({ leadId: q.leadId, customer: q.customer, company: q.company, ownerName: q.ownerName, assignedAt: q.assignedAt, mode: q.mode }));
  return {
    success: true, key, total: count || 0, requests,
    rows: (data || []).map((r: any) => {
      const k = cm.get(r.contact_id) || {};
      return { id: r.id, printedAt: r.printed_at, offerType: r.offer_type, contactName: str(k.name, 200), contactCompany: str(k.company || k.companyName, 200), printedByName: r.printed_by_name || "", totalValue: r.total_value === null ? null : Number(r.total_value), plan: r.plan || null };
    }),
  };
});

// ---------------------------------------------------------------------------------------------
// 10. lead brief for the Land Bank hold dialog
// ---------------------------------------------------------------------------------------------
lbRoute("GET", "/integration/lead-brief", async ({ c, query }) => {
  await rateLimit(`lbbrief:${c.id}`, 60, 60);
  const id = str(query.get("leadId"), 60);
  if (!ID_RE.test(id)) throw new HttpError(404, "Lead not found");
  const scope = crmScope(c), team = scope === "team" ? await teamIds(c) : [];
  const { data: l } = await admin.from("crm_leads").select("id,data,assigned_to,created_by,status").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!l || !SPECS.leads.owns(c, scope, team, l)) throw new HttpError(404, "Lead not found");
  let ownerEmail = "", ownerName = str(l.data?.assignedSalespersonName, 120);
  if (l.assigned_to) {
    const { data: u } = await admin.from("app_users").select("name,email").eq("id", l.assigned_to).maybeSingle();
    if (u) { ownerEmail = str(u.email, 254); ownerName = str(u.name, 120) || ownerName; }
  }
  return {
    success: true, leadId: l.id, customerName: str(l.data?.customerName, 200), companyName: str(l.data?.companyName, 200),
    ownerName, ownerEmail, phoneLast4: last4(l.data?.phoneNumber),
  };
});
