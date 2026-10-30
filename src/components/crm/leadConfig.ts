// One place for the sales team's working vocabulary. It is the vocabulary of the CRM they used for four months, so
// moving to this system changes nothing in how they speak about a lead. Keep server copy in
// supabase/functions/api/leadrules.ts in step with this file.
import type { Lead } from './types';

export const STATUS_GROUPS: { group: string; statuses: string[] }[] = [
  { group: 'New', statuses: ['New'] },
  { group: 'Contact attempt', statuses: ['Sent WhatsApp', 'No Answer – Sent WhatsApp', 'Out of Coverage – Sent WhatsApp', 'Mail Sent'] },
  { group: 'Follow-up', statuses: ['Call Back', 'Client Will Call Back', 'Need Time to Study Our Offer'] },
  { group: 'Sales pipeline', statuses: ['Offer Sent – Following Up', 'Scheduled Meeting', 'Site Visit Scheduled', 'Negotiation'] },
  { group: 'Won', statuses: ['Won'] },
  { group: 'Closed', statuses: ['Lost', 'Wrong Number'] },
];
export const STATUSES: string[] = STATUS_GROUPS.flatMap((g) => g.statuses);
/** statuses that older rows (and the mail intake) may still carry; shown but not offered */
export const LEGACY_STATUSES = ['Assigned', 'Contacted', 'Follow Up', 'Meeting Scheduled', 'Quotation Sent', 'Waiting Customer', 'Duplicate', 'Invalid', 'No Answer', 'Closed', 'Low Budget', 'Not Interested'];

/** need a meeting date + time + notes */
export const REQ_DATETIME = ['Call Back', 'Scheduled Meeting', 'Site Visit Scheduled'];
/** need a next follow-up date */
export const REQ_FOLLOWUP = ['Sent WhatsApp', 'No Answer – Sent WhatsApp', 'Out of Coverage – Sent WhatsApp', 'Mail Sent', 'Client Will Call Back', 'Need Time to Study Our Offer', 'Offer Sent – Following Up'];
/** closed: not workable any more */
export const ACTIVE_EXCLUDE = ['Won', 'Lost', 'Not Interested', 'Low Budget', 'Wrong Number', 'Duplicate', 'Invalid', 'Closed'];
export const PIPELINE_STATUSES = ['Offer Sent – Following Up', 'Scheduled Meeting', 'Site Visit Scheduled', 'Negotiation', 'Meeting Scheduled', 'Quotation Sent'];
export const CLOSED_STATUSES = ACTIVE_EXCLUDE;

export type Stage = 'won' | 'lost' | 'closed' | 'pipeline' | 'active';
export function statusStage(s: string): Stage {
  if (s === 'Won') return 'won';
  if (s === 'Lost') return 'lost';
  if (ACTIVE_EXCLUDE.includes(s)) return 'closed';
  if (PIPELINE_STATUSES.includes(s)) return 'pipeline';
  return 'active';
}
/**
 * The status a logged action moves a lead to (null = leave it). Closed leads are never reopened. A call, WhatsApp or e-mail
 * moves leads that are still in "New / contact attempt"; a lead already in the sales pipeline (offer, meeting, negotiation)
 * keeps its status. A meeting or site visit can also move a lead out of the pipeline's earlier steps.
 */
export type LoggedAction = 'call' | 'whatsapp' | 'email' | 'meeting' | 'visit' | 'follow-up';
export function statusAfterAction(current: string, action: LoggedAction, outcome = ''): string | null {
  const stage = statusStage(current);
  if (stage === 'won' || stage === 'lost' || stage === 'closed') return null;
  let next: string | null = null;
  if (action === 'whatsapp') next = 'Sent WhatsApp';
  else if (action === 'email') next = 'Mail Sent';
  else if (action === 'follow-up') next = 'Call Back';
  else if (action === 'meeting') next = 'Scheduled Meeting';
  else if (action === 'visit') next = 'Site Visit Scheduled';
  else if (action === 'call') {
    next = ({ 'Line Busy': 'No Answer – Sent WhatsApp', 'No Answer': 'No Answer – Sent WhatsApp', 'Wrong Number': 'Wrong Number', 'Asked to Call Back': 'Client Will Call Back', 'Not Interested': 'Lost' } as Record<string, string>)[outcome] || null;
  }
  if (!next || next === current) return null;
  const moves = action === 'meeting' || action === 'visit' ? (stage === 'active' || (stage === 'pipeline' && current !== 'Negotiation')) : stage === 'active';
  return moves || (action === 'call' && (outcome === 'Wrong Number' || outcome === 'Not Interested')) ? next : null;
}
export const isOpenStatus = (s: string) => !ACTIVE_EXCLUDE.includes(s);

export const PRIORITIES = ['VIP', 'High', 'Medium', 'Low'];
export const PRIORITY_ORDER: Record<string, number> = { VIP: 0, Urgent: 0, High: 1, Medium: 2, Normal: 2, Low: 3 };

export const SOURCES = ['Website', 'Billboard', 'Google SEM', 'Facebook', 'Instagram', 'LinkedIn', 'YouTube', 'Radio', 'Mobile App', 'Event / Exhibition', 'Management', 'Referral', 'Personal', 'Walk-In', 'BD Research'];
// Marketing CHANNEL (main) versus lead SOURCE (sub). The channel is where the lead reached us; the source is what the customer says brought them.
export const CHANNELS = ['Mobile App', 'Call Center', 'Facebook Leads', 'Website', 'Personal', 'Walk-in'] as const;
export const NO_CHANNEL = 'Not set';
export function channelOf(l: { channel?: string; source?: string }): string {
  const c = (l.channel || '').trim();
  if (c) return CHANNELS.find((x) => x.toLowerCase() === c.toLowerCase()) || c;
  const s = (l.source || '').trim().toLowerCase();
  if (s === 'walk-in' || s === 'walk in') return 'Walk-in';
  if (s === 'mobile app') return 'Mobile App';
  if (s === 'personal') return 'Personal';   // leads a salesperson found and registered themselves
  if (s === 'website') return 'Website';   // web-form leads (the website mails "New submission from ..."); a channel set on the lead wins
  if (s === 'facebook' || s === 'instagram') return 'Facebook Leads';   // the old system's Facebook / Instagram leads came from the Facebook lead forms
  return NO_CHANNEL;
}
export const NON_MARKETING_SOURCES = ['Personal', 'Management', 'BD Research'];
export const INDUSTRIES = ['Engineering', 'Pharmaceutical', 'Textile', 'Chemical', 'Food & Beverage (F&B)', 'Logistics', 'Heavy Industry', 'Services', 'Automotive', 'Warehouse'];
export const PROJECTS = ['Industria October', 'Industria Sokhna', 'Industria Asher', 'Industria East', 'Industria West', 'Industria Sadat', 'Industria New Sadat', 'Industria Borg El Arab', 'Industria New Damietta', 'SOKHNA360', 'Al Oula', 'Industria Ras Al Hekma', 'El Minya Green Park', 'Industria Safaga', 'Elsewedy Industrial City (Tanzania)', 'Industria Iraq', 'Other'];
export const QUALIFICATIONS = ['Qualified', 'Unqualified'];
export const TEMPERATURES = ['Hot', 'Warm', 'Cold'];
export const LOST_CATEGORIES = ['Price', 'Not Interested', 'Competitor', 'Location'];
export const LOST_REASONS_TEAM = ['Low Budget', 'Need More Time', 'Need Small Area', 'Need Large Area', 'Collecting Information', 'Industry Not Available', 'Lack of Utilities', 'Not Interested', 'Broker', 'Bought From Another Developer', 'Bought From IDA', 'Bought From SCZone', 'Different Location', 'Plot Sold Out', 'Price Too High'];

const SOURCE_ALIASES: Record<string, string> = {
  'business development': 'BD Research', bd: 'BD Research',
  google: 'Google SEM', 'google ads': 'Google SEM', adwords: 'Google SEM', sem: 'Google SEM', 'google search': 'Google SEM', 'google adwords': 'Google SEM',
  internet: 'Google SEM', online: 'Google SEM', 'social media': 'Google SEM', social: 'Google SEM', web: 'Google SEM', 'website ads': 'Google SEM',
  fb: 'Facebook', 'f.b': 'Facebook', 'face book': 'Facebook', 'fb leads': 'Facebook', 'facebook leads': 'Facebook', meta: 'Facebook',
  ig: 'Instagram', insta: 'Instagram', instgram: 'Instagram', 'instagram leads': 'Instagram',
  in: 'LinkedIn', 'linked in': 'LinkedIn', 'linkedin leads': 'LinkedIn',
  yt: 'YouTube', 'you tube': 'YouTube',
  'walk in': 'Walk-In', walkin: 'Walk-In', 'walk-in customer': 'Walk-In',
  exhibition: 'Event / Exhibition', event: 'Event / Exhibition', expo: 'Event / Exhibition',
  'n/a': '', na: '', 'n.a': '', none: '', unknown: '', '-': '', '--': '', 'not specified': '',
};
export function normSource(s: string | undefined | null): string {
  const k = String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[._]+$/, '');
  if (!k) return '';
  if (k in SOURCE_ALIASES) return SOURCE_ALIASES[k];
  return SOURCES.find((x) => x.toLowerCase() === k) || String(s).trim();
}
export const isMarketingSource = (s: string) => !NON_MARKETING_SOURCES.includes(normSource(s));

const PROJECT_FIX: [RegExp, string][] = [
  [/^(industria|inustria)\s+(october|oct)\b(?!.*new)/i, 'Industria October'],
  [/^(industria|inustria)\s+sokhna/i, 'Industria Sokhna'],
  [/^(industria|inustria)\s+asher/i, 'Industria Asher'],
  [/^(industria|inustria)\s+east/i, 'Industria East'],
  [/^(industria|inustria)\s+west/i, 'Industria West'],
  [/^(industria|inustria)\s+new\s+sadat/i, 'Industria New Sadat'],
  [/^(industria|inustria)\s+sadat/i, 'Industria Sadat'],
  [/^(industria|inustria)\s+borg\s*(al|el)\s*arab\s*$/i, 'Industria Borg El Arab'],
  [/^(industria|inustria)\s+(new\s+)?damietta/i, 'Industria New Damietta'],
  [/^sokhna\s*360|^sokhna360/i, 'SOKHNA360'],
  [/^al\s*oula/i, 'Al Oula'],
  [/^anadasataraya\s+alaashar/i, 'Industria Asher'],
  [/^enadasataraya\s+akatawabar/i, 'Industria October'],
  [/^(egyptian industrial city|eic)/i, 'Egyptian Industrial City (EIC)'],
];
/** website page names that were captured as a "project" by the ad forms: not a project */
const NOT_A_PROJECT = /^(plan your visit|opportunities page|contact us|textile sector case study.*|n\/a|none|-)$/i;
/** Fixes typos and double spaces in a project name; unknown names are kept as typed (never guessed). */
export function normProject(p: string | undefined | null): string {
  const t = String(p ?? '').trim().replace(/\s+/g, ' ');
  if (!t || NOT_A_PROJECT.test(t)) return '';
  for (const [re, name] of PROJECT_FIX) if (re.test(t)) return name;
  return PROJECTS.find((x) => x.toLowerCase() === t.toLowerCase()) || t;
}

/** Phone to +<digits> (Egypt / KSA / UAE aware). "" when it cannot be repaired. */
export function phoneIntl(raw: string | undefined | null): string {
  let d = String(raw ?? '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');
  if (!d) return '';
  while (d.startsWith('00')) d = d.slice(2);
  d = d.replace(/^(20)(20)(1\d{9})$/, '$1$3');
  if (/^20\d{10}$/.test(d)) return '+' + d;
  if (/^966\d{9}$/.test(d)) return '+' + d;
  if (/^971\d{9}$/.test(d)) return '+' + d;
  if (/^01\d{9}$/.test(d)) return '+20' + d.slice(1);
  if (/^1\d{9}$/.test(d)) return '+20' + d;
  if (/^05\d{8}$/.test(d)) return '+966' + d.slice(1);
  if (/^5\d{8}$/.test(d)) return '+966' + d;
  if (/^0\d{8,10}$/.test(d)) return '+20' + d.slice(1);
  if (/^2\d{9}$/.test(d)) return '';
  if (d.length >= 11 && d.length <= 15) return '+' + d;
  return '';
}

/** 0-100 ranking aid. `winRate` = historic win rate of the lead's source (0-1), when known. */
export function leadScore(l: Partial<Lead>, winRate = 0, today = new Date()): number {
  let s = 0;
  s += ({ VIP: 25, Urgent: 25, High: 18, Medium: 10, Normal: 10, Low: 3 } as Record<string, number>)[String(l.priority)] ?? 8;
  if (l.qualification === 'Qualified') s += l.temperature === 'Hot' ? 25 : l.temperature === 'Warm' ? 15 : l.temperature === 'Cold' ? 6 : 10;
  else if (l.qualification === 'Unqualified') s -= 15;
  const a = Number(l.requiredSize) || 0;
  s += a >= 50000 ? 15 : a >= 20000 ? 11 : a >= 5000 ? 7 : a > 0 ? 4 : 0;
  s += PIPELINE_STATUSES.includes(String(l.status)) ? 15 : l.status === 'New' ? 5 : 8;
  s += Math.round(winRate * 20);
  const age = l.date ? Math.max(0, (today.getTime() - new Date(l.date).getTime()) / 864e5) : 999;
  s += age <= 14 ? 10 : age <= 30 ? 6 : age <= 90 ? 3 : 0;
  return Math.max(0, Math.min(100, Math.round(s)));
}

/** the day a deal is won when it is marked Won now: its EOI / reservation / contract date, else TODAY (never the day the lead came in) */
export function wonDateFor(l: Partial<Lead>, today: string): string {
  if (l.eoiApplicable === true && l.eoiDate) return l.eoiDate;
  return l.reservationDate || l.eoiDate || l.contractDate || today;
}
/** the day a deal counts in reports: EOI (when that is the path), else reservation, contract, won date, lead date */
export function closingDate(l: Partial<Lead>): string {
  if (l.wonDate) return l.wonDate;
  if (l.eoiApplicable === true && l.eoiDate) return l.eoiDate;
  return l.reservationDate || l.eoiDate || l.contractDate || (l.date || '').slice(0, 10);
}

export const CONTRACT_STEPS: { key: string; department: string; label: string; slaDays: number }[] = [
  { key: 'development', department: 'Development', label: 'Development', slaDays: 2 },
  { key: 'finance-revision', department: 'Finance', label: 'Finance – revision', slaDays: 2 },
  { key: 'legal', department: 'Legal', label: 'Legal', slaDays: 2 },
  { key: 'finance-signature', department: 'Finance', label: 'Finance – signature', slaDays: 2 },
  { key: 'cfo', department: 'CFO', label: 'CFO signature', slaDays: 2 },
  { key: 'ceo', department: 'CEO', label: 'CEO signature', slaDays: 2 },
];

// ---------------------------------------------------------------------------------------------
// Dropdown lists the administrator edits in Settings. The arrays above are changed IN PLACE, so every screen that imports
// them sees the new values on its next render. The defaults are kept for "Reset". The last saved copy is cached in the browser
// so the first paint already uses it.
// ---------------------------------------------------------------------------------------------
export interface DropdownLists {
  statuses?: { group: string; statuses: string[] }[];
  sources?: string[]; projects?: string[]; industries?: string[]; lostReasons?: string[]; lostCategories?: string[]; temperatures?: string[];
}
export const DEFAULT_LISTS: Required<DropdownLists> = JSON.parse(JSON.stringify({
  statuses: STATUS_GROUPS, sources: SOURCES, projects: PROJECTS, industries: INDUSTRIES, lostReasons: LOST_REASONS_TEAM, lostCategories: LOST_CATEGORIES, temperatures: TEMPERATURES,
}));
/** statuses the system's own rules depend on: they can be moved or renamed in the sheet below but never deleted */
export const PROTECTED_STATUSES = new Set<string>([...REQ_DATETIME, ...REQ_FOLLOWUP, ...ACTIVE_EXCLUDE, ...PIPELINE_STATUSES, ...LEGACY_STATUSES, 'New', 'Contacted']);
const swap = (a: string[], b?: string[]) => { if (Array.isArray(b) && b.length) a.splice(0, a.length, ...b.filter((x) => typeof x === 'string' && x.trim())); };
export function applyLists(o: DropdownLists | null | undefined) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o.statuses) && o.statuses.length) {
    const groups = o.statuses.map((g) => ({ group: String(g.group), statuses: (g.statuses || []).filter((x) => typeof x === 'string' && x.trim()) }));
    const have = new Set(groups.flatMap((g) => g.statuses));
    // a status the rules need is never lost, even if an old saved copy lacks it
    for (const d of DEFAULT_LISTS.statuses) for (const st of d.statuses) if (PROTECTED_STATUSES.has(st) && !have.has(st)) (groups.find((g) => g.group === d.group) || groups[0]).statuses.push(st);
    STATUS_GROUPS.splice(0, STATUS_GROUPS.length, ...groups);
    STATUSES.splice(0, STATUSES.length, ...groups.flatMap((g) => g.statuses));
  }
  swap(SOURCES, o.sources); swap(PROJECTS, o.projects); swap(INDUSTRIES, o.industries); swap(LOST_REASONS_TEAM, o.lostReasons); swap(LOST_CATEGORIES, o.lostCategories); swap(TEMPERATURES, o.temperatures);
}
try { const c = localStorage.getItem('crm_lists'); if (c) applyLists(JSON.parse(c)); } catch { /* defaults */ }
/** ask the server for the saved lists; true when they differ from what this browser was using */
export async function loadLists(): Promise<boolean> {
  try {
    const r = await fetch('/api/crm/lists'); if (!r.ok) return false;
    const j = await r.json(); const next = JSON.stringify(j || {});
    if (next === (localStorage.getItem('crm_lists') || '{}')) return false;
    try { localStorage.setItem('crm_lists', next); } catch { /* ignore */ }
    applyLists(j); return true;
  } catch { return false; }
}

/** automatic marker (not editable): somebody worked on the lead (any activity or any status other than New) */
export const isTouchedLead = (l: { touched?: boolean; status?: string }) => l.touched === true || (l.status || 'New') !== 'New';
