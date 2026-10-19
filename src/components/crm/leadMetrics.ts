import { cairoDateISO } from '../../lib/cairoTime';
// Pure calculations for My Day, the dashboard and the reports. No React, no network.
// Every number is derived from the lead rows only; when data is missing the result is null (shown as "—"), never a made-up value.
// Formulas follow the sales team's previous CRM (migration/oldcrm/spec_A.md sections 4.8 and 5, spec_D.md sections 1-3).
import type { Lead } from './types';
import {
  ACTIVE_EXCLUDE, PIPELINE_STATUSES, channelOf, closingDate, isMarketingSource, leadScore, normProject, normSource, phoneIntl, statusStage,
} from './leadConfig';

// ---------------------------------------------------------------------------------------------
// dates (local calendar: toISOString() is UTC and shifts the day in Egypt)
// ---------------------------------------------------------------------------------------------
const pad2 = (n: number) => String(n).padStart(2, '0');
export const localISO = (d: Date) => cairoDateISO(d);
export const todayISO = () => localISO(new Date());
/** 'YYYY-MM-DD' stays; a timestamp becomes its local calendar day; '' when missing or invalid */
export const dayOf = (v?: string | null): string => {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : localISO(d);
};
const utcDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) / 864e5; };
/** whole days from a to b (both 'YYYY-MM-DD'); NaN when either is invalid */
export const daysBetween = (a: string, b: string) => (a && b ? utcDay(b) - utcDay(a) : NaN);
export const addDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return localISO(new Date(y, (m || 1) - 1, (d || 1) + n));
};
export const msOf = (v?: string | null): number => { if (!v) return NaN; const t = new Date(v).getTime(); return t; };
export const fmtDay = (iso: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtEGP = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `EGP ${(n / 1e9).toFixed(2)} B`;
  if (a >= 1e6) return `EGP ${(n / 1e6).toFixed(1)} M`;
  if (a >= 1e3) return `EGP ${Math.round(n).toLocaleString('en-US')}`;
  return `EGP ${Math.round(n)}`;
};
export const pc = (n: number, d: number): number | null => (d > 0 ? (n / d) * 100 : null);
export const fmtPct = (v: number | null | undefined, dp = 0): string => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(dp)}%`);

// ---------------------------------------------------------------------------------------------
// who sees what (the server decides; this only picks the screen)
// ---------------------------------------------------------------------------------------------
export type CrmScopeKind = 'all' | 'team' | 'finance' | 'own';
export function crmScopeOf(user: { role?: string } | null | undefined, perms: { canViewSalesRules?: boolean; canConfirmCash?: boolean } | null | undefined): CrmScopeKind {
  const r = (user?.role || '').toLowerCase();
  if (r.includes('admin') || r === 'sales operation' || r.includes('operation') || perms?.canViewSalesRules) return 'all';
  if (r.includes('leader')) return 'team';
  if (perms?.canConfirmCash) return 'finance';
  return 'own';
}
export const isManagerScope = (s: CrmScopeKind) => s === 'all' || s === 'team';

// ---------------------------------------------------------------------------------------------
// SLA rules (spec_A 4.8). There is no setting page for these yet, so they are fixed constants.
// ---------------------------------------------------------------------------------------------
export const VIP_SLA_HOURS = 4;
export const NEGLECT_HOURS = 48;
export const CONTRACT_REMIND_DAYS = 30;
const isOpen = (l: Lead) => !ACTIVE_EXCLUDE.includes(l.status);
const isMerged = (l: Lead) => !!l.mergedInto || l.status === 'Duplicate';
const ownerOf = (l: Lead) => String(l.assignedSalespersonId || '');
/** the moment the first-contact clock starts: assigned date, else the lead date at 09:00 */
export const slaBaseMs = (l: Lead): number => {
  const a = msOf(l.assignedDate);
  if (Number.isFinite(a)) return a;
  const d = dayOf(l.date);
  return d ? new Date(`${d}T09:00:00`).getTime() : NaN;
};
/** hours the owner has had this lead without a first contact (null when not applicable) */
export const waitingHours = (l: Lead, nowMs: number): number | null => {
  if (!ownerOf(l) || l.firstContactAt || !isOpen(l)) return null;
  const b = slaBaseMs(l);
  return Number.isFinite(b) ? Math.max(0, (nowMs - b) / 36e5) : null;
};
export const isVipBreach = (l: Lead, nowMs: number) => l.priority === 'VIP' && (waitingHours(l, nowMs) ?? -1) > VIP_SLA_HOURS;
export const isNeglected = (l: Lead, nowMs: number) => (waitingHours(l, nowMs) ?? -1) > NEGLECT_HOURS;

// ---------------------------------------------------------------------------------------------
// MY DAY priority engine (spec_A section 5)
// ---------------------------------------------------------------------------------------------
export type TaskKind = 'meeting' | 'offer' | 'overdue' | 'followup' | 'owe' | 'risk' | 'first' | 'cold' | 'later';
export interface DayTask {
  lead: Lead;
  kind: TaskKind;
  level: 0 | 1 | 2 | 3;
  why: string;
  when?: string;
  rank: number;
  gap: number | null;
  sla: 'vip' | 'neglect' | null;
  waitH: number | null;
}
export const DAY_LEVEL = ['P0 — must do', 'P1 — high', 'P2 — should do', 'P3 — backlog'];
/** statuses where the next move is ours (the client is waiting for us) */
const WE_OWE = ['Call Back', 'Mail Sent', 'Offer Sent – Following Up', 'Scheduled Meeting', 'Site Visit Scheduled', 'Meeting Scheduled', 'Quotation Sent'];
const REAL_EVENTS = ['Call', 'Email', 'Meeting', 'Visit', 'WhatsApp', 'SMS', 'Comment'];

/** has anybody really worked this lead? (false = "never contacted", goes to the call-first queue) */
export function isEngaged(l: Lead): boolean {
  if (l.firstContactAt || l.lastContactDate || l.offerSent || l.meetingDate) return true;
  // the team's vocabulary: any status other than New means the owner has touched it
  if (l.status && l.status !== 'New' && l.status !== 'Assigned') return true;
  const tl = l.timeline;
  if (tl && tl.length) for (let i = 0; i < tl.length; i++) if (REAL_EVENTS.includes(tl[i].type)) return true;
  return false;
}
/** an offer was sent and the lead is still open */
export const offerAwaiting = (l: Lead) => isOpen(l) && (l.status === 'Offer Sent – Following Up' || !!l.offerSent);

const lastTouchDay = (l: Lead) => dayOf(l.lastContactDate) || dayOf(l.firstContactAt);
const slot = (l: Lead) => (l.meetingTime ? ` at ${l.meetingTime}` : '');

/** the single task of one lead for today, or null when it is not workable */
export function dayTask(l: Lead, today: string, nowMs: number, rates?: Map<string, number>): DayTask | null {
  if (isMerged(l) || !isOpen(l)) return null;
  const engaged = isEngaged(l);
  const touch = lastTouchDay(l);
  const gap = touch ? Math.max(0, Math.floor(daysBetween(touch, today))) : null;
  const waitH = waitingHours(l, nowMs);
  const sla: DayTask['sla'] = isVipBreach(l, nowMs) ? 'vip' : isNeglected(l, nowMs) ? 'neglect' : null;
  let next = dayOf(l.nextFollowUpDate);
  let offerDriven = false;
  if (offerAwaiting(l)) {
    const od = dayOf(l.offerDueDate);
    if (od && (!next || od < next)) { next = od; offerDriven = true; }
  }
  const value = Number(l.dealValue) || 0;
  const land = Math.max(Number(l.requiredSize) || 0, Number(l.soldArea) || 0);
  const hot = l.qualification === 'Qualified' && l.temperature === 'Hot';

  let kind: TaskKind; let level: 0 | 1 | 2 | 3; let why: string; let when: string | undefined;
  const meet = dayOf(l.meetingDate);
  if (meet === today) {
    kind = 'meeting'; level = 0; when = l.meetingTime || undefined;
    why = l.status === 'Site Visit Scheduled' ? `Site visit today${slot(l)}` : l.status === 'Call Back' ? `Call back today${slot(l)}` : `Meeting today${slot(l)}`;
  } else if (engaged && next && next < today) {
    const n = Math.round(daysBetween(next, today));
    kind = offerDriven ? 'offer' : 'overdue'; level = 0;
    const what = offerDriven ? 'Offer follow-up' : 'Follow-up';
    why = n === 1 ? `${what} was due yesterday` : `${what} was due ${fmtDay(next)} — ${n} days ago`;
  } else if (engaged && next === today) {
    kind = offerDriven ? 'offer' : 'followup'; level = 0;
    why = offerDriven ? 'Offer follow-up due today' : 'Follow-up scheduled for today';
  } else if (engaged && WE_OWE.includes(l.status)) {
    kind = 'owe'; level = 1;
    why = l.status === 'Call Back' ? 'They asked us to call back'
      : l.status === 'Mail Sent' ? 'We sent them something — no reply yet'
      : l.status === 'Offer Sent – Following Up' && gap != null ? `Offer sent ${gap} days ago`
      : 'We owe them the next step';
  } else if (engaged && (hot || value >= 2e7 || land >= 2e4) && gap != null && gap >= 5) {
    kind = 'risk'; level = 1; why = `${hot ? 'Hot opportunity' : value >= 2e7 ? 'High-value opportunity' : 'Large-area opportunity'} — nothing for ${gap} days`;
  } else if (!engaged) {
    kind = 'first'; level = 2;
    const d = dayOf(l.assignedDate) || dayOf(l.date);
    why = `New lead — never contacted, ${d ? `added ${fmtDay(d)}` : 'date not recorded'}`;
  } else if (gap != null && gap >= 10) {
    kind = 'cold'; level = 3; why = `Going cold — nothing for ${gap} days`;
  } else {
    kind = 'later'; level = 3; why = next ? `Next follow-up ${fmtDay(next)}` : 'No next step set';
  }

  // an owner who has not made the first call yet: the SLA clocks lift the lead inside its own queue
  if (kind === 'first' && sla === 'vip') why = `VIP — first call overdue (${Math.floor(waitH ?? 0)} h since assigned, limit ${VIP_SLA_HOURS} h)`;
  else if (kind === 'first' && sla === 'neglect') why = `Neglected — ${Math.floor(waitH ?? 0)} h without a first call (limit ${NEGLECT_HOURS} h)`;

  const daysOver = kind === 'overdue' || kind === 'offer' ? Math.min(30, Math.max(0, Math.floor(daysBetween(next, today)))) : 0;
  const srcRate = rates?.get(normSource(l.source)) ?? 0;
  let rank = (4 - level) * 1000;
  if (kind === 'meeting') rank += 500;
  if (daysOver >= 0 && (kind === 'overdue' || kind === 'offer')) rank += 300 + daysOver * 4;
  rank += Math.min(value / 1e6, 60);
  rank += leadScore(l, srcRate, new Date(nowMs)) / 4;
  if (l.priority === 'VIP') rank += 40;
  if (sla === 'vip') rank += 400; else if (sla === 'neglect') rank += 150;
  // a call center lead is somebody who phoned us and waits for a call back: first of the day, above everything else
  if (kind === 'first') {
    const cc = ccState(l, nowMs);
    if (cc) { why = cc.overdue ? `Call center lead: LATE ${ccLeft(cc.leftMs)}, call now` : `Call center lead: call back within 24 h (${ccLeft(cc.leftMs)} left)`; rank += 3500; }
  }
  return { lead: l, kind, level, why, when, rank, gap, sla, waitH };
}

/** win rate of every source that has at least 5 leads (a ranking aid; one pass over all leads) */
export function sourceWinRates(leads: Lead[]): Map<string, number> {
  const tot = new Map<string, number>(); const won = new Map<string, number>();
  for (const l of leads) {
    if (isMerged(l)) continue;
    const k = normSource(l.source);
    tot.set(k, (tot.get(k) || 0) + 1);
    if (l.status === 'Won') won.set(k, (won.get(k) || 0) + 1);
  }
  const out = new Map<string, number>();
  tot.forEach((t, k) => { if (t >= 5) out.set(k, (won.get(k) || 0) / t); });
  return out;
}

export interface DayBoard {
  tasks: DayTask[];                       // every workable lead, best first
  callList: DayTask[];                    // P0 and P1 (meetings, offers, overdue, due today, we-owe, at-risk)
  first: DayTask[];                       // never contacted, best first (the "call first" queue = first N)
  by: Record<TaskKind, DayTask[]>;
  doneToday: number;                      // leads of the owner touched today (any status)
  wonPendingAR: Lead[];                   // Won, cash not confirmed by accounts receivable
  contractDue: { lead: Lead; since: string; days: number }[]; // reserved or won, no contract date yet
}
export function buildDayBoard(mine: Lead[], today: string, nowMs: number, rates?: Map<string, number>): DayBoard {
  const tasks: DayTask[] = [];
  const by: Record<TaskKind, DayTask[]> = { meeting: [], offer: [], overdue: [], followup: [], owe: [], risk: [], first: [], cold: [], later: [] };
  let doneToday = 0;
  const wonPendingAR: Lead[] = [];
  const contractDue: DayBoard['contractDue'] = [];
  for (const l of mine) {
    if (isMerged(l)) continue;
    if (dayOf(l.lastContactDate) === today) doneToday++;
    if (l.status === 'Won') {
      if (l.cashStatus !== 'confirmed') wonPendingAR.push(l);
    }
    if ((l.status === 'Won' || l.reservationDate) && !l.contractDate && l.contract?.status !== 'Signed' && !l.contract?.signedAt && l.status !== 'Lost') {
      const since = l.reservationDate || closingDate(l);
      contractDue.push({ lead: l, since, days: since ? Math.max(0, Math.round(daysBetween(since, today))) : 0 });
    }
    const t = dayTask(l, today, nowMs, rates);
    if (t) { tasks.push(t); by[t.kind].push(t); }
  }
  const sort = (a: DayTask, b: DayTask) => b.rank - a.rank;
  tasks.sort(sort);
  (Object.keys(by) as TaskKind[]).forEach((k) => by[k].sort(sort));
  contractDue.sort((a, b) => b.days - a.days);
  return { tasks, callList: tasks.filter((t) => t.level <= 1), first: by.first, by, doneToday, wonPendingAR, contractDue };
}

// ---------------------------------------------------------------------------------------------
// Team Day (managers): one pass over the leads in scope
// ---------------------------------------------------------------------------------------------
export interface RepLoad { id: string; name: string; open: number; overdue: number; dueToday: number; noDate: number; offers: number; neverContacted: number }
export interface TeamDay {
  newToday: Lead[];
  unassigned: Lead[];
  vipOverdue: Lead[];
  neglected: Lead[];
  wonAwaitingAR: Lead[];
  cashConfirmed: number;
  overdue: number;
  dueToday: number;
  reps: RepLoad[];
}
export function teamDay(leads: Lead[], today: string, nowMs: number): TeamDay {
  const out: TeamDay = { newToday: [], unassigned: [], vipOverdue: [], neglected: [], wonAwaitingAR: [], cashConfirmed: 0, overdue: 0, dueToday: 0, reps: [] };
  const reps = new Map<string, RepLoad>();
  for (const l of leads) {
    if (isMerged(l)) continue;
    if (dayOf(l.date) === today) out.newToday.push(l);
    if (l.status === 'Won') { if (l.cashStatus === 'confirmed') out.cashConfirmed++; else out.wonAwaitingAR.push(l); }
    const own = ownerOf(l);
    let r: RepLoad | undefined;
    if (own) {
      r = reps.get(own);
      if (!r) { r = { id: own, name: l.assignedSalespersonName || own, open: 0, overdue: 0, dueToday: 0, noDate: 0, offers: 0, neverContacted: 0 }; reps.set(own, r); }
      if (l.offerSent) r.offers++;
    }
    if (!isOpen(l)) continue;
    if (!own) { out.unassigned.push(l); continue; }
    r!.open++;
    const n = dayOf(l.nextFollowUpDate);
    if (!n) r!.noDate++; else if (n < today) { r!.overdue++; out.overdue++; } else if (n === today) { r!.dueToday++; out.dueToday++; }
    if (!isEngaged(l)) r!.neverContacted++;
    if (isVipBreach(l, nowMs)) out.vipOverdue.push(l);
    if (isNeglected(l, nowMs)) out.neglected.push(l);
  }
  out.reps = [...reps.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  return out;
}

// ---------------------------------------------------------------------------------------------
// ANALYTICS ENGINE (spec_D section 1)
// ---------------------------------------------------------------------------------------------
export type Period = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom';
export interface Range { from: string; to: string; label: string }
export function periodRange(period: Period, from = '', to = '', now = new Date()): Range {
  const y = now.getFullYear(); const m = now.getMonth(); const t = localISO(now);
  switch (period) {
    case 'today': return { from: t, to: t, label: 'Today' };
    case 'week': { const s = new Date(now); s.setDate(s.getDate() - s.getDay()); const e = new Date(s); e.setDate(e.getDate() + 6); return { from: localISO(s), to: localISO(e), label: 'This week' }; }
    case 'month': return { from: localISO(new Date(y, m, 1)), to: localISO(new Date(y, m + 1, 0)), label: now.toLocaleString('en-GB', { month: 'long', year: 'numeric' }) };
    case 'quarter': { const q = Math.floor(m / 3); return { from: localISO(new Date(y, q * 3, 1)), to: localISO(new Date(y, q * 3 + 3, 0)), label: `Q${q + 1} ${y}` }; }
    case 'year': return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
    case 'custom': { const f = from || t; const e = to || f; return f <= e ? { from: f, to: e, label: `${fmtDay(f)} → ${fmtDay(e)}` } : { from: e, to: f, label: `${fmtDay(e)} → ${fmtDay(f)}` }; }
    default: return { from: '2000-01-01', to: '2100-01-01', label: 'All time' };
  }
}
/** the window of the same length that ends the day before `r.from` (null for all time) */
export function prevRange(r: Range, period: Period): Range | null {
  if (period === 'all') return null;
  const len = Math.round(daysBetween(r.from, r.to)) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1), label: 'previous period' };
}

/** funnel level reached: 0 none, 1 contacted, 2 qualified, 3 opportunity, 4 negotiation, 5 won */
export const STAGE_NAMES = ['Not contacted', 'Contacted', 'Qualified', 'Opportunity', 'Negotiation', 'Won'];
export const STAGE_WEIGHT = [0, 0.05, 0.15, 0.35, 0.6, 0];
const OFFER_STATUSES = ['Offer Sent – Following Up', 'Scheduled Meeting', 'Site Visit Scheduled', 'Meeting Scheduled', 'Quotation Sent'];

export interface P {
  l: Lead; id: string; created: string; closing: string; level: number;
  won: boolean; lost: boolean; open: boolean;
  value: number; area: number; owner: string; ownerName: string; source: string; project: string; reason: string;
  createdMs: number; firstMs: number; assignedMs: number; cycle: number | null; marketing: boolean;
}
/** one pass over the leads; everything later works on this list (so a filter change costs O(n), never O(n^2)) */
export function prepare(leads: Lead[]): P[] {
  const out: P[] = [];
  for (const l of leads) {
    if (isMerged(l)) continue;
    const stage = statusStage(l.status);
    const won = l.status === 'Won';
    const lost = l.status === 'Lost' || l.status === 'Not Interested' || l.status === 'Low Budget';
    const negotiation = won || l.status === 'Negotiation' || !!l.contractDate;
    const opportunity = negotiation || !!l.offerSent || OFFER_STATUSES.includes(l.status) || !!l.meetingDate;
    const qualified = opportunity || l.qualification === 'Qualified';
    const contacted = qualified || !!l.firstContactAt || (!!l.status && l.status !== 'New' && l.status !== 'Assigned');
    const level = won ? 5 : negotiation ? 4 : opportunity ? 3 : qualified ? 2 : contacted ? 1 : 0;
    const created = dayOf(l.date);
    const closing = won ? dayOf(closingDate(l)) : '';
    const wonDay = dayOf(l.wonDate);
    const cyc = won && wonDay && created ? daysBetween(created, wonDay) : NaN;
    out.push({
      l, id: l.id, created, closing, level, won, lost,
      open: !won && !lost && stage !== 'closed',
      value: Number(l.dealValue) > 0 ? Number(l.dealValue) : 0,
      area: Number(l.soldArea) || 0,
      owner: ownerOf(l), ownerName: l.assignedSalespersonName || '',
      source: normSource(l.source) || 'Not recorded',
      project: normProject(l.project) || 'Not recorded',
      reason: l.status === 'Not Interested' || l.status === 'Low Budget' ? (l.lostReason || l.status) : (l.lostReason || l.lostCategory || 'Not recorded'),
      createdMs: created ? new Date(`${created}T00:00:00`).getTime() : NaN,
      firstMs: msOf(l.firstContactAt), assignedMs: msOf(l.assignedDate),
      cycle: Number.isFinite(cyc) && cyc >= 0 && cyc < 3650 ? cyc : null,
      marketing: isMarketingSource(l.source),
    });
  }
  return out;
}

export interface Filters { period: Period; from: string; to: string; owner: string; source: string }
export const DEFAULT_FILTERS: Filters = { period: 'all', from: '', to: '', owner: '', source: '' };
const inRange = (d: string, r: Range) => !!d && d >= r.from && d <= r.to;
/** period membership: created in the window, or won with its closing date in the window */
export function selectPool(all: P[], f: Filters, r: Range): P[] {
  const ar = f.period === 'all';
  return all.filter((p) => (!f.owner || p.owner === f.owner) && (!f.source || p.source === f.source) && (ar || inRange(p.created, r) || (p.won && inRange(p.closing, r))));
}

export interface Agg {
  total: number; contacted: number; qualified: number; opportunity: number; negotiation: number;
  won: number; lost: number; open: number;
  wonValue: number; wonArea: number; wonWithValue: number;
  pipelineValue: number; weightedValue: number; weightedCount: number; openWithValue: number;
  cashPending: number; cashPendingValue: number; cashConfirmed: number; cashConfirmedValue: number;
  cycles: number[];
}
export const emptyAgg = (): Agg => ({
  total: 0, contacted: 0, qualified: 0, opportunity: 0, negotiation: 0, won: 0, lost: 0, open: 0, wonValue: 0, wonArea: 0, wonWithValue: 0,
  pipelineValue: 0, weightedValue: 0, weightedCount: 0, openWithValue: 0, cashPending: 0, cashPendingValue: 0, cashConfirmed: 0, cashConfirmedValue: 0, cycles: [],
});
function addTo(a: Agg, p: P, r: Range, allTime: boolean) {
  a.total++;
  if (p.level >= 1) a.contacted++;
  if (p.level >= 2) a.qualified++;
  if (p.level >= 3) a.opportunity++;
  if (p.level >= 4) a.negotiation++;
  if (p.won && (allTime || inRange(p.closing, r))) {
    a.won++; a.wonValue += p.value; a.wonArea += p.area;
    if (p.value > 0) a.wonWithValue++;
    if (p.cycle != null) a.cycles.push(p.cycle);
    if (p.l.cashStatus === 'confirmed') { a.cashConfirmed++; a.cashConfirmedValue += p.value; } else { a.cashPending++; a.cashPendingValue += p.value; }
  }
  if (p.lost) a.lost++;
  if (p.open) {
    a.open++;
    a.weightedCount += STAGE_WEIGHT[p.level];
    if (p.value > 0) { a.pipelineValue += p.value; a.weightedValue += p.value * STAGE_WEIGHT[p.level]; a.openWithValue++; }
  }
}
export interface Breakdown { key: string; label: string; agg: Agg; lostValue: number }
export interface Analysis {
  total: Agg;
  byOwner: Breakdown[]; bySource: Breakdown[]; byProject: Breakdown[]; byReason: { key: string; count: number; value: number }[];
  byStage: number[];                      // open leads per funnel level (0..4)
  speed: Speed;
}
export interface Speed {
  measured: number; never: number; avgDays: number | null; medianDays: number | null;
  bands: { same: number; two: number; week: number; more: number };
  avgAssignHours: number | null; assignMeasured: number;
}
function speedOf(pool: P[]): Speed {
  const waits: number[] = []; const assign: number[] = [];
  let never = 0; const bands = { same: 0, two: 0, week: 0, more: 0 };
  for (const p of pool) {
    if (!p.createdMs) continue;
    if (Number.isFinite(p.firstMs) && Number.isFinite(p.createdMs)) {
      const w = Math.max(0, (p.firstMs - p.createdMs) / 864e5);
      if (w < 3650) {
        waits.push(w);
        if (w <= 1) bands.same++; else if (w <= 2) bands.two++; else if (w <= 7) bands.week++; else bands.more++;
      }
      if (Number.isFinite(p.assignedMs) && p.firstMs >= p.assignedMs) assign.push((p.firstMs - p.assignedMs) / 36e5);
    } else if (!p.won && p.owner) never++;
  }
  waits.sort((a, b) => a - b);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    measured: waits.length, never,
    avgDays: avg(waits), medianDays: waits.length ? waits[Math.floor(waits.length / 2)] : null,
    bands, avgAssignHours: avg(assign), assignMeasured: assign.length,
  };
}
export function analyse(pool: P[], r: Range, period: Period): Analysis {
  const allTime = period === 'all';
  const total = emptyAgg();
  const own = new Map<string, Breakdown>(); const src = new Map<string, Breakdown>(); const prj = new Map<string, Breakdown>();
  const reasons = new Map<string, { key: string; count: number; value: number }>();
  const byStage = [0, 0, 0, 0, 0];
  const get = (m: Map<string, Breakdown>, key: string, label: string) => { let b = m.get(key); if (!b) { b = { key, label, agg: emptyAgg(), lostValue: 0 }; m.set(key, b); } return b; };
  for (const p of pool) {
    addTo(total, p, r, allTime);
    if (p.owner) addTo(get(own, p.owner, p.ownerName || p.owner).agg, p, r, allTime);
    const bs = get(src, p.source, p.source); addTo(bs.agg, p, r, allTime);
    const bp = get(prj, p.project, p.project); addTo(bp.agg, p, r, allTime);
    if (p.open && p.level < 5) byStage[p.level]++;
    if (p.lost) {
      const e = reasons.get(p.reason) || { key: p.reason, count: 0, value: 0 };
      e.count++; e.value += p.value; reasons.set(p.reason, e);
      bs.lostValue += p.value; bp.lostValue += p.value;
    }
  }
  const arr = (m: Map<string, Breakdown>) => [...m.values()];
  return { total, byOwner: arr(own), bySource: arr(src), byProject: arr(prj), byReason: [...reasons.values()].sort((a, b) => b.count - a.count), byStage, speed: speedOf(pool) };
}

export interface Rates { reached: number | null; qualify: number | null; offer: number | null; negotiate: number | null; close: number | null; win: number | null; winAll: number | null; loss: number | null; decided: number | null; open: number | null }
/** the denominators matter: each rate says what it is measured against */
export const repRates = (a: Agg): Rates => ({
  reached: pc(a.contacted, a.total), qualify: pc(a.qualified, a.contacted), offer: pc(a.opportunity, a.qualified),
  negotiate: pc(a.negotiation, a.opportunity), close: pc(a.won, a.negotiation), win: pc(a.won, a.contacted),
  winAll: pc(a.won, a.total), loss: pc(a.lost, a.contacted), decided: pc(a.won + a.lost, a.total), open: pc(a.open, a.total),
});
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
/** change against the previous period, null when there is nothing to compare */
export const deltaPct = (now: number | null, prev: number | null): number | null => {
  if (now == null || prev == null) return null;
  if (prev === 0) return now > 0 ? 100 : 0;
  return Math.round(((now - prev) / prev) * 100);
};

// ---- trend / monthly buckets ------------------------------------------------------------------
export interface Bucket { key: string; label: string; leads: number; reached: number; won: number; wonValue: number; lost: number }
export function buckets(pool: P[], r: Range, period: Period): { unit: 'day' | 'month'; rows: Bucket[] } {
  let from = r.from; let to = r.to;
  if (period === 'all') {
    let mn = ''; let mx = '';
    for (const p of pool) for (const d of [p.created, p.closing]) if (d) { if (!mn || d < mn) mn = d; if (!mx || d > mx) mx = d; }
    if (!mn) return { unit: 'month', rows: [] };
    from = mn; to = mx;
  }
  const t = todayISO();
  if (to > t && period === 'all') to = t;
  const span = Math.round(daysBetween(from, to)) + 1;
  const unit: 'day' | 'month' = span <= 92 ? 'day' : 'month';
  const keyOf = (d: string) => (unit === 'day' ? d : d.slice(0, 7));
  const map = new Map<string, Bucket>();
  const mk = (key: string) => ({ key, label: unit === 'day' ? `${key.slice(8)}/${key.slice(5, 7)}` : new Date(`${key}-01T00:00:00`).toLocaleString('en-GB', { month: 'short', year: '2-digit' }), leads: 0, reached: 0, won: 0, wonValue: 0, lost: 0 });
  // seed so empty days / months still show on the axis
  if (unit === 'day') { for (let d = from, i = 0; d <= to && i < 100; d = addDays(d, 1), i++) map.set(d, mk(d)); }
  else { let y = Number(from.slice(0, 4)); let m = Number(from.slice(5, 7)); const ey = Number(to.slice(0, 4)); const em = Number(to.slice(5, 7)); for (let i = 0; i < 240 && (y < ey || (y === ey && m <= em)); i++) { const k = `${y}-${pad2(m)}`; map.set(k, mk(k)); m++; if (m > 12) { m = 1; y++; } } }
  const bucket = (d: string) => { const k = keyOf(d); return map.get(k); };
  for (const p of pool) {
    if (p.created && inRange(p.created, { from, to, label: '' })) { const b = bucket(p.created); if (b) { b.leads++; if (p.level >= 1) b.reached++; } }
    if (p.won && p.closing && inRange(p.closing, { from, to, label: '' })) { const b = bucket(p.closing); if (b) { b.won++; b.wonValue += p.value; } }
    else if (p.lost) { const d = p.created; if (d && inRange(d, { from, to, label: '' })) { const b = bucket(d); if (b) b.lost++; } }
  }
  return { unit, rows: [...map.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}

// ---- record quality (spec_D 3.1 "Record quality") ----------------------------------------------
export interface HealthRow { key: string; label: string; pct: number | null; n: number; of: number; good: number; ok: number; note: string }
export function dataHealth(all: P[], today: string): { rows: HealthRow[]; score: number | null } {
  let phone = 0, src = 0, company = 0, project = 0, nat = 0, openN = 0, next = 0, onTime = 0, touched = 0;
  const cutoff = addDays(today, -14);
  for (const p of all) {
    const l = p.l;
    if (phoneIntl(l.phoneNumber)) phone++;
    if (p.source !== 'Not recorded') src++;
    if (l.companyName && l.companyName.trim()) company++;
    if (p.project !== 'Not recorded') project++;
    if (l.nationality && l.nationality.trim()) nat++;
    if (p.open) {
      openN++;
      const n = dayOf(l.nextFollowUpDate);
      if (n) next++;
      if (!n || n >= today) onTime++;
      const t = dayOf(l.lastContactDate) || dayOf(l.firstContactAt) || p.created;
      if (t && t >= cutoff) touched++;
    }
  }
  const T = all.length;
  const row = (key: string, label: string, n: number, of: number, good: number, ok: number, note: string): HealthRow => ({ key, label, n, of, pct: pc(n, of), good, ok, note });
  const rows = [
    row('phone', 'Usable phone number', phone, T, 95, 80, 'Phone that can be turned into an international number'),
    row('source', 'Source recorded', src, T, 90, 70, 'Source filled in (aliases are merged first)'),
    row('company', 'Company recorded', company, T, 80, 50, 'Company name filled in'),
    row('project', 'Project recorded', project, T, 85, 60, 'A real project name (website page names do not count)'),
    row('nat', 'Nationality recorded', nat, T, 70, 40, 'Nationality filled in'),
    row('next', 'Open leads with a next step', next, openN, 85, 60, 'Open leads that have a follow-up date'),
    row('ontime', 'Open leads on time', onTime, openN, 90, 70, 'Open leads with no date or a date that is not in the past'),
    row('touch', 'Open leads touched in 14 days', touched, openN, 80, 50, 'Last contact (or first contact, or lead date) within 14 days'),
  ];
  const vals = rows.map((r) => r.pct).filter((v): v is number => v != null);
  return { rows, score: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
}

/** funnel rows: count, % of all, % carried through from the previous stage, dropped */
export function funnelRows(a: Agg) {
  const steps = [
    { name: 'Leads received', n: a.total }, { name: 'Reached', n: a.contacted }, { name: 'Qualified', n: a.qualified },
    { name: 'Offer or meeting', n: a.opportunity }, { name: 'Negotiation', n: a.negotiation }, { name: 'Won', n: a.won },
  ];
  return steps.map((s, i) => ({ ...s, ofAll: pc(s.n, a.total), carried: i === 0 ? null : pc(s.n, steps[i - 1].n), dropped: i === 0 ? 0 : Math.max(0, steps[i - 1].n - s.n) }));
}

// ---------------------------------------------------------------------------------------------
// Call center leads must get a first contact within 24 hours. The clock starts when the lead has arrived AND has an owner
// (the later of the two). No contact by then = the team leader is alerted (server, scheduler). Same rule here, so the screen
// and the alert always agree.
// ---------------------------------------------------------------------------------------------
export const CC_HOURS = 24;
export interface CcState { leftMs: number; overdue: boolean; start: number }
export function ccState(l: Lead, nowMs: number): CcState | null {
  if (channelOf(l) !== 'Call Center' || !isOpen(l) || isMerged(l) || isEngaged(l)) return null;
  const start = Math.max(Date.parse(l.date) || 0, Date.parse(l.assignedDate || '') || 0);
  if (!start) return null;
  const leftMs = start + CC_HOURS * 3600_000 - nowMs;
  return { leftMs, overdue: leftMs < 0, start };
}
export const ccLeft = (ms: number) => { const a = Math.abs(ms), h = Math.floor(a / 3600_000), m = Math.floor((a % 3600_000) / 60_000); return `${h}h ${String(m).padStart(2, '0')}m`; };
