// Import engine for the sales team's 35-column lead sheet (the old CRM's export format).
// Pure functions: no network, no storage. CrmImportExport.tsx drives them, CrmDuplicates.tsx reuses the duplicate keys.
import type { Lead, TimelineEvent } from './types';
import { STATUSES, LEGACY_STATUSES, PRIORITIES, normSource, normProject, phoneIntl, closingDate } from './leadConfig';

export const XLSX_HEADERS = [
  'Lead ID', 'Lead Name', 'Reference No.', 'Company', 'Customer Number', 'Email', 'Lead Source', 'Project Interested In',
  'Customer Number 2', 'Requested Area (sqm)', 'Sold Area (sqm)', 'Plot Number', 'Industry', 'Nationality', 'Priority',
  'Qualification', 'Temperature', 'Status', 'Lost Reason', 'Meeting Date', 'Meeting Time', 'EOI Applicable', 'EOI Date',
  'Reservation Date', 'Contract Date', 'Total Sold Value (EGP)', 'Assigned To', 'Next Follow-up (YYYY-MM-DD)', 'Deal Value (EGP)',
  'Cash Status', 'Offer Sent (YES/NO)', 'Offer Date (YYYY-MM-DD)', 'Notes', 'Lead Date (YYYY-MM-DD)', 'Last Contact Date',
];

// ---------------------------------------------------------------------------------------------
// duplicate keys (same rules as the old CRM: contact details only, never names)
// ---------------------------------------------------------------------------------------------
const GENERIC_EMAIL = new Set(['', '-', '--', '.', '..', 'n/a', 'na', 'none', 'no', 'test', 'company', 'شركة']);
const IGNORE_EMAILS = new Set(['info@', 'no@no.com', 'none@none.com', 'test@test.com', 'na@na.com', 'email@email.com', 'x@x.com']);

export function dupPhoneKey(s: string | undefined | null): string {
  const raw = String(s ?? '');
  const i = phoneIntl(raw);
  if (i) return i;
  const d = raw.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}
export function dupEmailKey(s: string | undefined | null): string {
  const e = String(s ?? '').trim().toLowerCase();
  if (e.length < 3 || GENERIC_EMAIL.has(e) || IGNORE_EMAILS.has(e)) return '';
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : '';
}
/** every contact key of a lead (phone, phone2, e-mail), already prefixed by kind */
export function leadKeys(l: Pick<Lead, 'phoneNumber' | 'phone2' | 'email'>): string[] {
  const out: string[] = [];
  const a = dupPhoneKey(l.phoneNumber); if (a) out.push('p' + a);
  const b = dupPhoneKey(l.phone2); if (b && b !== a) out.push('p' + b);
  const e = dupEmailKey(l.email); if (e) out.push('e' + e);
  return out;
}

// ---------------------------------------------------------------------------------------------
// value normalisers
// ---------------------------------------------------------------------------------------------
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arToLatin = (s: string) => s.replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c))).replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));

/** trims, removes control characters and the apostrophe that an export puts in front of formula-looking text */
export function cleanCell(v: unknown): string {
  let s = String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (/^'[=+\-@]/.test(s)) s = s.slice(1);
  return s.length > 5000 ? s.slice(0, 5000) : s;
}

const isoOk = (y: number, m: number, d: number) => {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
/** Excel serial, dd/mm/yyyy (DAY first), dd-mm-yyyy, yyyy-m-d[ time]. Anything else: '' */
export function normDate(v: string): string {
  const s = arToLatin(cleanCell(v));
  if (!s) return '';
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n < 20000 || n > 80000) return '';
    const d = new Date(Math.round((n - 25569) * 864e5));
    return isoOk(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return isoOk(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s].*)?$/);
  if (m) return isoOk(+m[3], +m[2], +m[1]);
  return '';
}
export function normTime(v: string): string {
  const s = arToLatin(cleanCell(v)).toLowerCase();
  if (!s) return '';
  if (/^0?\.\d+$|^0\.\d+$|^\d\.\d+$/.test(s) && Number(s) < 1) {
    const mins = Math.round(Number(s) * 1440);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/);
  if (!m) return '';
  let h = +m[1]; const mi = +m[2];
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
export function parseNum(v: string): number {
  const s = arToLatin(cleanCell(v)).replace(/egp|£|e£|usd|\$/gi, '').replace(/[,\s]/g, '');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
/** "2,500 sqm" -> 2500; "2,500 - 5,000" -> 3750 (mid-point, flagged); nothing usable -> '' */
export function parseAreaInfo(v: string): { value: number | ''; range?: boolean; bad?: boolean } {
  let s = arToLatin(cleanCell(v)).toLowerCase();
  if (!s) return { value: '' };
  s = s.replace(/متر\s*مربع|م²|sq\.?\s*m(eters?)?|sqm|m2|m²|meters?|metres?/g, ' ').replace(/\s+/g, ' ').trim();
  const r = s.match(/^(\d[\d,.]*)\s*(?:-|–|—|~|to|till|until|إلى|الى)\s*(\d[\d,.]*)$/);
  if (r) {
    const a = parseFloat(r[1].replace(/,/g, '')), b = parseFloat(r[2].replace(/,/g, ''));
    if (a > 0 && b > 0) return { value: Math.round((a + b) / 2), range: true };
  }
  const n = s.match(/^(\d[\d,]*(?:\.\d+)?)$/);
  if (n) { const x = parseFloat(n[1].replace(/,/g, '')); return x > 0 ? { value: x } : { value: '' }; }
  return /\d/.test(s) ? { value: '', bad: true } : { value: '' };
}
export function normPriority(v: string): string {
  const s = cleanCell(v).toLowerCase();
  if (!s) return '';
  if (/^(vip|في اي بي|مهم جدا|مهم جداً)$/.test(s)) return 'VIP';
  if (/^(high|urgent|hot|عالي|مرتفع|عاجل)$/.test(s)) return 'High';
  if (/^(med|medium|normal|متوسط)$/.test(s)) return 'Medium';
  if (/^(low|cold|منخفض|ضعيف)$/.test(s)) return 'Low';
  return PRIORITIES.find((p) => p.toLowerCase() === s) || '';
}
const dashFold = (s: string) => s.toLowerCase().replace(/[–—‑-]/g, '-').replace(/\s+/g, ' ').trim();
const STATUS_LOOKUP = (() => { const m = new Map<string, string>(); for (const s of [...STATUSES, ...LEGACY_STATUSES]) m.set(dashFold(s), s); return m; })();
export const normStatus = (v: string): string => STATUS_LOOKUP.get(dashFold(cleanCell(v))) || '';

// ---------------------------------------------------------------------------------------------
// owner matcher: 12 ordered strategies; the first level that finds anyone decides; two or more people = ambiguous, never a guess
// ---------------------------------------------------------------------------------------------
export interface Person { id: string; name: string; email?: string; role?: string }
export type OwnerResult = { kind: 'matched'; person: Person; level: number } | { kind: 'ambiguous'; names: string[] } | { kind: 'none' } | { kind: 'blank' };

const TITLES = new Set(['mr', 'mrs', 'miss', 'ms', 'dr', 'eng', 'engineer', 'prof', 'mohandes', 'م', 'مهندس', 'دكتور']);
export function normPersonName(s: string): string {
  const t = arToLatin(String(s ?? '')).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[._]+/g, ' ').replace(/[^\p{L}\s]/gu, ' ');
  return t.split(/\s+/).filter((w) => w && !TITLES.has(w)).join(' ');
}
const tlit = (w: string) => w.replace(/ph/g, 'f').replace(/(.)\1+/g, '$1').replace(/e/g, 'i').replace(/o/g, 'u').replace(/y(?=\s|$)/g, 'i');
function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let min = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v); if (v < min) min = v;
    }
    if (min > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

interface PInfo { p: Person; norm: string; words: string[]; email: string; local: string; tl: string }
export function makeOwnerMatcher(people: Person[]) {
  const infos: PInfo[] = people.map((p) => {
    const norm = normPersonName(p.name);
    const email = String(p.email || '').trim().toLowerCase();
    return { p, norm, words: norm.split(' ').filter(Boolean), email, local: email.split('@')[0] || '', tl: tlit(norm) };
  });
  const cache = new Map<string, OwnerResult>();
  const pick = (hits: PInfo[], level: number): OwnerResult | null => {
    if (!hits.length) return null;
    return hits.length === 1 ? { kind: 'matched', person: hits[0].p, level } : { kind: 'ambiguous', names: hits.map((h) => h.p.name) };
  };
  return (rawIn: string): OwnerResult => {
    const raw = cleanCell(rawIn);
    if (!raw || /^(n\/a|na|none|-|--|unassigned|not assigned)$/i.test(raw)) return { kind: 'blank' };
    const hit = cache.get(raw); if (hit) return hit;
    const res = run(raw);
    cache.set(raw, res);
    return res;
  };
  function run(raw: string): OwnerResult {
    const rl = raw.toLowerCase();
    const norm = normPersonName(raw);
    const words = norm.split(' ').filter(Boolean);
    const compact = norm.replace(/ /g, '');
    const levels: ((i: PInfo) => boolean)[] = [
      (i) => !!norm && i.norm === norm,                                                           // 1 exact
      (i) => rl.includes('@') && i.email === rl,                                                  // 2 e-mail
      (i) => { const l = rl.includes('@') ? rl.split('@')[0] : rl.replace(/\s+/g, ''); return !!l && !!i.local && i.local === l; }, // 3 local part
      (i) => words.length >= 2 && i.words.length >= 2 && i.words[0] === words[0] && i.words[i.words.length - 1] === words[words.length - 1], // 4 first + last
      (i) => words.length >= 2 && words.every((w) => i.words.includes(w)),                        // 5 all written words
      (i) => words.length === 1 && i.words[0] === words[0],                                       // 6 first name only
      (i) => !!norm && norm.length >= 3 && (i.norm.startsWith(norm) || norm.startsWith(i.norm)) && i.norm.length >= 3, // 7 prefix of each other
      (i) => words.length === 1 && i.words.includes(words[0]),                                    // 8 one word = any part
      (i) => words.length === 1 && words[0].length >= 3 && i.words.some((w) => w.startsWith(words[0])), // 9 prefix of a part
      (i) => words.length === 1 && words[0].length >= 3 && i.words.some((w) => tlit(w) === tlit(words[0])), // 10 spelling variants, one word
      (i) => words.length >= 2 && i.tl === tlit(norm),                                            // 11 spelling variants, full
      (i) => {                                                                                    // 12 one typo
        if (compact.length < 5) return false;
        const budget = compact.length >= 7 ? 2 : 1;
        if (lev(compact, i.norm.replace(/ /g, ''), budget) <= budget) return true;
        return words.length === 1 && i.words.some((w) => w.length >= 5 && lev(words[0], w, 1) <= 1);
      },
    ];
    for (let n = 0; n < levels.length; n++) {
      const r = pick(infos.filter(levels[n]), n + 1);
      if (r) return r;
    }
    return { kind: 'none' };
  }
}

// ---------------------------------------------------------------------------------------------
// reading the sheet
// ---------------------------------------------------------------------------------------------
const compact = (s: string) => arToLatin(s).toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');

interface Cols { [k: string]: number }
function findCols(headers: string[]): Cols {
  const hs = headers.map(compact);
  const find = (prefixes: string[], not?: RegExp) => {
    for (const p of prefixes) {
      const i = hs.findIndex((h) => h.startsWith(p) && !(not && not.test(h)));
      if (i >= 0) return i;
    }
    return -1;
  };
  const c: Cols = {
    id: find(['leadid']),
    name: find(['leadname', 'customername', 'clientname', 'name']),
    company: find(['company']),
    email: find(['email']),
    source: find(['leadsource', 'source']),
    project: find(['project']),
    industry: find(['industry']),
    status: find(['status'], /^cash/),
    priority: find(['priority']),
    refNo: find(['referenceno', 'reference']),
    area: find(['landsize', 'requestedarea', 'requiredsize', 'area', 'size']),
    soldArea: find(['soldarea']),
    plotNo: find(['plotnumber', 'plotno']),
    nationality: find(['nationality']),
    qualification: find(['qualification']),
    temperature: find(['temperature']),
    lostReason: find(['lostreason']),
    meetingDate: find(['meetingdate']),
    meetingTime: find(['meetingtime']),
    eoiApplicable: find(['eoiapplicable']),
    eoiDate: find(['eoidate']),
    reservationDate: find(['reservationdate']),
    contractDate: find(['contractdate']),
    totalSold: find(['totalsold']),
    owner: find(['assigned', 'owner', 'salesperson', 'salesrep', 'responsible', 'agent']),
    nextFollow: find(['nextfollow']),
    dealValue: find(['dealvalue']),
    offerSent: find(['offersent']),
    offerDate: find(['offerdate']),
    notes: find(['notes', 'description', 'comment']),
    leadDate: find(['leaddate', 'created', 'date']),
    lastContact: find(['lastcontact']),
    qualNotes: find(['qualificationnotes']),
    lostCategory: find(['lostcategory']),
  };
  // Era rule: when a "Phone" column exists, "Customer Number" is the reference number; otherwise it IS the phone.
  const phoneCol = find(['phone', 'mobile'], /2$/);
  const custCol = find(['customernumber'], /2$/);
  c.phone = phoneCol >= 0 ? phoneCol : custCol;
  if (phoneCol >= 0 && custCol >= 0 && c.refNo < 0) c.refNo = custCol;
  c.phone2 = find(['customernumber2', 'phone2', 'mobile2', 'alternative']);
  return c;
}

export interface PlanRow {
  rowNo: number;                       // row number in the file (header = 1)
  name: string;
  phone: string;
  kind: 'new' | 'update' | 'unchanged' | 'invalid';
  errors: string[];
  warnings: string[];
  dup?: { of: string; scope: 'system' | 'file'; via: string };
  owner?: 'matched' | 'ambiguous' | 'none' | 'blank' | 'self';
  ownerRaw?: string;
  ownerNote?: string;
  lead?: Lead;
}
export interface Plan {
  fatal?: string;
  rows: PlanRow[];
  sheetRows: number;
  corrected: number;                   // phone numbers repaired
  protectedIgnored: boolean;
}
export interface PlanCtx {
  existing: Lead[];
  people: Person[];
  canOwners: boolean;                  // Sales Operation / admin
  scopeAll: boolean;                   // same, as far as the browser can tell (Won / protected fields)
  leaveUnassigned?: boolean;           // marketing: imported leads go to the routing queue, not to the person importing
  me: { id: string; name: string };
  userLabel: string;
  fileName: string;
  today: string;
  dupMode: 'skip' | 'import';
  updateExisting: boolean;
  history?: Map<string, HistRow[]>;    // the "Comments & Notes" sheet, by lead id (migration from the old CRM)
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const uid = () => Math.random().toString(36).slice(2, 11);
const put = (o: any, k: string, v: any) => { if (v !== '' && v !== undefined && v !== null && !(typeof v === 'number' && Number.isNaN(v))) o[k] = v; };

// ---------------------------------------------------------------------------------------------
// the history sheet ("Comments & Notes"): one row per comment, note, assignment, status change or call outcome
// ---------------------------------------------------------------------------------------------
export interface HistRow { date: string; time: string; by: string; type: string; comment: string }
export function parseHistory(rows: string[][]): Map<string, HistRow[]> {
  const out = new Map<string, HistRow[]>();
  if (rows.length < 2) return out;
  const hs = rows[0].map((h) => compact(cleanCell(h)));
  const at = (n: string) => hs.indexOf(n);
  const ci = { id: at('leadid'), date: at('date'), time: at('time'), by: at('writtenby'), type: at('type'), text: at('comment') };
  if (ci.id < 0 || ci.text < 0 || ci.type < 0) return out;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const id = cleanCell(r[ci.id]).toLowerCase(); const text = String(r[ci.text] ?? '').trim();
    if (!id || !text) continue;
    const e: HistRow = { date: normDate(cleanCell(r[ci.date])), time: ci.time >= 0 ? normTime(cleanCell(r[ci.time])) : '', by: ci.by >= 0 ? cleanCell(r[ci.by]) : '', type: cleanCell(r[ci.type]), comment: text.slice(0, 4000) };
    const a = out.get(id); if (a) a.push(e); else out.set(id, [e]);
  }
  return out;
}
const histStamp = (e: HistRow): string => {
  const d = e.date || new Date().toISOString().slice(0, 10);
  const t = e.time && /^\d{1,2}:\d{2}/.test(e.time) ? e.time.padStart(5, '0').slice(0, 5) : '12:00';
  const ms = Date.parse(`${d}T${t}:00+03:00`);          // Cairo time in the old CRM
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
};
/** comments stay comments; assignments, status changes, call outcomes and system lines become the lead's timeline (notes and qualification
 *  notes already sit in the lead's own columns). Returns what to set on the lead. */
export function applyHistory(lead: any, entries: HistRow[]) {
  const comments: any[] = []; const events: TimelineEvent[] = [];
  let firstContact = '', lastAssign = '';
  entries.forEach((e, n) => {
    const ts = histStamp(e);
    const id = 'h_' + uid() + n;
    if (e.type === 'Comment') comments.push({ id, date: ts.slice(0, 10), time: (e.time || '').slice(0, 5), user: e.by || 'Imported', comment: e.comment, isPrivate: false });
    else if (e.type === 'Assignment') { events.push({ id, timestamp: ts, type: 'Assignment', user: e.by || 'System', title: 'Assignment', description: e.comment }); if (!lastAssign || ts > lastAssign) lastAssign = ts; }
    else if (e.type === 'Status change') { events.push({ id, timestamp: ts, type: 'Status Change', user: e.by || 'System', title: 'Status changed', description: e.comment }); if (!firstContact || ts < firstContact) firstContact = ts; }
    else if (e.type === 'Call outcome') { events.push({ id, timestamp: ts, type: 'Call', user: e.by || 'System', title: 'Call', description: e.comment }); if (!firstContact || ts < firstContact) firstContact = ts; }
    else if (e.type === 'System') events.push({ id, timestamp: ts, type: 'Import', user: e.by || 'System', title: 'System', description: e.comment });
  });
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  comments.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  lead.comments = comments;
  lead.timeline = [...events, ...(lead.timeline || [])];
  lead.assignedDate = lastAssign || (lead.date ? `${lead.date}T09:00:00.000Z` : lead.assignedDate);
  if (firstContact && lead.status !== 'New') lead.firstContactAt = firstContact;
  const last = [...events.map((x) => x.timestamp), ...comments.map((c) => histStamp({ date: c.date, time: c.time } as HistRow))].sort().pop();
  if (last) lead.lastUpdated = last;
}

export async function buildPlan(headers: string[], body: string[][], ctx: PlanCtx, onProgress?: (done: number, total: number) => void): Promise<Plan> {
  const cols = findCols(headers);
  const plan: Plan = { rows: [], sheetRows: body.length, corrected: 0, protectedIgnored: false };
  if (cols.name < 0) { plan.fatal = "Import failed: couldn't find a Lead Name column."; return plan; }

  const byId = new Map<string, Lead>();
  const keyOwner = new Map<string, string>();      // contact key -> lead id (system) or 'row N' (file)
  for (const l of ctx.existing) {
    if (l.mergedInto) continue;
    byId.set(String(l.id).toLowerCase(), l);
    if (l.legacyId) byId.set(String(l.legacyId).toLowerCase(), l);
    for (const k of leadKeys(l)) if (!keyOwner.has(k)) keyOwner.set(k, l.id);
  }
  const fileKey = new Map<string, number>();
  const matchOwner = makeOwnerMatcher(ctx.people);
  const seenIds = new Set<string>();
  const nowIso = new Date().toISOString();
  const cell = (r: string[], k: string) => (cols[k] >= 0 ? cleanCell(r[cols[k]]) : '');

  for (let i = 0; i < body.length; i++) {
    if (i % 300 === 0) { onProgress?.(i, body.length); await tick(); }
    const r = body[i];
    if (!r || !r.some((x) => cleanCell(x))) continue;      // empty line
    const rowNo = i + 2;
    const row: PlanRow = { rowNo, name: cell(r, 'name'), phone: '', kind: 'new', errors: [], warnings: [] };
    plan.rows.push(row);
    const err = (m: string) => row.errors.push(m);
    const warn = (m: string) => row.warnings.push(m);

    if (!row.name) { err('No lead name'); row.kind = 'invalid'; continue; }

    // ---- fields (blank cells are simply absent: they never clear anything)
    const f: Record<string, any> = {};
    let rawPhone = cell(r, 'phone');
    let rawEmail = cell(r, 'email');
    // the old data has e-mails typed in the phone column and phones ("p:+20…") typed in the e-mail column
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
    if (EMAIL_RE.test(rawPhone)) { if (!rawEmail || !EMAIL_RE.test(rawEmail)) rawEmail = rawPhone; rawPhone = ''; }
    if (rawEmail && !EMAIL_RE.test(rawEmail)) {
      const asPhone = rawEmail.replace(/^p:\s*/i, '');
      if (!rawPhone && phoneIntl(asPhone)) rawPhone = asPhone;
    }
    if (rawPhone) {
      const p = phoneIntl(rawPhone);
      if (p) { f.phoneNumber = p; if (p !== rawPhone) plan.corrected++; }
      else { f.phoneNumber = rawPhone; warn(`Phone "${rawPhone}" could not be corrected: kept as typed`); }
    }
    row.phone = f.phoneNumber || '';
    const rawPhone2 = cell(r, 'phone2');
    if (rawPhone2) { const p = phoneIntl(rawPhone2); f.phone2 = p || rawPhone2; if (!p) warn(`Second phone "${rawPhone2}" could not be corrected`); }
    const em = rawEmail.toLowerCase();
    if (em) { if (EMAIL_RE.test(em)) f.email = em; else if (!/^(n\/a|na|none|-|--)$/.test(em) && !/^p:/.test(em)) warn(`E-mail "${em.slice(0, 40)}" is not valid: ignored`); }
    put(f, 'companyName', cell(r, 'company'));
    const src = normSource(cell(r, 'source')); put(f, 'source', src);
    put(f, 'project', normProject(cell(r, 'project')));
    put(f, 'industry', cell(r, 'industry'));
    put(f, 'nationality', cell(r, 'nationality'));
    put(f, 'refNo', cell(r, 'refNo'));
    put(f, 'plotNo', cell(r, 'plotNo'));
    put(f, 'lostReason', cell(r, 'lostReason'));
    put(f, 'notes', cell(r, 'notes'));
    put(f, 'qualNotes', cell(r, 'qualNotes'));
    put(f, 'lostCategory', cell(r, 'lostCategory'));
    const rawPrio = cell(r, 'priority');
    if (rawPrio) { const p = normPriority(rawPrio); if (p) f.priority = p; else warn(`Priority "${rawPrio}" not recognised`); }
    const q = cell(r, 'qualification').toLowerCase();
    if (q) { if (q.startsWith('qual')) f.qualification = 'Qualified'; else if (q.startsWith('unq') || q.startsWith('not q')) f.qualification = 'Unqualified'; else warn(`Qualification "${q}" not recognised`); }
    const t = cell(r, 'temperature').toLowerCase();
    if (t) { const m = ['Hot', 'Warm', 'Cold'].find((x) => x.toLowerCase() === t); if (m) f.temperature = m; else warn(`Temperature "${t}" not recognised`); }
    const area = parseAreaInfo(cell(r, 'area'));
    if (area.value !== '') { f.requiredSize = area.value; if (area.range) warn(`Requested area "${cell(r, 'area')}" imported as the mid-point ${area.value}`); }
    else if (area.bad) warn(`Requested area "${cell(r, 'area')}" could not be read`);
    for (const [k, col, label] of [['soldArea', 'soldArea', 'Sold area'], ['totalSoldValue', 'totalSold', 'Total sold value'], ['dealValue', 'dealValue', 'Deal value']] as const) {
      const s = cell(r, col);
      if (!s) continue;
      const n = parseNum(s);
      if (Number.isFinite(n)) f[k] = n; else warn(`${label} "${s.slice(0, 30)}" is not a number: ignored`);
    }
    for (const [k, col, label] of [['meetingDate', 'meetingDate', 'Meeting date'], ['eoiDate', 'eoiDate', 'EOI date'], ['reservationDate', 'reservationDate', 'Reservation date'], ['contractDate', 'contractDate', 'Contract date'],
      ['nextFollowUpDate', 'nextFollow', 'Next follow-up'], ['offerDate', 'offerDate', 'Offer date'], ['lastContactDate', 'lastContact', 'Last contact date'], ['date', 'leadDate', 'Lead date']] as const) {
      const s = cell(r, col);
      if (!s) continue;
      const d = normDate(s);
      if (d) f[k] = d; else warn(`${label} "${s.slice(0, 20)}" is not a valid date (use YYYY-MM-DD or DD/MM/YYYY): ignored`);
    }
    const mt = cell(r, 'meetingTime');
    if (mt) { const x = normTime(mt); if (x) f.meetingTime = x; else warn(`Meeting time "${mt}" not recognised`); }
    const eoi = cell(r, 'eoiApplicable').toLowerCase();
    if (/^y/.test(eoi)) f.eoiApplicable = true; else if (/^n/.test(eoi)) f.eoiApplicable = false;
    const os = cell(r, 'offerSent');
    if (os) f.offerSent = /^(yes|y|true|1)$/i.test(os);
    const st = cell(r, 'status');
    let status = '';
    if (st) { status = normStatus(st); if (!status) warn(`Status "${st.slice(0, 40)}" is not one of the CRM's statuses`); }

    // ---- existing lead?
    const fileId = cell(r, 'id');
    const ex = fileId ? byId.get(fileId.toLowerCase()) : undefined;
    if (fileId && seenIds.has(fileId.toLowerCase())) { err(`Lead ID ${fileId} appears twice in the file`); row.kind = 'invalid'; continue; }
    if (fileId) seenIds.add(fileId.toLowerCase());

    if (ex) {
      // ---------------- update ----------------
      if (!ctx.updateExisting) { row.kind = 'unchanged'; warn(`Lead ${ex.id} already exists: left as it is (updates are switched off)`); continue; }
      const patch: Record<string, any> = { ...f };
      if (status) patch.status = status;
      if (!ctx.scopeAll) {
        for (const k of ['source', 'phoneNumber', 'email', 'priority', 'date']) if (k in patch && String(patch[k]) !== String((ex as any)[k] ?? '')) plan.protectedIgnored = true;
        for (const k of ['source', 'phoneNumber', 'email', 'priority', 'date']) delete patch[k];
      }
      const ownerRaw = cell(r, 'owner');
      if (ownerRaw && ctx.canOwners) {
        const o = matchOwner(ownerRaw);
        row.ownerRaw = ownerRaw;
        if (o.kind === 'matched') {
          row.owner = 'matched';
          if (o.person.id !== ex.assignedSalespersonId) { patch.assignedSalespersonId = o.person.id; patch.assignedSalespersonName = o.person.name; }
        } else if (o.kind === 'ambiguous') { row.owner = 'ambiguous'; row.ownerNote = `More than one match: ${o.names.slice(0, 3).join(', ')}`; warn(`Owner "${ownerRaw}": ${row.ownerNote}. Owner left as it is`); }
        else { row.owner = 'none'; row.ownerNote = 'No matching team member'; warn(`Owner "${ownerRaw}": no matching team member. Owner left as it is`); }
      } else if (ownerRaw) plan.protectedIgnored = true;
      // only fields that really differ
      const diff: string[] = [];
      for (const [k, v] of Object.entries(patch)) if (JSON.stringify((ex as any)[k] ?? '') !== JSON.stringify(v)) diff.push(k);
      if (!diff.length) { row.kind = 'unchanged'; continue; }
      const nextStatus = patch.status ?? ex.status;
      const nextDeal = patch.dealValue ?? ex.dealValue;
      if (patch.status === 'Won' && ex.status !== 'Won' && !(Number(nextDeal) > 0)) { err('A Won lead needs the deal value (EGP)'); row.kind = 'invalid'; continue; }
      if (patch.status === 'Lost' && ex.status !== 'Lost' && !(patch.lostReason ?? ex.lostReason)) { err('A Lost lead needs the lost reason'); row.kind = 'invalid'; continue; }
      void nextStatus;
      const ev: TimelineEvent = {
        id: 'imp_' + uid(), timestamp: nowIso, type: 'Import', user: ctx.userLabel, title: 'Updated from Excel import',
        description: `Row ${rowNo} of ${ctx.fileName}: ${diff.map((d) => d).join(', ')}` + (patch.status && patch.status !== ex.status ? `. Status ${ex.status} → ${patch.status}` : ''),
      };
      row.lead = { ...ex, ...patch, lastUpdated: nowIso, timeline: [...(ex.timeline || []), ev] } as Lead;
      row.kind = 'update';
      row.phone = (row.lead.phoneNumber as string) || '';
      continue;
    }

    // ---------------- new lead ----------------
    if (!f.phoneNumber && !f.email) warn('No phone and no e-mail: duplicates cannot be checked for this row');

    // owner
    let assignee: Person | null = null;
    let legacyOwner = '';
    const ownerRaw = cell(r, 'owner');
    if (ctx.canOwners) {
      if (!ownerRaw) row.owner = 'blank';
      else {
        row.ownerRaw = ownerRaw;
        const o = matchOwner(ownerRaw);
        if (o.kind === 'matched') { assignee = o.person; row.owner = 'matched'; }
        else if (o.kind === 'ambiguous') { row.owner = 'ambiguous'; row.ownerNote = `More than one match: ${o.names.slice(0, 3).join(', ')}`; legacyOwner = ownerRaw; }
        else if (o.kind === 'none') { row.owner = 'none'; row.ownerNote = 'No matching team member'; legacyOwner = ownerRaw; }
        else row.owner = 'blank';
      }
    } else {
      if (ctx.leaveUnassigned) row.owner = 'blank';
      else { assignee = { id: ctx.me.id, name: ctx.me.name }; row.owner = 'self'; }
    }

    // status
    let finalStatus = status && status !== 'Duplicate' ? status : 'New';
    if (st && !status) finalStatus = 'New';
    if (finalStatus === 'Won' && !ctx.scopeAll) { finalStatus = 'New'; warn('Won can only be set by Sales Operation: imported as New'); }
    if (finalStatus === 'Won' && !(Number(f.dealValue) > 0)) warn('Won without a deal value');
    if (finalStatus === 'Lost' && !f.lostReason) warn('Lost without a reason');

    // duplicates (phones, second phone, e-mail), against the system first, then earlier rows of the file
    const keys = leadKeys({ phoneNumber: f.phoneNumber, phone2: f.phone2, email: f.email });
    for (const k of keys) {
      const sys = keyOwner.get(k);
      if (sys) { row.dup = { of: sys, scope: 'system', via: k[0] === 'e' ? 'e-mail' : 'phone' }; break; }
      const fr = fileKey.get(k);
      if (fr !== undefined) { row.dup = { of: `row ${fr}`, scope: 'file', via: k[0] === 'e' ? 'e-mail' : 'phone' }; break; }
    }
    const lead: any = {
      id: '', date: f.date || ctx.today, source: f.source || '', project: f.project || '', customerName: row.name,
      phoneNumber: f.phoneNumber || '', email: f.email || '', requiredSize: f.requiredSize ?? '', priority: f.priority || 'Medium',
      status: finalStatus, lastUpdated: nowIso, expectedClosingDate: '', description: '', comments: [], attachments: [],
    };
    for (const k of ['companyName', 'phone2', 'industry', 'nationality', 'refNo', 'plotNo', 'notes', 'lostReason', 'lostCategory', 'qualNotes', 'qualification', 'temperature', 'soldArea', 'totalSoldValue', 'dealValue',
      'meetingDate', 'meetingTime', 'eoiApplicable', 'eoiDate', 'reservationDate', 'contractDate', 'nextFollowUpDate', 'offerSent', 'offerDate', 'lastContactDate']) put(lead, k, f[k]);
    if (assignee) { lead.assignedSalespersonId = assignee.id; lead.assignedSalespersonName = assignee.name; lead.assignedDate = nowIso; }
    if (legacyOwner) lead.legacyOwnerName = legacyOwner;
    if (fileId) lead.legacyId = fileId;
    if (finalStatus === 'Won') {
      lead.wonDate = closingDate(lead) || ctx.today;
      if (ctx.scopeAll && Number(lead.dealValue) > 0) lead.cashStatus = 'pending';
    }
    if (finalStatus === 'Lost' && !lead.lostReason) lead.lostReason = 'Imported';
    lead.timeline = [{
      id: 'imp_' + uid(), timestamp: nowIso, type: 'Import', user: ctx.userLabel, title: 'Imported from Excel',
      description: `Row ${rowNo} of ${ctx.fileName}` + (fileId ? ` (previous Lead ID ${fileId})` : '') + (legacyOwner ? `. Owner written as "${legacyOwner}" (not matched: left unassigned)` : ''),
    }];
    if (fileId && ctx.history?.has(fileId.toLowerCase())) applyHistory(lead, ctx.history.get(fileId.toLowerCase())!);
    row.lead = lead as Lead;
    // later rows of the file are compared with this one (also when it is a duplicate itself, like the old engine)
    for (const k of keys) if (!fileKey.has(k) && !keyOwner.has(k)) fileKey.set(k, rowNo);
  }
  onProgress?.(body.length, body.length);
  return plan;
}

export interface PlanSummary { total: number; news: number; updates: number; unchanged: number; invalid: number; dupSystem: number; dupFile: number; ownerNot: number; warnings: number; toImport: number }
export function summarize(plan: Plan, dupMode: 'skip' | 'import'): PlanSummary {
  const s: PlanSummary = { total: plan.rows.length, news: 0, updates: 0, unchanged: 0, invalid: 0, dupSystem: 0, dupFile: 0, ownerNot: 0, warnings: 0, toImport: 0 };
  for (const r of plan.rows) {
    if (r.warnings.length) s.warnings++;
    if (r.kind === 'invalid') s.invalid++;
    else if (r.kind === 'unchanged') s.unchanged++;
    else if (r.kind === 'update') { s.updates++; s.toImport++; if (r.owner === 'ambiguous' || r.owner === 'none') s.ownerNot++; }
    else {
      if (r.dup) { if (r.dup.scope === 'system') s.dupSystem++; else s.dupFile++; }
      if (r.owner === 'ambiguous' || r.owner === 'none') s.ownerNot++;
      if (r.dup && dupMode === 'skip') continue;
      s.news++; s.toImport++;
    }
  }
  return s;
}

/** rows with something to say, for the downloadable report */
export function reportRows(plan: Plan, dupMode: 'skip' | 'import'): string[][] {
  const out: string[][] = [['Row', 'Lead name', 'Phone', 'Result', 'Details']];
  for (const r of plan.rows) {
    const items: [string, string][] = [];
    if (r.kind === 'invalid') items.push(['Error', r.errors.join('; ')]);
    if (r.dup) items.push([dupMode === 'skip' && r.kind === 'new' ? 'Duplicate (skipped)' : 'Duplicate (imported)', `Same ${r.dup.via} as ${r.dup.of}`]);
    if (r.owner === 'ambiguous' || r.owner === 'none') items.push(['Owner not matched', `"${r.ownerRaw}": ${r.ownerNote}`]);
    if (r.kind === 'unchanged' && !r.warnings.length) continue;
    for (const w of r.warnings) items.push(['Warning', w]);
    for (const [res, det] of items) out.push([String(r.rowNo), r.name, r.phone, res, det]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------------------------
const d10 = (s?: string) => (s ? String(s).slice(0, 10) : '');
export function leadToRow(l: Lead): (string | number)[] {
  const v = (x: unknown) => (x === undefined || x === null ? '' : (x as string | number));
  return [
    l.id, l.customerName, v(l.refNo), v(l.companyName), l.phoneNumber, l.email, l.source, l.project, v(l.phone2), v(l.requiredSize), v(l.soldArea), v(l.plotNo),
    v(l.industry), v(l.nationality), l.priority, v(l.qualification), v(l.temperature), l.status, v(l.lostReason), d10(l.meetingDate), v(l.meetingTime),
    l.eoiApplicable === true ? 'YES' : l.eoiApplicable === false ? 'NO' : '', d10(l.eoiDate), d10(l.reservationDate), d10(l.contractDate), v(l.totalSoldValue),
    l.assignedSalespersonName || l.legacyOwnerName || '', d10(l.nextFollowUpDate), v(l.dealValue), v(l.cashStatus),
    l.offerSent === true ? 'YES' : l.offerSent === false ? 'NO' : '', d10(l.offerDate), (l.notes || l.description || ''), d10(l.date), d10(l.lastContactDate),
  ];
}
