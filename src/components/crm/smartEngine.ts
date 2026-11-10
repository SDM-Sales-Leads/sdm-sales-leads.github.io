// Smart Assistant engine (Phase 1 of docs/LARA-SALES-AI-PLAN.md). Pure functions, no React, no network.
// Everything is worked out in the browser from the leads already loaded and the Land Bank plot copy: no extra server calls, no AI cost.
// Every suggestion carries its reason in plain words. Missing data gives null ("—"), never an invented number.
import type { Lead } from './types';
import type { Plot } from '../../lib/plotsService';
import { canonicalParks } from '../../lib/parkAliases';
import { ACTIVE_EXCLUDE, PIPELINE_STATUSES, REQ_FOLLOWUP, normSource, phoneIntl } from './leadConfig';
import {
  DayTask, TeamDay, buildDayBoard, dayOf, daysBetween, fmtDay, isEngaged, isNeglected, median, offerAwaiting, teamDay, todayISO,
} from './leadMetrics';

const isOpen = (l: Lead) => !ACTIVE_EXCLUDE.includes(l.status) && !l.mergedInto && l.status !== 'Duplicate';
const hasEmail = (l: Lead) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(l.email || '').trim());
export const hasPhone = (l: Lead) => !!phoneIntl(l.phoneNumber);
const REAL = new Set(['Call', 'Email', 'Meeting', 'Visit', 'WhatsApp', 'SMS', 'Comment']);
const cairoHour = (ms: number) => Number(new Date(ms).toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Cairo' })) % 24;

// ---------------------------------------------------------------------------------------------
// plots that fit a customer (same rule as the lead card: park by alias, 0.7x .. 1.3x of the size asked)
// ---------------------------------------------------------------------------------------------
export interface PlotFit { count: number; park: string; best: Plot[]; from: number; to: number }
export function sizeRange(req: unknown): [number, number] | null {
  if (typeof req === 'number') return req > 0 ? [req, req] : null;
  const m = String(req ?? '').match(/\d[\d,]*(?:\.\d+)?/g);
  if (!m) return null;
  let a = parseFloat(m[0].replace(/,/g, '')); let b = m[1] ? parseFloat(m[1].replace(/,/g, '')) : a;
  if (!(a > 0) || !(b > 0)) return null;
  if (a > b) [a, b] = [b, a];
  return [a, b];
}
/** available plots grouped by park, built once per plot copy */
export function availableByPark(plots: Plot[]): Map<string, Plot[]> {
  const m = new Map<string, Plot[]>();
  for (const p of plots) {
    if (p.status !== 'available' || !(p.areaSqM > 0)) continue;
    const list = m.get(p.park) || []; list.push(p); m.set(p.park, list);
  }
  return m;
}
export function plotFit(l: Lead, byPark: Map<string, Plot[]>): PlotFit | null {
  const r = sizeRange(l.requiredSize);
  if (!r || !l.project) return null;
  const parks = canonicalParks(l.project);
  if (!parks.length) return null;
  const [lo, hi] = r; const mid = (lo + hi) / 2;
  const fit: Plot[] = [];
  for (const park of parks) for (const p of byPark.get(park) || []) if (p.areaSqM >= lo * 0.7 && p.areaSqM <= hi * 1.3) fit.push(p);
  if (!fit.length) return { count: 0, park: parks[0], best: [], from: lo, to: hi };
  fit.sort((a, b) => Math.abs(a.areaSqM - mid) - Math.abs(b.areaSqM - mid));
  return { count: fit.length, park: fit[0].park, best: fit.slice(0, 3), from: lo, to: hi };
}

// ---------------------------------------------------------------------------------------------
// 1. Next best action: My Day's single task per lead, turned into one clear move with the best channel
// ---------------------------------------------------------------------------------------------
export type Move = 'call' | 'whatsapp' | 'email' | 'confirm' | 'offer';
export interface NextAction { task: DayTask; move: Move; label: string; why: string; fit: PlotFit | null }
const MOVE_LABEL: Record<Move, string> = { call: 'Call now', whatsapp: 'Send WhatsApp', email: 'Send e-mail', confirm: 'Confirm the appointment', offer: 'Follow up the offer' };
const NO_ANSWER = ['No Answer – Sent WhatsApp', 'Out of Coverage – Sent WhatsApp', 'Sent WhatsApp', 'No Answer'];

function pickMove(t: DayTask): Move {
  const l = t.lead; const phone = hasPhone(l);
  if (t.kind === 'meeting') return 'confirm';
  if (t.kind === 'offer') return phone ? 'offer' : 'email';
  if (!phone) return hasEmail(l) ? 'email' : 'call';
  // three tries already went to WhatsApp with no answer: change channel
  if (NO_ANSWER.includes(l.status)) return hasEmail(l) ? 'email' : 'call';
  if (t.kind === 'cold') return 'whatsapp';
  return 'call';
}
export function nextActions(mine: Lead[], today: string, nowMs: number, rates: Map<string, number>, byPark: Map<string, Plot[]>, limit = 8): { list: NextAction[]; total: number; board: ReturnType<typeof buildDayBoard> } {
  const board = buildDayBoard(mine.filter((l) => !l.oldLead), today, nowMs, rates);
  const pool = [...board.callList, ...board.first.slice(0, 20), ...board.by.cold.slice(0, 10)];
  const seen = new Set<string>(); const list: NextAction[] = [];
  for (const t of pool.sort((a, b) => b.rank - a.rank)) {
    if (seen.has(t.lead.id)) continue; seen.add(t.lead.id);
    const move = pickMove(t);
    const fit = plotFit(t.lead, byPark);
    let why = t.why;
    if (NO_ANSWER.includes(t.lead.status) && move !== 'call') why += ' · WhatsApp got no answer, try another channel';
    list.push({ task: t, move, label: MOVE_LABEL[move], why, fit });
    if (list.length >= limit) break;
  }
  return { list, total: board.callList.length + board.first.length, board };
}

// ---------------------------------------------------------------------------------------------
// 4 + 5. Signals: what changed or needs attention, with the reason
// ---------------------------------------------------------------------------------------------
export type Tone = 'red' | 'amber' | 'green' | 'blue';
export interface Signal { id: string; tone: Tone; title: string; why: string; leadIds: string[] }
const lastTouch = (l: Lead) => dayOf(l.lastContactDate) || dayOf(l.firstContactAt);
const STATUS_TL = 'Status Change';

export function signals(mine: Lead[], plots: Plot[], byPark: Map<string, Plot[]>, today: string, nowMs: number): Signal[] {
  const out: Signal[] = [];
  const byKey = new Map(plots.map((p) => [p.key, p]));
  const offerSilent: Lead[] = []; const gone: { l: Lead; units: string[] }[] = []; const fits: Lead[] = []; const neg: Lead[] = []; const moving: Lead[] = []; const neglected: Lead[] = [];
  let fitPlots = 0;
  for (const l of mine) {
    if (!isOpen(l) || l.oldLead) continue;
    const gap = lastTouch(l) ? daysBetween(lastTouch(l), today) : NaN;
    if (offerAwaiting(l) && Number.isFinite(gap) && gap >= 3) offerSilent.push(l);
    if (l.status === 'Negotiation' && Number.isFinite(gap) && gap >= 7) neg.push(l);
    if (isNeglected(l, nowMs)) neglected.push(l);
    const units = (l.assignedPlots || []).filter((a) => { const p = byKey.get(a.key); return p && p.status !== 'available'; }).map((a) => `${a.unit} (${byKey.get(a.key)!.status})`);
    if (units.length) gone.push({ l, units });
    if (isEngaged(l) && !(l.assignedPlots || []).length) { const f = plotFit(l, byPark); if (f && f.count > 0) { fits.push(l); fitPlots += f.count; } }
    const tl = l.timeline || [];
    for (let i = tl.length - 1; i >= 0 && i >= tl.length - 6; i--) {
      const e = tl[i];
      if (e.type === STATUS_TL && PIPELINE_STATUSES.some((s) => String(e.description || e.title || '').includes(s)) && nowMs - Date.parse(e.timestamp) < 3 * 864e5) { moving.push(l); break; }
    }
  }
  const ids = (a: Lead[]) => a.map((l) => l.id);
  if (neglected.length) out.push({ id: 'neglected', tone: 'red', title: `${neglected.length} lead${neglected.length > 1 ? 's' : ''} waiting more than 48 h for a first call`, why: 'The customer asked and nobody called yet. The first day decides most deals.', leadIds: ids(neglected) });
  if (offerSilent.length) out.push({ id: 'offer', tone: 'red', title: `${offerSilent.length} offer${offerSilent.length > 1 ? 's' : ''} sent, no follow-up for 3+ days`, why: 'An offer without a follow-up call is usually lost to a competitor.', leadIds: ids(offerSilent) });
  if (gone.length) out.push({ id: 'plotgone', tone: 'amber', title: `${gone.length} customer${gone.length > 1 ? 's' : ''} asked for a plot that is no longer available`, why: gone.slice(0, 3).map((g) => `${g.l.customerName || g.l.id}: ${g.units.join(', ')}`).join(' · ') + (gone.length > 3 ? ' …' : '') + '. Offer an alternative before they hear it elsewhere.', leadIds: gone.map((g) => g.l.id) });
  if (neg.length) out.push({ id: 'neg', tone: 'amber', title: `${neg.length} negotiation${neg.length > 1 ? 's' : ''} silent for 7+ days`, why: 'Deals in negotiation that go quiet need a call from you, not a message.', leadIds: ids(neg) });
  if (fits.length) out.push({ id: 'fits', tone: 'blue', title: `${fits.length} active customer${fits.length > 1 ? 's' : ''} have matching available plots`, why: `Land Bank has ${fitPlots} available plots that fit their park and size, and none is assigned to them yet. Assign plots on the lead card.`, leadIds: ids(fits) });
  if (moving.length) out.push({ id: 'moving', tone: 'green', title: `${moving.length} lead${moving.length > 1 ? 's' : ''} moved forward in the last 3 days`, why: 'Meeting, site visit, offer or negotiation. Keep the momentum: set the next step today.', leadIds: ids(moving) });
  return out;
}

// ---------------------------------------------------------------------------------------------
// 6. My week: the person's own activity, this week against last week
// ---------------------------------------------------------------------------------------------
export interface Week {
  actions: number; prevActions: number; byType: Record<string, number>; leadsWorked: number; prevLeadsWorked: number;
  firstContactMedianH: number | null; within24: number | null; firstMeasured: number;
  bestHour: number | null; activeDays: number;
  sources: { source: string; leads: number; won: number; rate: number }[];
}
export function myWeek(mine: Lead[], userName: string, nowMs: number): Week {
  const D = 864e5; const w0 = nowMs - 7 * D; const w1 = nowMs - 14 * D; const m0 = nowMs - 30 * D;
  const name = userName.trim().toLowerCase();
  let actions = 0, prevActions = 0; const byType: Record<string, number> = {};
  const worked = new Set<string>(); const prevWorked = new Set<string>(); const hours = new Array(24).fill(0); let hourN = 0; const days = new Set<string>();
  const waits: number[] = []; let in24 = 0;
  const src = new Map<string, { leads: number; won: number }>();
  for (const l of mine) {
    for (const e of l.timeline || []) {
      if (!REAL.has(e.type) && e.type !== STATUS_TL) continue;
      if (String(e.user || '').trim().toLowerCase() !== name) continue;
      const t = Date.parse(e.timestamp); if (!Number.isFinite(t)) continue;
      if (t >= w0) { actions++; byType[e.type] = (byType[e.type] || 0) + 1; worked.add(l.id); days.add(dayOf(e.timestamp)); }
      else if (t >= w1) { prevActions++; prevWorked.add(l.id); }
      if (t >= m0 && REAL.has(e.type)) { hours[cairoHour(t)]++; hourN++; }
    }
    if (!l.oldLead) {
      const a = Date.parse(l.assignedDate || l.date); const f = Date.parse(l.firstContactAt || '');
      if (Number.isFinite(a) && a >= m0 && Number.isFinite(f) && f >= a) { const h = (f - a) / 36e5; waits.push(h); if (h <= 24) in24++; }
      const k = normSource(l.source) || 'Not recorded';
      const s = src.get(k) || { leads: 0, won: 0 }; s.leads++; if (l.status === 'Won') s.won++; src.set(k, s);
    }
  }
  let best: number | null = null;
  if (hourN >= 10) { let mx = 0; hours.forEach((n, h) => { if (n > mx) { mx = n; best = h; } }); }
  const sources = [...src.entries()].filter(([, s]) => s.leads >= 5).map(([source, s]) => ({ source, ...s, rate: (s.won / s.leads) * 100 })).sort((a, b) => b.rate - a.rate || b.leads - a.leads).slice(0, 6);
  return {
    actions, prevActions, byType, leadsWorked: worked.size, prevLeadsWorked: prevWorked.size,
    firstContactMedianH: median(waits), within24: waits.length ? (in24 / waits.length) * 100 : null, firstMeasured: waits.length,
    bestHour: best, activeDays: days.size, sources,
  };
}

// ---------------------------------------------------------------------------------------------
// 7. Fix my data: small gaps that stop the system (and Lara later) from helping
// ---------------------------------------------------------------------------------------------
export interface Fix { id: string; title: string; why: string; leadIds: string[] }
export function dataFixes(mine: Lead[], today: string): Fix[] {
  const noSource: string[] = [], noDate: string[] = [], late: string[] = [], noProject: string[] = [], noEmail: string[] = [], noSize: string[] = [];
  const phones = new Map<string, string[]>();
  for (const l of mine) {
    if (!isOpen(l) || l.oldLead) continue;
    if (!normSource(l.source)) noSource.push(l.id);
    const n = dayOf(l.nextFollowUpDate);
    if (REQ_FOLLOWUP.includes(l.status) && !n) noDate.push(l.id);
    else if (isEngaged(l) && n && daysBetween(n, today) > 30) late.push(l.id);
    if (!canonicalParks(l.project || '').length) noProject.push(l.id);
    if (isEngaged(l) && !hasEmail(l)) noEmail.push(l.id);
    if (isEngaged(l) && !sizeRange(l.requiredSize)) noSize.push(l.id);
    const p = phoneIntl(l.phoneNumber); if (p) { const a = phones.get(p) || []; a.push(l.id); phones.set(p, a); }
  }
  const dups = [...phones.values()].filter((a) => a.length > 1).flat();
  const all: Fix[] = [
    { id: 'nodate', title: 'Waiting status but no follow-up date', why: 'These statuses need a date, or the lead never comes back to your list.', leadIds: noDate },
    { id: 'late', title: 'Follow-up date more than 30 days old', why: 'Move the date or close the lead (Lost with a reason). Old dates hide the leads that matter.', leadIds: late },
    { id: 'dup', title: 'Same phone on more than one of your leads', why: 'Merge them so the customer gets one story from us.', leadIds: dups },
    { id: 'nosize', title: 'Contacted, but the land size is missing', why: 'Without the size the system cannot match plots or prepare an offer.', leadIds: noSize },
    { id: 'noproject', title: 'No known project / park', why: 'Without the park the system cannot match plots from the Land Bank.', leadIds: noProject },
    { id: 'noemail', title: 'Contacted, but no e-mail address', why: 'Ask for it on the next call: offers and e-mail follow-ups need it.', leadIds: noEmail },
    { id: 'nosource', title: 'Source not recorded', why: 'Marketing needs the source to know which campaigns bring deals.', leadIds: noSource },
  ];
  return all.filter((f) => f.leadIds.length);
}

// ---------------------------------------------------------------------------------------------
// 9. Tips: one line each, from the person's own leads and habits
// ---------------------------------------------------------------------------------------------
export interface Tip { id: string; text: string; go?: 'bulk' | 'offers' | 'myday' }
export function tips(mine: Lead[], week: Week, fixes: Fix[]): Tip[] {
  const out: Tip[] = [];
  const open = mine.filter((l) => isOpen(l) && !l.oldLead);
  const noAns = open.filter((l) => NO_ANSWER.includes(l.status)).length;
  if (noAns >= 10) out.push({ id: 'bulk', text: `${noAns} of your leads are on "No answer / Sent WhatsApp". Send one follow-up to all of them at once with Bulk message on the Leads page, then call the ones who reply.`, go: 'bulk' });
  if (week.firstContactMedianH != null && week.firstContactMedianH > 24) out.push({ id: 'speed', text: `Your new leads waited ${Math.round(week.firstContactMedianH)} h (median) for the first call in the last 30 days. Start the day with "Never contacted": the first hours decide most deals.`, go: 'myday' });
  if (week.bestHour != null) out.push({ id: 'hour', text: `Most of your logged calls and messages happen around ${String(week.bestHour).padStart(2, '0')}:00. Block that hour every day for new leads.` });
  const offers = open.filter((l) => offerAwaiting(l)).length;
  if (offers >= 3) out.push({ id: 'offers', text: `${offers} offers are waiting for your follow-up. The "Offers to follow" page lists them with the days since sending.`, go: 'offers' });
  const statusOnly = week.byType[STATUS_TL] || 0; const logged = week.actions - statusOnly;
  if (statusOnly >= 5 && logged < statusOnly / 3) out.push({ id: 'log', text: `This week you changed ${statusOnly} statuses but logged ${logged} calls or messages. Use the Call / WhatsApp buttons here: they log the action for you, so the system can remind you at the right time.` });
  if (week.sources.length >= 2 && week.sources[0].rate > 0) out.push({ id: 'src', text: `Your best source is ${week.sources[0].source} (${week.sources[0].rate.toFixed(0)}% won of ${week.sources[0].leads}). Give those leads your fastest response.` });
  const fixN = fixes.reduce((a, f) => a + f.leadIds.length, 0);
  if (fixN >= 20) out.push({ id: 'fix', text: `${fixN} small data gaps on your leads (see "Fix my data"). Ten minutes there makes every suggestion on this page better.` });
  return out;
}

// ---------------------------------------------------------------------------------------------
// 8. Team view (leaders, operations, admin): load, risk and a suggested rebalance (the server rules still decide)
// ---------------------------------------------------------------------------------------------
export interface TeamRow { id: string; name: string; open: number; overdue: number; neverContacted: number; neglected: number; noDate: number; risk: number }
export interface TeamInsight { day: TeamDay; rows: TeamRow[]; avgOpen: number | null; advice: string[] }
export function teamInsight(leads: Lead[], today: string, nowMs: number): TeamInsight {
  const day = teamDay(leads.filter((l) => !l.oldLead), today, nowMs);
  const neg = new Map<string, number>();
  for (const l of day.neglected) { const k = String(l.assignedSalespersonId || ''); neg.set(k, (neg.get(k) || 0) + 1); }
  const rows: TeamRow[] = day.reps.filter((r) => r.open > 0).map((r) => {
    const n = neg.get(r.id) || 0;
    return { id: r.id, name: r.name, open: r.open, overdue: r.overdue, neverContacted: r.neverContacted, neglected: n, noDate: r.noDate, risk: r.overdue + n * 2 };
  }).sort((a, b) => b.risk - a.risk);
  const avgOpen = rows.length ? rows.reduce((a, r) => a + r.open, 0) / rows.length : null;
  const advice: string[] = [];
  if (day.unassigned.length) advice.push(`${day.unassigned.length} open lead${day.unassigned.length > 1 ? 's have' : ' has'} no owner. Hand them out first (Leads > filter "No owner", or the pool).`);
  if (avgOpen != null && rows.length >= 2) {
    const light = [...rows].sort((a, b) => a.open - b.open)[0];
    for (const r of rows.slice(0, 3)) {
      if (r.neglected > 0 && r.open > avgOpen * 1.4 && light.id !== r.id) advice.push(`${r.name}: ${r.open} open leads (team average ${Math.round(avgOpen)}) and ${r.neglected} waiting over 48 h. Consider moving the never-contacted ones to ${light.name} (${light.open} open).`);
    }
  }
  if (day.vipOverdue.length) advice.push(`${day.vipOverdue.length} VIP lead${day.vipOverdue.length > 1 ? 's are' : ' is'} past the 4-hour first-call limit.`);
  return { day, rows, avgOpen, advice };
}

// ---------------------------------------------------------------------------------------------
// 3. Brief me (no AI): who, what they need, what happened last, what is next
// ---------------------------------------------------------------------------------------------
export interface Brief { who: string; need: string; last: { when: string; text: string }[]; next: string }
export function briefOf(l: Lead, fit: PlotFit | null): Brief {
  const who = [l.customerName, l.companyName, l.industry].filter(Boolean).join(' · ') || '—';
  const size = sizeRange(l.requiredSize);
  const need = [
    l.project ? `Park: ${l.project}` : 'Park not recorded',
    size ? `Size: ${size[0] === size[1] ? size[0].toLocaleString('en-US') : `${size[0].toLocaleString('en-US')}–${size[1].toLocaleString('en-US')}`} sqm` : 'Size not recorded',
    fit ? (fit.count ? `${fit.count} available plot${fit.count > 1 ? 's' : ''} fit in ${fit.park}` : `No available plot of that size in ${fit.park}`) : '',
  ].filter(Boolean).join(' · ');
  const tl = (l.timeline || []).filter((e) => REAL.has(e.type) || e.type === STATUS_TL).slice(-3).reverse();
  const last = tl.map((e) => ({ when: fmtDay(dayOf(e.timestamp)), text: `${e.type}: ${e.title || ''}${e.description && e.description !== e.title ? ` — ${String(e.description).slice(0, 140)}` : ''}` }));
  const nd = dayOf(l.nextFollowUpDate);
  const late = nd ? Math.round(daysBetween(nd, todayISO())) : 0;
  const next = nd ? `Next follow-up ${fmtDay(nd)}${l.nextFollowUpTime ? ' ' + l.nextFollowUpTime : ''}${late > 0 ? ` — ${late} day${late > 1 ? 's' : ''} late` : ''}` : 'No next step set';
  return { who, need, last, next };
}
