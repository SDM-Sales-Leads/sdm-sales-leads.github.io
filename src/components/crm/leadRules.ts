// Browser-side lead rules of the sales team's CRM (spec_A 2.4, 4.2, 4.7, 4.8). They are a convenience: they tell the
// user what is missing before the save. The server (supabase/functions/api/leadrules.ts) is the authority.
import type { Lead } from './types';
import { cairoDateISO } from '../../lib/cairoTime';
import {
  ACTIVE_EXCLUDE, LEGACY_STATUSES, REQ_DATETIME, REQ_FOLLOWUP, STATUS_GROUPS, closingDate, isOpenStatus, statusStage,
} from './leadConfig';

export const todayISO = () => cairoDateISO(new Date());
export const addDaysISO = (days: number) => {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** the older English priorities map onto the team's four */
export const prioKey = (p?: string): string => (p === 'Urgent' ? 'VIP' : p === 'Normal' ? 'Medium' : p || '');

export function statusOptions(current?: string): { group: string; statuses: string[] }[] {
  const out = STATUS_GROUPS.map((g) => ({ ...g }));
  if (current && !STATUS_GROUPS.some((g) => g.statuses.includes(current))) out.push({ group: 'Legacy', statuses: [current] });
  return out;
}
export const isLegacyStatus = (s: string) => LEGACY_STATUSES.includes(s);

// ---- colours: by stage first, then specific statuses; legacy statuses land in their stage ----
export function statusClass(s: string): string {
  const st = statusStage(s);
  if (st === 'won') return 'bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold';
  if (st === 'lost') return 'bg-rose-100 text-rose-800 border border-rose-300';
  if (st === 'closed') return 'bg-brand-gray/10 text-brand-gray border border-brand-gray/20';
  if (st === 'pipeline') return 'bg-blue-50 text-blue-700 border border-blue-200';
  if (s === 'New') return 'bg-yellow-50 text-yellow-700 border border-yellow-200';
  if (s === 'Assigned') return 'bg-purple-50 text-purple-700 border border-purple-200';
  return 'bg-indigo-50 text-indigo-700 border border-indigo-200';
}
export function priorityClass(p?: string): string {
  switch (prioKey(p)) {
    case 'VIP': return 'bg-rose-100 text-rose-700 font-bold';
    case 'High': return 'bg-orange-100 text-orange-700';
    case 'Medium': return 'bg-blue-100 text-blue-700';
    default: return 'bg-brand-gray/10 text-brand-gray';
  }
}

/** the four kanban columns, driven by leadConfig so every status (team and legacy) lands somewhere */
export type KanbanKey = 'new' | 'working' | 'pipeline' | 'closed';
export function kanbanBucket(status: string): KanbanKey {
  if (status === 'New') return 'new';
  const st = statusStage(status);
  if (st === 'pipeline') return 'pipeline';
  if (st === 'won' || st === 'lost' || st === 'closed') return 'closed';
  return 'working';
}

// ---- SLA (spec_A 4.8): VIP 4 h and neglect 48 h from the assignment (or lead date 09:00) to the first contact ----
export interface NeglectInfo { state: 'na' | 'contacted' | 'ok' | 'vip-breach' | 'neglected'; hours: number; label: string }
export function neglectInfo(l: Partial<Lead>, vipHours = 4, neglectHours = 48, now = Date.now()): NeglectInfo {
  if (!isOpenStatus(String(l.status))) return { state: 'na', hours: 0, label: 'Closed' };
  if (!l.assignedSalespersonId && !l.assignedSalespersonName) return { state: 'na', hours: 0, label: 'Not assigned yet' };
  if (l.firstContactAt) return { state: 'contacted', hours: 0, label: 'First contact made' };
  const base = Date.parse(l.assignedDate || (l.date ? `${String(l.date).slice(0, 10)}T09:00:00` : ''));
  if (isNaN(base)) return { state: 'na', hours: 0, label: '—' };
  const hours = Math.max(0, (now - base) / 36e5);
  const h = hours >= 48 ? `${Math.floor(hours / 24)}d` : `${Math.floor(hours)}h`;
  if (hours > neglectHours) return { state: 'neglected', hours, label: `Neglected: no contact for ${h}` };
  if (l.priority && prioKey(l.priority) === 'VIP' && hours > vipHours) return { state: 'vip-breach', hours, label: `VIP: no contact for ${h} (limit ${vipHours}h)` };
  const limit = prioKey(l.priority) === 'VIP' ? vipHours : neglectHours;
  return { state: 'ok', hours, label: `${Math.max(0, Math.ceil(limit - hours))}h left for first contact` };
}

// ---- who may edit what (convenience only; the server decides) ----
export interface LeadAuth {
  /** Sales Operation, admin, or a role that manages the sales rules */
  isOps: boolean;
  isOwner: boolean;
  isTeamLead: boolean;
  readOnly: boolean;
  canConfirmCash: boolean;
}
export interface FieldRights { core: boolean; shared: boolean; follow: boolean; stages: boolean; values: boolean }
export function fieldRights(a: LeadAuth, isNew: boolean): FieldRights {
  if (a.readOnly) return { core: false, shared: false, follow: false, stages: false, values: false };
  const core = a.isOps || isNew;
  const follow = a.isOps || a.isOwner || a.isTeamLead || isNew;
  return { core, shared: follow, follow, stages: !isNew && (a.isOps || a.isOwner || a.isTeamLead), values: follow };
}

/**
 * Required fields per status (spec_A 4.2). `next` is the lead as it will be saved. Returns the first problem, or ''.
 */
export function validateLead(next: Partial<Lead>, prev: Partial<Lead> | null): string {
  const s = String(next.status || 'New');
  if (REQ_DATETIME.includes(s)) {
    if (!next.meetingDate) return `"${s}" needs the meeting date.`;
    if (!next.meetingTime) return `"${s}" needs the meeting time.`;
    if (!String(next.notes || '').trim()) return `"${s}" needs notes (what was agreed).`;
  }
  if (REQ_FOLLOWUP.includes(s) && !next.nextFollowUpDate) return `"${s}" needs the next follow-up date.`;
  if (s === 'Lost') {
    if (!next.lostCategory) return 'Lost needs the lost category.';
    if (!next.lostReason) return 'Lost needs the lost reason.';
  }
  if (next.qualification) {
    if (!String(next.qualNotes || '').trim()) return 'A qualification needs qualification notes.';
    if (next.qualification === 'Qualified' && !next.temperature) return 'A qualified lead needs a temperature (Hot / Warm / Cold).';
  }
  if (s === 'Won' && !(Number(next.dealValue) > 0)) return 'A Won lead needs the deal value (cash value, EGP) above zero.';
  if (next.offerSent && !next.offerDate) return 'Enter the date the offer was sent.';
  return '';
}

/**
 * Side effects of a save (spec_A 4.2 / 4.3 / 4.4): Won sets cash pending and the closing date, Lost keeps its reason only
 * while Lost, a status without a meeting slot clears the slot, the first contact by the owner is stamped.
 */
export function withSideEffects(prev: Lead | null, next: Lead, actor?: { id?: string }): Lead {
  const out: Lead = { ...next };
  const s = out.status;
  if (s === 'Won' && prev?.status !== 'Won') {
    out.cashStatus = out.cashStatus || 'pending';
    if (!out.wonDate) out.wonDate = closingDate(out);
  }
  if (s !== 'Lost') { if (out.lostReason) out.lostReason = undefined; if (out.lostCategory) out.lostCategory = undefined; }
  if (!REQ_DATETIME.includes(s)) { if (out.meetingDate) out.meetingDate = ''; if (out.meetingTime) out.meetingTime = ''; }
  else if (!out.nextFollowUpDate && out.meetingDate) out.nextFollowUpDate = out.meetingDate;
  if (out.offerSent && !out.offerDate) out.offerDate = todayISO();
  if (!out.offerSent && out.offerDate) out.offerDate = '';
  if (actor?.id && out.assignedSalespersonId === actor.id && !out.firstContactAt && (s !== 'New' || (prev && String(out.notes || '') !== String(prev.notes || '')))) {
    out.firstContactAt = new Date().toISOString();
  }
  return out;
}

/** Fields of a lead the editor may send. Everything else on the record is left untouched. */
export const EDITABLE_KEYS = [
  'customerName', 'companyName', 'phoneNumber', 'phone2', 'email', 'project', 'requiredSize', 'source', 'channel', 'priority', 'date',
  'industry', 'nationality', 'status', 'nextFollowUpDate', 'nextFollowUpTime', 'meetingDate', 'meetingTime', 'offerSent', 'offerDate',
  'qualification', 'temperature', 'qualNotes', 'notes', 'lostCategory', 'lostReason', 'lostComment',
  'eoiApplicable', 'eoiDate', 'reservationDate', 'contractDate', 'wonDate', 'dealValue', 'totalSoldValue', 'soldArea', 'plotNo',
] as const;

export const isClosedStatus = (s: string) => ACTIVE_EXCLUDE.includes(s);
