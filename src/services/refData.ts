import { useEffect, useSyncExternalStore } from 'react';
import { Category, RolePermissions, SLAConfig, WorkflowRequest } from '../types';
import { fetchWithTimeout } from '../lib/fetchUtils';
import { supabase } from '../lib/supabase';
import { adminService } from './adminService';

/**
 * Small shared cache for reference data that changes rarely (SLA hours, ticket categories, workflow templates).
 *
 *  - stale-while-revalidate: cached data is returned at once (any age below MAX_AGE); it is refreshed quietly in
 *    the background only when older than REFRESH_AFTER;
 *  - one request at a time per list (in-flight de-duplication);
 *  - invalidated when this browser saves that data (see the wrappers at the bottom);
 *  - no timers, no polling, no refetch on focus;
 *  - cleared when the signed-in user changes (workflow lists differ by permission).
 */
const REFRESH_AFTER = 2 * 60_000;
const MAX_AGE = 10 * 60_000;

export interface Snap<T> {
  data?: T;
  error?: string;
  /** a request is running (with or without cached data) */
  loading: boolean;
  fetchedAt: number;
}

export interface Store<T> {
  peek: () => Snap<T>;
  subscribe: (cb: () => void) => () => void;
  /** resolves with usable data: cached at once when present, otherwise after the request */
  load: (opts?: { force?: boolean }) => Promise<T>;
  /** start a quiet refresh when the data is missing or older than 2 minutes (no await needed) */
  ensure: () => void;
  /** change the cached data locally (after a save whose result the caller already has) */
  set: (next: T | ((prev: T | undefined) => T)) => void;
  /** the data was changed on the server: mark stale and refetch quietly */
  invalidate: () => void;
  clear: () => void;
}

function createStore<T>(fetcher: () => Promise<T>): Store<T> {
  let snap: Snap<T> = { loading: false, fetchedAt: 0 };
  let inflight: Promise<T> | null = null;
  let gen = 0; // bumped by clear(): a request that started before it must not fill the cache
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<Snap<T>>) => {
    snap = { ...snap, ...patch };
    listeners.forEach(l => l());
  };
  const usable = () => snap.data !== undefined && Date.now() - snap.fetchedAt < MAX_AGE;

  const fetchNow = (): Promise<T> => {
    if (inflight) return inflight;
    const my = gen;
    emit({ loading: true });
    const p = fetcher().then(
      data => {
        if (my === gen) emit({ data, error: undefined, loading: false, fetchedAt: Date.now() });
        return data;
      },
      err => {
        if (my === gen) emit({ error: err?.message || 'Request failed', loading: false });
        throw err;
      }
    ).finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
    return p;
  };

  const store: Store<T> = {
    peek: () => snap,
    subscribe: cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    load: async (opts = {}) => {
      if (!opts.force && usable()) {
        if (Date.now() - snap.fetchedAt > REFRESH_AFTER) fetchNow().catch(() => {});
        return snap.data as T;
      }
      return fetchNow();
    },
    ensure: () => {
      if (inflight) return;
      if (!usable() || Date.now() - snap.fetchedAt > REFRESH_AFTER) fetchNow().catch(() => {});
    },
    set: next => {
      const data = typeof next === 'function' ? (next as (p: T | undefined) => T)(snap.data) : next;
      emit({ data, error: undefined, fetchedAt: snap.data === undefined ? Date.now() : snap.fetchedAt });
    },
    invalidate: () => {
      snap = { ...snap, fetchedAt: 0 };
      // a request already running may carry the old data: let it finish, then fetch again
      if (inflight) inflight.finally(() => fetchNow().catch(() => {})).catch(() => {});
      else if (snap.data !== undefined || listeners.size > 0) fetchNow().catch(() => {});
    },
    clear: () => { gen++; inflight = null; snap = { loading: false, fetchedAt: 0 }; listeners.forEach(l => l()); },
  };
  return store;
}

async function serverMsg(res: Response, fallback: string): Promise<never> {
  let msg = fallback;
  try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* keep fallback */ }
  throw new Error(msg);
}

export const refData = {
  sla: createStore<SLAConfig[]>(() => adminService.getSLA()),
  categories: createStore<Category[]>(() => adminService.getCategories()),
  workflows: createStore<WorkflowRequest[]>(async () => {
    const res = await fetchWithTimeout('/api/workflow-requests', {}, 15000);
    if (!res.ok) await serverMsg(res, 'Failed to fetch workflow requests');
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }),
};

export const clearRefData = () => {
  refData.sla.clear();
  refData.categories.clear();
  refData.workflows.clear();
  warmed = false;
};

/** React hook: renders with the cached data at once and refreshes it quietly when it is old */
export function useRefStore<T>(store: Store<T>): Snap<T> {
  const snap = useSyncExternalStore(store.subscribe, store.peek, store.peek);
  useEffect(() => { store.ensure(); }, [store]);
  return snap;
}

// ---------------------------------------------------------------------------------------------
// prefetch: once, after the first screen has rendered
// ---------------------------------------------------------------------------------------------
let warmed = false;
/**
 * Call once with the signed-in user's permissions (App does this after the first render). It waits for an idle
 * moment (or 1.5 s), then loads the three lists and the two page bundles so the first visit is already warm.
 */
export function warmReferenceData(perms: Pick<RolePermissions, 'canViewTickets' | 'canViewWorkflowBuilder'> | null | undefined) {
  if (warmed || !perms) return;
  const tickets = !!perms.canViewTickets;
  const workflows = tickets || !!perms.canViewWorkflowBuilder;
  if (!tickets && !workflows) return;
  warmed = true;
  const run = () => {
    if (tickets) {
      refData.sla.load().catch(() => {});
      refData.categories.load().catch(() => {});
      import('../components/TicketForm').catch(() => {});
    }
    if (workflows) refData.workflows.load().catch(() => {});
    // the workflow screen (about 750 KB) is NOT fetched ahead any more: it loads when it is opened
  };
  const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o?: { timeout: number }) => number);
  // never earlier than 1.5 s after the first render, so the first screen is not slowed down
  setTimeout(() => (ric ? ric(run, { timeout: 3000 }) : run()), 1500);
}

// ---------------------------------------------------------------------------------------------
// keep the cache honest
// ---------------------------------------------------------------------------------------------
let lastUser: string | null | undefined;
supabase.auth.onAuthStateChange((_event, session) => {
  const id = session?.user?.id ?? null;
  if (lastUser !== undefined && id !== lastUser) clearRefData();
  lastUser = id;
});

// The admin panel saves SLA hours and categories through adminService: drop our copies when it does.
const wrap = <K extends 'updateSLA' | 'addCategory' | 'deleteCategory'>(name: K, store: Store<any>) => {
  const orig = adminService[name] as (...a: any[]) => Promise<any>;
  (adminService as any)[name] = async (...args: any[]) => {
    try { return await orig(...args); } finally { store.invalidate(); }
  };
};
wrap('updateSLA', refData.sla);
wrap('addCategory', refData.categories);
wrap('deleteCategory', refData.categories);
