import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Package, Layers, Search, X, ChevronRight, ExternalLink, RefreshCw, Filter, Database, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { Plot, PlotStatus, PlotsState, agoText, getPlotsSnapshot, isOlderThan24h, landBankLink, loadPlots, plotsAreStale, trackLbClick } from '../../lib/plotsService';
import { PagerBar } from './LeadListParts';
import { useDebounced, usePagedList } from './usePagedList';
import { OfferPrintsList } from './OfferPrintsList';
import { downloadCsv } from './crmCsv';

const STATUS_LABEL: Record<PlotStatus, string> = { available: 'Available', reserved: 'Reserved', sold: 'Sold', eoi: 'EOI', hold: 'On hold', nfs: 'Not for sale', unknown: 'Unknown' };
const STATUS_CLASS: Record<PlotStatus, string> = {
  available: 'bg-emerald-100 text-emerald-800', reserved: 'bg-amber-100 text-amber-800', sold: 'bg-rose-100 text-rose-800',
  eoi: 'bg-yellow-100 text-yellow-800', hold: 'bg-blue-100 text-blue-800', nfs: 'bg-slate-300 text-slate-800', unknown: 'bg-slate-100 text-slate-500',
};
const BAR_CLASS: Record<PlotStatus, string> = {
  available: 'bg-emerald-500', reserved: 'bg-amber-400', sold: 'bg-rose-500', eoi: 'bg-yellow-400', hold: 'bg-blue-400', nfs: 'bg-slate-500', unknown: 'bg-slate-300',
};
const nf = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString('en-US') : '—');
const dash = (v?: string | null) => (v ? v : '—');
const dayText = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; };
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const selCls = 'appearance-none bg-brand-light hover:bg-black/5 text-brand-black px-4 py-2 pr-8 rounded-xl font-bold text-xs border border-black/5 focus:outline-none focus:ring-2 focus:ring-brand-red cursor-pointer transition-all';
const numCls = 'bg-brand-light text-brand-black px-3 py-2 rounded-xl font-bold text-xs border border-black/5 focus:outline-none focus:ring-2 focus:ring-brand-red w-24';

export const StatusPill: React.FC<{ status: PlotStatus }> = ({ status }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
);

export const LbLink: React.FC<{ plot: Plot; base: string; big?: boolean; leadId?: string }> = ({ plot, base, big, leadId }) => {
  const hold = plot.status === 'available';
  return (
    <a href={landBankLink(base, plot.key, hold ? 'hold' : 'plot')} target="_blank" rel="noopener noreferrer"
      onClick={(e) => { e.stopPropagation(); trackLbClick(plot.key, hold ? 'hold' : 'open', leadId); }}
      className={hold
        ? `inline-flex items-center gap-1 rounded-lg bg-brand-red text-white font-bold whitespace-nowrap hover:opacity-90 ${big ? 'px-4 py-2 text-xs' : 'px-2.5 py-1 text-[11px]'}`
        : `inline-flex items-center gap-1 rounded-lg border border-brand-gray/30 text-brand-black font-semibold whitespace-nowrap hover:bg-brand-gray/5 ${big ? 'px-4 py-2 text-xs' : 'px-2.5 py-1 text-[11px]'}`}>
      {hold ? 'Hold in Land Bank' : 'Open in Land Bank'} <ExternalLink size={11} />
    </a>
  );
};

const Select: React.FC<{ value: string; onChange: (v: string) => void; all: string; options: string[] }> = ({ value, onChange, all, options }) => (
  <div className="relative">
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selCls}>
      <option value="">{all}</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-brand-gray"><ChevronRight size={12} className="rotate-90 opacity-60" /></div>
  </div>
);

export const CrmPlotsInventory: React.FC = () => {
  const [st, setSt] = useState<PlotsState | null>(() => getPlotsSnapshot());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [activeTab, setActiveTab] = useState<'breakdown' | 'landbank'>('breakdown');
  const [park, setPark] = useState(''); const [sector, setSector] = useState(''); const [landType, setLandType] = useState('');
  const [minA, setMinA] = useState(''); const [maxA, setMaxA] = useState('');
  const [minP, setMinP] = useState(''); const [maxP, setMaxP] = useState('');
  const [q, setQ] = useState(''); const dq = useDebounced(q, 250);
  const [ledger, setLedger] = useState<{ park: string; sector: string; plots: Plot[] } | null>(null);
  const [open, setOpen] = useState<Plot | null>(null);

  const refresh = useCallback(async (force: boolean) => {
    setLoading(true); setErr('');
    try { setSt(await loadPlots(force)); } catch (e: any) { setErr(e.message || 'Plots could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (plotsAreStale()) refresh(false); }, [refresh]);
  useEffect(() => {
    if (!open && !ledger) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (open) setOpen(null); else setLedger(null); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, ledger]);

  const all = st?.plots || [];
  const opts = useMemo(() => {
    const parks = new Set<string>(), types = new Set<string>(), sectors = new Set<string>();
    for (const p of all) { if (p.park) parks.add(p.park); if (p.landType) types.add(p.landType); if (p.sector && (!park || p.park === park)) sectors.add(p.sector); }
    const s = (x: Set<string>) => [...x].sort(collator.compare);
    return { parks: s(parks), types: s(types), sectors: s(sectors) };
  }, [all, park]);

  const filtered = useMemo(() => {
    const lo = Number(minA) || 0, hi = Number(maxA) || Infinity, plo = Number(minP) || 0, phi = Number(maxP) || Infinity;
    const needle = dq.trim().toLowerCase();
    const byPrice = plo > 0 || phi !== Infinity;
    return all.filter((p) =>
      (!park || p.park === park) && (!sector || p.sector === sector) && (!landType || p.landType === landType) &&
      p.areaSqM >= lo && p.areaSqM <= hi &&
      (!byPrice || (p.listPriceSqm !== null && p.listPriceSqm >= plo && p.listPriceSqm <= phi)) &&
      (!needle || `${p.unit} ${p.merged?.join(' ') || ''}`.toLowerCase().includes(needle)));
  }, [all, park, sector, landType, minA, maxA, minP, maxP, dq]);

  // park -> sector -> available plots (one pass)
  const breakdown = useMemo(() => {
    const m = new Map<string, Map<string, Plot[]>>();
    for (const p of filtered) {
      if (p.status !== 'available') continue;
      const sec = p.sector || p.landType || 'General';
      let g = m.get(p.park); if (!g) { g = new Map(); m.set(p.park, g); }
      const a = g.get(sec); if (a) a.push(p); else g.set(sec, [p]);
    }
    return [...m.entries()].sort((a, b) => collator.compare(a[0], b[0])).map(([name, secs]) => {
      const list = [...secs.entries()].sort((a, b) => collator.compare(a[0], b[0])).map(([sec, plots]) => ({ sec, plots, area: plots.reduce((s, p) => s + p.areaSqM, 0) }));
      return { name, secs: list, units: list.reduce((s, x) => s + x.plots.length, 0), area: list.reduce((s, x) => s + x.area, 0) };
    });
  }, [filtered]);

  const analysis = useMemo(() => {
    const m = new Map<string, { total: number; area: number; by: Record<string, { n: number; area: number }> }>();
    for (const p of filtered) {
      let g = m.get(p.park); if (!g) { g = { total: 0, area: 0, by: {} }; m.set(p.park, g); }
      g.total++; g.area += p.areaSqM;
      const b = g.by[p.status] || (g.by[p.status] = { n: 0, area: 0 }); b.n++; b.area += p.areaSqM;
    }
    return [...m.entries()].sort((a, b) => collator.compare(a[0], b[0]));
  }, [filtered]);

  const availCount = useMemo(() => breakdown.reduce((s, b) => s + b.units, 0), [breakdown]);
  const base = st?.landBankUrl || '';
  const never = !!st && (!st.updatedAt || st.count === 0);
  const stale = !!st && !never && isOlderThan24h(st.updatedAt);
  const clear = () => { setPark(''); setSector(''); setLandType(''); setMinA(''); setMaxA(''); setMinP(''); setMaxP(''); setQ(''); };
  const dirty = !!(park || sector || landType || minA || maxA || minP || maxP || q);

  const exportLedger = () => {
    if (!ledger) return;
    downloadCsv(`${ledger.park}_${ledger.sector}_Inventory.csv`.replace(/\s+/g, '_'),
      ['Park', 'Plot', 'Status', 'Area (sqm)', 'Price / sqm', 'Total price', 'Land type', 'Sector'],
      ledger.plots.map((p) => [p.park, p.unit, STATUS_LABEL[p.status], p.areaSqM, p.listPriceSqm ?? '', p.listTotal ?? '', p.landType, p.sector]));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col p-5 rounded-2xl bg-white border border-black/5 shadow-sm gap-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand-red/10 text-brand-red rounded-xl"><Database size={22} /></div>
            <div>
              <h2 className="font-bold text-brand-black text-base flex flex-wrap items-center gap-2">
                Plots Inventory
                <span className="text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Land Bank</span>
                {err && <span className="text-[10px] bg-rose-500/10 text-rose-600 border border-rose-500/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Load failed</span>}
              </h2>
              <p className="text-xs text-brand-gray mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{err ? `${err} Click Refresh to retry.` : st ? `${st.count.toLocaleString('en-US')} plots from the Land Bank.` : 'Loading…'}</span>
                <span className="text-black/20">|</span>
                <span className="text-black/50">Updated from Land Bank: <strong className="text-brand-black font-semibold">{st?.updatedAt ? agoText(st.updatedAt) : 'never'}</strong></span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => refresh(true)} disabled={loading}
              className={`px-3.5 py-2.5 bg-brand-red hover:bg-brand-red/90 text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-sm ${loading ? 'opacity-60 cursor-not-allowed' : ''}`}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {(never || stale) && (
          <div className="p-3 rounded-xl border bg-amber-500/10 text-amber-800 border-amber-500/20 flex items-center gap-2.5 text-xs font-semibold">
            <AlertCircle size={16} />
            {never ? 'The Land Bank has not published the plots yet. An Admin or Sales Operation user must publish them from the Land Bank page.'
              : `This snapshot is older than 24 hours (${agoText(st!.updatedAt)}). Check availability in the Land Bank before promising a plot.`}
          </div>
        )}
      </div>

      {st && !never && (
        <>
          <div className="bento-card">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-black/5">
              <div className="flex items-center gap-2 text-brand-black"><Filter className="text-brand-red" size={18} /><h3 className="font-bold text-sm uppercase tracking-wider">Operational Filters</h3></div>
              <span className="text-xs bg-brand-red/15 text-brand-red px-3 py-1 rounded-full font-extrabold tracking-wider border border-brand-red/10">{filtered.length.toLocaleString('en-US')} / {all.length.toLocaleString('en-US')}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={park} onChange={(v) => { setPark(v); setSector(''); }} all="Project (All)" options={opts.parks} />
              <Select value={sector} onChange={setSector} all="Sector (All)" options={opts.sectors} />
              <Select value={landType} onChange={setLandType} all="Land Type (All)" options={opts.types} />
              <input type="number" min={0} value={minA} onChange={(e) => setMinA(e.target.value)} placeholder="Min m²" className={numCls} />
              <input type="number" min={0} value={maxA} onChange={(e) => setMaxA(e.target.value)} placeholder="Max m²" className={numCls} />
              <input type="number" min={0} value={minP} onChange={(e) => setMinP(e.target.value)} placeholder="Min EGP/m²" className={numCls} />
              <input type="number" min={0} value={maxP} onChange={(e) => setMaxP(e.target.value)} placeholder="Max EGP/m²" className={numCls} />
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-gray" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Plot code" className={`${numCls} w-36 pl-9`} />
              </div>
              {dirty && <button onClick={clear} className="text-xs font-bold text-brand-red">Clear filters</button>}
            </div>
          </div>

          <div className="flex border-b border-black/5 gap-1">
            {([['breakdown', Package, 'Available Inventory Breakdown'], ['landbank', Layers, 'Project Land Bank Analysis']] as const).map(([id, Icon, label]) => (
              <button key={id} onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2.5 px-6 py-3.5 font-bold text-sm border-b-2 transition-all ${activeTab === id ? 'border-brand-red text-brand-red' : 'border-transparent text-brand-gray hover:text-brand-black'}`}>
                <Icon size={18} /> {label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'breakdown' ? (
              <motion.div key="breakdown" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <Package className="text-brand-red" size={20} />
                  <h3 className="font-bold text-lg text-brand-black">Available Inventory Breakdown</h3>
                  <span className="text-xs text-brand-gray">{availCount.toLocaleString('en-US')} available plots</span>
                </div>
                {breakdown.length === 0 ? (
                  <div className="p-12 text-center bg-white/40 border border-black/5 rounded-2xl text-xs font-semibold text-brand-gray">No available plots match these filters.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {breakdown.map((b) => (
                      <div key={b.name} className="bento-card flex flex-col justify-between">
                        <div>
                          <div className="flex justify-between items-center border-b border-black/5 pb-3 mb-4">
                            <h4 className="font-bold text-base text-brand-black uppercase tracking-tight">{b.name}</h4>
                            <span className="text-[10px] bg-brand-red/10 text-brand-red font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">{b.units} Available</span>
                          </div>
                          <div className="space-y-2.5">
                            {b.secs.map((s) => (
                              <button key={s.sec} onClick={() => setLedger({ park: b.name, sector: s.sec, plots: s.plots })}
                                className="w-full flex justify-between items-center p-3 rounded-xl border border-black/5 bg-black/5 hover:bg-brand-red hover:text-white transition-all cursor-pointer group text-left">
                                <span className="text-xs font-bold">{s.sec}</span>
                                <span className="text-right flex items-center gap-1.5">
                                  <span className="flex flex-col"><span className="text-xs font-mono font-bold">{s.plots.length} Units</span><span className="text-[10px] font-mono text-brand-gray group-hover:text-white/80">{Math.round(s.area).toLocaleString('en-US')} m²</span></span>
                                  <ChevronRight size={14} className="opacity-40 group-hover:opacity-100 transition-all" />
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="mt-6 pt-4 border-t border-black/5 flex justify-between text-[11px] font-mono text-brand-gray">
                          <span>TOTAL PORTFOLIO:</span><span className="font-bold text-brand-black">{Math.round(b.area).toLocaleString('en-US')} m² Available</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div key="landbank" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
                <div>
                  <span className="text-[10px] font-bold tracking-widest text-brand-gray uppercase block">PORTFOLIO LAND BANK LEVELS</span>
                  <div className="flex items-center gap-2.5 mt-0.5"><Layers className="text-brand-red" size={22} /><h3 className="font-bold text-2xl text-brand-black">PROJECT LAND BANK ANALYSIS</h3></div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {analysis.map(([name, g]) => (
                    <div key={name} className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-black/5 border-t-4 border-t-brand-red p-6 space-y-4">
                      <div className="flex justify-between items-center">
                        <h4 className="font-extrabold text-brand-black text-sm tracking-tight uppercase">{name}</h4>
                        <span className="text-[10px] font-mono text-brand-gray">{g.total.toLocaleString('en-US')} plots · {Math.round(g.area).toLocaleString('en-US')} m²</span>
                      </div>
                      <div className="flex h-2.5 rounded-full overflow-hidden bg-black/5">
                        {(Object.keys(STATUS_LABEL) as PlotStatus[]).filter((s) => g.by[s]).map((s) => <div key={s} className={BAR_CLASS[s]} style={{ width: `${(g.by[s].n / g.total) * 100}%` }} title={`${STATUS_LABEL[s]}: ${g.by[s].n}`} />)}
                      </div>
                      <div className="space-y-1.5">
                        {(Object.keys(STATUS_LABEL) as PlotStatus[]).filter((s) => g.by[s]).map((s) => (
                          <div key={s} className="flex justify-between items-center text-xs">
                            <StatusPill status={s} />
                            <span className="font-mono"><strong>{g.by[s].n.toLocaleString('en-US')}</strong> <span className="text-brand-gray">· {Math.round(g.by[s].area).toLocaleString('en-US')} m²</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {ledger && <Ledger ledger={ledger} base={base} onClose={() => setLedger(null)} onOpen={setOpen} onExport={exportLedger} />}

      {open && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex justify-end" onClick={() => setOpen(null)}>
          <div className="bg-white w-full max-w-md h-full overflow-y-auto p-6 space-y-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-lg font-black font-mono">{dash(open.unit)}</h3><p className="text-xs text-brand-gray font-semibold">{dash(open.park)}</p></div>
              <button onClick={() => setOpen(null)} aria-label="Close" className="p-2 rounded-xl hover:bg-black/5"><X size={18} /></button>
            </div>
            <div className="flex items-center gap-3"><StatusPill status={open.status} /><LbLink plot={open} base={base} big /></div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {([
                ['Area', open.areaSqM ? `${nf(open.areaSqM)} m²` : '—'], ['Price / sqm', open.listPriceSqm ? `${nf(open.listPriceSqm)} EGP` : '—'],
                ['Total price', open.listTotal ? `${nf(open.listTotal)} EGP` : '—'], ['Land type', dash(open.landType)],
                ['Sector', dash(open.sector)], ['Hold until', open.status === 'hold' ? dayText(open.holdUntil) : '—'],
                ['Merged plots', open.merged ? open.merged.join(', ') : '—'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="bg-brand-light rounded-xl p-3"><div className="text-[10px] uppercase font-bold text-brand-gray tracking-wider">{k}</div><div className="font-bold mt-0.5 break-words">{v}</div></div>
              ))}
            </div>
            <div>
              <h4 className="text-[10px] uppercase font-bold text-brand-gray tracking-widest mb-2">Offers printed for this plot</h4>
              <div className="border border-brand-gray/15 rounded-xl"><OfferPrintsList plotKey={open.key} compact /></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Ledger: React.FC<{ ledger: { park: string; sector: string; plots: Plot[] }; base: string; onClose: () => void; onOpen: (p: Plot) => void; onExport: () => void }> = ({ ledger, base, onClose, onOpen, onExport }) => {
  const rows = useMemo(() => [...ledger.plots].sort((a, b) => collator.compare(a.unit, b.unit)), [ledger]);
  const { pageRows, page, pageSize, setPage, setPageSize, allShown, more } = usePagedList(rows, 'crm.plots.page', ledger.sector + ledger.park);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[92vw] lg:max-w-6xl bg-white rounded-2xl shadow-2xl border border-black/10 flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-black/5 bg-brand-light rounded-t-2xl">
          <div><h4 className="font-bold text-lg text-brand-black">{ledger.park}</h4><p className="text-xs text-brand-red font-bold">Sector / Land Type: {ledger.sector}</p></div>
          <div className="flex items-center gap-2.5">
            <button onClick={onExport} className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5"><FileSpreadsheet size={14} /> Export to CSV</button>
            <button onClick={onClose} aria-label="Close" className="p-1.5 hover:bg-black/5 text-brand-gray rounded-lg"><X size={20} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0"><tr className="bg-brand-gray/5 border-b border-brand-gray/15 text-brand-gray text-[10px] font-bold uppercase tracking-wider">
              <th className="py-3 px-4">Park</th><th className="py-3 px-3">Plot</th><th className="py-3 px-3">Status</th><th className="py-3 px-3 text-right">Area (m²)</th>
              <th className="py-3 px-3 text-right">Price / sqm</th><th className="py-3 px-3 text-right">Total price</th><th className="py-3 px-3">Land type</th><th className="py-3 px-3">Sector</th><th className="py-3 px-3">Hold until</th><th className="py-3 px-3" />
            </tr></thead>
            <tbody className="divide-y divide-brand-gray/10">
              {pageRows.map((p) => (
                <tr key={p.key} onClick={() => onOpen(p)} className="hover:bg-brand-gray/5 cursor-pointer">
                  <td className="py-2.5 px-4 font-semibold">{dash(p.park)}</td>
                  <td className="py-2.5 px-3 font-mono font-bold text-brand-red">{dash(p.unit)}{p.merged && <span className="ml-1 text-[10.5px] text-brand-gray font-sans">merged ×{p.merged.length}</span>}</td>
                  <td className="py-2.5 px-3"><StatusPill status={p.status} /></td>
                  <td className="py-2.5 px-3 text-right font-mono">{nf(p.areaSqM)}</td>
                  <td className="py-2.5 px-3 text-right font-mono">{nf(p.listPriceSqm)}</td>
                  <td className="py-2.5 px-3 text-right font-mono">{nf(p.listTotal)}</td>
                  <td className="py-2.5 px-3">{dash(p.landType)}</td><td className="py-2.5 px-3">{dash(p.sector)}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">{p.status === 'hold' ? dayText(p.holdUntil) : '—'}</td>
                  <td className="py-2.5 px-3 text-right"><LbLink plot={p} base={base} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PagerBar total={rows.length} page={page} pageSize={pageSize} onPage={setPage} onSize={setPageSize} shown={allShown} onMore={more} />
      </motion.div>
    </div>
  );
};
