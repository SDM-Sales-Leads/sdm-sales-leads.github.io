// deno-lint-ignore-file no-explicit-any
// Lara Sales AI — phase 2 (docs/LARA-SALES-AI-PLAN.md): SHADOW mode, admin only, NO AI.
// - Shadow run (daily 09:00 Cairo Sun–Thu from /cron/reminders, or "Run now"): picks the leads the team did not follow up
//   (rules below), writes the message Lara WOULD send with the same smart writer the team uses, and stores it as a draft.
//   Nothing is sent and no lead is changed.
// - Q&A: approved answers, matched by words and concepts (lara_match.ts). Unmatched questions go to "Missed questions".
// - Availability questions ("is there land in October around 3,000 m?") are answered from the Land Bank plot list.
import { admin, bad, body, Caller, can, crmScope, forbidden, getConfig, getSecret, HttpError, isAdmin, needAdmin, nowIso, rateLimit, setConfig, str, tryLock, unlock } from "./lib.ts";
import { inWindow, intl, saveWa, syncTemplates, waCfg, waReady, waSend, waSignatureOk, waThreadFor } from "./lara_wa.ts";
import { hasSecret } from "./lib.ts";
import { route } from "./router.ts";
import { pg } from "./db.ts";
import { analyse, isArabic, KbEntry, matchQuestion, normText, THRESHOLD } from "./lara_match.ts";
import { canonicalParks } from "../../../src/lib/parkAliases.ts";
import { PARK_AR, plotsAr, preferredLang, situationOf, writeFor } from "../../../src/components/crm/smartWriter.ts";
import { availableByPark, plotFit } from "../../../src/components/crm/smartEngine.ts";
import { firstNameOf } from "../../../src/lib/personName.ts";
import { triggerHit, condsOk, condOne, stopReason, validateWorkflow, hasEmail, hasPhone, TRIGGERS, Workflow, graphOf, nextOf, NODE_LABEL, type Graph, type GNode } from "./lara_flow.ts";
import { addNotifications } from "./notify.ts";
import { teamIds } from "./routes_crm.ts";
import { aiAnswer } from "./lara_ai.ts";
import { buildOffer, coverText, offerCandidates, OfferInput } from "./lara_offer.ts";
import { lbRoute } from "./integration.ts";
import { sendOfferTestCopy } from "./lara_mail.ts";
import { handleReply, laraMailCfg, pollLaraInbox, saveMailbox, sendDraft, sendQueued, SendRules } from "./lara_mail.ts";

export interface LaraConfig {
  mode: "off" | "shadow" | "approve" | "auto";
  firstContactHours: number;   // new lead with an owner, no first contact after this many hours
  overdueDays: number;         // follow-up date passed by this many days
  offerSilentDays: number;     // offer sent, nothing logged since
  noAnswerDays: number;        // "no answer" status, last try this many days ago
  maxPerRun: number;           // drafts per run (keeps the list reviewable and the database small)
  nameEn: string; nameAr: string;
  // phase 3 (e-mail, approve first)
  sendEnabled: boolean;        // master switch for sending: off until the admin turns it on
  maxSendPerDay: number; minDaysBetween: number; maxUnanswered: number; sendStart: number; sendEnd: number;
  autoReplies: boolean;        // phase 7: in Autopilot, customer replies are answered without a person
}
export const LARA_DEFAULT: LaraConfig = {
  mode: "shadow", firstContactHours: 24, overdueDays: 3, offerSilentDays: 3, noAnswerDays: 2, maxPerRun: 60,
  nameEn: "Lara, digital sales assistant", nameAr: "لارا، المساعدة الرقمية للمبيعات",
  sendEnabled: false, maxSendPerDay: 30, minDaysBetween: 3, maxUnanswered: 3, sendStart: 9, sendEnd: 17, autoReplies: false,
};
export async function laraConfig(): Promise<LaraConfig> {
  const c = await getConfig<any>("lara_config", {});
  return { ...LARA_DEFAULT, ...(c && typeof c === "object" ? c : {}) };
}
export async function log(kind: string, actor: string | null, text: string, data?: any) {
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
    byPark: availableByPark(plots as any), byKey: new Map(plots.map((p: any) => [p.key, p])), waLive: await waReady().catch(() => false),
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

/** the message draft for one "Write to the customer" box (null when the lead cannot get one now) */
function draftFor(cfg: LaraConfig, x: Ctx, wf: Workflow, step: { channel?: string; situation?: string }, label: string, l: any, why: string, runId: string) {
  const ctx = { rep: cfg.nameEn, repAr: cfg.nameAr, fit: plotFit(l, x.byPark as any), byKey: x.byKey as any, owner: str(l.assignedSalespersonName, 60) };
  const sit = step.situation && step.situation !== "auto" ? step.situation : situationOf(l, ctx);
  const d = writeFor(l, ctx, sit as any)[0];
  const lang = preferredLang(l);
  const mail = hasEmail(l) ? String(l.email).trim().toLowerCase() : "";
  let channel: "email" | "whatsapp";
  if (step.channel === "email") { if (!mail) return null; channel = "email"; }
  else if (step.channel === "whatsapp") { if (!hasPhone(l)) return null; channel = "whatsapp"; }
  else channel = x.waLive && hasPhone(l) ? "whatsapp" : (cfg.mode === "approve" || cfg.mode === "auto") && mail ? "email" : hasPhone(l) ? "whatsapp" : "email";   /* WhatsApp when connected (phase 6), else e-mail */
  if (channel === "email" && !mail) return null;
  return {
    lead_id: l.id, run_id: runId, rule: `wf:${wf.id}`, situation: sit, channel, lang,
    subject: lang === "ar" ? d.subjectAr : d.subjectEn, body: lang === "ar" ? d.ar : d.en,
    reason: `${wf.name} · ${label}: ${why}`,
    customer: str(l.customerName || l.companyName || l.id, 120), owner_id: l.assigned_to, owner_name: str(l.assignedSalespersonName, 80),
    kind: "followup", to_addr: mail || null, to_phone: hasPhone(l) ? intl(l.phoneNumber) || null : null,
    /* Autopilot (phase 7): only when the owner chose Autopilot AND this workflow allows it; offers never */
    ...(cfg.mode === "auto" && (wf as any).autopilot ? { status: "approved", decided_by: "Autopilot", decided_at: nowIso(), send_status: "queued" } : {}),
  };
}

async function directors(): Promise<string[]> {
  const { data } = await admin.from("app_users").select("id").in("role", ["Sales Director"]).neq("active", false).limit(20);
  return (data || []).map((r: any) => r.id);
}

/** run one action box; returns what happened ('' = not now, try again next run) */
async function doStep(cfg: LaraConfig, x: Ctx, wf: Workflow, n: GNode, l: any, why: string, runId: string, budget: { left: number }): Promise<string> {
  const step = { action: n.type, channel: n.data?.channel, situation: n.data?.situation };
  const label = n.data?.label || NODE_LABEL[n.type] || n.type;
  if (step.action === "offer") {
    if (budget.left <= 0) return "";
    if (!hasEmail(l)) return "skipped (no e-mail for an offer)";
    const r = await createOfferDraft(cfg, l.id, { plotKeys: null, mode: "cash", discountPct: 0 }, `${wf.name} · ${label}: ${why}`, `wf:${wf.id}`, runId).catch(() => null);
    if (!r) return "skipped (no available plot fits)";
    budget.left--;
    return "draft";
  }
  if (step.action === "message") {
    if (x.pending.has(l.id)) return "";                                           // a draft for this lead is still waiting
    if (budget.left <= 0) return "";
    const t = x.threads.get(l.id);
    if (t && t.last_out_at && x.now - Date.parse(t.last_out_at) < cfg.minDaysBetween * 864e5) return "";
    const row = draftFor(cfg, x, wf, step, label, l, why, runId);
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

// ---- the drawn workflow (boxes + arrows) -----------------------------------------------------
const ACTION_TYPES = new Set(["message", "offer", "notify_owner", "notify_director", "handover"]);
/** does the drawing look at replies itself? then "stop when the customer replies" must not end it early */
const usesReply = (g: Graph) => g.nodes.some((n) => n.type === "wait_reply" || (n.type === "condition" && n.data?.field === "replied"));
/** the box an enrollment is waiting at (old rows only know the step number: s0, s1, … from the converted step list) */
function enrollNode(g: Graph, e: any): string | null {
  if (e.node) return g.nodes.some((n) => n.id === e.node) ? e.node : null;
  const id = `s${Number(e.step) || 0}`;
  return g.nodes.some((n) => n.id === id) ? id : null;
}
interface Walk { node: string | null; nextAt: number; waitSince: string | null; path: any[]; did: string[]; moved: boolean }
/** walk the drawing from `start` until a Wait box, the end, or an action that cannot run now (at most 10 boxes per run) */
async function advance(cfg: LaraConfig, x: Ctx, wf: Workflow, g: Graph, start: string | null, e: { started_at?: string; wait_since?: string | null; path?: any[]; next_at?: string }, l: any, why: string, runId: string, budget: { left: number }): Promise<Walk> {
  const now = x.now; const t = x.threads.get(l.id);
  const lastIn = Date.parse(t?.last_in_at || "") || 0;
  const replied = lastIn > (Date.parse(e.started_at || "") || now);
  const path = Array.isArray(e.path) ? e.path.slice(-29) : [];
  const w: Walk = { node: start, nextAt: now, waitSince: null, path, did: [], moved: false };
  const mark = (n: GNode, what: string) => { w.path.push({ n: n.id, at: new Date(now).toISOString(), what }); if (w.path.length > 30) w.path.shift(); w.moved = true; };
  for (let k = 0; k < 10 && w.node; k++) {
    const n = g.nodes.find((z) => z.id === w.node);
    if (!n || n.type === "end") { if (n) mark(n, "end"); w.node = null; break; }
    if (n.type === "trigger") { w.node = nextOf(g, n.id); continue; }
    if (n.type === "wait") {
      const days = Math.max(1, Math.min(60, Number(n.data?.days) || 1));
      mark(n, `wait ${days} d`); w.node = nextOf(g, n.id); w.nextAt = now + days * 864e5;
      return w;                                                                   // continue after the wait
    }
    if (n.type === "wait_reply") {
      const since = e.wait_since && start === n.id ? Date.parse(e.wait_since) : 0;
      if (!since) {                                                              // just arrived: start waiting
        const days = Math.max(1, Math.min(30, Number(n.data?.days) || 3));
        mark(n, `waiting up to ${days} d for a reply`); w.waitSince = new Date(now).toISOString(); w.nextAt = now + days * 864e5; return w;
      }
      if (lastIn > since) { mark(n, "replied"); w.node = nextOf(g, n.id, "replied"); w.waitSince = null; continue; }
      if (now >= (Date.parse(e.next_at || "") || 0)) { mark(n, "no reply"); w.node = nextOf(g, n.id, "no_reply"); w.waitSince = null; continue; }
      w.waitSince = e.wait_since || null; w.nextAt = Date.parse(e.next_at || "") || now; return w;   // still waiting
    }
    if (n.type === "condition") {
      const ok = condOne({ field: n.data?.field, op: n.data?.op || "in", value: n.data?.value }, l, now, replied);
      mark(n, ok ? "yes" : "no"); w.node = nextOf(g, n.id, ok ? "yes" : "no"); continue;
    }
    if (ACTION_TYPES.has(n.type)) {
      const did = await doStep(cfg, x, wf, n, l, why, runId, budget);
      if (!did) return w;                                                        // not now (draft limit, a draft still waiting…): try again next run
      mark(n, did); w.did.push(did); w.node = nextOf(g, n.id); continue;
    }
    w.node = nextOf(g, n.id);
  }
  return w;
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
      const g = wf ? graphOf(wf) : null;
      const wfStop = wf && g && usesReply(g) ? { ...wf, stop: { ...wf.stop, onReply: false } } : wf;   // the drawing handles replies itself
      const stop = !wf ? "Workflow switched off" : x.dnc.has(e.lead_id) ? "Rejected: do not contact" : stopReason(wfStop!, l, Date.parse(e.started_at), x.today, Date.parse(t?.last_in_at || "") || 0, t?.status || "", !!(l && x.optedOut(l)));
      if (stop) { await admin.from("lara_enrollments").update({ status: "stopped", stop_reason: stop, updated_at: nowIso() }).eq("id", e.id); res.stopped++; continue; }
      if (!wf || !g) continue;
      const at = enrollNode(g, e);
      if (!at) { await admin.from("lara_enrollments").update({ status: "done", node: null, updated_at: nowIso() }).eq("id", e.id); res.finished++; continue; }
      const atNode = g.nodes.find((n) => n.id === at);
      const repliedSince = atNode?.type === "wait_reply" && e.wait_since && (Date.parse(t?.last_in_at || "") || 0) > Date.parse(e.wait_since);
      if (Date.parse(e.next_at) > now && !repliedSince) continue;                 // not due (a reply wakes a "Wait for a reply" box early)
      const w = await advance(cfg, x, wf, g, at, e, l, e.why, runId, budget);
      for (const d of w.did) { if (d === "draft") res.drafted++; else if (d.startsWith("notified") || d === "handed over") res.notified++; }
      if (!w.moved) continue;
      const done = !w.node;
      await admin.from("lara_enrollments").update({ node: w.node, step: (Number(e.step) || 0) + w.did.length, status: done ? "done" : "active", next_at: new Date(w.nextAt).toISOString(), wait_since: w.waitSince, path: w.path, updated_at: nowIso() }).eq("id", e.id);
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
      const g = graphOf(c.wf);
      const trig = g.nodes.find((n) => n.type === "trigger");
      const start = trig ? nextOf(g, trig.id) : null;
      if (!start) continue;
      const first = g.nodes.find((n) => n.id === start);
      if ((first?.type === "message" || first?.type === "offer") && budget.left <= 0) continue;   // drafts for today are used up; other workflows still start
      const ins = await admin.from("lara_enrollments").insert({ workflow_id: c.wf.id, lead_id: c.l.id, why: c.why, node: start, next_at: new Date(now).toISOString() }).select("*").single();
      if (ins.error || !ins.data) continue;
      res.enrolled++; count(c.wf);
      const w = await advance(cfg, x, c.wf, g, start, ins.data, c.l, c.why, runId, budget);
      for (const d of w.did) { if (d === "draft") res.drafted++; else res.notified++; }
      if (!w.moved) continue;
      await admin.from("lara_enrollments").update({ node: w.node, step: w.did.length, status: w.node ? "active" : "done", next_at: new Date(w.nextAt).toISOString(), wait_since: w.waitSince, path: w.path, updated_at: nowIso() }).eq("id", ins.data.id);
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
  // the path each sample lead would take through the drawing (a reply is assumed NOT to come; nothing is written)
  const g = graphOf(w);
  const simulate = (l: any) => {
    const steps: { id: string; type: string; text: string }[] = []; let msg: any = null;
    const trig = g.nodes.find((n) => n.type === "trigger");
    let cur = trig ? nextOf(g, trig.id) : null; let day = 0;
    for (let k = 0; k < 20 && cur; k++) {
      const n = g.nodes.find((z) => z.id === cur); if (!n) break;
      const label = n.data?.label || NODE_LABEL[n.type] || n.type;
      if (n.type === "end") { steps.push({ id: n.id, type: n.type, text: "End" }); break; }
      if (n.type === "wait") { const d = Number(n.data?.days) || 1; day += d; steps.push({ id: n.id, type: n.type, text: `Wait ${d} day${d > 1 ? "s" : ""}` }); cur = nextOf(g, n.id); continue; }
      if (n.type === "wait_reply") { const d = Number(n.data?.days) || 3; day += d; steps.push({ id: n.id, type: n.type, text: `No reply within ${d} days (assumed)` }); cur = nextOf(g, n.id, "no_reply"); continue; }
      if (n.type === "condition") { const ok = condOne({ field: n.data?.field, op: n.data?.op || "in", value: n.data?.value }, l, x.now, false); steps.push({ id: n.id, type: n.type, text: `${label}: ${ok ? "yes" : "no"}` }); cur = nextOf(g, n.id, ok ? "yes" : "no"); continue; }
      if (n.type === "message") {
        const d = draftFor(cfg, x, w, { channel: n.data?.channel, situation: n.data?.situation }, label, l, "", "TEST");
        steps.push({ id: n.id, type: n.type, text: d ? `Day ${day}: ${d.channel === "email" ? "e-mail" : "WhatsApp"} draft` : `Day ${day}: skipped (no e-mail / phone for this channel)` });
        if (d && !msg) msg = { customer: d.customer, channel: d.channel, subject: d.subject, body: d.body };
      } else steps.push({ id: n.id, type: n.type, text: `Day ${day}: ${label}` });
      cur = nextOf(g, n.id);
    }
    if (cur === null && steps[steps.length - 1]?.type !== "end") steps.push({ id: "", type: "end", text: "End" });
    return { steps, msg };
  };
  const sims = hits.filter((h) => !h.busy).slice(0, 5).map((h) => ({ h, s: simulate(h.l) }));
  const samples = sims.map((z) => z.s.msg).filter(Boolean).slice(0, 3);
  const paths = sims.map((z) => ({ id: z.h.l.id, customer: z.h.l.customerName || z.h.l.companyName || z.h.l.id, steps: z.s.steps }));
  const owners: Record<string, number> = {};
  for (const h of hits) owners[h.l.assignedSalespersonName || "—"] = (owners[h.l.assignedSalespersonName || "—"] || 0) + 1;
  return {
    matched: hits.length, alreadyInAWorkflow: hits.filter((h) => h.busy).length, perRunLimit: cfg.maxPerRun,
    leads: hits.slice(0, 40).map((h) => ({ id: h.l.id, customer: h.l.customerName || h.l.companyName || h.l.id, owner: h.l.assignedSalespersonName || "—", status: h.l.status, why: h.why, busy: h.busy, email: hasEmail(h.l), phone: hasPhone(h.l) })),
    byOwner: Object.entries(owners).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, n]) => ({ name, n })),
    samples, paths,
  };
}

// ---------------------------------------------------------------------------------------------
// Q&A
// ---------------------------------------------------------------------------------------------
export async function activeKb(): Promise<KbEntry[]> {
  const { data } = await admin.from("lara_kb").select("id,topic,q_ar,q_en,phrasings,a_ar,a_en,status,uses").eq("status", "active").limit(3000);
  return (data || []) as KbEntry[];
}
/** "is there land in October around 3,000 m?" answered from the Land Bank list (no Q&A needed) */
export async function availabilityAnswer(question: string): Promise<{ ar: string; en: string } | null> {
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
/** who may use Lara: administrators, or roles with canUseLara. What they SEE follows the CRM's own rule (owner, 11 Nov 2026):
 *  admin / Sales Operation / everyone with an "all leads" scope -> every lead; team leader -> the team's leads; others -> their own leads.
 *  `admin` here means "sees every lead" (not "is an administrator"); admin-only screens still use needAdmin. */
export function laraWho(c: Caller): { admin: boolean; id: string } {
  if (isAdmin(c)) return { admin: true, id: c.id };
  if (can(c, "canUseLara")) { const s = crmScope(c); return { admin: s === "all" || s === "viewall", id: c.id }; }
  throw forbidden("Lara is not switched on for your role");
}
/** the owners whose leads this person may see in Lara (null = every lead) */
export async function laraOwners(c: Caller): Promise<string[] | null> {
  if (laraWho(c).admin) return null;
  return crmScope(c) === "team" ? await teamIds(c) : [c.id];
}
export async function canSeeOwner(c: Caller, ownerId: string | null | undefined): Promise<boolean> {
  const o = await laraOwners(c);
  return o === null || (!!ownerId && o.includes(ownerId));
}
export async function ownsLead(c: Caller, leadId: string) {
  const { data } = await admin.from("crm_leads").select("assigned_to").eq("id", leadId).maybeSingle();
  if (!data || !(await canSeeOwner(c, data.assigned_to))) throw forbidden("This lead is not in your leads");
}
export const who = (c: Caller) => c.name || c.email || "admin";

route("GET", "/lara/overview", async ({ c }) => {
  const w = laraWho(c);
  const cfg = await laraConfig();
  if (!w.admin) {
    const { data: mine } = await admin.from("lara_drafts").select("status,situation,rule,edited").in("owner_id", (await laraOwners(c)) || []).gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString()).limit(5000);
    const t = { shadow: 0, approved: 0, rejected: 0, expired: 0, edited: 0 } as Record<string, number>;
    for (const d of mine || []) { t[d.status] = (t[d.status] || 0) + 1; if (d.edited) t.edited++; }
    return { success: true, user: true, config: { mode: cfg.mode, sendEnabled: cfg.sendEnabled }, testLock: (await getConfig<any>("lara_test_lock", true)) !== false, drafts30: t, kbActive: 0, missedOpen: 0, openBySituation: {}, openByRule: {}, ruleLabels: RULE_LABEL, channels: { email: false, whatsapp: false }, ai: false };
  }
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
  return { success: true, testLock, ruleLabels: labels, workflows: wfl.map((w) => ({ id: w.id, name: w.name, enabled: w.enabled })), mailbox: { address: mb.address, user: mb.user, host: mb.host, shared: !!mb.shared, status: mb.status || null }, threads, unmatched: um.count || 0, send, config: cfg, drafts30: t, openBySituation: bySituation, openByRule: byRule, kbActive: kb.count || 0, missedOpen: missed.count || 0, lastRun: lastRun.data || null, channels: { email: !!mb.status?.ok, whatsapp: await waReady() }, ai: false };
});

route("PUT", "/lara/config", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 4000);
  const cur = await laraConfig();
  const num = (v: any, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
  const next: LaraConfig = {
    mode: b.mode === "off" ? "off" : b.mode === "approve" ? "approve" : b.mode === "auto" ? "auto" : "shadow",
    firstContactHours: num(b.firstContactHours, 1, 240, cur.firstContactHours),
    overdueDays: num(b.overdueDays, 1, 60, cur.overdueDays),
    offerSilentDays: num(b.offerSilentDays, 1, 60, cur.offerSilentDays),
    noAnswerDays: num(b.noAnswerDays, 1, 30, cur.noAnswerDays),
    maxPerRun: num(b.maxPerRun, 5, 200, cur.maxPerRun),
    nameEn: str(b.nameEn, 60) || cur.nameEn, nameAr: str(b.nameAr, 60) || cur.nameAr,
    sendEnabled: b.sendEnabled === true, autoReplies: b.autoReplies === true,
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
  const w = laraWho(c);
  // paged on the server (owner, 11 Nov 2026: never download every draft on a refresh); only the fields the card shows
  const status = ["shadow", "approved", "rejected", "expired"].includes(query.get("status") || "") ? query.get("status")! : "shadow";
  const size = [10, 25, 50, 100].includes(Number(query.get("size"))) ? Number(query.get("size")) : 10;
  const page = Math.max(1, Math.min(5000, Number(query.get("page")) || 1));
  const qs = str(query.get("q") || "", 80).replace(/[%_\\,()]/g, " ").trim();
  const ch = ["email", "whatsapp"].includes(query.get("channel") || "") ? query.get("channel")! : "";
  const sit = /^[a-z_]{2,40}$/.test(query.get("situation") || "") ? query.get("situation")! : "";
  const kind = ["followup", "reply", "offer"].includes(query.get("kind") || "") ? query.get("kind")! : "";
  let dq: any = admin.from("lara_drafts").select("id,lead_id,rule,kind,situation,channel,lang,subject,body,reason,customer,owner_id,owner_name,status,feedback,edited,decided_by,decided_at,send_status,send_error,sent_at,to_addr,to_phone,offer,thread_id,created_at", { count: "exact" }).eq("status", status);
  if (!w.admin) dq = dq.in("owner_id", (await laraOwners(c)) || []);
  if (ch) dq = dq.eq("channel", ch);
  if (sit) dq = dq.eq("situation", sit);
  if (kind) dq = dq.eq("kind", kind);
  if (qs) dq = dq.or(`customer.ilike.%${qs}%,owner_name.ilike.%${qs}%,lead_id.ilike.%${qs}%`);
  const { data, error, count } = await dq.order(status === "shadow" ? "created_at" : "decided_at", { ascending: false }).range((page - 1) * size, page * size - 1);
  if (error && (error as any).code === "PGRST103") return { success: true, page, size, total: (await admin.from("lara_drafts").select("id", { count: "exact", head: true }).eq("status", status)).count || 0, rows: [] };   // a page past the end
  if (error) throw new HttpError(500, "Could not read the drafts");
  return { success: true, page, size, total: count || 0, rows: data || [] };
});

route("POST", "/lara/drafts/:id/decide", async ({ req, c, params }) => {
  const w = laraWho(c);
  const b = await body(req, 8000);
  const decision = b.decision === "approved" ? "approved" : b.decision === "rejected" ? "rejected" : "";
  if (!decision) throw bad("decision?");
  const { data: d } = await admin.from("lara_drafts").select("*").eq("id", params.id).maybeSingle();
  if (!d) throw new HttpError(404, "Draft not found");
  if (!w.admin && !(await canSeeOwner(c, d.owner_id))) throw forbidden("This lead is not in your leads");
  if (d.status !== "shadow") throw new HttpError(409, "This draft was already decided");
  const newBody = typeof b.body === "string" ? str(b.body, 4000) : d.body;
  const upd = { status: decision, feedback: str(b.feedback, 200) || null, body: newBody, subject: typeof b.subject === "string" ? str(b.subject, 200) : d.subject, edited: newBody !== d.body, decided_by: who(c), decided_at: nowIso(), updated_at: nowIso() };
  const md = (await laraConfig()).mode;
  const willSend = decision === "approved" && (md === "approve" || md === "auto");
  await admin.from("lara_drafts").update({ ...upd, send_status: willSend ? "queued" : "none" }).eq("id", d.id);
  await log("decision", who(c), `${decision === "approved" ? "Approved" : "Rejected"} draft for ${d.customer} (${d.situation})${upd.feedback ? `: ${upd.feedback}` : ""}${upd.edited ? " — edited" : ""}`);
  if (willSend) { const r = await sendDraft(d.id, rules(await laraConfig()), who(c)); return { success: true, sent: r.sent, sendNote: r.sent ? (d.channel === "whatsapp" ? "WhatsApp sent" : "E-mail sent") : r.reason }; }
  return { success: true, sent: false };
});
route("POST", "/lara/drafts/:id/send", async ({ c, params }) => {
  const w = laraWho(c);
  if (!w.admin) { const { data: d0 } = await admin.from("lara_drafts").select("owner_id").eq("id", params.id).maybeSingle(); if (!(await canSeeOwner(c, d0?.owner_id))) throw forbidden("This lead is not in your leads"); }
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
  const size = [10, 25, 50, 100].includes(Number(query.get("size"))) ? Number(query.get("size")) : 25;
  const page = Math.max(1, Math.min(5000, Number(query.get("page")) || 1));
  const kind = /^[a-z]{2,20}$/.test(query.get("kind") || "") ? query.get("kind")! : "";
  const qs = str(query.get("q") || "", 80).replace(/[%_\\,()]/g, " ").trim();
  let lq: any = admin.from("lara_log").select("id,at,kind,actor,text", { count: "exact" });
  if (kind) lq = lq.eq("kind", kind);
  if (qs) lq = lq.ilike("text", `%${qs}%`);
  const { data, count, error } = await lq.order("at", { ascending: false }).range((page - 1) * size, page * size - 1);
  if (error) return { success: true, page, size, total: 0, rows: [] };
  return { success: true, page, size, total: count || 0, rows: data || [] };
});

// ---------------------------------------------------------------------------------------------
// phase 3: mailbox, conversations, replies
// ---------------------------------------------------------------------------------------------
const rules = (c: LaraConfig): SendRules => ({  sendEnabled: c.sendEnabled, mode: c.mode, maxSendPerDay: c.maxSendPerDay, minDaysBetween: c.minDaysBetween, maxUnanswered: c.maxUnanswered, sendStart: c.sendStart, sendEnd: c.sendEnd });

/** what Lara does with a customer's reply (no AI): the approved answer when there is one; otherwise a polite holding reply */
export const replyHooks = {
  autoApprove: async () => { const c = await laraConfig(); return c.mode === "auto" && c.autoReplies === true; },
  answer: async (q: string, leadId: string) => {
    const r = await laraAnswer(q.slice(0, 600), { record: true, source: "customer", leadId, by: "Customer reply" });
    const best = r.matches[0];
    if (r.data) return { answered: true, source: "landbank" as const, text: r.data };
    if (r.answered && best) return { answered: true, source: "qa" as const, text: { ar: best.a_ar, en: best.a_en } };
    // only now, and only if the owner switched it on (daily cap): the AI, grounded on the approved answers; the reply is still a draft
    const ar = isArabic(q);
    const ai = await aiAnswer(q, await activeKb(), [], { lang: ar ? "ar" : "en" }).catch(() => null);
    if (ai) return { answered: true, source: "ai" as const, text: { ar: ai, en: ai } };
    return { answered: false };
  },
  writeReply: async (leadId: string, ar: boolean, answerText: string | null, welcome?: string | null) => {
    const cfg = await laraConfig();
    const { data } = await admin.from("crm_leads").select("data->customerName,data->assignedSalespersonName").eq("id", leadId).maybeSingle();
    const first = firstNameOf(String((data as any)?.customerName || ""));
    const owner = String((data as any)?.assignedSalespersonName || "").trim();
    if (ar) {
      const hi = welcome || (first ? `أهلاً أ. ${first}،` : "أهلاً بحضرتك،");
      const mid = answerText
        ? `شكراً لرد حضرتك.\n\n${answerText}\n\nلو فيه أي سؤال تاني أنا موجودة${owner ? `، وزميلي ${owner} مسؤول المبيعات الخاص بحضرتك متاح كمان لأي تفاصيل` : ""}.`
        : `شكراً لرد حضرتك. سؤال حضرتك وصل${owner ? ` لزميلي ${owner}، مسؤول المبيعات الخاص بحضرتك،` : " لفريق المبيعات"} وهيرد عليك بالتفاصيل في أقرب وقت.`;
      return { subject: "", body: `${hi}\n\n${mid}\n\n${cfg.nameAr}\nالسويدي للتنمية الصناعية` };
    }
    const hi = welcome || (first && !/[؀-ۿ]/.test(first) ? `Dear ${first},` : "Good day,");
    const mid = answerText
      ? `Thank you for your reply.\n\n${answerText}\n\nIf you have any other question I am here${owner ? `, and your account manager, ${owner}, is also available for any details` : ""}.`
      : `Thank you for your reply. Your question has been passed to ${owner ? `your account manager, ${owner},` : "our sales team,"} who will get back to you with the details shortly.`;
    return { subject: "", body: `${hi}\n\n${mid}\n\nBest regards,\n${cfg.nameEn}\nElsewedy Industrial Development` };
  },
};

/** cron (every 10 minutes, 07:00–22:00): read Lara's mailbox and send the approved mails that wait for working hours */
export async function laraMailTick() {
  const cfg = await laraConfig();
  if (cfg.mode !== "approve" && cfg.mode !== "auto") return { laraMail: "not in approve-first / autopilot mode" };
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
  const w = laraWho(c);
  const st = ["open", "handover", "stopped", "closed"].includes(query.get("status") || "") ? query.get("status")! : "";
  let q: any = admin.from("lara_threads").select("*").order("updated_at", { ascending: false }).limit(300);
  if (st) q = q.eq("status", st);
  let { data } = await q;
  if (!w.admin && data?.length) { const own = new Set(((await admin.from("crm_leads").select("id").in("id", data.map((t: any) => t.lead_id)).in("assigned_to", (await laraOwners(c)) || [])).data || []).map((r: any) => r.id)); data = data.filter((t: any) => own.has(t.lead_id)); }
  const ids = (data || []).map((t: any) => t.lead_id);
  const names = ids.length ? (await admin.from("crm_leads").select("id,data->customerName,data->assignedSalespersonName").in("id", ids)).data || [] : [];
  const nm = new Map(names.map((r: any) => [r.id, r]));
  return { success: true, rows: (data || []).map((t: any) => ({ ...t, customer: (nm.get(t.lead_id) as any)?.customerName || t.lead_id, owner: (nm.get(t.lead_id) as any)?.assignedSalespersonName || "" })) };
});
route("GET", "/lara/threads/:id", async ({ c, params }) => {
  const w = laraWho(c);
  const { data: t } = await admin.from("lara_threads").select("*").eq("id", params.id).maybeSingle();
  if (!t) throw new HttpError(404, "Conversation not found");
  if (!w.admin) await ownsLead(c, t.lead_id);
  const [msgs, drafts] = await Promise.all([
    admin.from("lara_messages").select("id,direction,kind,channel,wa_status,matched_by,subject,body,from_addr,to_addr,at").eq("thread_id", t.id).order("at").limit(200),
    admin.from("lara_drafts").select("id,kind,status,send_status,send_error,body,created_at").eq("lead_id", t.lead_id).in("status", ["shadow", "approved"]).neq("send_status", "sent").order("created_at", { ascending: false }).limit(10),
  ]);
  return { success: true, thread: t, messages: msgs.data || [], pending: drafts.data || [] };
});
route("POST", "/lara/threads/:id/status", async ({ req, c, params }) => {
  const w = laraWho(c);
  if (!w.admin) { const { data: t0 } = await admin.from("lara_threads").select("lead_id").eq("id", params.id).maybeSingle(); if (!t0) throw new HttpError(404, "Conversation not found"); await ownsLead(c, t0.lead_id); }
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
/** the drawing as sent by the screen, cleaned box by box; the Start box's settings become the workflow's trigger and filters */
const NODE_TYPES = ["trigger", "wait", "condition", "wait_reply", "message", "offer", "notify_owner", "notify_director", "handover", "end"];
const cleanVal = (v: any) => typeof v === "boolean" ? v : Array.isArray(v) ? v.map((x: any) => str(x, 80)).slice(0, 30) : typeof v === "number" ? v : str(v, 400);
function cleanGraph(g: any): Graph | null {
  if (!g || !Array.isArray(g.nodes) || !g.nodes.length) return null;
  const nodes = g.nodes.slice(0, 40).filter((n: any) => NODE_TYPES.includes(n?.type)).map((n: any) => {
    const d = n.data || {}; const data: any = {};
    if (d.label) data.label = str(d.label, 60);
    if (n.type === "trigger") { data.trigger = d.trigger; data.conditions = d.conditions; }
    if (n.type === "wait" || n.type === "wait_reply") data.days = Math.max(1, Math.min(n.type === "wait" ? 60 : 30, Math.round(Number(d.days) || 1)));
    if (n.type === "condition") { data.field = str(d.field, 30); data.op = str(d.op, 10) || "in"; data.value = cleanVal(d.value); }
    if (n.type === "message") { data.channel = ["auto", "email", "whatsapp"].includes(d.channel) ? d.channel : "auto"; data.situation = str(d.situation, 30) || "auto"; }
    return { id: str(n.id, 40), type: n.type, x: Math.round(Number(n.x) || 0), y: Math.round(Number(n.y) || 0), data };
  });
  const ids = new Set(nodes.map((n: any) => n.id));
  const edges = (Array.isArray(g.edges) ? g.edges : []).slice(0, 80).filter((e: any) => ids.has(e?.source) && ids.has(e?.target))
    .map((e: any) => ({ id: str(e.id, 90) || `e-${e.source}-${e.target}`, source: str(e.source, 40), target: str(e.target, 40), ...(e.handle && e.handle !== "out" ? { handle: str(e.handle, 12) } : {}) }));
  return { nodes, edges };
}
const cleanWf = (b0: any) => {
  const graph = cleanGraph(b0.graph);
  const tn: any = graph?.nodes.find((n) => n.type === "trigger");
  const b = tn ? { ...b0, trigger: tn.data.trigger, conditions: tn.data.conditions } : b0;
  const w = cleanWf0(b);
  if (graph && tn) { tn.data = { ...tn.data, trigger: w.trigger, conditions: w.conditions }; }
  return { ...w, graph, steps: graph ? [] : w.steps };
};
const cleanWf0 = (b: any) => ({
  name: str(b.name, 80), description: str(b.description, 400), enabled: b.enabled === true, priority: Math.max(1, Math.min(999, Math.round(Number(b.priority) || 100))),
  trigger: { type: String(b.trigger?.type || ""), value: Math.max(0, Math.min(3650, Number(b.trigger?.value) || 0)), statuses: Array.isArray(b.trigger?.statuses) ? b.trigger.statuses.map((x: any) => str(x, 60)).slice(0, 20) : undefined },
  conditions: (Array.isArray(b.conditions) ? b.conditions : []).slice(0, 10).map((c: any) => ({ field: str(c.field, 30), op: str(c.op, 10) || "in", value: typeof c.value === "boolean" ? c.value : Array.isArray(c.value) ? c.value.map((v: any) => str(v, 80)).slice(0, 30) : str(c.value, 400) })),
  steps: (Array.isArray(b.steps) ? b.steps : []).slice(0, 8).map((s: any) => ({ waitDays: Math.max(0, Math.min(60, Math.round(Number(s.waitDays) || 0))), action: str(s.action, 20), channel: ["auto", "email", "whatsapp"].includes(s.channel) ? s.channel : "auto", situation: str(s.situation, 30) || "auto" })),
  stop: { onActivity: b.stop?.onActivity !== false, onReply: b.stop?.onReply !== false, onMeeting: b.stop?.onMeeting !== false },
  autopilot: b.autopilot === true,
});

route("GET", "/lara/workflows", async ({ c }) => {
  needAdmin(c);
  const [wfs, en] = await Promise.all([
    admin.from("lara_workflows").select("*").eq("status", "active").order("priority").order("created_at"),
    admin.from("lara_enrollments").select("workflow_id,status,stop_reason,node,step").gte("started_at", new Date(Date.now() - 30 * 864e5).toISOString()).limit(50000),
  ]);
  const stats: Record<string, any> = {};
  for (const e of en.data || []) {
    const s = stats[e.workflow_id] ||= { active: 0, done: 0, stopped: 0, reasons: {} as Record<string, number>, atNode: {} as Record<string, number> };
    s[e.status]++;
    if (e.status === "active") { const k = e.node || `s${Number(e.step) || 0}`; s.atNode[k] = (s.atNode[k] || 0) + 1; }
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
export async function createOfferDraft(cfg: LaraConfig, leadId: string, inp: OfferInput, reason: string, rule: string, runId: string | null) {
  const { offer, lead } = await buildOffer(leadId, inp);
  const mail = String(lead.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw bad("This lead has no e-mail address: an offer needs one");
  const cover = coverText(offer, lead, cfg);
  const ins = await admin.from("lara_drafts").insert({
    lead_id: leadId, run_id: runId, rule, situation: "offer_initial", kind: "offer", channel: "email", lang: cover.lang,
    subject: cover.subject, body: cover.body, to_addr: mail, reason, offer,
    customer: str(lead.customerName || lead.companyName || leadId, 120), owner_id: lead.owner_id || null, owner_name: str(lead.assignedSalespersonName, 80),
  }).select("id").single();
  if (ins.error) throw new HttpError(500, "Could not save the offer");
  await log("offer", null, `Offer prepared for ${lead.customerName || leadId}: ${offer.plots.length} plot(s), ${offer.mode}, discount ${offer.discountPct}%, ${offer.ref}`);
  return { id: ins.data.id, offer };
}
const offerInput = (b: any): OfferInput => ({
  plotKeys: Array.isArray(b.plotKeys) ? b.plotKeys.map((k: any) => str(k, 120)).filter(Boolean).slice(0, 10) : null,
  discountPct: Number(b.discountPct) || 0, mode: "plan", plan: b.plan && typeof b.plan === "object" ? b.plan : undefined,   /* the Initial financial offer always has a payment plan */
});
/** what the system shows sales: real price (internal) next to what the customer sees */
const offerView = (o: any) => ({ ...o, maxDiscountPct: o.listSqm ? Math.floor((1 - o.realSqm / o.listSqm) * 10000) / 100 : 0 });

route("GET", "/lara/offers/candidates", async ({ c, query }) => {
  const w = laraWho(c); const id = str(query.get("leadId"), 40).toUpperCase();
  if (!w.admin) await ownsLead(c, id);
  return { success: true, ...(await offerCandidates(id)) };
});
route("POST", "/lara/offers/preview", async ({ req, c }) => {
  const w = laraWho(c);
  const b = await body(req, 5000);
  if (!w.admin) await ownsLead(c, str(b.leadId, 40).toUpperCase());
  const { offer } = await buildOffer(str(b.leadId, 40).toUpperCase(), offerInput(b));
  return { success: true, offer: offerView(offer) };
});
route("POST", "/lara/offers", async ({ req, c }) => {
  const w = laraWho(c);
  const b = await body(req, 5000);
  if (!w.admin) await ownsLead(c, str(b.leadId, 40).toUpperCase());
  const r = await createOfferDraft(await laraConfig(), str(b.leadId, 40).toUpperCase(), offerInput(b), `Prepared by ${who(c)}`, "manual_offer", null);
  return { success: true, draftId: r.id, offer: offerView(r.offer) };
});
/** change discount / cash or instalments on an offer that waits for approval (same plots, prices re-read from the Land Bank) */
route("POST", "/lara/offers/:id/update", async ({ req, c, params }) => {
  const w = laraWho(c);
  const b = await body(req, 5000);
  const { data: d } = await admin.from("lara_drafts").select("*").eq("id", params.id).eq("kind", "offer").maybeSingle();
  if (!d?.offer) throw new HttpError(404, "Offer not found");
  if (!w.admin && !(await canSeeOwner(c, d.owner_id))) throw forbidden("This lead is not in your leads");
  if (d.status !== "shadow") throw new HttpError(409, "Only an offer that waits for approval can be changed");
  const inp = offerInput({ ...b, plotKeys: d.offer.plots.map((p: any) => p.key), mode: b.mode ?? d.offer.mode, plan: b.plan ?? d.offer.plan, discountPct: b.discountPct ?? d.offer.discountPct });
  const { offer, lead } = await buildOffer(d.lead_id, inp);
  const cover = coverText(offer, lead, await laraConfig());
  await admin.from("lara_drafts").update({ offer: { ...offer, pdf: null }, subject: cover.subject, body: cover.body, edited: true, updated_at: nowIso() }).eq("id", d.id);
  await log("offer", who(c), `Offer ${offer.ref} changed: ${offer.mode}, discount ${offer.discountPct}%`);
  return { success: true, offer: offerView(offer) };
});
route("GET", "/lara/offers", async ({ c }) => {
  const w = laraWho(c);
  let oq: any = admin.from("lara_drafts").select("id,lead_id,customer,owner_name,owner_id,status,send_status,send_error,sent_at,created_at,decided_by,offer,reason").eq("kind", "offer");
  if (!w.admin) oq = oq.in("owner_id", (await laraOwners(c)) || []);
  const { data } = await oq.order("created_at", { ascending: false }).limit(150);
  return { success: true, rows: (data || []).map((r: any) => ({ ...r, offer: r.offer?.listSqm ? offerView(r.offer) : r.offer })) };
});
/** the PDF of an offer draft = the Initial financial offer the Land Bank built for it (the same file is attached when sent) */
route("GET", "/lara/offers/:id/pdf", async ({ c, params }) => {
  const w = laraWho(c);
  if (!w.admin) { const { data: d0 } = await admin.from("lara_drafts").select("owner_id").eq("id", params.id).maybeSingle(); if (!(await canSeeOwner(c, d0?.owner_id))) throw forbidden("This lead is not in your leads"); }
  const { data: f } = await admin.from("lara_offer_files").select("file_name,pdf_b64").eq("draft_id", params.id).maybeSingle();
  if (!f) throw new HttpError(409, "Not built yet: press \"Build in Land Bank\" first");
  const raw = Uint8Array.from(atob(f.pdf_b64), (ch) => ch.charCodeAt(0));
  return new Response(raw, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${String(f.file_name).replace(/[^A-Za-z0-9 ._-]/g, "")}"`, "Cache-Control": "no-store" } });
});

// ---- the Land Bank side (Land Bank token): read Lara's offer, send back the PDF it built ----
const lbAllowed = async (c: Caller, ownerId?: string | null) => c.role === "Admin" || c.role === "Sales Operation" || (can(c, "canUseLara") && await canSeeOwner(c, ownerId));
lbRoute("GET", "/integration/lara-offer/:id", async ({ c, params }) => {
  const { data: d } = await admin.from("lara_drafts").select("id,lead_id,status,offer,customer,owner_name,owner_id").eq("id", params.id).eq("kind", "offer").maybeSingle();
  if (!d?.offer) throw new HttpError(404, "Offer not found");
  if (!(await lbAllowed(c, d.owner_id))) throw new HttpError(403, "Only Admin, Sales Operation or the lead's salesperson build Lara's offers");
  if (d.status !== "shadow") throw new HttpError(409, "This offer is no longer waiting (it was approved, rejected or expired)");
  const { data: lead } = await admin.from("crm_leads").select("data->customerName,data->companyName,data->industry").eq("id", d.lead_id).maybeSingle();
  const o = d.offer;
  return { success: true, id: d.id, ref: o.ref, leadId: d.lead_id, plotKeys: (o.plots || []).map((p: any) => p.key),
    plan: o.plan || null, discountPct: o.discountPct || 0, customer: (lead as any)?.customerName || "", company: (lead as any)?.companyName || "", activity: (lead as any)?.industry || "", owner: d.owner_name || "",
    expect: { realTotal: o.realTotal, listTotal: o.listTotal, netTotal: o.netTotal, due: o.due } };
});
lbRoute("POST", "/integration/lara-offer/:id/pdf", async ({ req, c, params }) => {
  const b = await body(req, 6_000_000);
  const pdf = String(b.pdfBase64 || "");
  if (!/^JVBERi0/.test(pdf)) throw bad("That is not a PDF");
  if (pdf.length > 5_500_000) throw bad("The PDF is too large (max ~4 MB)");
  const { data: d } = await admin.from("lara_drafts").select("id,status,offer,owner_id").eq("id", params.id).eq("kind", "offer").maybeSingle();
  if (!d?.offer) throw new HttpError(404, "Offer not found");
  if (!(await lbAllowed(c, d.owner_id))) throw new HttpError(403, "Only Admin, Sales Operation or the lead's salesperson build Lara's offers");
  if (d.status !== "shadow") throw new HttpError(409, "This offer is no longer waiting");
  const name = str(b.fileName, 140) || `${d.offer.ref}.pdf`;
  const size = Math.round(pdf.length * 3 / 4);
  await admin.from("lara_offer_files").upsert({ draft_id: d.id, file_name: name, pdf_b64: pdf, size_bytes: size, built_by: c.name || c.email, built_at: nowIso() });
  await admin.from("lara_drafts").update({ offer: { ...d.offer, pdf: { name, size, builtAt: nowIso(), builtBy: c.name || c.email, total: Number(b.total) || null } }, updated_at: nowIso() }).eq("id", d.id);
  await log("offer", c.name || c.email, `Initial financial offer built in the Land Bank for ${d.offer.ref} (${Math.round(size / 1024)} KB)`);
  return { success: true };
});

route("POST", "/lara/offers/:id/test-copy", async ({ c, params }) => {
  const w = laraWho(c);
  await rateLimit(`laraoffertest:${c.id}`, 3600, 10);
  const { data: d } = await admin.from("lara_drafts").select("*").eq("id", params.id).eq("kind", "offer").maybeSingle();
  if (!d?.offer) throw new HttpError(404, "Offer not found");
  if (!w.admin && !(await canSeeOwner(c, d.owner_id))) throw forbidden("This lead is not in your leads");
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

// ---------------------------------------------------------------------------------------------
// phase 6: WhatsApp (Meta Cloud API)
// ---------------------------------------------------------------------------------------------
const WEBHOOK_URL = "https://iyubegbevtjcvtuubpaq.supabase.co/functions/v1/api/wa/webhook";
route("GET", "/lara/wa", async ({ c }) => {
  needAdmin(c);
  const w = await waCfg();
  const { data: tpl } = await admin.from("lara_wa_templates").select("*").order("name").limit(300);
  return { success: true, wa: { ...w, webhookUrl: WEBHOOK_URL, hasToken: await hasSecret("wa_token"), hasAppSecret: await hasSecret("wa_app_secret") }, templates: tpl || [], situations: Object.keys(RULE_LABEL) };
});
route("POST", "/lara/wa", async ({ req, c }) => { needAdmin(c); return { success: true, wa: { ...(await saveWa(await body(req, 4000), who(c))), webhookUrl: WEBHOOK_URL } }; });
route("POST", "/lara/wa/templates/sync", async ({ c }) => { needAdmin(c); return { success: true, ...(await syncTemplates()) }; });
route("POST", "/lara/wa/templates/link", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 1000);
  await admin.from("lara_wa_templates").update({ situation: str(b.situation, 40) || null }).eq("name", str(b.name, 120)).eq("lang", str(b.lang, 20));
  await log("config", who(c), `WhatsApp template ${b.name} (${b.lang}) linked to: ${b.situation || "nothing"}`);
  return { success: true };
});
/** a test message to one of the TEST numbers (Meta's own "hello_world" template works on every new number) */
route("POST", "/lara/wa/test", async ({ req, c }) => {
  needAdmin(c);
  await rateLimit(`lara-watest:${c.id}`, 3600, 10);
  const b = await body(req, 1000);
  const w = await waCfg();
  const to = intl(b.to);
  if (!to || !w.testNumbers.includes(to)) throw bad("Send tests only to a number in the test list");
  const id = await waSend(to, b.text ? { text: str(b.text, 500) } : { template: { name: str(b.template, 120) || "hello_world", lang: str(b.lang, 20) || "en_US", params: [] } });
  await log("config", who(c), `WhatsApp test message sent to a test number (${id.slice(-8)})`);
  return { success: true, id };
});

// Meta's webhook: GET = verification handshake, POST = messages and delivery statuses (signature checked with the app secret)
route("GET", "/wa/webhook", async ({ query }) => {
  const w = await waCfg();
  if (query.get("hub.mode") === "subscribe" && w.verifyToken && query.get("hub.verify_token") === w.verifyToken) return new Response(query.get("hub.challenge") || "", { status: 200, headers: { "Content-Type": "text/plain" } });
  return new Response("forbidden", { status: 403 });
}, { public: true });
route("POST", "/wa/webhook", async ({ req }) => {
  const raw = await req.text();
  if (raw.length > 500_000) return new Response("too large", { status: 413 });
  if (!(await waSignatureOk(raw, req.headers.get("x-hub-signature-256")))) return new Response("bad signature", { status: 401 });
  let j: any = {}; try { j = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  let n = 0;
  for (const e of j.entry || []) for (const ch of e.changes || []) {
    const v = ch.value || {};
    for (const st of v.statuses || []) { if (st.id) await admin.from("lara_messages").update({ wa_status: str(st.status, 20) }).eq("wa_id", st.id); }
    for (const m of v.messages || []) {
      const from = intl(m.from); if (!from || !m.id) continue;
      const text = str(m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || (m.type ? `[${m.type}]` : ""), 2000);
      const at = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : nowIso();
      const { data: seen } = await admin.from("lara_messages").select("id").eq("wa_id", m.id).maybeSingle();
      if (seen) continue;
      const base = { wa_id: m.id, direction: "in", channel: "whatsapp", subject: "", body: text, from_addr: from, to_addr: "whatsapp", at };
      const thread = await waThreadFor(from);
      if (!thread) { await admin.from("lara_messages").insert({ ...base, kind: "unmatched" }); continue; }
      n++;
      await handleReply(thread, base, "phone", text, replyHooks);
    }
  }
  if (n) await log("mail", "WhatsApp", `${n} WhatsApp message(s) from customers`);
  return new Response("ok", { status: 200 });
}, { public: true });
