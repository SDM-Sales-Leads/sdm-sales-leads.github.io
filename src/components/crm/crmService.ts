import DOMPurify from "dompurify";
import { toast } from 'sonner';
import { Lead, Contact, Company, EmailImportLog, QueueSettings, SalespersonTask, SalespersonActivity, TimelineEvent } from './types';
import { INITIAL_QUEUE_SETTINGS } from './mockData';
import { phoneIntl } from './leadConfig';
import { withSideEffects } from './leadRules';

// Phone number normalizer
export function normalizePhone(phone: string): string {
  let num = String(phone ?? '').trim().replace(/[^\d+]/g, ''); // strip non-digits except +
  num = num.replace(/^\+/, ''); // remove leading +
  if (num.startsWith('0020') && num.length === 14) num = '0' + num.substring(4);
  else if (num.startsWith('20') && num.length === 12) num = '0' + num.substring(2);
  else if (num.length === 10 && num.startsWith('1')) num = '0' + num;
  return num;
}

type Kind = 'leads' | 'contacts' | 'companies' | 'tasks' | 'activities' | 'email-logs';
const STORE: Record<Kind, string> = {
  leads: 'crm_leads', contacts: 'crm_contacts', companies: 'crm_companies',
  tasks: 'crm_tasks', activities: 'crm_activities', 'email-logs': 'crm_email_logs',
};
const KINDS = Object.keys(STORE) as Kind[];

// The server is the source of truth. Lists are cached for this tab only (see lib/storageGuard.ts).
// `baseline` remembers what the server last confirmed, so a save sends ONLY the rows that changed.
const memory: Partial<Record<Kind, any[]>> = {};
const baseline: Record<Kind, Map<string, string>> = {
  leads: new Map(), contacts: new Map(), companies: new Map(), tasks: new Map(), activities: new Map(), 'email-logs': new Map(),
};
const pending: Record<Kind, number> = { leads: 0, contacts: 0, companies: 0, tasks: 0, activities: 0, 'email-logs': 0 };
const queues: Partial<Record<Kind, Promise<void>>> = {};
const ids: Record<'lead' | 'contact' | 'company', string[]> = { lead: [], contact: [], company: [] };

let queueSettingsLoaded = false, queueSettingsAt = 0, lastDeltaAt = 0, autoUsers = 0;
let autoTimer: ReturnType<typeof setInterval> | null = null;
let autoOff: (() => void) | null = null;

/** same phone = same normalised international number (or the last 10 digits when it cannot be repaired) */
function dupPhoneKey(raw?: string): string {
  const p = phoneIntl(raw);
  if (p) return p;
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}
const GENERIC_LOCAL = new Set(['info', 'no', 'none', 'test', 'na', 'n/a', 'email', 'x', 'noemail', 'nomail']);
function dupEmailKey(raw?: string): string {
  const e = String(raw ?? '').trim().toLowerCase();
  if (e.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return '';
  const [local, domain] = e.split('@');
  if (GENERIC_LOCAL.has(local) && (local === 'info' || GENERIC_LOCAL.has(domain.split('.')[0]))) return '';
  return e;
}

const stable = (r: any) => { const { _rev, ...rest } = r || {}; return JSON.stringify(rest); };
const changed = () => window.dispatchEvent(new CustomEvent('crm-data-changed'));

// The in-memory copy is the primary one (4,000+ leads are far too big to parse from storage on every call).
// Storage is only a best-effort cache for small lists; the storage guard keeps it in sessionStorage.
const STORAGE_MAX_ROWS = 1200;
const persistTimers: Partial<Record<Kind, ReturnType<typeof setTimeout>>> = {};
let dupIndex: { src: any[]; n: number; phone: Map<string, any[]>; email: Map<string, any[]> } | null = null;

function read(kind: Kind): any[] {
  const m = memory[kind];
  if (m) return m;
  let rows: any[] = [];
  try {
    const raw = localStorage.getItem(STORE[kind]);
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) rows = v; }
  } catch { /* nothing cached */ }
  memory[kind] = rows;
  return rows;
}
function persistSoon(kind: Kind) {
  if (persistTimers[kind]) clearTimeout(persistTimers[kind]);
  persistTimers[kind] = setTimeout(() => {
    const rows = memory[kind] || [];
    try {
      if (rows.length > STORAGE_MAX_ROWS) localStorage.removeItem(STORE[kind]);
      else localStorage.setItem(STORE[kind], JSON.stringify(rows));
    } catch { /* quota: the memory copy is used */ }
  }, 1500);
}
// A version number per list, bumped only when the list really changed. Screens compare it before re-rendering,
// so a refresh that brought nothing new costs no re-render at all.
const ver: Record<Kind, number> = { leads: 0, contacts: 0, companies: 0, tasks: 0, activities: 0, 'email-logs': 0 };
function sameRows(a: any[] | undefined, b: any[]) {
  if (a === b) return true;
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function write(kind: Kind, rows: any[]) {
  if (!sameRows(memory[kind], rows)) ver[kind]++;
  memory[kind] = rows;
  if (kind === 'leads') dupIndex = null;
  persistSoon(kind);
}
function setBaseline(kind: Kind, rows: any[]) {
  const m = new Map<string, string>();
  rows.forEach((r) => m.set(String(r.id), stable(r)));
  baseline[kind] = m;
}

// ---- delta refresh: only rows changed since the last answer travel (the full list is fetched once) ----
const cursor: Partial<Record<Kind, string>> = {};
const lastFull: Partial<Record<Kind, number>> = {};
const inflight: Partial<Record<Kind, Promise<boolean | null>>> = {};
const DELTA_KINDS: Kind[] = ['leads', 'contacts', 'companies', 'tasks', 'activities'];
const OVERLAP_MS = 15_000;          // re-read the last seconds: merging is idempotent, missing a row is not
const FULL_EVERY_MS = 4 * 60 * 60_000;  // safety net only: deletes already travel in the delta (soft delete bumps updated_at)

const cursorFrom = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return isNaN(t) ? undefined : new Date(t - OVERLAP_MS).toISOString();
};

async function pull(kind: Kind): Promise<any[] | null> {
  try {
    const t0 = Date.now();
    const res = await fetch(`/api/crm/${kind}`);
    if (res.status === 403) { lastFull[kind] = Date.now(); return []; }   // this role may not see this list (e.g. the mail log): that is an empty list, not a failed load
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    // the server's own clock (HTTP Date) avoids trusting this PC's clock; fall back to the request time
    cursor[kind] = cursorFrom(res.headers.get('date')) || new Date(t0 - 10 * 60_000).toISOString();
    lastFull[kind] = Date.now();
    return rows;
  } catch { return null; }
}

/** merges the rows changed since the last answer. true = something changed, false = nothing, null = need a full load */
function pullDelta(kind: Kind): Promise<boolean | null> {
  if (inflight[kind]) return inflight[kind]!;
  const run = async (): Promise<boolean | null> => {
    const since = cursor[kind];
    if (!since || !DELTA_KINDS.includes(kind)) return null;
    let j: any;
    try {
      const res = await fetch(`/api/crm/${kind}?since=${encodeURIComponent(since)}`);
      if (!res.ok) return null;
      j = await res.json();
    } catch { return null; }
    return applyDelta(kind, j);
  };
  const p = run().finally(() => { delete inflight[kind]; });
  inflight[kind] = p;
  return p;
}

/** merges one delta answer ({ delta, rows, removed, now }) into memory. true = changed, false = nothing, null = malformed (full load needed) */
function applyDelta(kind: Kind, j: any): boolean | null {
  {
    if (!j || j.delta !== true || !Array.isArray(j.rows)) return null;
    if (pending[kind] > 0) return false; // a save started meanwhile: the next refresh will merge
    const nextCursor = cursorFrom(j.now);
    const removed = new Set<string>((j.removed || []).map(String));
    const cur = read(kind);
    const idx = new Map<string, number>();
    cur.forEach((r, i) => idx.set(String(r.id), i));
    let next: any[] | null = null;
    const fresh: any[] = [];
    for (const r of j.rows) {
      const id = String(r.id);
      const i = idx.get(id);
      if (i === undefined) { fresh.push(r); continue; }
      if (cur[i]._rev === r._rev) continue; // our own save coming back: keep the same object
      if (!next) next = cur.slice();
      next[i] = r;
    }
    if (removed.size) {
      const base = next || cur;
      const kept = base.filter((r) => !removed.has(String(r.id)));
      if (kept.length !== base.length) next = kept;
    }
    if (fresh.length) next = [...fresh.reverse(), ...(next || cur)]; // newest first, like the full list
    if (nextCursor) cursor[kind] = nextCursor;
    if (!next) return false;
    write(kind, next);
    for (const r of j.rows) baseline[kind].set(String(r.id), stable(r));
    for (const id of removed) baseline[kind].delete(id);
    return true;
  }
}

// ---- ONE request for every poll: leads + tasks + activities changes and the bell's unread count (see /crm/pulse on the server) ----
const HOT: Kind[] = ['leads', 'tasks', 'activities'];
const IDLE_MS = 5 * 60_000;                // nobody touched the screen for 5 minutes: stop polling until they do
let lastActivity = Date.now(), lastPulseAt = 0, pulsing = false;
async function pulse(): Promise<boolean> {
  if (pulsing) return false;
  const qs = new URLSearchParams();
  for (const k of HOT) if (cursor[k] && pending[k] === 0) qs.set(k, cursor[k]!);
  if (![...qs.keys()].length) return false;
  pulsing = true; lastDeltaAt = lastPulseAt = Date.now(); (window as any).__sdmLastPulse = lastPulseAt;
  try {
    const res = await fetch(`/api/crm/pulse?${qs}`);
    if (!res.ok) return false;
    const j = await res.json();
    window.dispatchEvent(new CustomEvent('crm-pulse', { detail: { unread: Number(j.unread) || 0 } }));
    let any = false;
    for (const k of HOT) {
      const r = j.results?.[k];
      if (!r || r.error) continue;
      const d = applyDelta(k, r);
      if (d === true) any = true;
      else if (d === null) { const rows = await pull(k); if (rows && pending[k] === 0) { write(k, rows); setBaseline(k, rows); any = true; } }
    }
    if (any) changed();
    return any;
  } catch { return false; } finally { pulsing = false; }
}

async function flush(kind: Kind) {
  const arr = read(kind);
  const base = baseline[kind];
  const present = new Set(arr.map((r) => String(r.id)));
  const upserts = arr.filter((r) => base.get(String(r.id)) !== stable(r));
  const deletes = [...base.keys()].filter((id) => !present.has(id));
  if (!upserts.length && !deletes.length) return;

  const CHUNK = 100;
  for (let i = 0; i < Math.max(1, Math.ceil(upserts.length / CHUNK)); i++) {
    const part = upserts.slice(i * CHUNK, (i + 1) * CHUNK);
    let res: Response;
    try {
      res = await fetch(`/api/crm/${kind}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upserts: part, deletes: i === 0 ? deletes : [] }),
      });
    } catch {
      toast.error('Could not reach the server. Your last change was not saved.');
      return;
    }
    if (!res.ok) {
      let msg = 'Your change was not saved.';
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* keep default */ }
      toast.error(msg);
      const fresh = await pull(kind);
      if (fresh) { write(kind, fresh); setBaseline(kind, fresh); changed(); }
      return;
    }
    const out = await res.json();
    const sent = new Map(part.map((r) => [String(r.id), r]));
    const current = read(kind);
    for (const s of out.saved || []) {
      base.set(String(s.id), stable(sent.get(String(s.id)) || {}));
      const row = current.find((r) => String(r.id) === String(s.id));
      if (row) row._rev = s._rev;
    }
    if (i === 0) for (const d of deletes) if (!(out.rejected || []).some((x: any) => x.id === d)) base.delete(d);
    write(kind, current);
    const bad = [...(out.conflicts || []), ...(out.rejected || []).map((x: any) => x.id)];
    if (bad.length) {
      toast.error(out.conflicts?.length
        ? 'Someone else changed this record at the same time. The latest version was reloaded: please repeat your edit.'
        : `Not allowed: ${(out.rejected?.[0]?.reason) || 'change refused'}`);
      const fresh = await pull(kind);
      if (fresh) { write(kind, fresh); setBaseline(kind, fresh); }
      changed();
      return;
    }
  }
}

function queue(kind: Kind) {
  pending[kind]++;
  queues[kind] = (queues[kind] || Promise.resolve())
    .then(() => flush(kind))
    .catch((e) => console.warn('CRM save failed', kind, e))
    .finally(() => { pending[kind]--; });
  return queues[kind]!;
}

async function refill(kind: 'lead' | 'contact' | 'company') {
  if (ids[kind].length >= 3) return;
  try {
    const res = await fetch('/api/crm/ids', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, n: 10 }) });
    if (res.ok) ids[kind].push(...((await res.json()).ids || []));
  } catch { /* offline: temporary ids are used */ }
}
function takeId(kind: 'lead' | 'contact' | 'company'): string {
  const next = ids[kind].shift();
  if (ids[kind].length < 3) refill(kind);
  if (next) return next;
  const p = kind === 'lead' ? 'LD' : kind === 'contact' ? 'CON' : 'COM';
  return `${p}-T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const saved = (kind: Kind) => (rows: any[]) => { write(kind, rows); ver[kind]++; void queue(kind); };

export const crmService = {
  /**
   * Load everything this user may see. Cheap and idempotent: after the first full load only the rows changed
   * since then are fetched (a full reload happens at most every 15 min). Skips a list while a save of it is running.
   */
  loadAll: async (): Promise<{ ok: boolean }> => {
    const results = await Promise.all(KINDS.map(async (k) => {
      if (pending[k] > 0) return [k, null, false] as const;
      const fullDue = !cursor[k] || !DELTA_KINDS.includes(k) || Date.now() - (lastFull[k] || 0) > FULL_EVERY_MS;
      if (!fullDue) {
        const d = await pullDelta(k);
        if (d !== null) return [k, null, true] as const; // merged (or nothing new)
      }
      return [k, await pull(k), false] as const;
    }));
    let ok = true;
    for (const [k, rows, viaDelta] of results) {
      if (viaDelta) continue;
      if (rows) {
        // keep the same objects for rows that did not change, so row components and search caches stay valid
        const old = new Map<string, any>();
        for (const r of read(k)) old.set(String(r.id), r);
        const merged = rows.map((r) => { const o = old.get(String(r.id)); return o && o._rev === r._rev ? o : r; });
        write(k, merged); setBaseline(k, merged);
      } else if (pending[k] === 0) ok = false;
    }
    if (!queueSettingsLoaded || Date.now() - queueSettingsAt > 10 * 60_000) {
      try {
        const res = await fetch('/api/crm/queue-settings');
        if (res.ok) { localStorage.setItem('crm_queue_settings', JSON.stringify(await res.json())); queueSettingsLoaded = true; queueSettingsAt = Date.now(); }
      } catch { ok = false; }
    }
    refill('lead'); refill('contact'); refill('company');
    lastDeltaAt = Date.now();
    changed();
    return { ok };
  },

  /**
   * Cheap refresh: GET /api/crm/<kind>?since=... for every list, merged into memory (optimistic-lock _rev kept).
   * Fires 'crm-data-changed' only when something changed. Safe to call often (throttled to once per 5 s).
   */
  refreshDelta: async (opts: { force?: boolean; kinds?: Kind[] } = {}): Promise<{ changed: boolean }> => {
    if (!opts.force && Date.now() - lastDeltaAt < 5000) return { changed: false };
    lastDeltaAt = Date.now();
    let any = false;
    await Promise.all((opts.kinds || DELTA_KINDS).map(async (k) => {
      if (pending[k] > 0) return;
      const d = await pullDelta(k);
      if (d === true) any = true;
      else if (d === null && !cursor[k]) { /* not loaded yet: loadAll does the first full load */ }
      else if (d === null) { const rows = await pull(k); if (rows && pending[k] === 0) { write(k, rows); setBaseline(k, rows); any = true; } }
    }));
    if (any) changed();
    return { changed: any };
  },

  /** changes whenever a list really changed (cheap to compare): screens skip re-rendering when it is the same */
  versionKey: (): string => `${ver.leads}.${ver.contacts}.${ver.companies}.${ver['email-logs']}.${ver.tasks}.${ver.activities}`,

  /**
   * Polls refreshDelta every ~90 s while the tab is visible, and when the window regains focus / becomes visible.
   * Returns a stop function. Reference counted: call it from every screen that shows leads.
   */
  startAutoRefresh: (intervalMs = 150_000): (() => void) => {
    autoUsers++;
    if (autoUsers === 1) {
      const visible = () => document.visibilityState === 'visible';
      // only while the tab is in front AND the person is using the screen (idle PCs and forgotten tabs stop calling the server)
      autoTimer = setInterval(() => { if (visible() && Date.now() - lastActivity < IDLE_MS) void pulse(); }, intervalMs);
      const onActivity = () => {
        const wasIdle = Date.now() - lastActivity > IDLE_MS;
        lastActivity = Date.now();
        if (wasIdle && visible()) void pulse();           // back after a pause: catch up at once
      };
      const onWake = () => { if (visible() && Date.now() - lastPulseAt > 60_000) { lastActivity = Date.now(); void pulse(); } };
      const evs = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
      evs.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
      window.addEventListener('focus', onWake);
      document.addEventListener('visibilitychange', onWake);
      autoOff = () => { evs.forEach((e) => window.removeEventListener(e, onActivity)); window.removeEventListener('focus', onWake); document.removeEventListener('visibilitychange', onWake); };
    }
    let done = false;
    return () => {
      if (done) return; done = true;
      autoUsers--;
      if (autoUsers === 0) { if (autoTimer) clearInterval(autoTimer); autoTimer = null; autoOff?.(); autoOff = null; }
    };
  },

  /** Other open leads with the same phone (phone or phone 2) or the same e-mail. Generic e-mails never count. */
  findDuplicates: (probe: { phone?: string; phone2?: string; email?: string }, excludeId?: string): Lead[] => {
    const leads = read('leads');
    if (!dupIndex || dupIndex.src !== leads || dupIndex.n !== leads.length) {
      const phone = new Map<string, any[]>(), email = new Map<string, any[]>();
      const add = (m: Map<string, any[]>, k: string, l: any) => { if (!k) return; const a = m.get(k); if (a) { if (!a.includes(l)) a.push(l); } else m.set(k, [l]); };
      for (const l of leads) {
        if (l.mergedInto || l.status === 'Duplicate') continue;
        add(phone, dupPhoneKey(l.phoneNumber), l); add(phone, dupPhoneKey(l.phone2), l); add(email, dupEmailKey(l.email), l);
      }
      dupIndex = { src: leads, n: leads.length, phone, email };
    }
    const out = new Map<string, any>();
    for (const k of [dupPhoneKey(probe.phone), dupPhoneKey(probe.phone2)]) if (k) for (const l of dupIndex.phone.get(k) || []) out.set(l.id, l);
    const ek = dupEmailKey(probe.email);
    if (ek) for (const l of dupIndex.email.get(ek) || []) out.set(l.id, l);
    if (excludeId) out.delete(excludeId);
    return [...out.values()];
  },

  // Getters (from this tab's cache; call loadAll first)
  getLeads: (): Lead[] => read('leads').slice(),
  getContacts: (): Contact[] => read('contacts').slice(),
  getCompanies: (): Company[] => read('companies').slice(),
  /** the ingestion history is not part of the cheap refresh: re-read it (after a sync, and when the tab opens) */
  reloadEmailLogs: async (): Promise<void> => {
    const rows = await pull('email-logs');
    if (rows) { write('email-logs', rows); setBaseline('email-logs', rows); changed(); }
  },
  getEmailLogs: (): EmailImportLog[] => read('email-logs').slice(),
  getTasks: (): SalespersonTask[] => read('tasks').slice(),
  getActivities: (): SalespersonActivity[] => read('activities').slice(),
  getQueueSettings: (): QueueSettings => {
    try { const d = localStorage.getItem('crm_queue_settings'); if (d) return JSON.parse(d); } catch { /* default */ }
    return INITIAL_QUEUE_SETTINGS;
  },
  getSalesPeople: () => {
    try { const d = localStorage.getItem('crm_sales_people'); if (d) return JSON.parse(d); } catch { /* none */ }
    return [] as any[];
  },

  // Save helpers: pass the whole list as before; only changed rows travel to the server
  saveLeads: (leads: Lead[]) => saved('leads')(leads),
  saveContacts: (contacts: Contact[]) => saved('contacts')(contacts),
  saveCompanies: (companies: Company[]) => saved('companies')(companies),
  saveEmailLogs: (logs: EmailImportLog[]) => saved('email-logs')(logs),
  saveTasks: (tasks: SalespersonTask[]) => saved('tasks')(tasks),
  saveActivities: (activities: SalespersonActivity[]) => saved('activities')(activities),
  saveSalesPeople: (people: any[]) => {
    try { localStorage.setItem('crm_sales_people', JSON.stringify(people)); } catch { /* ignore */ }
  },
  saveQueueSettings: (settings: QueueSettings) => {
    localStorage.setItem('crm_queue_settings', JSON.stringify(settings));
    fetch('/api/crm/queue-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
    }).then(async (r) => {
      if (!r.ok) { let m = 'Routing settings were not saved.'; try { m = (await r.json()).error || m; } catch { /* default */ } toast.error(m); }
    }).catch(() => toast.error('Could not reach the server. Routing settings were not saved.'));
  },
  /** wait until every pending save has reached the server */
  whenSaved: async () => { await Promise.all(KINDS.map((k) => queues[k]).filter(Boolean)); },

  // Audit Log (the server records WHO from the login, not from this call)
  addActivityLog: (_user: string, action: string, details: string, type: 'auth' | 'ticket' | 'workflow' | 'admin' | 'system') => {
    fetch('/api/activity-logs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, details, type }),
    }).catch(() => { /* audit is best effort */ });
  },

  // Lead Lifecycle Operations
  createLead: (leadData: Partial<Lead>, createdBy: string): Lead => {
    // Sanitize user inputs
    if (leadData.description) leadData.description = DOMPurify.sanitize(leadData.description);
    if (leadData.comments) leadData.comments = leadData.comments.map(c => ({...c, comment: DOMPurify.sanitize(c.comment)}));

    const leads = crmService.getLeads();
    const contacts = crmService.getContacts();
    const companies = crmService.getCompanies();

    const normalizedPhone = leadData.phoneNumber ? leadData.phoneNumber.replace(/\D/g, '') : '';
    
    // ids come from a server sequence (handed out in advance), so two people never get the same one
    const newId = takeId('lead');

    const newLead: Lead = {
      ...leadData,            // the team's extra fields (phone 2, industry, nationality, qualification, ...)
      id: newId,
      createdBy: (leadData as any).createdBy || createdBy,     // who registered it (for the Marketing report)
      emailId: leadData.emailId,
      date: leadData.date || new Date().toISOString(),
      source: leadData.source || 'Manual Entry',
      project: leadData.project || '',
      customerName: leadData.customerName || '',
      phoneNumber: leadData.phoneNumber || '',
      email: leadData.email || '',
      companyName: leadData.companyName,
      requiredSize: leadData.requiredSize ?? '',
      budget: leadData.budget,
      priority: leadData.priority || 'Medium',
      status: leadData.status || 'New',
      description: leadData.description || '',
      comments: leadData.comments || [],
      attachments: leadData.attachments || [],
      lastUpdated: new Date().toISOString(),
      expectedClosingDate: leadData.expectedClosingDate || '',
      timeline: [
        {
          id: Math.random().toString(36).substr(2, 9),
          timestamp: new Date().toISOString(),
          type: 'Creation',
          user: createdBy,
          title: 'Lead Registered',
          description: `Lead registered under CRM and linked to contact ${leadData.customerName}.`,
        }
      ],
    };

    leads.push(newLead);
    crmService.saveLeads(leads);

    // Trigger Assignment Engine if status is New/Pending Routing and auto assignment is enabled
    const settings = crmService.getQueueSettings();
    if (settings.assignmentMethod !== 'Manual Assignment Only') {
      crmService.routeLeadAutomatically(newLead.id);
    }
    
    return newLead;
  },

  /**
   * Updates one lead. The history is append-only: status changes push a timeline event, nothing is rewritten.
   * `ctx.userId` lets the first-contact stamp (SLA) know who is acting. A refusal by the server arrives as a toast.
   */
  updateLead: (id: string, updates: Partial<Lead>, user: string, ctx?: { userId?: string }): Lead => {
    const leads = crmService.getLeads();
    const idx = leads.findIndex(l => l.id === id);
    if (idx === -1) throw new Error('Lead not found');

    const original = leads[idx];
    let updated: Lead = {
      ...original,
      ...updates,
      timeline: [...(updates.timeline ?? original.timeline ?? [])],
      lastUpdated: new Date().toISOString()
    };
    updated = withSideEffects(original, updated, { id: ctx?.userId });

    const ev = (type: TimelineEvent['type'], title: string, description: string) => updated.timeline.push({
      id: Math.random().toString(36).substr(2, 9), timestamp: new Date().toISOString(), type, user, title, description,
    });
    if (updates.status && updates.status !== original.status) {
      if (updates.status === 'Won') ev('Status Change', 'Deal Won', `Status changed from ${original.status} to Won. Deal value EGP ${Number(updated.dealValue || 0).toLocaleString('en-US')} (cash pending confirmation by accounts receivable).`);
      else if (updates.status === 'Lost') ev('Status Change', 'Lead Closed as Lost', `Lost${updated.lostCategory ? ` (${updated.lostCategory})` : ''}: ${updated.lostReason || '—'}${updated.lostComment ? `. ${updated.lostComment}` : ''}`);
      else ev('Status Change', 'Status Updated', `Status changed from ${original.status} to ${updates.status}`);
    }
    if (updates.priority && updates.priority !== original.priority) ev('Status Change', 'Priority Updated', `Priority changed from ${original.priority} to ${updates.priority}`);

    leads[idx] = updated;
    crmService.saveLeads(leads);
    crmService.addActivityLog(user, 'Update Lead', `Updated CRM Sales Lead ${id} details`, 'ticket');
    return updated;
  },

  /** who changed what and when (owner, status, source, value, stage dates, cash, create, delete): written by the server */
  fetchAudit: async (id: string): Promise<{ rows: any[]; error?: string }> => {
    try {
      const res = await fetch(`/api/crm/leads/${encodeURIComponent(id)}/audit`);
      if (!res.ok) { let m = 'The change history is not available to you.'; try { m = (await res.json()).error || m; } catch { /* default */ } return { rows: [], error: m }; }
      const j = await res.json();
      return { rows: Array.isArray(j) ? j : (j.rows || []) };
    } catch { return { rows: [], error: 'Could not reach the server.' }; }
  },

  parseEmailAndCreateLead: (emailLog: Partial<EmailImportLog>, user: string): { success: boolean, leadId?: string, error?: string, isDuplicate?: boolean } => {
    const leads = crmService.getLeads();
    const text = emailLog.bodyPreview || '';

    let parsedName = '';
    let parsedPhone = '';
    let parsedEmail = '';
    let parsedCompany = '';
    let parsedProject = '';
    let parsedPlotType = '';
    let parsedInquiryType = '';
    let parsedSize: string | number = '';
    let parsedBudget: number | undefined;
    let parsedSource = '';
    let parsedPriority = '';
    let parsedComment = '';

    const nameMatch = text.match(/(?:Customer Name|Name|صاحب شركة|customer_name)\s*[:\/\t]*\s*([^\n]+)/i);
    parsedName = nameMatch ? nameMatch[1].trim() : '';

    const phoneMatch = text.match(/(?:Customer Number|Phone Number|Phone|Mobile|customer_number|الهاتف|رقم)\s*[:\/\t]*\s*([^\n]+)/i);
    parsedPhone = phoneMatch ? phoneMatch[1].trim() : '';

    const emailMatch = text.match(/(?:Email|البريد الالكتروني|البريد)\s*[:\/\t]*\s*([^\n]+)/i);
    parsedEmail = emailMatch ? emailMatch[1].trim() : '';

    const companyMatch = text.match(/(?:Company Name|Company|company_name|الشركة)\s*[:\/\t]*\s*([^\n]+)/i);
    parsedCompany = companyMatch ? companyMatch[1].trim() : '';

    const projectMatch = text.match(/(?:Project Name|Project|project_name|المشروع)\s*[:\/\t]*\s*([^\n]+)/i);
    parsedProject = projectMatch ? projectMatch[1].trim() : '';

    const commentMatch = text.match(/(?:Comment|Message|الوصف|التفاصيل|الرسالة)\s*[:\/\t]*\s*([^\n]+)/i);
    parsedComment = commentMatch ? commentMatch[1].trim() : '';

    const plotTypeMatch = text.match(/(?:Plot Type|plot_type|Type|نوع)\s*[:\/\t]*\s*([^\n]+)/i);
    parsedPlotType = plotTypeMatch ? plotTypeMatch[1].trim() : '';

    const sizeMatch = text.match(/(?:Required Size|Required Land Size|required_size|Size|المساحة)\s*[:\/\t]*\s*([^\n]+)/i);
    if (sizeMatch) parsedSize = sizeMatch[1].trim();

    const budgetMatch = text.match(/(?:Budget|الميزانية)\s*[:\/\t]*\s*(\d+)/i);
    if (budgetMatch) parsedBudget = parseInt(budgetMatch[1]);

    const priorityMatch = text.match(/(?:Priority|الأهمية)\s*[:\/\t]*\s*([^\n]+)/i);
    parsedPriority = priorityMatch ? priorityMatch[1].trim() : '';

    const inquiryTypeMatch = text.match(/(?:Inquiry Type|inquiry_type|نوع الاستفسار)\s*[:\/\t]*\s*([^\n]+)/i);
    parsedInquiryType = inquiryTypeMatch ? inquiryTypeMatch[1].trim() : '';
    const sourceMatch = text.match(/(?:Lead Source|Source|المصدر)\s*[:\/\t]*\s*([^\n]+)/i);
    parsedSource = sourceMatch ? sourceMatch[1].trim() : '';

    let project = '';
    if (parsedProject) {
      const pLower = parsedProject.toLowerCase();
      if (pLower.includes('أكتوبر') || pLower.includes('october')) {
        project = 'Industria October';
      } else if (pLower.includes('شرق') || pLower.includes('east')) {
        project = 'Industria East';
      } else if (pLower.includes('غرب') || pLower.includes('west')) {
        project = 'Industria West';
      } else if (pLower.includes('سادات') || pLower.includes('sadat')) {
        project = 'Industria Sadat';
      } else if (pLower.includes('عاشر') || pLower.includes('ramadan') || pLower.includes('10')) {
        project = 'Industria 10th of Ramadan';
      } else if (pLower.includes('سخنة') || pLower.includes('sokhna')) {
        project = 'Sokhna';
      } else if (pLower.includes('علمين') || pLower.includes('alamein')) {
        project = 'Industria New Alamein';
      } else {
        project = parsedProject.trim();
      }
    }

    const tempNormPhone = parsedPhone ? parsedPhone.replace(/\D/g, '') : '';
    
    // Smart Deduplication
    if (emailLog.id) {
       const existingByEmailId = leads.find(l => l.emailId === emailLog.id);
       if (existingByEmailId) {
         return { success: true, leadId: existingByEmailId.id, isDuplicate: true };
       }
    }

    if (tempNormPhone && parsedName) {
       // Check if there's a lead with the exact same Name + Phone + Project
       const existingByDetails = leads.find(l => 
         l.phoneNumber && l.phoneNumber.replace(/\D/g, '') === tempNormPhone && 
         l.customerName === parsedName.trim() &&
         l.project === project
       );
       if (existingByDetails) {
         // Optionally update the existing lead's emailId if it was missing
         if (emailLog.id && !existingByDetails.emailId) {
             existingByDetails.emailId = emailLog.id;
             crmService.saveLeads(leads);
         }
         return { success: true, leadId: existingByDetails.id, isDuplicate: true };
       }
    }
    
    // Check by description/notes to catch exact same email content
    if (parsedComment && parsedComment.length > 10) {
       const existingByComment = leads.find(l => l.description && l.description.includes(parsedComment));
       if (existingByComment) {
         return { success: true, leadId: existingByComment.id, isDuplicate: true };
       }
    }

    if (!parsedName && !parsedPhone) {
        return { success: false, error: 'Missing customer name or phone' };
    }

    if (!parsedName && !parsedPhone) {
        return { success: false, error: 'Missing customer name or phone' };
    }

    try {
      const newLead = crmService.createLead({
        emailId: emailLog.id,
        customerName: parsedName.trim(),
        phoneNumber: parsedPhone,
        email: parsedEmail.trim(),
        companyName: parsedCompany.trim(),
        project,
        requiredSize: parsedSize,
        budget: parsedBudget,
        source: parsedSource,
        priority: 'Normal',
        description: parsedComment,
        date: new Date().toISOString().split('T')[0],
        status: 'New'
      }, 'System Administrator');
      
      const logs = crmService.getEmailLogs();
      const newLogId = emailLog.id || 'eml_' + Math.random().toString(36).substr(2, 9);
      const existingLogIndex = logs.findIndex(l => l.id === newLogId);
      
      const newLog: EmailImportLog = {
        id: newLogId,
        receivedTime: new Date().toISOString(),
        sender: emailLog.sender || 'web@elsewedydevelopment.com',
        subject: emailLog.subject || 'Website Inquiry Form',
        status: 'Success',
        parsedLeadId: newLead.id,
        bodyPreview: text,
      };

      if (existingLogIndex !== -1) {
        logs[existingLogIndex] = newLog;
      } else {
        logs.unshift(newLog);
      }
      crmService.saveEmailLogs(logs);

      return { success: true, leadId: newLead.id };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  // The server applies the routing rules (method, caps, leave, daily limit) and never re-routes an assigned lead.
  routeLeadAutomatically: (leadId: string): void => {
    if (crmService.getQueueSettings().assignmentMethod === 'Manual Assignment Only') return;
    void (queues.leads || Promise.resolve()).then(async () => {
      try {
        const res = await fetch('/api/crm/leads/route', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId }),
        });
        if (!res.ok) return;
        const out = await res.json();
        if (!out.assigned || !out.lead) return;
        const rows = read('leads');
        const i = rows.findIndex((r) => r.id === leadId);
        if (i === -1) return;
        rows[i] = out.lead;
        write('leads', rows);
        baseline.leads.set(String(leadId), stable(out.lead));
        changed();
      } catch { /* the lead stays in the queue for a manager */ }
    });
  },

  // Merge duplicate leads
  mergeLeads: (primaryId: string, duplicateId: string, user: string): Lead => {
    const leads = crmService.getLeads();
    const primaryIdx = leads.findIndex(l => l.id === primaryId);
    const duplicateIdx = leads.findIndex(l => l.id === duplicateId);

    if (primaryIdx === -1 || duplicateIdx === -1) throw new Error('Primary or Duplicate lead not found');

    const primary = { ...leads[primaryIdx] };
    const duplicate = { ...leads[duplicateIdx], timeline: [...(leads[duplicateIdx].timeline || [])] };

    // Merge comments, timeline events
    const mergedComments = [...primary.comments, ...duplicate.comments, {
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString().split('T')[0],
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      user,
      comment: `System Merge Action: Merged details from duplicate lead record ${duplicateId}. Details included: Required size: ${duplicate.requiredSize}sqm, project: ${duplicate.project}.`,
      isPrivate: false,
    }];

    const mergedTimeline: TimelineEvent[] = [...primary.timeline, ...duplicate.timeline, {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type: 'Approval' as const,
      user,
      title: `Merged with Lead ${duplicateId}`,
      description: `Lead ${duplicateId} merged into primary record ${primaryId}. Duplicate lead record flagged as Closed/Duplicate.`
    }];

    primary.comments = mergedComments;
    primary.timeline = mergedTimeline;
    primary.lastUpdated = new Date().toISOString();

    // Mark duplicate lead as closed/duplicate
    duplicate.status = 'Duplicate';
    duplicate.lastUpdated = new Date().toISOString();
    duplicate.timeline.push({
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type: 'Status Change',
      user,
      title: 'Flagged as Duplicate',
      description: `Merged into primary record ${primaryId}. Closed automatically.`
    });

    leads[primaryIdx] = primary;
    leads[duplicateIdx] = duplicate;
    crmService.saveLeads(leads);

    crmService.addActivityLog(user, 'Merge Leads', `Merged duplicate CRM Lead ${duplicateId} into ${primaryId}`, 'ticket');

    return primary;
  }
};
