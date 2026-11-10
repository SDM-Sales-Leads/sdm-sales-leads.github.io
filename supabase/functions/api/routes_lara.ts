// deno-lint-ignore-file no-explicit-any
// Lara Sales AI — phase 2 (docs/LARA-SALES-AI-PLAN.md): SHADOW mode, admin only, NO AI.
// - Shadow run (daily 09:00 Cairo Sun–Thu from /cron/reminders, or "Run now"): picks the leads the team did not follow up
//   (rules below), writes the message Lara WOULD send with the same smart writer the team uses, and stores it as a draft.
//   Nothing is sent and no lead is changed.
// - Q&A: approved answers, matched by words and concepts (lara_match.ts). Unmatched questions go to "Missed questions".
// - Availability questions ("is there land in October around 3,000 m?") are answered from the Land Bank plot list.
import { admin, bad, body, Caller, getConfig, HttpError, needAdmin, nowIso, rateLimit, setConfig, str, tryLock, unlock } from "./lib.ts";
import { route } from "./router.ts";
import { pg } from "./db.ts";
import { analyse, isArabic, KbEntry, matchQuestion, normText, THRESHOLD } from "./lara_match.ts";
import { canonicalParks } from "../../../src/lib/parkAliases.ts";
import { PARK_AR, plotsAr, preferredLang, situationOf, writeFor } from "../../../src/components/crm/smartWriter.ts";
import { availableByPark, plotFit } from "../../../src/components/crm/smartEngine.ts";
import { firstNameOf } from "../../../src/lib/personName.ts";
import { triggerHit, condsOk, stopReason, validateWorkflow, hasEmail, hasPhone, TRIGGERS, Workflow, Step } from "./lara_flow.ts";
import { addNotifications } from "./notify.ts";
import { buildOffer, coverText, offerCandidates, offerPdf } from "./lara_offer.ts";
import { sendOfferTestCopy } from "./lara_mail.ts";
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

/** the open leads Lara may act on, with only the fields she uses (a few hundred bytes each, never the whole lead) */
async function candidateLeads(includeOld: boolean): Promise<any[]> {
  const rows: any[] = await pg(async (q) => await q`
    select id, assigned_to,
      data->>'status' as status, data->>'customerName' as "customerName", data->>'companyName' as "companyName", data->>'project' as project,
      data->>'requiredSize' as "requiredSize", data->>'industry' as industry, data->>'phoneNumber' as "phoneNumber", data->>'email' as email,
      data->>'assignedSalespersonId' as "assignedSalespersonId", data->>'assignedSalespersonName' as "assignedSalespersonName",
      data->>'nextFollowUpDate' as "nextFollowUpDate", data->>'lastContactDate' as "lastContactDate", data->>'firstContactAt' as "firstContactAt",
      data->>'offerSent' as "offerSent", data->>'offerDate' as "offerDate", data->>'meetingDate' as "meetingDate", data->>'meetingTime' as "meetingTime",
      data->>'date' as date, data->>'assignedDate' as "assignedDate", data->>'priority' as priority, data->>'channel' as channel, data->>'source' as source,
      data->>'dealValue' as "dealValue", data->>'nationality' as nationality, data->>'oldLead' as "oldLead", data->'assignedPlots' as "assignedPlots",
      (select coalesce(jsonb_agg(x.e order by x.i), '[]'::jsonb) from (
         select jsonb_build_object('type', e->>'type', 'user', e->>'user', 'title', left(e->>'title', 80), 'description', left(e->>'description', 120), 'timestamp', e->>'timestamp') as e, i
         from jsonb_array_elements(case when jsonb_typeof(data->'timeline') = 'array' then data->'timeline' else '[]'::jsonb end) with ordinality t(e, i)
         order by i desc limit 8) x) as timeline
    from crm_leads
    where deleted_at is null and status <> all(${CLOSED})
      and coalesce(data->>'mergedInto', '') = '' and assigned_to is not null
      and (${includeOld} or coalesce(data->>'oldLead', '') <> 'true')
    limit 12000`,
    async () => { throw new HttpError(503, "The database link is busy, try again in a minute."); });
  return rows.map((r) => ({ ...r, offerSent: r.offerSent === "true", timeline: Array.isArray(r.timeline) ? r.timeline : [], assignedPlots: Array.isArray(r.assignedPlots) ? r.assignedPlots : [] }));
}

async function loadWorkflows(onlyEnabled: boolean): Promise<Workflow[]> {
  let q: any = admin.from("lara_workflows").select("*").eq("status", "active").order("priority").order("created_at");
  if (onlyEnabled) q = q.eq("enabled", true);
  const { data } = await q;
  return (data || []) as Workflow[];
}

/** everything a run needs, read once */
async function runContext(includeOld: boolean) {
  const now = Date.now();
  const [leads, openDrafts, rejected, snap, threads, optout] = await Promise.all([
    candidateLeads(includeOld),
    admin.from("lara_drafts").select("lead_id").eq("status", "shadow").eq("kind", "followup").limit(5000),
    admin.from("lara_drafts").select("lead_id").eq("status", "rejected").eq("feedback", "Do not contact").gte("decided_at", new Date(now - 60 * 864e5).toISOString()).limit(5000),
    admin.from("plots_snapshot").select("data").eq("id", 1).maybeSingle(),
    admin.from("lara_threads").select("lead_id,status,unanswered,last_out_at,last_in_at").limit(20000),
    admin.from("lara_optout").select("contact").limit(20000),
  ]);
  const plots = (Array.isArray(snap.data?.data) ? snap.data!.data : []).map((p: any) => ({ ...p, areaSqM: Number(p.areaSqm) || 0 }));
  const blocked = new Set((optout.data || []).map((r: any) => String(r.contact).toLowerCase()));
  const digits = (p: string) => String(p || "").replace(/\D/g, "");
  return {
    now, today: cairoDay(), leads, byId: new Map(leads.map((l) => [l.id, l])),
    pending: new Set((openDrafts.data || []).map((r: any) => r.lead_id)),
    dnc: new Set((rejected.data || []).map((r: any) => r.lead_id)),
    threads: new Map<string, any>((threads.data || []).map((t: any) => [t.lead_id, t])),
    optedOut: (l: any) => (l.email && blocked.has(String(l.email).toLowerCase())) || (l.phoneNumber && blocked.has(digits(l.phoneNumber))),
    byPark: availableByPark(plots as any), byKey: new Map(plots.map((p: any) => [p.key, p])),
    notes: { owner: {} as Record<string, { handover: NoteItem[]; remind: NoteItem[] }>, director: [] as NoteItem[] },
  };
}
interface NoteItem { leadId: string; text: string; owner: string }

/** one notification per salesperson (and one summary for the Sales Director) instead of one per lead */
async function flushNotes(x: { notes: { owner: Record<string, { handover: NoteItem[]; remind: NoteItem[] }>; director: NoteItem[] } }) {
  const list = (a: NoteItem[]) => a.slice(0, 15).map((i) => `• ${i.text}`).join("\n") + (a.length > 15 ? `\n… and ${a.length - 15} more (Leads page)` : "");
  const rows: { userId: string; type: string; leadId?: string; title: string; body: string }[] = [];
  for (const [userId, g] of Object.entries(x.notes.owner)) {
    if (g.handover.length) rows.push({ userId, type: "escalation", leadId: g.handover.length === 1 ? g.handover[0].leadId : undefined, title: g.handover.length === 1 ? `Lara hands a lead back to you: ${g.handover[0].text.split(" — ")[0]}` : `Lara hands ${g.handover.length} leads back to you`, body: list(g.handover) });
    if (g.remind.length) rows.push({ userId, type: "reminder", leadId: g.remind.length === 1 ? g.remind[0].leadId : undefined, title: g.remind.length === 1 ? `Lara: ${g.remind[0].text.split(" — ")[0]} needs you` : `Lara: ${g.remind.length} of your leads need you`, body: list(g.remind) });
  }
  if (x.notes.director.length) {
    const ids = await directors();
    const by: Record<string, number> = {}; for (const i of x.notes.director) by[i.owner] = (by[i.owner] || 0) + 1;
    const head = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o}: ${n}`).join(" · ");
    for (const userId of ids) rows.push({ userId, type: "escalation", title: `Lara: ${x.notes.director.length} leads need the Sales Director`, body: `${head}\n${list(x.notes.director)}` });
  }
  if (rows.length) await addNotifications(rows).catch(() => {});
  return rows.length;
}
type Ctx = Awaited<ReturnType<typeof runContext>>;

/** the message draft for one step (null when the lead cannot get one now) */
function draftFor(cfg: LaraConfig, x: Ctx, wf: Workflow, step: Step, i: number, l: any, why: string, runId: string) {
  const ctx = { rep: cfg.nameEn, repAr: cfg.nameAr, fit: plotFit(l, x.byPark as any), byKey: x.byKey as any, owner: str(l.assignedSalespersonName, 60) };
  const sit = step.situation && step.situation !== "auto" ? step.situation : situationOf(l, ctx);
  const d = writeFor(l, ctx, sit as any)[0];
  const lang = preferredLang(l);
  const mail = hasEmail(l) ? String(l.email).trim().toLowerCase() : "";
  let channel: "email" | "whatsapp";
  if (step.channel === "email") { if (!mail) return null; channel = "email"; }
  else if (step.channel === "whatsapp") { if (!hasPhone(l)) return null; channel = "whatsapp"; }
  else channel = (cfg.mode === "approve" && mail) || !hasPhone(l) ? "email" : "whatsapp";   // e-mail is live from phase 3; WhatsApp is sent by hand until phase 6
  if (channel === "email" && !mail) return null;
  return {
    lead_id: l.id, run_id: runId, rule: `wf:${wf.id}`, situation: sit, channel, lang,
    subject: lang === "ar" ? d.subjectAr : d.subjectEn, body: lang === "ar" ? d.ar : d.en,
    reason: `${wf.name} · step ${i + 1} of ${wf.steps.length}: ${why}`,
    customer: str(l.customerName || l.companyName || l.id, 120), owner_id: l.assigned_to, owner_name: str(l.assignedSalespersonName, 80),
    kind: "followup", to_addr: mail || null,
  };
}

async function directors(): Promise<string[]> {
  const { data } = await admin.from("app_users").select("id").in("role", ["Sales Director"]).neq("active", false).limit(20);
  return (data || []).map((r: any) => r.id);
}

/** run one step; returns what happened ('' = skipped, try again next run) */
async function doStep(cfg: LaraConfig, x: Ctx, wf: Workflow, i: number, l: any, why: string, runId: string, budget: { left: number }): Promise<string> {
  const step = wf.steps[i];
  if (step.action === "offer") {
    if (budget.left <= 0) return "";
    if (!hasEmail(l)) return "skipped (no e-mail for an offer)";
    const r = await createOfferDraft(cfg, l.id, null, 14, `${wf.name} · step ${i + 1} of ${wf.steps.length}: ${why}`, `wf:${wf.id}`, runId).catch(() => null);
    if (!r) return "skipped (no available plot fits)";
    budget.left--;
    return "draft";
  }
  if (step.action === "message") {
    if (x.pending.has(l.id)) return "";                                           // a draft for this lead is still waiting
    if (budget.left <= 0) return "";
    const t = x.threads.get(l.id);
    if (t && t.last_out_at && x.now - Date.parse(t.last_out_at) < cfg.minDaysBetween * 864e5) return "";
    const row = draftFor(cfg, x, wf, step, i, l, why, runId);
    if (!row) return "skipped (no e-mail / phone for this channel)";
    const ins = await admin.from("lara_drafts").insert(row);
    if (ins.error) return "";
    x.pending.add(l.id); budget.left--;
    return "draft";
  }
  // notifications are collected and sent GROUPED after the run (one per salesperson, one summary for the Sales Director)
  const item = { leadId: l.id, text: `${l.customerName || l.id} — ${wf.name}: ${why}`, owner: l.assignedSalespersonName || "no owner" };
  if (step.action === "notify_director") { x.notes.director.push(item); return "notified director"; }
  if (l.assigned_to) { const k = l.assigned_to; (x.notes.owner[k] ||= { handover: [], remind: [] })[step.action === "handover" ? "handover" : "remind"].push(item); }
  if (step.action === "handover") {
    const t = x.threads.get(l.id);
    if (t) await admin.from("lara_threads").update({ status: "handover", note: `${wf.name}: handed back`, updated_at: nowIso() }).eq("lead_id", l.id);
    return "handed over";
  }
  return "notified owner";
}

/** the daily run: move due enrollments one step (or stop them), then enroll new leads by workflow priority */
export async function runShadow(by: string): Promise<any> {
  const cfg = await laraConfig();
  if (cfg.mode === "off") return { skipped: true, reason: "Lara is off" };
  if (!(await tryLock("lara-run", 300))) return { skipped: true, reason: "another run is busy" };
  const runId = `R${Date.now().toString(36)}`;
  try {
    const wfs = await loadWorkflows(true);
    if (!wfs.length) return { skipped: true, reason: "no workflow is switched on" };
    const now = Date.now();
    await admin.from("lara_drafts").update({ status: "expired", updated_at: nowIso() }).eq("status", "shadow").lt("created_at", new Date(now - 7 * 864e5).toISOString());
    const x = await runContext(wfs.some((w) => w.trigger.type === "old_lead"));
    const budget = { left: Math.max(1, Math.min(200, cfg.maxPerRun)) };
    const wfById = new Map(wfs.map((w) => [w.id, w]));
    const res = { runId, scanned: x.leads.length, moved: 0, stopped: 0, finished: 0, enrolled: 0, drafted: 0, notified: 0, byWorkflow: {} as Record<string, number> };
    const count = (wf: Workflow) => { res.byWorkflow[wf.name] = (res.byWorkflow[wf.name] || 0) + 1; };

    // 1. running enrollments
    const { data: active } = await admin.from("lara_enrollments").select("*").eq("status", "active").limit(20000);
    const enrolled = new Set<string>();
    for (const e of active || []) {
      enrolled.add(e.lead_id);
      const wf = wfById.get(e.workflow_id);
      const l = x.byId.get(e.lead_id);
      const t = x.threads.get(e.lead_id);
      const stop = !wf ? "Workflow switched off" : x.dnc.has(e.lead_id) ? "Rejected: do not contact" : stopReason(wf, l, Date.parse(e.started_at), x.today, Date.parse(t?.last_in_at || "") || 0, t?.status || "", !!(l && x.optedOut(l)));
      if (stop) { await admin.from("lara_enrollments").update({ status: "stopped", stop_reason: stop, updated_at: nowIso() }).eq("id", e.id); res.stopped++; continue; }
      if (Date.parse(e.next_at) > now || !wf) continue;
      if (e.step >= wf.steps.length) { await admin.from("lara_enrollments").update({ status: "done", updated_at: nowIso() }).eq("id", e.id); res.finished++; continue; }
      const did = await doStep(cfg, x, wf, e.step, l, e.why, runId, budget);
      if (!did) continue;
      if (did === "draft") res.drafted++; else if (did.startsWith("notified") || did === "handed over") res.notified++;
      const next = e.step + 1;
      const done = next >= wf.steps.length;
      await admin.from("lara_enrollments").update({ step: next, status: done ? "done" : "active", next_at: new Date(now + (done ? 0 : Number(wf.steps[next].waitDays) || 0) * 864e5).toISOString(), updated_at: nowIso() }).eq("id", e.id);
      res.moved++; if (done) res.finished++; count(wf);
    }

    // 2. new enrollments (not again into the same workflow within 30 days)
    const { data: recentDone } = await admin.from("lara_enrollments").select("workflow_id,lead_id").neq("status", "active").gte("started_at", new Date(now - 30 * 864e5).toISOString()).limit(20000);
    const recently = new Set((recentDone || []).map((r: any) => `${r.workflow_id}|${r.lead_id}`));
    const cands: { wf: Workflow; l: any; why: string; rank: number }[] = [];
    for (const l of x.leads) {
      if (enrolled.has(l.id) || x.dnc.has(l.id) || x.optedOut(l)) continue;
      if (!hasEmail(l) && !hasPhone(l)) continue;
      const t = x.threads.get(l.id);
      if (t && (t.status !== "open" || t.unanswered >= cfg.maxUnanswered)) continue;
      if (d10(l.meetingDate) && d10(l.meetingDate) >= x.today) continue;
      for (const wf of wfs) {
        if (recently.has(`${wf.id}|${l.id}`)) continue;
        const hit = triggerHit(wf, l, x.today, now);
        if (!hit || !condsOk(wf, l, now)) continue;
        cands.push({ wf, l, why: hit.why, rank: hit.rank - wf.priority });
        break;                                                                     // the first matching workflow by priority
      }
    }
    cands.sort((a, b) => b.rank - a.rank);
    for (const c of cands) {
      const first = c.wf.steps[0];
      const needsBudget = first.action === "message" && Number(first.waitDays) === 0;
      if (needsBudget && budget.left <= 0) continue;   // drafts for today are used up; notification-only workflows still start
      const ins = await admin.from("lara_enrollments").insert({ workflow_id: c.wf.id, lead_id: c.l.id, why: c.why, next_at: new Date(now + (Number(first.waitDays) || 0) * 864e5).toISOString() }).select("*").single();
      if (ins.error || !ins.data) continue;
      res.enrolled++; count(c.wf);
      if (Number(first.waitDays) > 0) continue;
      const did = await doStep(cfg, x, c.wf, 0, c.l, c.why, runId, budget);
      if (!did) continue;
      if (did === "draft") res.drafted++; else res.notified++;
      const done = c.wf.steps.length <= 1;
      await admin.from("lara_enrollments").update({ step: 1, status: done ? "done" : "active", next_at: new Date(now + (done ? 0 : Number(c.wf.steps[1].waitDays) || 0) * 864e5).toISOString(), updated_at: nowIso() }).eq("id", ins.data.id);
    }
    const sentNotes = await flushNotes(x);
    await log("run", by, `Run: ${sentNotes} grouped notifications; ${res.enrolled} leads started a workflow, ${res.moved} moved a step, ${res.stopped} stopped; ${res.drafted} drafts, ${res.notified} notifications. Only approved e-mails are sent.`, res);
    return res;
  } finally { await unlock("lara-run"); }
}

/** test run: who a workflow would act on right now, with sample messages. Nothing is written. */
export async function testWorkflow(w: Workflow) {
  const cfg = await laraConfig();
  const x = await runContext(w.trigger.type === "old_lead");
  const { data: active } = await admin.from("lara_enrollments").select("lead_id").eq("status", "active").limit(20000);
  const busy = new Set((active || []).map((r: any) => r.lead_id));
  const hits: { l: any; why: string; rank: number; busy: boolean }[] = [];
  for (const l of x.leads) {
    if (x.dnc.has(l.id) || x.optedOut(l) || (!hasEmail(l) && !hasPhone(l))) continue;
    if (d10(l.meetingDate) && d10(l.meetingDate) >= x.today) continue;
    const hit = triggerHit(w, l, x.today, x.now);
    if (hit && condsOk(w, l, x.now)) hits.push({ l, why: hit.why, rank: hit.rank, busy: busy.has(l.id) });
  }
  hits.sort((a, b) => b.rank - a.rank);
  const firstMsg = w.steps.findIndex((s) => s.action === "message");
  const samples = firstMsg < 0 ? [] : hits.filter((h) => !h.busy).slice(0, 3).map((h) => { const d = draftFor(cfg, x, w, w.steps[firstMsg], firstMsg, h.l, h.why, "TEST"); return d ? { customer: d.customer, channel: d.channel, subject: d.subject, body: d.body } : null; }).filter(Boolean);
  const owners: Record<string, number> = {};
  for (const h of hits) owners[h.l.assignedSalespersonName || "—"] = (owners[h.l.assignedSalespersonName || "—"] || 0) + 1;
  return {
    matched: hits.length, alreadyInAWorkflow: hits.filter((h) => h.busy).length, perRunLimit: cfg.maxPerRun,
    leads: hits.slice(0, 40).map((h) => ({ id: h.l.id, customer: h.l.customerName || h.l.companyName || h.l.id, owner: h.l.assignedSalespersonName || "—", status: h.l.status, why: h.why, busy: h.busy, email: hasEmail(h.l), phone: hasPhone(h.l) })),
    byOwner: Object.entries(owners).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, n]) => ({ name, n })),
    samples,
  };
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
  const wfl = await loadWorkflows(false);
  const labels: Record<string, string> = { ...RULE_LABEL, customer_reply: "Customer replied", test: "Test" };
  for (const w of wfl) labels[`wf:${w.id}`] = w.name;
  const testLock = (await getConfig<any>("lara_test_lock", true)) !== false;
  return { success: true, testLock, ruleLabels: labels, workflows: wfl.map((w) => ({ id: w.id, name: w.name, enabled: w.enabled })), mailbox: { address: mb.address, user: mb.user, host: mb.host, shared: !!mb.shared, status: mb.status || null }, threads, unmatched: um.count || 0, send, config: cfg, drafts30: t, openBySituation: bySituation, openByRule: byRule, kbActive: kb.count || 0, missedOpen: missed.count || 0, lastRun: lastRun.data || null, channels: { email: !!mb.status?.ok, whatsapp: false }, ai: false };
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

// ---------------------------------------------------------------------------------------------
// phase 4: workflows
// ---------------------------------------------------------------------------------------------
const cleanWf = (b: any) => ({
  name: str(b.name, 80), description: str(b.description, 400), enabled: b.enabled === true, priority: Math.max(1, Math.min(999, Math.round(Number(b.priority) || 100))),
  trigger: { type: String(b.trigger?.type || ""), value: Math.max(0, Math.min(3650, Number(b.trigger?.value) || 0)), statuses: Array.isArray(b.trigger?.statuses) ? b.trigger.statuses.map((x: any) => str(x, 60)).slice(0, 20) : undefined },
  conditions: (Array.isArray(b.conditions) ? b.conditions : []).slice(0, 10).map((c: any) => ({ field: str(c.field, 30), op: str(c.op, 10) || "in", value: typeof c.value === "boolean" ? c.value : Array.isArray(c.value) ? c.value.map((v: any) => str(v, 80)).slice(0, 30) : str(c.value, 400) })),
  steps: (Array.isArray(b.steps) ? b.steps : []).slice(0, 8).map((s: any) => ({ waitDays: Math.max(0, Math.min(60, Math.round(Number(s.waitDays) || 0))), action: str(s.action, 20), channel: ["auto", "email", "whatsapp"].includes(s.channel) ? s.channel : "auto", situation: str(s.situation, 30) || "auto" })),
  stop: { onActivity: b.stop?.onActivity !== false, onReply: b.stop?.onReply !== false, onMeeting: b.stop?.onMeeting !== false },
});

route("GET", "/lara/workflows", async ({ c }) => {
  needAdmin(c);
  const [wfs, en] = await Promise.all([
    admin.from("lara_workflows").select("*").eq("status", "active").order("priority").order("created_at"),
    admin.from("lara_enrollments").select("workflow_id,status,stop_reason").gte("started_at", new Date(Date.now() - 30 * 864e5).toISOString()).limit(50000),
  ]);
  const stats: Record<string, any> = {};
  for (const e of en.data || []) {
    const s = stats[e.workflow_id] ||= { active: 0, done: 0, stopped: 0, reasons: {} as Record<string, number> };
    s[e.status]++;
    if (e.status === "stopped" && e.stop_reason) s.reasons[e.stop_reason] = (s.reasons[e.stop_reason] || 0) + 1;
  }
  return { success: true, rows: wfs.data || [], stats, triggers: TRIGGERS };
});
route("POST", "/lara/workflows", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 30000);
  const w = cleanWf(b);
  const err = validateWorkflow(w);
  if (err) throw bad(err);
  if (b.id) {
    const u = await admin.from("lara_workflows").update({ ...w, updated_by: who(c), updated_at: nowIso() }).eq("id", str(b.id, 40)).select("*").single();
    if (u.error) throw new HttpError(500, "Could not save the workflow");
    await log("workflow", who(c), `Workflow saved: ${w.name}${w.enabled ? " (on)" : " (off)"}`);
    return { success: true, row: u.data };
  }
  const i = await admin.from("lara_workflows").insert({ ...w, created_by: who(c), updated_by: who(c) }).select("*").single();
  if (i.error) throw new HttpError(500, "Could not save the workflow");
  await log("workflow", who(c), `Workflow created: ${w.name}`);
  return { success: true, row: i.data };
});
route("POST", "/lara/workflows/:id/toggle", async ({ req, c, params }) => {
  needAdmin(c);
  const b = await body(req, 500);
  const { data } = await admin.from("lara_workflows").update({ enabled: b.enabled === true, updated_by: who(c), updated_at: nowIso() }).eq("id", params.id).select("name").single();
  // switching a workflow off stops the leads running in it (the next run would stop them anyway)
  if (b.enabled !== true) await admin.from("lara_enrollments").update({ status: "stopped", stop_reason: "Workflow switched off", updated_at: nowIso() }).eq("workflow_id", params.id).eq("status", "active");
  await log("workflow", who(c), `Workflow ${b.enabled === true ? "switched on" : "switched off"}: ${data?.name || params.id}`);
  return { success: true };
});
route("POST", "/lara/workflows/:id/archive", async ({ c, params }) => {
  needAdmin(c);
  await admin.from("lara_workflows").update({ status: "archived", enabled: false, updated_by: who(c), updated_at: nowIso() }).eq("id", params.id);
  await admin.from("lara_enrollments").update({ status: "stopped", stop_reason: "Workflow archived", updated_at: nowIso() }).eq("workflow_id", params.id).eq("status", "active");
  await log("workflow", who(c), "Workflow archived");
  return { success: true };
});
route("POST", "/lara/workflows/test", async ({ req, c }) => {
  needAdmin(c);
  await rateLimit(`laratest:${c.id}`, 60, 6);
  const w = cleanWf(await body(req, 30000));
  const err = validateWorkflow({ ...w, name: w.name || "Test" });
  if (err) throw bad(err);
  return { success: true, ...(await testWorkflow({ ...w, id: "test", name: w.name || "Test" } as any)) };
});

// ---------------------------------------------------------------------------------------------
// phase 5: initial offers (PDF at list prices, approve first)
// ---------------------------------------------------------------------------------------------
/** creates an offer draft for a lead (the plots chosen, else Lara's suggestion); throws when there is no e-mail or no plot */
export async function createOfferDraft(cfg: LaraConfig, leadId: string, plotKeys: string[] | null, validDays: number, reason: string, rule: string, runId: string | null) {
  const { offer, lead } = await buildOffer(leadId, plotKeys, validDays);
  const mail = String(lead.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw bad("This lead has no e-mail address: an offer needs one");
  const cover = coverText(offer, lead, cfg);
  const ins = await admin.from("lara_drafts").insert({
    lead_id: leadId, run_id: runId, rule, situation: "offer_initial", kind: "offer", channel: "email", lang: cover.lang,
    subject: cover.subject, body: cover.body, to_addr: mail, reason, offer,
    customer: str(lead.customerName || lead.companyName || leadId, 120), owner_id: lead.owner_id || null, owner_name: str(lead.assignedSalespersonName, 80),
  }).select("id").single();
  if (ins.error) throw new HttpError(500, "Could not save the offer");
  await log("offer", null, `Offer prepared for ${lead.customerName || leadId}: ${offer.plots.length} plot(s), ${offer.ref}`);
  return { id: ins.data.id, offer };
}

route("GET", "/lara/offers/candidates", async ({ c, query }) => {
  needAdmin(c);
  return { success: true, ...(await offerCandidates(str(query.get("leadId"), 40).toUpperCase())) };
});
route("POST", "/lara/offers", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 5000);
  const keys = Array.isArray(b.plotKeys) ? b.plotKeys.map((k: any) => str(k, 120)).filter(Boolean).slice(0, 10) : null;
  const r = await createOfferDraft(await laraConfig(), str(b.leadId, 40).toUpperCase(), keys, Number(b.validDays) || 14, `Prepared by ${who(c)}`, "manual_offer", null);
  return { success: true, draftId: r.id, offer: r.offer };
});
route("GET", "/lara/offers", async ({ c }) => {
  needAdmin(c);
  const { data } = await admin.from("lara_drafts").select("id,lead_id,customer,owner_name,status,send_status,send_error,sent_at,created_at,decided_by,offer,reason").eq("kind", "offer").order("created_at", { ascending: false }).limit(150);
  return { success: true, rows: data || [] };
});
/** the PDF of an offer draft (preview before approving; the same file is attached when sent) */
route("GET", "/lara/offers/:id/pdf", async ({ c, params }) => {
  needAdmin(c);
  const { data: d } = await admin.from("lara_drafts").select("offer").eq("id", params.id).eq("kind", "offer").maybeSingle();
  if (!d?.offer) throw new HttpError(404, "Offer not found");
  return new Response(offerPdf(d.offer), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${String(d.offer.ref).replace(/[^A-Za-z0-9-]/g, "")}.pdf"`, "Cache-Control": "no-store" } });
});

route("POST", "/lara/offers/:id/test-copy", async ({ c, params }) => {
  needAdmin(c);
  await rateLimit(`laraoffertest:${c.id}`, 3600, 10);
  const { data: d } = await admin.from("lara_drafts").select("*").eq("id", params.id).eq("kind", "offer").maybeSingle();
  if (!d?.offer) throw new HttpError(404, "Offer not found");
  if (!c.email) throw bad("Your account has no e-mail address");
  await sendOfferTestCopy(d, c.email);
  await log("offer", who(c), `Test copy of ${d.offer.ref} sent to the admin's own address`);
  return { success: true };
});

// the test lock can only be lifted on purpose (typed confirmation); the screens show it but have no switch for it
route("POST", "/lara/test-lock", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 500);
  if (b.locked === false && b.confirm !== "LIFT TEST LOCK") throw bad('To lift the test lock send confirm: "LIFT TEST LOCK"');
  await setConfig("lara_test_lock", b.locked !== false);
  await log("config", who(c), b.locked === false ? "TEST LOCK LIFTED: Lara may e-mail customers" : "Test lock on: Lara may e-mail staff addresses only");
  return { success: true, locked: b.locked !== false };
});
