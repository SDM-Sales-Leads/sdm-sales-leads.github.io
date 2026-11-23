// Plots come from the Land Bank snapshot (GET /api/plots), published by the Land Bank system.
// Fetched once, kept in memory, revalidated with ?hash=<held> (a refresh with no change is one tiny reply).
// No timers, no polling: refresh happens when a screen opens and the copy is older than 2 minutes, or on a button.
export type PlotStatus = 'available' | 'reserved' | 'sold' | 'eoi' | 'hold' | 'nfs' | 'unknown';

export interface Plot {
  key: string; park: string; project: string; unit: string; status: PlotStatus;
  sector: string; landType: string; areaSqM: number;
  listPriceSqm: number | null; listTotal: number | null;
  merged: string[] | null; holdUntil: string | null;
}
interface RawPlot {
  key: string; park?: string; project?: string; unit?: string; status?: string; sector?: string; landType?: string;
  areaSqm?: number; listPriceSqm?: number | null; listTotal?: number | null; merged?: string[] | null; holdUntil?: string | null;
}
export interface PlotsState {
  plots: Plot[]; hash: string; updatedAt: string | null; count: number; landBankUrl: string; loadedAt: number;
}

export const OFFER_TYPE_LABEL: Record<string, string> = { sales_offer: 'Sales offer', financial_offer: 'Financial offer', proposal: 'Proposal' };
export const DEFAULT_LAND_BANK_URL = 'https://sdm-land-bank.github.io/';
const STATUSES = new Set(['available', 'reserved', 'sold', 'eoi', 'hold', 'nfs', 'unknown']);
const STALE_MS = 2 * 60_000;

let state: PlotsState | null = null;
let inflight: Promise<PlotsState> | null = null;
const listeners = new Set<() => void>();

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function normalise(p: RawPlot): Plot {
  const st = String(p.status || '').toLowerCase();
  return {
    key: String(p.key), park: p.park || p.project || '', project: p.project || '', unit: p.unit || '',
    // a hold whose end date has passed is available again (the Land Bank releases it too; this covers the minutes before the next list arrives)
    status: ((st === 'hold' && p.holdUntil && Date.parse(p.holdUntil) < Date.now()) ? 'available' : STATUSES.has(st) ? st : 'unknown') as PlotStatus,
    sector: p.sector || '', landType: p.landType || '', areaSqM: num(p.areaSqm) ?? 0,
    listPriceSqm: num(p.listPriceSqm), listTotal: num(p.listTotal),
    merged: Array.isArray(p.merged) && p.merged.length ? p.merged : null, holdUntil: p.holdUntil || null,
  };
}

export function getPlotsSnapshot(): PlotsState | null { return state; }
export function subscribePlots(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const plotsAreStale = () => !state || Date.now() - state.loadedAt > STALE_MS;

/** Loads (or revalidates) the snapshot. `force` ignores the 2-minute freshness. Rejects with a readable Error. */
export function loadPlots(force = false): Promise<PlotsState> {
  if (state && !force && !plotsAreStale()) return Promise.resolve(state);
  if (inflight) return inflight;
  inflight = (async () => {
    const q = state?.hash ? `?hash=${encodeURIComponent(state.hash)}` : '';
    const res = await fetch('/api/plots' + q);
    let j: any = null;
    try { j = await res.json(); } catch { /* handled below */ }
    if (!res.ok || !j || j.success === false) throw new Error((j && (j.error || j.message)) || `Plots could not be loaded (HTTP ${res.status}).`);
    if (j.unchanged && state) {
      state = { ...state, loadedAt: Date.now(), landBankUrl: j.landBankUrl || state.landBankUrl };
    } else {
      const raw: RawPlot[] = Array.isArray(j.plots) ? j.plots : [];
      state = {
        plots: raw.map(normalise), hash: j.hash || '', updatedAt: j.updatedAt || null,
        count: typeof j.count === 'number' ? j.count : raw.length,
        landBankUrl: j.landBankUrl || DEFAULT_LAND_BANK_URL, loadedAt: Date.now(),
      };
    }
    listeners.forEach((f) => f());
    return state!;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Link into the Land Bank page (#hold= to start a hold request, #plot= to open the plot card). */
export function landBankLink(base: string | undefined, key: string, kind: 'hold' | 'plot', leadId?: string): string {
  let b = (base || DEFAULT_LAND_BANK_URL).trim();
  try { const u = new URL(b); if (u.protocol !== 'https:' && u.protocol !== 'http:') b = DEFAULT_LAND_BANK_URL; } catch { b = DEFAULT_LAND_BANK_URL; }
  return `${b.split('#')[0]}#${kind}=${encodeURIComponent(key)}${leadId && kind === 'hold' ? `&lead=${encodeURIComponent(leadId)}` : ''}`;
}

export function agoText(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
export const isOlderThan24h = (iso: string | null | undefined) => !iso || Date.now() - new Date(iso).getTime() > 24 * 3600_000;

export interface OfferPrint {
  id: string; contactId?: string; leadId?: string; offerType: string;
  plots: { key?: string; park?: string; unit?: string; areaSqm?: number; status?: string }[];
  totalValue?: number | null; summary?: string; docName?: string; printedBy?: string; printedByName?: string; printedAt: string;
  /** 23 Nov 2026: the customer's answer (server routes_offers.ts). result = status, or 'confirmed' once finance confirmed the deal */
  status?: 'open' | 'accepted' | 'rejected' | 'closed'; result?: 'open' | 'accepted' | 'rejected' | 'closed' | 'confirmed';
  rejectReason?: string; decisionNote?: string; decidedAt?: string | null; decidedByName?: string; holdReq?: number | null; holdNote?: string;
  canDecide?: boolean; canConfirm?: boolean;
}
export async function fetchOfferPrints(params: { contactId?: string; leadId?: string; plotKey?: string }, limit = 100): Promise<OfferPrint[]> {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) sp.set(k, v); });
  sp.set('limit', String(limit));
  const res = await fetch('/api/crm/offer-prints?' + sp.toString());
  let j: any = null;
  try { j = await res.json(); } catch { /* below */ }
  if (!res.ok || !j || j.success === false) throw new Error((j && (j.error || j.message)) || `Offers could not be loaded (HTTP ${res.status}).`);
  return Array.isArray(j.rows) ? j.rows : [];
}

/** Fire-and-forget record of a click on a Land Bank link. Never throws, never delays the new tab. */
export function trackLbClick(plotKey: string, kind: 'hold' | 'open', leadId?: string) {
  try {
    fetch('/api/crm/lb-click', {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plotKey, kind, ...(leadId ? { leadId } : {}) }),
    }).catch(() => { /* ignored */ });
  } catch { /* ignored */ }
}
