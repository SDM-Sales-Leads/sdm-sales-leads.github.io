// Calculations for the extra Sales Reports tabs and Team Performance. Pure functions, no React, one pass over the data each.
// Same rule as leadMetrics.ts: when something cannot be measured the value is null (shown as "—"), never an invented number.
import type { Lead, SalespersonActivity } from './types';
import { CHANNELS, NO_CHANNEL, channelOf, isTouchedLead, statusStage } from './leadConfig';
import {
  P, Range, STAGE_NAMES, STAGE_WEIGHT, addDays, dayOf, daysBetween, isEngaged, mean, median, msOf, pc,
} from './leadMetrics';

const inR = (d: string, r: Range) => !!d && d >= r.from && d <= r.to;
const clean = (s: string | undefined | null, empty = 'Not recorded') => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return t || empty; };
const nameKey = (s: string | undefined | null) => String(s ?? '').trim().toLowerCase();

// ---------------------------------------------------------------------------------------------
// Tally: the one set of counters every breakdown uses
// ---------------------------------------------------------------------------------------------
export interface Tally {
  leads: number; won: number; lost: number; open: number;
  wonValue: number; wonWithValue: number; wonArea: number; pipeline: number; openWithValue: number;
  /** ids behind the counters (only kept for breakdown rows, so a clicked number can open exactly those leads) */
  ids?: { leads: string[]; won: string[]; lost: string[]; open: string[] };
}
export const emptyTally = (withIds = false): Tally => ({ leads: 0, won: 0, lost: 0, open: 0, wonValue: 0, wonWithValue: 0, wonArea: 0, pipeline: 0, openWithValue: 0, ...(withIds ? { ids: { leads: [], won: [], lost: [], open: [] } } : {}) });
/** won counts only when its closing day is in the window (all time = always), exactly like the Sales Reports page */
export function tallyAdd(t: Tally, p: P, r: Range, allTime: boolean) {
  t.leads++; t.ids?.leads.push(p.id);
  if (t.ids) { if (p.won && (allTime || inR(p.closing, r))) t.ids.won.push(p.id); if (p.lost) t.ids.lost.push(p.id); if (p.open) t.ids.open.push(p.id); }
  if (p.won && (allTime || inR(p.closing, r))) { t.won++; t.wonValue += p.value; t.wonArea += p.area; if (p.value > 0) t.wonWithValue++; }
  if (p.lost) t.lost++;
  if (p.open) { t.open++; if (p.value > 0) { t.pipeline += p.value; t.openWithValue++; } }
}
/** won ÷ leads. A lead is still "in play" while open, so this is a blended rate. */
export const convOf = (t: Tally) => pc(t.won, t.leads);
/** won ÷ (won + lost): of the leads that were decided, how many we won. Open leads are left out. */
export const decidedWinOf = (t: Tally) => pc(t.won, t.won + t.lost);
export const avgDealOf = (t: Tally) => (t.wonWithValue ? t.wonValue / t.wonWithValue : null);

export interface Group { key: string; label: string; t: Tally }
export function groupBy(pool: P[], r: Range, allTime: boolean, keyOf: (p: P) => string): Group[] {
  const m = new Map<string, Group>();
  for (const p of pool) {
    const k = keyOf(p);
    let g = m.get(k);
    if (!g) { g = { key: k, label: k, t: emptyTally(true) }; m.set(k, g); }
    tallyAdd(g.t, p, r, allTime);
  }
  return [...m.values()];
}
export const byLeadsDesc = (a: Group, b: Group) => b.t.leads - a.t.leads || a.label.localeCompare(b.label);

// ---------------------------------------------------------------------------------------------
// Funnel by stage (cohort: leads whose lead date is in the window; each lead counted once at the furthest stage it reached)
// ---------------------------------------------------------------------------------------------
export interface FunnelStep { name: string; n: number; ofAll: number | null; carried: number | null; dropped: number; lostHere: number }
export function funnelCohort(pool: P[], r: Range, allTime: boolean): { steps: FunnelStep[]; cohort: number } {
  const cohort = pool.filter((p) => allTime || inR(p.created, r));
  const reach = [0, 0, 0, 0, 0, 0]; // reach[i] = leads that got at least to level i
  const lostAt = [0, 0, 0, 0, 0, 0];
  for (const p of cohort) {
    for (let i = 0; i <= p.level; i++) reach[i]++;
    if (p.lost) lostAt[p.level]++;
  }
  const names = ['Leads received', 'Reached', 'Qualified', 'Offer or meeting', 'Negotiation', 'Won'];
  const steps = names.map((name, i) => ({
    name, n: reach[i], ofAll: pc(reach[i], reach[0]), carried: i === 0 ? null : pc(reach[i], reach[i - 1]),
    dropped: i === 0 ? 0 : Math.max(0, reach[i - 1] - reach[i]), lostHere: i === 5 ? 0 : lostAt[i],
  }));
  return { steps, cohort: cohort.length };
}
/** current status of every lead in the pool: how many sit in which status, with value where recorded */
export function statusMix(pool: P[]): { status: string; n: number; value: number; withValue: number }[] {
  const m = new Map<string, { status: string; n: number; value: number; withValue: number }>();
  for (const p of pool) {
    const s = p.l.status || 'Not recorded';
    let e = m.get(s); if (!e) { e = { status: s, n: 0, value: 0, withValue: 0 }; m.set(s, e); }
    e.n++; if (p.value > 0) { e.value += p.value; e.withValue++; }
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

// ---------------------------------------------------------------------------------------------
// Lead aging (open leads only, as of today)
// ---------------------------------------------------------------------------------------------
export const AGE_BANDS: { key: string; label: string; max: number }[] = [
  { key: 'a0', label: '0–7 days', max: 7 }, { key: 'a1', label: '8–30 days', max: 30 }, { key: 'a2', label: '31–90 days', max: 90 },
  { key: 'a3', label: '91–180 days', max: 180 }, { key: 'a4', label: 'Over 180 days', max: Infinity },
];
export const IDLE_BANDS: { key: string; label: string; max: number }[] = [
  { key: 'i0', label: 'Touched in the last 2 days', max: 2 }, { key: 'i1', label: '3–7 days ago', max: 7 }, { key: 'i2', label: '8–14 days ago', max: 14 },
  { key: 'i3', label: '15–30 days ago', max: 30 }, { key: 'i4', label: 'Over 30 days ago', max: Infinity },
];
export interface AgingRow { key: string; label: string; n: number; value: number; withValue: number }
export function agingOf(open: P[], today: string) {
  const age = AGE_BANDS.map((b) => ({ key: b.key, label: b.label, n: 0, value: 0, withValue: 0 }));
  const idle = IDLE_BANDS.map((b) => ({ key: b.key, label: b.label, n: 0, value: 0, withValue: 0 }));
  const never: AgingRow = { key: 'never', label: 'Never touched', n: 0, value: 0, withValue: 0 };
  const noTouch: AgingRow = { key: 'notouch', label: 'Worked, but no contact date recorded', n: 0, value: 0, withValue: 0 };
  const noDate: AgingRow = { key: 'nodate', label: 'No lead date', n: 0, value: 0, withValue: 0 };
  const ages: number[] = [];
  const add = (row: AgingRow, p: P) => { row.n++; if (p.value > 0) { row.value += p.value; row.withValue++; } };
  for (const p of open) {
    const a = p.created ? daysBetween(p.created, today) : NaN;
    if (!Number.isFinite(a)) add(noDate, p);
    else { const d = Math.max(0, a); ages.push(d); add(age[AGE_BANDS.findIndex((b) => d <= b.max)], p); }
    const touch = dayOf(p.l.lastContactDate) || dayOf(p.l.firstContactAt);
    if (!touch) { add(isEngaged(p.l) ? noTouch : never, p); continue; }
    const g = Math.max(0, daysBetween(touch, today));
    if (Number.isFinite(g)) add(idle[IDLE_BANDS.findIndex((b) => g <= b.max)], p);
  }
  return { age, idle, never, noTouch, noDate, avgAge: mean(ages), medianAge: median(ages), measured: ages.length };
}

// ---------------------------------------------------------------------------------------------
// Trend: leads created per day / week / month
// ---------------------------------------------------------------------------------------------
export type TrendUnit = 'day' | 'week' | 'month';
export interface TrendRow { key: string; label: string; leads: number; reached: number; won: number; wonValue: number; lost: number }
const weekStart = (d: string) => { const [y, m, dd] = d.split('-').map(Number); const dt = new Date(y, m - 1, dd); return addDays(d, -dt.getDay()); }; // Sunday-start week, as Egypt
export function trendOf(pool: P[], r: Range, allTime: boolean, today: string, unitPref: TrendUnit | 'auto'): { unit: TrendUnit; rows: TrendRow[] } {
  let from = r.from; let to = r.to;
  if (allTime) {
    let mn = ''; let mx = '';
    for (const p of pool) for (const d of [p.created, p.won ? p.closing : '']) if (d) { if (!mn || d < mn) mn = d; if (!mx || d > mx) mx = d; }
    if (!mn) return { unit: 'month', rows: [] };
    from = mn; to = mx > today ? today : mx;
  }
  const span = Math.round(daysBetween(from, to)) + 1;
  const unit: TrendUnit = unitPref !== 'auto' ? unitPref : span <= 62 ? 'day' : span <= 400 ? 'week' : 'month';
  const keyOf = (d: string) => (unit === 'day' ? d : unit === 'week' ? weekStart(d) : d.slice(0, 7));
  const label = (k: string) => unit === 'month'
    ? new Date(`${k}-01T00:00:00`).toLocaleString('en-GB', { month: 'short', year: '2-digit' })
    : unit === 'week' ? `${k.slice(8)}/${k.slice(5, 7)}` : `${k.slice(8)}/${k.slice(5, 7)}`;
  const map = new Map<string, TrendRow>();
  const mk = (k: string): TrendRow => ({ key: k, label: label(k), leads: 0, reached: 0, won: 0, wonValue: 0, lost: 0 });
  // seed empty buckets so quiet days / weeks still show; hard cap keeps a huge range cheap
  if (unit === 'month') {
    let y = Number(from.slice(0, 4)); let m = Number(from.slice(5, 7));
    for (let i = 0; i < 240 && `${y}-${String(m).padStart(2, '0')}` <= to.slice(0, 7); i++) { const k = `${y}-${String(m).padStart(2, '0')}`; map.set(k, mk(k)); m++; if (m > 12) { m = 1; y++; } }
  } else {
    const step = unit === 'day' ? 1 : 7;
    for (let d = unit === 'day' ? from : weekStart(from), i = 0; d <= to && i < 800; d = addDays(d, step), i++) map.set(d, mk(d));
  }
  for (const p of pool) {
    if (p.created && p.created >= from && p.created <= to) { const b = map.get(keyOf(p.created)); if (b) { b.leads++; if (p.level >= 1) b.reached++; if (p.lost) b.lost++; } }
    if (p.won && p.closing && p.closing >= from && p.closing <= to) { const b = map.get(keyOf(p.closing)); if (b) { b.won++; b.wonValue += p.value; } }
  }
  return { unit, rows: [...map.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}

// ---------------------------------------------------------------------------------------------
// Win / loss
// ---------------------------------------------------------------------------------------------
export interface LostRow { key: string; n: number; value: number; withValue: number; area: number; ids?: string[] }
export function lostAnalysis(pool: P[]) {
  const reasons = new Map<string, LostRow>(); const stage = [0, 0, 0, 0, 0, 0]; const owners = new Map<string, { key: string; n: number }>();
  let lost = 0;
  for (const p of pool) {
    if (!p.lost) continue;
    lost++;
    let e = reasons.get(p.reason); if (!e) { e = { key: p.reason, n: 0, value: 0, withValue: 0, area: 0, ids: [] }; reasons.set(p.reason, e); }
    e.n++; e.ids?.push(p.id); if (p.value > 0) { e.value += p.value; e.withValue++; }
    e.area += Number(p.l.requiredSize) > 0 ? Number(p.l.requiredSize) : 0;
    stage[p.level]++;
    if (p.owner) { const o = owners.get(p.owner) || { key: p.ownerName || p.owner, n: 0 }; o.n++; owners.set(p.owner, o); }
  }
  return {
    lost, reasons: [...reasons.values()].sort((a, b) => b.n - a.n),
    byStage: STAGE_NAMES.slice(0, 5).map((name, i) => ({ name, n: stage[i] })),
    byOwner: [...owners.values()].sort((a, b) => b.n - a.n),
    notRecorded: reasons.get('Not recorded')?.n || 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Channel (main) and source (sub)
// ---------------------------------------------------------------------------------------------
export interface ChannelRow { key: string; t: Tally; sources: Group[] }
export function channelReport(pool: P[], r: Range, allTime: boolean) {
  const ch = new Map<string, ChannelRow>(); const matrix = new Map<string, Tally>(); const srcSet = new Set<string>();
  for (const p of pool) {
    const c = channelOf(p.l); const s = p.source;
    let row = ch.get(c); if (!row) { row = { key: c, t: emptyTally(), sources: [] }; ch.set(c, row); }
    tallyAdd(row.t, p, r, allTime);
    const mk = `${c}\u0001${s}`; let cell = matrix.get(mk); if (!cell) { cell = emptyTally(); matrix.set(mk, cell); }
    tallyAdd(cell, p, r, allTime); srcSet.add(s);
  }
  // sources under each channel
  matrix.forEach((t, mk) => { const [c, s] = mk.split('\u0001'); ch.get(c)!.sources.push({ key: s, label: s, t }); });
  const order = (k: string) => { const i = (CHANNELS as readonly string[]).indexOf(k); return k === NO_CHANNEL ? 99 : i < 0 ? 50 : i; };
  const rows = [...ch.values()].sort((a, b) => order(a.key) - order(b.key) || b.t.leads - a.t.leads);
  rows.forEach((row) => row.sources.sort(byLeadsDesc));
  const sources = [...srcSet].sort((a, b) => { let x = 0, y = 0; rows.forEach((rw) => { x += matrix.get(`${rw.key}\u0001${a}`)?.leads || 0; y += matrix.get(`${rw.key}\u0001${b}`)?.leads || 0; }); return y - x || a.localeCompare(b); });
  return { rows, sources, cell: (c: string, s: string) => matrix.get(`${c}\u0001${s}`) };
}

// ---------------------------------------------------------------------------------------------
// Project demand, plot-size demand, industry
// ---------------------------------------------------------------------------------------------
export const SIZE_BANDS: { label: string; max: number }[] = [
  { label: 'Up to 1,000 sqm', max: 1000 }, { label: '1,000 – 2,500 sqm', max: 2500 }, { label: '2,500 – 5,000 sqm', max: 5000 },
  { label: '5,000 – 10,000 sqm', max: 10000 }, { label: '10,000 – 20,000 sqm', max: 20000 }, { label: 'Over 20,000 sqm', max: Infinity },
];
export const NO_SIZE = 'Size not recorded';
export const sizeBandOf = (l: Lead): string => {
  const n = Number(l.requiredSize);
  if (!Number.isFinite(n) || n <= 0) return NO_SIZE;
  return SIZE_BANDS.find((b) => n <= b.max)!.label;
};
export function industryOf(l: Lead): string {
  const t = clean(l.industry, '');
  if (!t) return 'Not recorded';
  return t.toLowerCase().replace(/(^|[\s/&(-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
}
export function projectDemand(pool: P[], r: Range, allTime: boolean): (Group & { sizes: number[] })[] {
  const m = new Map<string, Group & { sizes: number[] }>();
  for (const p of pool) {
    let g = m.get(p.project); if (!g) { g = { key: p.project, label: p.project, t: emptyTally(), sizes: [] }; m.set(p.project, g); }
    tallyAdd(g.t, p, r, allTime);
    const s = Number(p.l.requiredSize); if (s > 0) g.sizes.push(s);
  }
  return [...m.values()].sort(byLeadsDesc);
}
export function sizeDemand(pool: P[], r: Range, allTime: boolean): Group[] {
  const g = groupBy(pool, r, allTime, (p) => sizeBandOf(p.l));
  const order = [...SIZE_BANDS.map((b) => b.label), NO_SIZE];
  return g.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/** Plot-size breakdown (26 Nov 2026, Walid): per size band, who holds the leads (assigned / unassigned), touched or not,
 *  where they stand (open / waiting for finance / won / lost), new vs old (Excel) leads, area asked, and the split by
 *  salesperson and by project. Every counter keeps its lead ids so a clicked number opens exactly those leads. */
export interface SizeRow {
  key: string; label: string; t: Tally; sizes: number[];
  assigned: string[]; unassigned: string[]; touched: string[]; untouched: string[];
  pending: string[]; oldL: string[]; newL: string[];
  /** open leads that nobody owns: the ones to hand out first */
  openUnassigned: string[];
}
export interface SizeBreakdown {
  rows: SizeRow[]; total: SizeRow;
  /** band × salesperson (leads with an owner) and band × project */
  byOwner: { key: string; label: string; total: number; cells: Map<string, string[]> }[];
  byProject: { key: string; label: string; total: number; cells: Map<string, string[]> }[];
}
export function sizeBreakdown(pool: P[], r: Range, allTime: boolean): SizeBreakdown {
  const mk = (k: string): SizeRow => ({ key: k, label: k, t: emptyTally(true), sizes: [], assigned: [], unassigned: [], touched: [], untouched: [], pending: [], oldL: [], newL: [], openUnassigned: [] });
  const order = [...SIZE_BANDS.map((b) => b.label), NO_SIZE];
  const m = new Map<string, SizeRow>(order.map((k) => [k, mk(k)]));
  const total = mk('All sizes');
  const own = new Map<string, { key: string; label: string; total: number; cells: Map<string, string[]> }>();
  const prj = new Map<string, { key: string; label: string; total: number; cells: Map<string, string[]> }>();
  const cellAdd = (mp: typeof own, k: string, label: string, band: string, id: string) => {
    let x = mp.get(k); if (!x) { x = { key: k, label, total: 0, cells: new Map() }; mp.set(k, x); }
    x.total++; const c = x.cells.get(band); if (c) c.push(id); else x.cells.set(band, [id]);
  };
  for (const p of pool) {
    const band = sizeBandOf(p.l);
    for (const row of [m.get(band)!, total]) {
      tallyAdd(row.t, p, r, allTime);
      const s = Number(p.l.requiredSize); if (Number.isFinite(s) && s > 0) row.sizes.push(s);
      (p.owner ? row.assigned : row.unassigned).push(p.id);
      if (!p.owner && p.open) row.openUnassigned.push(p.id);
      (isTouchedLead(p.l) ? row.touched : row.untouched).push(p.id);
      if (p.pending) row.pending.push(p.id);
      (p.l.oldLead ? row.oldL : row.newL).push(p.id);
    }
    if (p.owner) cellAdd(own, p.owner, p.ownerName || 'Name not recorded', band, p.id);
    cellAdd(prj, p.project, p.project, band, p.id);
  }
  const desc = (a: { total: number; label: string }, b: { total: number; label: string }) => b.total - a.total || a.label.localeCompare(b.label);
  return { rows: order.map((k) => m.get(k)!).filter((x) => x.t.leads > 0), total, byOwner: [...own.values()].sort(desc), byProject: [...prj.values()].sort(desc) };
}

// ---------------------------------------------------------------------------------------------
// First action, final stage, SLA, follow-ups (shared by Service report and Team Performance)
// ---------------------------------------------------------------------------------------------
const ACTION_TYPES = new Set(['Call', 'Email', 'Meeting', 'Visit', 'WhatsApp', 'SMS', 'Comment', 'Status Change']);
/** activities grouped by lead (one pass over all activity rows) */
export function activityIndex(acts: SalespersonActivity[]): Map<string, SalespersonActivity[]> {
  const m = new Map<string, SalespersonActivity[]>();
  for (const a of acts) { if (!a.leadId) continue; const x = m.get(a.leadId); if (x) x.push(a); else m.set(a.leadId, [a]); }
  return m;
}
/** the moment the clock starts for the current owner: the assignment time; else the lead date when it carries a time. NaN = cannot be measured. */
export function clockStartMs(l: Lead): number {
  const a = msOf(l.assignedDate); if (Number.isFinite(a)) return a;
  if (l.date && l.date.length > 10) return msOf(l.date);
  return NaN;
}
/**
 * FIRST ACTION of the current owner on a lead = the earliest of
 *   (a) lead.firstContactAt (the server stamps it when the owner first works the lead),
 *   (b) a logged call / WhatsApp / meeting / visit / e-mail by that owner on the lead (activities),
 *   (c) a timeline entry by that owner of type Call, Email, Meeting, Visit, WhatsApp, SMS, Comment or Status Change (priority edits excluded),
 * that happened at or after the clock start. NaN when there is no such event or no clock start.
 */
export function firstActionMs(l: Lead, idx: Map<string, SalespersonActivity[]>): number {
  const owner = String(l.assignedSalespersonId || '');
  const base = clockStartMs(l);
  if (!owner || !Number.isFinite(base)) return NaN;
  let first = Infinity;
  const fc = msOf(l.firstContactAt); if (Number.isFinite(fc) && fc >= base - 60_000) first = fc;
  const acts = idx.get(l.id);
  if (acts) for (const a of acts) { if (a.salespersonId !== owner) continue; const t = msOf(a.timestamp); if (t >= base && t < first) first = t; }
  const nm = nameKey(l.assignedSalespersonName);
  const tl = l.timeline;
  if (nm && tl) for (const ev of tl) {
    if (!ACTION_TYPES.has(ev.type) || ev.title === 'Priority Updated' || nameKey(ev.user) !== nm) continue;
    const t = msOf(ev.timestamp); if (t >= base && t < first) first = t;
  }
  return Number.isFinite(first) ? first : NaN;
}
/** hours from the clock start to the first action; null when it cannot be measured */
export function hoursToFirstAction(l: Lead, idx: Map<string, SalespersonActivity[]>): number | null {
  const f = firstActionMs(l, idx); if (!Number.isFinite(f)) return null;
  return Math.max(0, (f - clockStartMs(l)) / 36e5);
}
const LOST_RE = /\bto (Lost|Not Interested|Low Budget)\b/i;
/** day the lead reached its final stage: Won = closing day; Lost / Not Interested / Low Budget = the day of the last matching status change in the timeline. '' when unknown. */
export function finalDayOf(p: P): string {
  if (p.won) return p.closing;
  if (!p.lost) return '';
  const tl = p.l.timeline; let best = '';
  if (tl) for (const ev of tl) {
    if (ev.type !== 'Status Change') continue;
    if (!(ev.title === 'Lead Closed as Lost' || LOST_RE.test(ev.description || ''))) continue;
    const d = dayOf(ev.timestamp); if (d && d > best) best = d;
  }
  return best;
}
/** days from assignment (else lead date) to the final stage; null when either end is unknown or the order is impossible */
export function daysToFinal(p: P): number | null {
  const end = finalDayOf(p); const start = dayOf(p.l.assignedDate) || p.created;
  if (!end || !start) return null;
  const d = daysBetween(start, end);
  return Number.isFinite(d) && d >= 0 && d < 3650 ? d : null;
}
export type SlaResult = 'met' | 'breached' | 'pending' | null;
/**
 * SLA on the first action: the lead carries a deadline.
 *   first action at or before the deadline = met; after it = breached;
 *   no first action yet: open lead past its deadline = breached, open lead before it = pending, closed lead = not measurable.
 */
export function slaResult(l: Lead, firstMs: number, nowMs: number): SlaResult {
  if (!l.slaDeadline) return null;
  const dl = msOf(l.slaDeadline); if (!Number.isFinite(dl)) return null;
  if (Number.isFinite(firstMs)) return firstMs <= dl ? 'met' : 'breached';
  if (statusStage(l.status) !== 'active' && statusStage(l.status) !== 'pipeline') return null;
  return dl < nowMs ? 'breached' : 'pending';
}
export const RESPONSE_BANDS: { label: string; maxH: number }[] = [
  { label: 'Within 1 hour', maxH: 1 }, { label: '1–4 hours', maxH: 4 }, { label: '4–24 hours', maxH: 24 }, { label: '1–2 days', maxH: 48 }, { label: 'Over 2 days', maxH: Infinity },
];

export interface ServiceReport {
  measured: number; avgHours: number | null; medianHours: number | null;
  bands: { label: string; n: number }[]; noAction: number;
  sla: { met: number; breached: number; pending: number; rate: number | null };
  byOwner: { key: string; name: string; measured: number; avgH: number | null; medianH: number | null; breached: number; met: number; overdue: number; noNext: number; openN: number }[];
  followup: { open: number; overdue: number; today: number; noDate: number; upcoming: number; oldestOverdue: { id: string; name: string; owner: string; days: number }[]; overdueBands: { label: string; n: number }[] };
}
export function serviceReport(pool: P[], allOpen: P[], idx: Map<string, SalespersonActivity[]>, today: string, nowMs: number): ServiceReport {
  const hrs: number[] = []; const bands = RESPONSE_BANDS.map((b) => ({ label: b.label, n: 0 })); let noAction = 0;
  const sla = { met: 0, breached: 0, pending: 0 };
  const own = new Map<string, { key: string; name: string; h: number[]; breached: number; met: number; overdue: number; noNext: number; openN: number }>();
  const get = (p: P) => { let o = own.get(p.owner); if (!o) { o = { key: p.owner, name: p.ownerName || p.owner, h: [], breached: 0, met: 0, overdue: 0, noNext: 0, openN: 0 }; own.set(p.owner, o); } return o; };
  for (const p of pool) {
    if (!p.owner) continue;
    const o = get(p);
    const f = firstActionMs(p.l, idx);
    const base = clockStartMs(p.l);
    if (Number.isFinite(f) && Number.isFinite(base)) {
      const h = Math.max(0, (f - base) / 36e5);
      hrs.push(h); o.h.push(h); bands[RESPONSE_BANDS.findIndex((b) => h <= b.maxH)].n++;
    } else if (p.open) noAction++;
    const s = slaResult(p.l, f, nowMs);
    if (s === 'met') { sla.met++; o.met++; } else if (s === 'breached') { sla.breached++; o.breached++; } else if (s === 'pending') sla.pending++;
  }
  let overdue = 0, due = 0, noDate = 0, upcoming = 0;
  const od: { id: string; name: string; owner: string; days: number }[] = [];
  const ob = [{ label: '1–3 days late', n: 0 }, { label: '4–7 days late', n: 0 }, { label: '8–14 days late', n: 0 }, { label: 'Over 14 days late', n: 0 }];
  for (const p of allOpen) {
    if (!p.owner) continue;
    const o = get(p); o.openN++;
    const n = dayOf(p.l.nextFollowUpDate);
    if (!n) { noDate++; o.noNext++; } else if (n < today) {
      overdue++; o.overdue++;
      const d = Math.round(daysBetween(n, today));
      od.push({ id: p.id, name: p.l.companyName || p.l.customerName, owner: p.ownerName || p.owner, days: d });
      ob[d <= 3 ? 0 : d <= 7 ? 1 : d <= 14 ? 2 : 3].n++;
    } else if (n === today) due++; else upcoming++;
  }
  od.sort((a, b) => b.days - a.days);
  return {
    measured: hrs.length, avgHours: mean(hrs), medianHours: median(hrs), bands, noAction,
    sla: { ...sla, rate: pc(sla.met, sla.met + sla.breached) },
    byOwner: [...own.values()].map((o) => ({ key: o.key, name: o.name, measured: o.h.length, avgH: mean(o.h), medianH: median(o.h), breached: o.breached, met: o.met, overdue: o.overdue, noNext: o.noNext, openN: o.openN })),
    followup: { open: allOpen.filter((p) => p.owner).length, overdue, today: due, noDate, upcoming, oldestOverdue: od.slice(0, 15), overdueBands: ob },
  };
}

// ---------------------------------------------------------------------------------------------
// Expected-closing forecast (open leads, by their expected closing date)
// ---------------------------------------------------------------------------------------------
export interface ForecastRow { key: string; label: string; n: number; expectedDeals: number; value: number; withValue: number; weighted: number }
export function forecastOf(open: P[], today: string, months = 12) {
  const rows = new Map<string, ForecastRow>();
  const mk = (key: string, label: string): ForecastRow => ({ key, label, n: 0, expectedDeals: 0, value: 0, withValue: 0, weighted: 0 });
  rows.set('overdue', mk('overdue', 'Date already passed'));
  const y0 = Number(today.slice(0, 4)); const m0 = Number(today.slice(5, 7));
  for (let i = 0; i < months; i++) { const d = new Date(y0, m0 - 1 + i, 1); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; rows.set(k, mk(k, d.toLocaleString('en-GB', { month: 'long', year: 'numeric' }))); }
  rows.set('later', mk('later', 'Later'));
  rows.set('none', mk('none', 'No expected date'));
  const lastKey = [...rows.keys()].filter((k) => /^\d{4}-/.test(k)).pop()!;
  for (const p of open) {
    const w = STAGE_WEIGHT[Math.min(p.level, 4)];
    const d = dayOf(p.l.expectedClosingDate);
    const key = !d ? 'none' : d < today ? 'overdue' : d.slice(0, 7) > lastKey ? 'later' : d.slice(0, 7);
    const row = rows.get(key)!;
    row.n++; row.expectedDeals += w;
    if (p.value > 0) { row.value += p.value; row.withValue++; row.weighted += p.value * w; }
  }
  const all = [...rows.values()];
  const tot = all.reduce((a, r) => ({ n: a.n + r.n, expectedDeals: a.expectedDeals + r.expectedDeals, value: a.value + r.value, withValue: a.withValue + r.withValue, weighted: a.weighted + r.weighted }), { n: 0, expectedDeals: 0, value: 0, withValue: 0, weighted: 0 });
  return { rows: all, total: tot };
}

// ---------------------------------------------------------------------------------------------
// TEAM PERFORMANCE (one pass over the period pool + one over all open leads)
// ---------------------------------------------------------------------------------------------
export interface RepPerf {
  id: string; name: string;
  leads: number; open: number; won: number; lost: number; other: number;
  conversion: number | null; decidedWin: number | null; wonValue: number; wonWithValue: number; avgDeal: number | null;
  firstActionH: number[]; avgFirstH: number | null; medianFirstH: number | null;
  finalDays: number[]; avgFinalDays: number | null;
  offers: number;
  slaMet: number; slaBreached: number;
  // snapshot, whatever the period: the person's open leads right now
  openNow: number; overdue: number; neverContacted: number; noNext: number; capacity: number | null; loadPct: number | null;
  channels: { key: string; n: number }[]; sources: { key: string; n: number }[];
  tally: Tally;
}
export function teamPerformance(
  pool: P[], allOpen: P[], r: Range, allTime: boolean, idx: Map<string, SalespersonActivity[]>, today: string, nowMs: number,
  caps: Map<string, number>, defaultCap: number | null,
): RepPerf[] {
  const m = new Map<string, RepPerf & { ch: Map<string, number>; src: Map<string, number> }>();
  const get = (id: string, name: string) => {
    let x = m.get(id);
    if (!x) {
      x = { id, name: name || id, leads: 0, open: 0, won: 0, lost: 0, other: 0, conversion: null, decidedWin: null, wonValue: 0, wonWithValue: 0, avgDeal: null, firstActionH: [], avgFirstH: null, medianFirstH: null, finalDays: [], avgFinalDays: null, offers: 0, slaMet: 0, slaBreached: 0, openNow: 0, overdue: 0, neverContacted: 0, noNext: 0, capacity: null, loadPct: null, channels: [], sources: [], tally: emptyTally(), ch: new Map(), src: new Map() };
      m.set(id, x);
    } else if (!x.name || x.name === x.id) x.name = name || x.name;
    return x;
  };
  for (const p of pool) {
    if (!p.owner) continue;
    const x = get(p.owner, p.ownerName);
    tallyAdd(x.tally, p, r, allTime);
    x.leads++;
    const wonNow = p.won && (allTime || inR(p.closing, r));
    if (wonNow) { x.won++; x.wonValue += p.value; if (p.value > 0) x.wonWithValue++; }
    else if (p.lost) x.lost++;
    else if (p.open) x.open++;
    else if (!p.won) x.other++;
    if (p.l.offerSent) x.offers++;
    const f = firstActionMs(p.l, idx);
    const base = clockStartMs(p.l);
    if (Number.isFinite(f) && Number.isFinite(base)) x.firstActionH.push(Math.max(0, (f - base) / 36e5));
    if (p.won || p.lost) { const d = daysToFinal(p); if (d != null) x.finalDays.push(d); }
    const s = slaResult(p.l, f, nowMs);
    if (s === 'met') x.slaMet++; else if (s === 'breached') x.slaBreached++;
    const c = channelOf(p.l); x.ch.set(c, (x.ch.get(c) || 0) + 1);
    x.src.set(p.source, (x.src.get(p.source) || 0) + 1);
  }
  for (const p of allOpen) {
    if (!p.owner) continue;
    const x = get(p.owner, p.ownerName);
    x.openNow++;
    const n = dayOf(p.l.nextFollowUpDate);
    if (!n) x.noNext++; else if (n < today) x.overdue++;
    if (!isEngaged(p.l)) x.neverContacted++;
  }
  const out: RepPerf[] = [];
  m.forEach((x) => {
    x.conversion = pc(x.won, x.leads);
    x.decidedWin = pc(x.won, x.won + x.lost);
    x.avgDeal = x.wonWithValue ? x.wonValue / x.wonWithValue : null;
    x.avgFirstH = mean(x.firstActionH); x.medianFirstH = median(x.firstActionH);
    x.avgFinalDays = mean(x.finalDays);
    x.capacity = caps.get(x.id) ?? defaultCap;
    x.loadPct = x.capacity ? pc(x.openNow, x.capacity) : null;
    x.channels = [...x.ch.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
    x.sources = [...x.src.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
    out.push(x);
  });
  return out;
}
