// deno-lint-ignore-file no-explicit-any
// Lara's workflow engine (phase 4). NO AI. Pure evaluation (trigger, conditions, stop rules) + the step runner.
// A lead is in at most one workflow at a time ("enrollment"). Each run: move due enrollments one step (or stop them), then enroll new leads
// by workflow priority. Messages are drafts (approve first); notifications go to the bell. Nothing changes the lead's own fields.
import { canonicalParks } from "../../../src/lib/parkAliases.ts";
import { graphOf, validateGraph, type Graph } from "../../../src/components/lara/flow/graph.ts";
export { graphOf, nextOf, stepsToGraph, BRANCHES, NODE_LABEL } from "../../../src/components/lara/flow/graph.ts";
export type { Graph, GNode } from "../../../src/components/lara/flow/graph.ts";

export type TriggerType = "no_first_contact" | "followup_overdue" | "offer_silent" | "no_answer" | "status_stuck" | "old_lead";
export interface Cond { field: string; op: string; value: any }
export interface Step { waitDays: number; action: "message" | "offer" | "notify_owner" | "notify_director" | "handover"; channel?: "auto" | "email" | "whatsapp"; situation?: string }
export interface Workflow {
  id: string; name: string; description?: string; enabled: boolean; priority: number;
  trigger: { type: TriggerType; value: number; statuses?: string[] };
  conditions: Cond[]; steps: Step[]; stop: { onActivity?: boolean; onReply?: boolean; onMeeting?: boolean };
  graph?: Graph | null; autopilot?: boolean;
}

export const TRIGGERS: Record<TriggerType, { label: string; unit: string }> = {
  no_first_contact: { label: "New lead has no first contact after", unit: "hours" },
  followup_overdue: { label: "Follow-up date passed by", unit: "days" },
  offer_silent: { label: "Offer sent and nothing logged for", unit: "days" },
  no_answer: { label: '"No answer / Sent WhatsApp" and no new try for', unit: "days" },
  status_stuck: { label: "Status unchanged for", unit: "days" },
  old_lead: { label: "Old imported lead, no contact for", unit: "days" },
};
export const NO_ANS = ["No Answer – Sent WhatsApp", "Out of Coverage – Sent WhatsApp", "Sent WhatsApp", "No Answer"];
const REAL = new Set(["Call", "Email", "Meeting", "Visit", "WhatsApp", "SMS", "Comment", "Status Change", "Offer"]);
const NOT_PERSON = new Set(["System", "Lara", ""]);
const d10 = (v: any) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");
const dayDiff = (a: string, b: string) => (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5;
export const hasEmail = (l: any) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(l.email || "").trim());
export const hasPhone = (l: any) => String(l.phoneNumber || "").replace(/\D/g, "").length >= 8;

/** when the status last changed (newest "Status Change" in the timeline we read), else when the lead was assigned / created */
function statusSince(l: any): number {
  const tl = Array.isArray(l.timeline) ? l.timeline : [];
  for (let i = tl.length - 1; i >= 0; i--) if (tl[i]?.type === "Status Change") { const t = Date.parse(tl[i].timestamp); if (t) return t; }
  return Date.parse(l.assignedDate || "") || Date.parse(l.date || "") || 0;
}

/** does the trigger fire for this lead? returns the reason in plain words and a rank (bigger = more urgent) */
export function triggerHit(wf: Workflow, l: any, today: string, now: number): { why: string; rank: number } | null {
  const t = wf.trigger; const v = Number(t.value) || 0;
  const last = d10(l.lastContactDate) || d10(l.firstContactAt);
  const gap = last ? dayDiff(last, today) : null;
  const boost = (l.priority === "VIP" ? 300 : 0) + (l.channel === "Call Center" ? 200 : 0) + Math.min(100, (Number(l.dealValue) || 0) / 1e6);
  const isOld = l.oldLead === true || l.oldLead === "true";
  if (t.type !== "old_lead" && isOld) return null;
  switch (t.type) {
    case "no_first_contact": {
      if (!((l.status === "New" || l.status === "Assigned") && !l.firstContactAt)) return null;
      const start = Math.max(Date.parse(l.assignedDate || "") || 0, Date.parse(l.date || "") || 0);
      const h = start ? (now - start) / 36e5 : 0;
      return h >= v ? { why: `New lead, no first contact for ${Math.floor(h)} h`, rank: 500 + boost + Math.min(h, 240) / 4 } : null;
    }
    case "offer_silent":
      return l.offerSent && gap != null && gap >= v ? { why: `Offer sent, nothing logged for ${gap} days`, rank: 700 + boost + gap } : null;
    case "no_answer":
      return NO_ANS.includes(l.status) && (gap == null || gap >= v) ? { why: `"${l.status}"${gap != null ? `, last try ${gap} days ago` : ""}`, rank: 300 + boost + (gap || 0) } : null;
    case "followup_overdue": {
      const fu = d10(l.nextFollowUpDate); if (!fu) return null;
      const n = dayDiff(fu, today);
      return n >= v ? { why: `Follow-up was due ${fu} (${n} days ago)`, rank: 400 + boost + Math.min(n, 60) } : null;
    }
    case "status_stuck": {
      const list = Array.isArray(t.statuses) && t.statuses.length ? t.statuses : ["Negotiation"];
      if (!list.includes(l.status)) return null;
      const since = statusSince(l); if (!since) return null;
      const days = Math.floor((now - since) / 864e5);
      return days >= v ? { why: `"${l.status}" unchanged for ${days} days`, rank: 600 + boost + days } : null;
    }
    case "old_lead":
      return isOld && (gap == null || gap >= v) ? { why: `Old lead${gap != null ? `, no contact for ${gap} days` : ", never contacted"}`, rank: 50 + boost } : null;
  }
  return null;
}

/** one If box: true/false for this lead (replied = the customer wrote since the lead entered the workflow) */
export function condOne(c: Cond, l: any, now: number, replied: boolean): boolean {
  if (c.field === "replied") return replied === (c.value !== false && c.value !== "false");
  return condsOk({ conditions: [c] } as any, l, now);
}

export function condsOk(wf: Workflow, l: any, now: number): boolean {
  for (const c of wf.conditions || []) {
    const vals: string[] = (Array.isArray(c.value) ? c.value : String(c.value ?? "").split(",")).map((x: any) => String(x).trim().toLowerCase()).filter(Boolean);
    const inList = (x: string) => vals.includes(String(x || "").trim().toLowerCase());
    let ok = true;
    switch (c.field) {
      case "source": ok = inList(l.source); break;
      case "channel": ok = inList(l.channel); break;
      case "status": ok = inList(l.status); break;
      case "priority": ok = inList(l.priority); break;
      case "owner": ok = inList(l.assignedSalespersonName); break;
      case "park": ok = canonicalParks(l.project || "").some((p) => inList(p)); break;
      case "hasEmail": ok = hasEmail(l) === (c.value === true || c.value === "true"); break;
      case "hasPhone": ok = hasPhone(l) === (c.value === true || c.value === "true"); break;
      case "leadAgeDays": { const age = (now - (Date.parse(l.date || "") || now)) / 864e5; ok = c.op === "lte" ? age <= Number(c.value) : age >= Number(c.value); break; }
      case "dealValue": ok = (Number(l.dealValue) || 0) >= Number(c.value); break;
      default: ok = true;
    }
    if (c.op === "notin" && ["source", "channel", "status", "priority", "owner", "park"].includes(c.field)) ok = !ok;
    if (!ok) return false;
  }
  return true;
}

/** should a running enrollment stop? (the reason, or '' to continue) */
export function stopReason(wf: Workflow, l: any | undefined, startedAt: number, today: string, threadLastIn: number, threadStatus: string, optedOut: boolean): string {
  if (!l) return "Lead closed, deleted or no longer open";
  if (optedOut) return "Customer is on the do-not-contact list";
  if (threadStatus && threadStatus !== "open") return `Conversation is ${threadStatus}`;
  const s = wf.stop || {};
  if (s.onReply !== false && threadLastIn > startedAt) return "Customer replied";
  if (s.onMeeting !== false && d10(l.meetingDate) && d10(l.meetingDate) >= today) return "A meeting is planned";
  if (s.onActivity !== false) {
    const lc = Date.parse(l.lastContactDate || "") || 0; const fc = Date.parse(l.firstContactAt || "") || 0;
    if (lc > startedAt || fc > startedAt) return "The salesperson contacted the customer";
    for (const e of Array.isArray(l.timeline) ? l.timeline : []) {
      if (REAL.has(e?.type) && !NOT_PERSON.has(String(e?.user || "")) && (Date.parse(e?.timestamp) || 0) > startedAt) return "The salesperson worked on the lead";
    }
  }
  return "";
}

/** checks a workflow before it is saved; returns the problem or '' (the drawing is checked box by box) */
export function validateWorkflow(w: any): string {
  if (!w || typeof w !== "object") return "Nothing to save";
  if (!String(w.name || "").trim()) return "Give the workflow a name";
  if (!w.trigger || !(w.trigger.type in TRIGGERS)) return "Choose when the workflow starts";
  if (!(Number(w.trigger.value) >= 0)) return "The start value must be a number";
  if (!Array.isArray(w.conditions) || w.conditions.length > 10) return "At most 10 filters on the Start box";
  const p = validateGraph(graphOf(w));
  return p.length ? p[0].text : "";
}
