// deno-lint-ignore-file no-explicit-any
// Lara Sales AI — phase 2 (docs/LARA-SALES-AI-PLAN.md): SHADOW mode, admin only, NO AI.
// - Shadow run (daily 09:00 Cairo Sun–Thu from /cron/reminders, or "Run now"): picks the leads the team did not follow up
//   (rules below), writes the message Lara WOULD send with the same smart writer the team uses, and stores it as a draft.
//   Nothing is sent and no lead is changed.
// - Q&A: approved answers, matched by words and concepts (lara_match.ts). Unmatched questions go to "Missed questions".
// - Availability questions ("is there land in October around 3,000 m?") are answered from the Land Bank plot list.
import { admin, bad, body, Caller, getConfig, HttpError, needAdmin, nowIso, setConfig, str, tryLock, unlock } from "./lib.ts";
import { route } from "./router.ts";
import { pg } from "./db.ts";
import { analyse, isArabic, KbEntry, matchQuestion, normText, THRESHOLD } from "./lara_match.ts";
import { canonicalParks } from "../../../src/lib/parkAliases.ts";
import { PARK_AR, plotsAr, preferredLang, situationOf, writeFor } from "../../../src/components/crm/smartWriter.ts";
import { availableByPark, plotFit } from "../../../src/components/crm/smartEngine.ts";
import { firstNameOf } from "../../../src/lib/personName.ts";
import { handleReply, laraMailCfg, pollLaraInbox, saveMailbox, sendDraft, sendQueued, SendRules } from "./lara_mail.ts";

export interface LaraConfig {
  mode: "off" | "shadow" | "approve";
  firstContactHours: number;   // new lead with an owner, no first contact after this many hours
  overdueDays: number;         // follow-up date passed by this many days
  offerSilentDays: number;     // offer sent, nothing logged since
  noAnswerDays: number;        // "no answer" status, last try this many days ago
  maxPerRun: number;           // drafts per run (keeps the list reviewable and the database small)
  nameEn: string; nameAr: string;
  // phase 3 (e-mail, approve first)
  sendEnabled: boolean;        // master switch for sending: off until the admin turns it on
  maxSendPerDay: number; minDaysBetween: number; maxUnanswered: number; sendStart: number; sendEnd: number;
}
export const LARA_DEFAULT: LaraConfig = {
  mode: "shadow", firstContactHours: 24, overdueDays: 3, offerSilentDays: 3, noAnswerDays: 2, maxPerRun: 60,
  nameEn: "Lara, digital sales assistant", nameAr: "لارا، المساعدة الرقمية للمبيعات",
  sendEnabled: false, maxSendPerDay: 30, minDaysBetween: 3, maxUnanswered: 3, sendStart: 9, sendEnd: 17,
};
export async function laraConfig(): Promise<LaraConfig> {
  const c = await getConfig<any>("lara_config", {});
  return { ...LARA_DEFAULT, ...(c && typeof c === "object" ? c : {}) };
}
async function log(kind: string, actor: string | null, text: string, data?: any) {
  await admin.from("lara_log").insert({ kind, actor, text: text.slice(0, 500), data: data ?? null }).then(() => {}, () => {});
}

// ---------------------------------------------------------------------------------------------
// shadow run
// ---------------------------------------------------------------------------------------------
const CLOSED = ["Won", "Lost", "Not Interested", "Low Budget", "Wrong Number", "Duplicate", "Invalid", "Closed"];
const NO_ANS = ["No Answer – Sent WhatsApp", "Out of Coverage – Sent WhatsApp", "Sent WhatsApp", "No Answer"];
const cairoDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const dayDiff = (a: string, b: string) => (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5;
const d10 = (v: any) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");
const RULE_LABEL: Record<string, string> = {
  no_first_contact: "No first contact", followup_overdue: "Follow-up overdue", offer_silent: "Offer without follow-up", no_answer: "No answer, no new try",
};

/** the open leads that may need Lara, with only the fields she uses (a few hundred bytes each, never the whole lead) */
async function candidateLeads(cfg: LaraConfig): Promise<any[]> {
  const today = cairoDay();
  const cut = new Date(Date.parse(today) - cfg.overdueDays * 864e5).toISOString().slice(0, 10);
  const rows: any[] = await pg(async (q) => await q`
    select id, assigned_to,
      data->>'status' as status, data->>'customerName' as "customerName", data->>'companyName' as "companyName", data->>'project' as project,
      data->>'requiredSize' as "requiredSize", data->>'industry' as industry, data->>'phoneNumber' as "phoneNumber", data->>'email' as email,
      data->>'assignedSalespersonId' as "assignedSalespersonId", data->>'assignedSalespersonName' as "assignedSalespersonName",
      data->>'nextFollowUpDate' as "nextFollowUpDate", data->>'lastContactDate' as "lastContactDate", data->>'firstContactAt' as "firstContactAt",
      data->>'offerSent' as "offerSent", data->>'offerDate' as "offerDate", data->>'meetingDate' as "meetingDate", data->>'meetingTime' as "meetingTime",
      data->>'date' as date, data->>'assignedDate' as "assignedDate", data->>'priority' as priority, data->>'channel' as channel, data->>'source' as source,
      data->>'dealValue' as "dealValue", data->>'nationality' as nationality, data->'assignedPlots' as "assignedPlots",
      (select coalesce(jsonb_agg(x.e order by x.i), '[]'::jsonb) from (
         select jsonb_build_object('type', e->>'type', 'title', left(e->>'title', 80), 'description', left(e->>'description', 120), 'timestamp', e->>'timestamp') as e, i
         from jsonb_array_elements(case when jsonb_typeof(data->'timeline') = 'array' then data->'timeline' else '[]'::jsonb end) with ordinality t(e, i)
         order by i desc limit 8) x) as timeline
    from crm_leads
    where deleted_at is null and status <> all(${CLOSED})
      and coalesce(data->>'oldLead', '') <> 'true' and coalesce(data->>'mergedInto', '') = ''
      and assigned_to is not null
      and ( (data->>'nextFollowUpDate') between '2000-01-01' and ${cut}
         or coalesce(data->>'firstContactAt', '') = ''
         or data->>'offerSent' = 'true'
         or status = any(${NO_ANS}) )
    limit 8000`,
    async () => { throw new HttpError(503, "The database link is busy, try again in a minute."); });
  return rows.map((r) => ({ ...r, offerSent: r.offerSent === "true", timeline: Array.isArray(r.timeline) ? r.timeline : [], assignedPlots: Array.isArray(r.assignedPlots) ? r.assignedPlots : [] }));
}

function pickRule(l: any, cfg: LaraConfig, today: string, now: number): { rule: string; why: string; rank: number } | null {
  const meet = d10(l.meetingDate);
  if (meet && meet >= today) return null;                                     // a meeting is planned: the owner is on it
  if (!l.phoneNumber && !l.email) return null;                                // no way to reach the customer
  const last = d10(l.lastContactDate) || d10(l.firstContactAt);
  const gap = last ? dayDiff(last, today) : null;
  const vip = l.priority === "VIP" ? 300 : 0;
  const cc = l.channel === "Call Center" ? 200 : 0;
  const value = Math.min(100, (Number(l.dealValue) || 0) / 1e6);
  if ((l.status === "New" || l.status === "Assigned") && !l.firstContactAt) {
    const start = Math.max(Date.parse(l.assignedDate || "") || 0, Date.parse(l.date || "") || 0);
    const h = start ? (now - start) / 36e5 : 0;
    if (h >= cfg.firstContactHours) return { rule: "no_first_contact", why: `New lead, no first contact for ${Math.floor(h)} h (limit ${cfg.firstContactHours} h)`, rank: 500 + vip + cc + value + Math.min(h, 240) / 4 };
    return null;
  }
  if (l.offerSent && gap != null && gap >= cfg.offerSilentDays) return { rule: "offer_silent", why: `Offer sent, nothing logged for ${gap} days`, rank: 700 + vip + value + gap };
  if (NO_ANS.includes(l.status) && (gap == null || gap >= cfg.noAnswerDays)) return { rule: "no_answer", why: `"${l.status}"${gap != null ? `, last try ${gap} days ago` : ""}`, rank: 300 + vip + value + (gap || 0) };
  const fu = d10(l.nextFollowUpDate);
  if (fu && dayDiff(fu, today) >= cfg.overdueDays) { const n = dayDiff(fu, today); return { rule: "followup_overdue", why: `Follow-up was due ${fu} (${n} days ago)`, rank: 400 + vip + value + Math.min(n, 60) }; }
  return null;
}

export async function runShadow(by: string): Promise<any> {
  const cfg = await laraConfig();
  if (cfg.mode === "off") return { skipped: true, reason: "Lara is off" };
  if (!(await tryLock("lara-run", 300))) return { skipped: true, reason: "another run is busy" };
  const runId = `R${Date.now().toString(36)}`;
  try {
    const now = Date.now(); const today = cairoDay();
    // drafts nobody looked at for 7 days are stale: expire them (kept, never deleted)
    await admin.from("lara_drafts").update({ status: "expired", updated_at: nowIso() }).eq("status", "shadow").lt("created_at", new Date(now - 7 * 864e5).toISOString());
    const skip = new Set<string>();
    const [leads, open, recent, snap, threads, optout] = await Promise.all([
      candidateLeads(cfg),
      admin.from("lara_drafts").select("lead_id").eq("status", "shadow").limit(5000),
      admin.from("lara_drafts").select("lead_id").eq("status", "rejected").eq("feedback", "Do not contact").gte("decided_at", new Date(now - 30 * 864e5).toISOString()).limit(5000),
      admin.from("plots_snapshot").select("data").eq("id", 1).maybeSingle(),
      admin.from("lara_threads").select("lead_id,status,unanswered,last_out_at").limit(20000),
      admin.from("lara_optout").select("contact").limit(20000),
    ]);
    // conversations that must not get a new follow-up: handed over / stopped / closed, too many unanswered, written to recently
    for (const t of threads.data || []) {
      if (t.status !== "open" || t.unanswered >= cfg.maxUnanswered || (t.last_out_at && now - Date.parse(t.last_out_at) < cfg.minDaysBetween * 864e5)) skip.add(t.lead_id);
    }
    const blocked = new Set((optout.data || []).map((r: any) => String(r.contact).toLowerCase()));
    const digits = (p: string) => String(p || "").replace(/\D/g, "");
    const plots = (Array.isArray(snap.data?.data) ? snap.data!.data : []).map((p: any) => ({ ...p, areaSqM: Number(p.areaSqm) || 0 }));
    const byPark = availableByPark(plots as any); const byKey = new Map(plots.map((p: any) => [p.key, p]));
    const picked: { l: any; r: { rule: string; why: string; rank: number } }[] = [];
    const counts: Record<string, number> = {};
    for (const r0 of [...(open.data || []), ...(recent.data || [])]) skip.add((r0 as any).lead_id);
    for (const l of leads) {
      if (skip.has(l.id)) continue;
      if ((l.email && blocked.has(String(l.email).toLowerCase())) || (l.phoneNumber && blocked.has(digits(l.phoneNumber)))) continue;
      const r = pickRule(l, cfg, today, now);
      if (!r) continue;
      counts[r.rule] = (counts[r.rule] || 0) + 1;
      picked.push({ l, r });
    }
    picked.sort((a, b) => b.r.rank - a.r.rank);
    const take = picked.slice(0, Math.max(1, Math.min(200, cfg.maxPerRun)));
    const rows = take.map(({ l, r }) => {
      const ctx = { rep: cfg.nameEn, repAr: cfg.nameAr, fit: plotFit(l, byPark as any), byKey: byKey as any, owner: str(l.assignedSalespersonName, 60) };
      const d = writeFor(l, ctx)[0];
      const lang = preferredLang(l);
      const mail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(l.email || "").trim()) ? String(l.email).trim().toLowerCase() : "";
      // e-mail is Lara's live channel from phase 3; WhatsApp drafts are for the salesperson to send by hand until phase 6
      const channel = (cfg.mode === "approve" && mail) || !l.phoneNumber ? "email" : "whatsapp";
      return {
        lead_id: l.id, run_id: runId, rule: r.rule, situation: situationOf(l, ctx), channel, lang,
        subject: lang === "ar" ? d.subjectAr : d.subjectEn, body: lang === "ar" ? d.ar : d.en, reason: r.why,
        customer: str(l.customerName || l.companyName || l.id, 120), owner_id: l.assigned_to, owner_name: str(l.assignedSalespersonName, 80),
        kind: "followup", to_addr: mail || null,
      };
    });
    if (rows.length) { const ins = await admin.from("lara_drafts").insert(rows); if (ins.error) throw new HttpError(500, "Could not save the drafts"); }
    const res = { runId, scanned: leads.length, eligible: picked.length, drafted: rows.length, byRule: counts, alreadyOpen: open.data?.length || 0 };
    await log("run", by, `Shadow run: ${rows.length} drafts written (${picked.length} leads needed a follow-up, ${leads.length} checked). Nothing sent.`, res);
    return res;
  } finally { await unlock("lara-run"); }
}

// ---------------------------------------------------------------------------------------------
// Q&A
// ---------------------------------------------------------------------------------------------
async function activeKb(): Promise<KbEntry[]> {
  const { data } = await admin.from("lara_kb").select("id,topic,q_ar,q_en,phrasings,a_ar,a_en,status,uses").eq("status", "active").limit(3000);
  return (data || []) as KbEntry[];
}
/** "is there land in October around 3,000 m?" answered from the Land Bank list (no Q&A needed) */
async function availabilityAnswer(question: string): Promise<{ ar: string; en: string } | null> {
  const a = analyse(question);
  const parks = canonicalParks(question);
  if (!parks.length || !(a.concepts.has("availability") || a.concepts.has("size") || /ارض|اراضي|قطع|مصنع|مخزن|land|plot/i.test(normText(question)))) return null;
  const nums = (question.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).match(/\d[\d,]{2,}/g) || []).map((x) => Number(x.replace(/,/g, ""))).filter((x) => x >= 100);
  const { data } = await admin.from("plots_snapshot").select("data,updated_at").eq("id", 1).maybeSingle();
  const all: any[] = Array.isArray(data?.data) ? data!.data : [];
  const avail = all.filter((p) => p.status === "available" && parks.includes(p.park) && Number(p.areaSqm) > 0);
  const fit = nums.length ? avail.filter((p) => p.areaSqm >= nums[0] * 0.7 && p.areaSqm <= (nums[1] || nums[0]) * 1.3) : avail;
  const park = parks[0]; const parkAr = PARK_AR[park] || park; const f = (n: number) => Math.round(n).toLocaleString("en-US");
  if (!avail.length) return { ar: `حالياً لا توجد قطع متاحة في ${parkAr} حسب آخر تحديث لبنك الأراضي.`, en: `There are no available plots in ${park} in the latest Land Bank list.` };
  const list = fit.length ? fit : avail;
  const areas = list.map((p) => p.areaSqm).sort((x, y) => x - y);
  const span = areas.length === 1 ? `${f(areas[0])}` : `${f(areas[0])} – ${f(areas[areas.length - 1])}`;
  if (nums.length && !fit.length) return { ar: `مفيش قطعة متاحة بالمساحة دي بالظبط في ${parkAr}، لكن متاح ${plotsAr(avail.length)} بمساحات ${span} م².`, en: `No available plot of that size in ${park}, but ${avail.length} plots are available (${span} sqm).` };
  return { ar: `متاح حالياً ${plotsAr(list.length)} في ${parkAr}${nums.length ? ' قريبة من المساحة المطلوبة' : ''} بمساحات ${span} م².`, en: `${list.length} plots are available now in ${park}${nums.length ? ' close to the size asked' : ''} (${span} sqm).` };
}

export async function laraAnswer(question: string, opts: { record: boolean; source: "test" | "customer"; leadId?: string; by?: string }) {
  const q = str(question, 600);
  if (q.length < 3) throw bad("Write a question");
  const data = await availabilityAnswer(q);
  const matches = matchQuestion(q, await activeKb(), 3);
  const best = matches[0];
  const answered = !!data || (!!best && best.score >= THRESHOLD);
  if (!data && best && best.score >= THRESHOLD) await admin.from("lara_kb").update({ uses: (Number((best.entry as any).uses) || 0) + 1 }).eq("id", best.entry.id).then(() => {}, () => {});
  let missedId: string | null = null;
  if (!answered && opts.record) {
    // the same question asked again adds to its count instead of a new row
    const { data: same } = await admin.from("lara_missed").select("id,asked").eq("status", "open").eq("question", q).maybeSingle();
    if (same) { await admin.from("lara_missed").update({ asked: (same.asked || 1) + 1, updated_at: nowIso() }).eq("id", same.id); missedId = same.id; }
    else { const ins = await admin.from("lara_missed").insert({ question: q, lang: isArabic(q) ? "ar" : "en", source: opts.source, lead_id: opts.leadId || null }).select("id").single(); missedId = ins.data?.id || null; }
    await log("missed", opts.by || null, `No approved answer: "${q.slice(0, 120)}"`);
  }
  return {
    success: true, answered, threshold: THRESHOLD,
    data,
    matches: matches.map((m) => ({ id: m.entry.id, topic: m.entry.topic, q: m.entry.q_ar || m.entry.q_en, a_ar: m.entry.a_ar, a_en: m.entry.a_en, score: m.score, concepts: m.concepts })),
    missedId,
  };
}

// ---------------------------------------------------------------------------------------------
// routes (admin only)
// ---------------------------------------------------------------------------------------------
const who = (c: Caller) => c.name || c.email || "admin";

route("GET", "/lara/overview", async ({ c }) => {
  needAdmin(c);
  const cfg = await laraConfig();
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [drafts, kb, missed, lastRun] = await Promise.all([
    admin.from("lara_drafts").select("status,situation,rule,edited").gte("created_at", since).limit(20000),
    admin.from("lara_kb").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("lara_missed").select("id", { count: "exact", head: true }).eq("status", "open"),
    admin.from("lara_log").select("at,actor,text,data").eq("kind", "run").order("at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const t = { shadow: 0, approved: 0, rejected: 0, expired: 0, edited: 0 } as Record<string, number>;
  const bySituation: Record<string, number> = {}; const byRule: Record<string, number> = {};
  for (const d of drafts.data || []) {
    t[d.status] = (t[d.status] || 0) + 1; if (d.edited) t.edited++;
    if (d.status === "shadow") { bySituation[d.situation] = (bySituation[d.situation] || 0) + 1; byRule[d.rule] = (byRule[d.rule] || 0) + 1; }
  }
  const [mb, th, um, q] = await Promise.all([
    laraMailCfg(),
    admin.from("lara_threads").select("status").limit(20000),
    admin.from("lara_messages").select("id", { count: "exact", head: true }).eq("kind", "unmatched"),
    admin.from("lara_drafts").select("send_status,sent_at").in("send_status", ["queued", "failed", "sent"]).gte("updated_at", since).limit(20000),
  ]);
  const threads: Record<string, number> = {}; for (const r of th.data || []) threads[r.status] = (threads[r.status] || 0) + 1;
  const send = { queued: 0, failed: 0, sent: 0, sentToday: 0 };
  for (const r of q.data || []) { (send as any)[r.send_status]++; if (r.send_status === "sent" && r.sent_at && Date.now() - Date.parse(r.sent_at) < 864e5) send.sentToday++; }
  return { success: true, mailbox: { address: mb.address, user: mb.user, host: mb.host, shared: !!mb.shared, status: mb.status || null }, threads, unmatched: um.count || 0, send, config: cfg, drafts30: t, openBySituation: bySituation, openByRule: byRule, ruleLabels: RULE_LABEL, kbActive: kb.count || 0, missedOpen: missed.count || 0, lastRun: lastRun.data || null, channels: { email: !!mb.status?.ok, whatsapp: false }, ai: false };
});

route("PUT", "/lara/config", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 4000);
  const cur = await laraConfig();
  const num = (v: any, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
  const next: LaraConfig = {
    mode: b.mode === "off" ? "off" : b.mode === "approve" ? "approve" : "shadow",
    firstContactHours: num(b.firstContactHours, 1, 240, cur.firstContactHours),
    overdueDays: num(b.overdueDays, 1, 60, cur.overdueDays),
    offerSilentDays: num(b.offerSilentDays, 1, 60, cur.offerSilentDays),
    noAnswerDays: num(b.noAnswerDays, 1, 30, cur.noAnswerDays),
    maxPerRun: num(b.maxPerRun, 5, 200, cur.maxPerRun),
    nameEn: str(b.nameEn, 60) || cur.nameEn, nameAr: str(b.nameAr, 60) || cur.nameAr,
    sendEnabled: b.sendEnabled === true,
    maxSendPerDay: num(b.maxSendPerDay, 1, 200, cur.maxSendPerDay), minDaysBetween: num(b.minDaysBetween, 1, 30, cur.minDaysBetween),
    maxUnanswered: num(b.maxUnanswered, 1, 10, cur.maxUnanswered), sendStart: num(b.sendStart, 6, 20, cur.sendStart), sendEnd: num(b.sendEnd, 8, 23, cur.sendEnd),
  };
  if (next.sendEnd <= next.sendStart) throw bad("Sending hours: the end must be after the start");
  await setConfig("lara_config", next);
  await log("config", who(c), `Settings saved (mode ${next.mode}, sending ${next.sendEnabled ? "ON" : "off"})`, next);
  return { success: true, config: next };
});

route("POST", "/lara/run", async ({ c }) => { needAdmin(c); return { success: true, ...(await runShadow(who(c))) }; });

route("GET", "/lara/drafts", async ({ c, query }) => {
  needAdmin(c);
  const status = ["shadow", "approved", "rejected", "expired"].includes(query.get("status") || "") ? query.get("status")! : "shadow";
  const limit = Math.min(200, Math.max(10, Number(query.get("limit")) || 100));
  const { data, error } = await admin.from("lara_drafts").select("*").eq("status", status).order(status === "shadow" ? "created_at" : "decided_at", { ascending: false }).limit(limit);
  if (error) throw new HttpError(500, "Could not read the drafts");
  return { success: true, rows: data || [] };
});

route("POST", "/lara/drafts/:id/decide", async ({ req, c, params }) => {
  needAdmin(c);
  const b = await body(req, 8000);
  const decision = b.decision === "approved" ? "approved" : b.decision === "rejected" ? "rejected" : "";
  if (!decision) throw bad("decision?");
  const { data: d } = await admin.from("lara_drafts").select("*").eq("id", params.id).maybeSingle();
  if (!d) throw new HttpError(404, "Draft not found");
  if (d.status !== "shadow") throw new HttpError(409, "This draft was already decided");
  const newBody = typeof b.body === "string" ? str(b.body, 4000) : d.body;
  const upd = { status: decision, feedback: str(b.feedback, 200) || null, body: newBody, subject: typeof b.subject === "string" ? str(b.subject, 200) : d.subject, edited: newBody !== d.body, decided_by: who(c), decided_at: nowIso(), updated_at: nowIso() };
  const willSend = decision === "approved" && d.channel === "email" && (await laraConfig()).mode === "approve";
  await admin.from("lara_drafts").update({ ...upd, send_status: willSend ? "queued" : "none" }).eq("id", d.id);
  await log("decision", who(c), `${decision === "approved" ? "Approved" : "Rejected"} draft for ${d.customer} (${d.situation})${upd.feedback ? `: ${upd.feedback}` : ""}${upd.edited ? " — edited" : ""}`);
  if (willSend) { const r = await sendDraft(d.id, rules(await laraConfig()), who(c)); return { success: true, sent: r.sent, sendNote: r.sent ? "E-mail sent" : r.reason }; }
  return { success: true, sent: false };
});
route("POST", "/lara/drafts/:id/send", async ({ c, params }) => {
  needAdmin(c);
  await admin.from("lara_drafts").update({ send_status: "queued", send_error: null }).eq("id", params.id).eq("status", "approved").neq("send_status", "sent");
  const r = await sendDraft(params.id, rules(await laraConfig()), who(c));
  return { success: true, sent: r.sent, sendNote: r.sent ? "E-mail sent" : r.reason };
});

route("GET", "/lara/kb", async ({ c, query }) => {
  needAdmin(c);
  const st = query.get("status") === "archived" ? "archived" : "active";
  const { data } = await admin.from("lara_kb").select("*").eq("status", st).order("topic").order("updated_at", { ascending: false }).limit(3000);
  return { success: true, rows: data || [] };
});
route("POST", "/lara/kb", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 20000);
  const row = { topic: str(b.topic, 60) || "General", q_ar: str(b.q_ar, 400), q_en: str(b.q_en, 400), phrasings: str(b.phrasings, 3000), a_ar: str(b.a_ar, 3000), a_en: str(b.a_en, 3000), updated_by: who(c), updated_at: nowIso() };
  if (!row.q_ar && !row.q_en) throw bad("Write the question (Arabic or English)");
  if (!row.a_ar && !row.a_en) throw bad("Write the answer (Arabic or English)");
  if (b.id) {
    const u = await admin.from("lara_kb").update(row).eq("id", str(b.id, 40)).select("*").single();
    if (u.error) throw new HttpError(500, "Could not save");
    await log("kb", who(c), `Q&A edited: ${row.q_ar || row.q_en}`);
    return { success: true, row: u.data };
  }
  const i = await admin.from("lara_kb").insert({ ...row, created_by: who(c) }).select("*").single();
  if (i.error) throw new HttpError(500, "Could not save");
  await log("kb", who(c), `Q&A added: ${row.q_ar || row.q_en}`);
  return { success: true, row: i.data };
});
route("POST", "/lara/kb/:id/status", async ({ req, c, params }) => {
  needAdmin(c);
  const b = await body(req, 500);
  const status = b.status === "archived" ? "archived" : "active";
  await admin.from("lara_kb").update({ status, updated_by: who(c), updated_at: nowIso() }).eq("id", params.id);
  await log("kb", who(c), `Q&A ${status === "archived" ? "archived" : "restored"}`);
  return { success: true };
});

route("POST", "/lara/ask", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 3000);
  return await laraAnswer(String(b.question || ""), { record: b.record === true, source: "test", by: who(c) });
});

route("GET", "/lara/missed", async ({ c, query }) => {
  needAdmin(c);
  const st = ["open", "answered", "dismissed"].includes(query.get("status") || "") ? query.get("status")! : "open";
  const { data } = await admin.from("lara_missed").select("*").eq("status", st).order("asked", { ascending: false }).order("created_at", { ascending: true }).limit(500);
  return { success: true, rows: data || [] };
});
route("POST", "/lara/missed/:id/answer", async ({ req, c, params }) => {
  needAdmin(c);
  const b = await body(req, 20000);
  const { data: m } = await admin.from("lara_missed").select("*").eq("id", params.id).maybeSingle();
  if (!m) throw new HttpError(404, "Question not found");
  const a_ar = str(b.a_ar, 3000), a_en = str(b.a_en, 3000);
  if (!a_ar && !a_en) throw bad("Write the answer (Arabic or English)");
  const ar = isArabic(m.question);
  const kb = await admin.from("lara_kb").insert({
    topic: str(b.topic, 60) || "General", q_ar: ar ? m.question : str(b.q_ar, 400), q_en: ar ? str(b.q_en, 400) : m.question,
    phrasings: str(b.phrasings, 3000), a_ar, a_en, created_by: who(c), updated_by: who(c),
  }).select("id").single();
  if (kb.error) throw new HttpError(500, "Could not save the answer");
  await admin.from("lara_missed").update({ status: "answered", kb_id: kb.data.id, decided_by: who(c), updated_at: nowIso() }).eq("id", m.id);
  await log("kb", who(c), `Missed question answered: ${m.question.slice(0, 120)}`);
  return { success: true, kbId: kb.data.id };
});
route("POST", "/lara/missed/:id/dismiss", async ({ c, params }) => {
  needAdmin(c);
  await admin.from("lara_missed").update({ status: "dismissed", decided_by: who(c), updated_at: nowIso() }).eq("id", params.id);
  return { success: true };
});

route("GET", "/lara/log", async ({ c, query }) => {
  needAdmin(c);
  const limit = Math.min(500, Math.max(20, Number(query.get("limit")) || 200));
  const { data } = await admin.from("lara_log").select("id,at,kind,actor,text").order("at", { ascending: false }).limit(limit);
  return { success: true, rows: data || [] };
});

// ---------------------------------------------------------------------------------------------
// phase 3: mailbox, conversations, replies
// ---------------------------------------------------------------------------------------------
const rules = (c: LaraConfig): SendRules => ({ sendEnabled: c.sendEnabled, mode: c.mode, maxSendPerDay: c.maxSendPerDay, minDaysBetween: c.minDaysBetween, maxUnanswered: c.maxUnanswered, sendStart: c.sendStart, sendEnd: c.sendEnd });

/** what Lara does with a customer's reply (no AI): the approved answer when there is one; otherwise a polite holding reply */
export const replyHooks = {
  answer: async (q: string, leadId: string) => {
    const r = await laraAnswer(q.slice(0, 600), { record: true, source: "customer", leadId, by: "Customer reply" });
    const best = r.matches[0];
    if (r.data) return { answered: true, source: "landbank" as const, text: r.data };
    if (r.answered && best) return { answered: true, source: "qa" as const, text: { ar: best.a_ar, en: best.a_en } };
    return { answered: false };
  },
  writeReply: async (leadId: string, ar: boolean, answerText: string | null) => {
    const cfg = await laraConfig();
    const { data } = await admin.from("crm_leads").select("data->customerName,data->assignedSalespersonName").eq("id", leadId).maybeSingle();
    const first = firstNameOf(String((data as any)?.customerName || ""));
    const owner = String((data as any)?.assignedSalespersonName || "").trim();
    if (ar) {
      const hi = first ? `أهلاً أ. ${first}،` : "أهلاً بحضرتك،";
      const mid = answerText
        ? `شكراً لرد حضرتك.\n\n${answerText}\n\nلو فيه أي سؤال تاني أنا موجودة${owner ? `، وزميلي ${owner} مسؤول المبيعات الخاص بحضرتك متاح كمان لأي تفاصيل` : ""}.`
        : `شكراً لرد حضرتك. سؤال حضرتك وصل${owner ? ` لزميلي ${owner}، مسؤول المبيعات الخاص بحضرتك،` : " لفريق المبيعات"} وهيرد عليك بالتفاصيل في أقرب وقت.`;
      return { subject: "", body: `${hi}\n\n${mid}\n\n${cfg.nameAr}\nالسويدي للتنمية الصناعية` };
    }
    const hi = first && !/[؀-ۿ]/.test(first) ? `Dear ${first},` : "Good day,";
    const mid = answerText
      ? `Thank you for your reply.\n\n${answerText}\n\nIf you have any other question I am here${owner ? `, and your account manager, ${owner}, is also available for any details` : ""}.`
      : `Thank you for your reply. Your question has been passed to ${owner ? `your account manager, ${owner},` : "our sales team,"} who will get back to you with the details shortly.`;
    return { subject: "", body: `${hi}\n\n${mid}\n\nBest regards,\n${cfg.nameEn}\nElsewedy Industrial Development` };
  },
};

/** cron (every 10 minutes, 07:00–22:00): read Lara's mailbox and send the approved mails that wait for working hours */
export async function laraMailTick() {
  const cfg = await laraConfig();
  if (cfg.mode !== "approve") return { laraMail: "not in approve-first mode" };
  const read = await pollLaraInbox(replyHooks).catch((e: any) => ({ pollError: String(e?.message || e).slice(0, 120) }));
  const sent = await sendQueued(rules(cfg)).catch((e: any) => ({ sendError: String(e?.message || e).slice(0, 120) }));
  return { ...read, ...sent };
}

route("POST", "/lara/mailbox", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 2000);
  return { success: true, mailbox: await saveMailbox(b, who(c)) };
});
route("POST", "/lara/mailbox/check", async ({ c }) => { needAdmin(c); return { success: true, ...(await laraMailTick()) }; });

route("GET", "/lara/threads", async ({ c, query }) => {
  needAdmin(c);
  const st = ["open", "handover", "stopped", "closed"].includes(query.get("status") || "") ? query.get("status")! : "";
  let q: any = admin.from("lara_threads").select("*").order("updated_at", { ascending: false }).limit(300);
  if (st) q = q.eq("status", st);
  const { data } = await q;
  const ids = (data || []).map((t: any) => t.lead_id);
  const names = ids.length ? (await admin.from("crm_leads").select("id,data->customerName,data->assignedSalespersonName").in("id", ids)).data || [] : [];
  const nm = new Map(names.map((r: any) => [r.id, r]));
  return { success: true, rows: (data || []).map((t: any) => ({ ...t, customer: (nm.get(t.lead_id) as any)?.customerName || t.lead_id, owner: (nm.get(t.lead_id) as any)?.assignedSalespersonName || "" })) };
});
route("GET", "/lara/threads/:id", async ({ c, params }) => {
  needAdmin(c);
  const { data: t } = await admin.from("lara_threads").select("*").eq("id", params.id).maybeSingle();
  if (!t) throw new HttpError(404, "Conversation not found");
  const [msgs, drafts] = await Promise.all([
    admin.from("lara_messages").select("id,direction,kind,matched_by,subject,body,from_addr,to_addr,at").eq("thread_id", t.id).order("at").limit(200),
    admin.from("lara_drafts").select("id,kind,status,send_status,send_error,body,created_at").eq("lead_id", t.lead_id).in("status", ["shadow", "approved"]).neq("send_status", "sent").order("created_at", { ascending: false }).limit(10),
  ]);
  return { success: true, thread: t, messages: msgs.data || [], pending: drafts.data || [] };
});
route("POST", "/lara/threads/:id/status", async ({ req, c, params }) => {
  needAdmin(c);
  const b = await body(req, 500);
  const status = ["open", "handover", "stopped", "closed"].includes(b.status) ? b.status : "";
  if (!status) throw bad("status?");
  await admin.from("lara_threads").update({ status, note: str(b.note, 200) || null, updated_at: nowIso() }).eq("id", params.id);
  await log("mail", who(c), `Conversation set to ${status}`);
  return { success: true };
});
route("GET", "/lara/unmatched", async ({ c }) => {
  needAdmin(c);
  const { data } = await admin.from("lara_messages").select("id,subject,body,from_addr,at").eq("kind", "unmatched").order("at", { ascending: false }).limit(200);
  return { success: true, rows: data || [] };
});
route("POST", "/lara/unmatched/:id", async ({ req, c, params }) => {
  needAdmin(c);
  const b = await body(req, 1000);
  const { data: m } = await admin.from("lara_messages").select("*").eq("id", params.id).eq("kind", "unmatched").maybeSingle();
  if (!m) throw new HttpError(404, "Mail not found");
  if (b.action === "ignore") { await admin.from("lara_messages").update({ kind: "ignored" }).eq("id", m.id); return { success: true }; }
  const leadId = str(b.leadId, 40).toUpperCase();
  const { data: lead } = await admin.from("crm_leads").select("id").eq("id", leadId).is("deleted_at", null).maybeSingle();
  if (!lead) throw bad("No lead with that number");
  // link: open (or reuse) the lead's conversation and treat the mail as the customer's reply
  const { data: t0 } = await admin.from("lara_threads").select("*").eq("lead_id", leadId).maybeSingle();
  const t = t0 || (await admin.from("lara_threads").insert({ lead_id: leadId, code: `SDM-${leadId}-${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`, customer_email: String(m.from_addr || "").toLowerCase() }).select("*").single()).data;
  await admin.from("lara_messages").update({ kind: "ignored" }).eq("id", m.id);
  await handleReply(t, { ews_id: null, direction: "in", subject: m.subject, body: m.body, from_addr: m.from_addr, to_addr: m.to_addr, at: m.at }, "linked", m.body, replyHooks);
  await log("mail", who(c), `Mail from ${m.from_addr} linked to ${leadId}`);
  return { success: true };
});
route("GET", "/lara/optout", async ({ c }) => {
  needAdmin(c);
  const { data } = await admin.from("lara_optout").select("*").order("at", { ascending: false }).limit(500);
  return { success: true, rows: data || [] };
});
