// Small shared pieces for the dashboard and the reports: info tooltip, KPI tile, filter bar, rate dial, bar row.
import { MultiSelect } from '../ui/MultiSelect';
import React from 'react';
import { Info, ArrowUpRight, ArrowDownRight, Minus, X } from 'lucide-react';
import { Filters, Period, deltaPct } from './leadMetrics';

/** "i" icon with the definition of a figure (what it counts and against what). Opens on hover, focus or tap. */
export const InfoTip: React.FC<{ text: React.ReactNode; wide?: boolean }> = ({ text, wide }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <span className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="How this is calculated" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} onBlur={() => setOpen(false)}
        className="text-brand-gray/50 hover:text-brand-red focus:outline-none focus:text-brand-red">
        <Info size={12} />
      </button>
      {open && (
        <span role="tooltip" className={`absolute z-40 left-1/2 -translate-x-1/2 top-full mt-1.5 ${wide ? 'w-80' : 'w-64'} bg-brand-black text-white text-[10px] font-medium normal-case tracking-normal leading-relaxed rounded-xl p-3 shadow-xl text-left`}>
          {text}
        </span>
      )}
    </span>
  );
};

export const Card: React.FC<{ title: React.ReactNode; info?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, info, right, children, className = '' }) => (
  <div className={`bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-4 ${className}`}>
    <div className="flex items-center justify-between gap-2">
      <h4 className="font-extrabold text-brand-black text-xs uppercase tracking-wider flex items-center gap-1.5">{title}{info && <InfoTip text={info} wide />}</h4>
      {right}
    </div>
    {children}
  </div>
);

export const Delta: React.FC<{ now: number | null; prev: number | null | undefined; lowerIsBetter?: boolean }> = ({ now, prev, lowerIsBetter }) => {
  if (prev === undefined) return null;
  const d = deltaPct(now, prev);
  if (d == null) return <span className="text-[10px] text-brand-gray/60">no earlier data</span>;
  if (d === 0) return <span className="text-[10px] text-brand-gray flex items-center gap-0.5"><Minus size={11} /> level vs previous</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={`text-[10px] font-bold flex items-center gap-0.5 ${good ? 'text-emerald-600' : 'text-rose-600'}`}>
      {d > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(d)}% vs previous
    </span>
  );
};

export const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; info: React.ReactNode; delta?: React.ReactNode; tone?: string; onClick?: () => void }> = ({ label, value, sub, info, delta, tone = 'text-brand-black', onClick }) => (
  <div onClick={onClick} title={onClick ? 'Click to open these leads' : undefined} className={`bg-white border border-brand-gray/20 rounded-2xl p-4 shadow-sm ${onClick ? 'cursor-pointer hover:border-brand-red/40' : ''}`}>
    <div className="flex items-center justify-between gap-1">
      <span className="text-[10px] uppercase font-bold text-brand-gray tracking-wider">{label}</span>
      <InfoTip text={info} />
    </div>
    <p className={`text-2xl font-black font-mono mt-1.5 ${tone}`}>{value}</p>
    {sub && <p className="text-[10px] text-brand-gray font-semibold mt-1">{sub}</p>}
    {delta && <div className="mt-1">{delta}</div>}
  </div>
);

const toneOf = (v: number | null, good: number, ok: number, lowerBetter = false) => {
  if (v == null) return 'bg-brand-gray/10 text-brand-gray';
  const g = lowerBetter ? v <= good : v >= good; const o = lowerBetter ? v <= ok : v >= ok;
  return g ? 'bg-emerald-100 text-emerald-800' : o ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800';
};
export const Pill: React.FC<{ v: number | null; good: number; ok: number; lowerBetter?: boolean; dp?: number }> = ({ v, good, ok, lowerBetter, dp = 0 }) => (
  <span className={`font-mono text-[10px] font-black px-2 py-0.5 rounded-full ${toneOf(v, good, ok, lowerBetter)}`}>{v == null ? '—' : `${v.toFixed(dp)}%`}</span>
);

export const RateDial: React.FC<{ label: string; v: number | null; good: number; ok: number; lowerBetter?: boolean; info: React.ReactNode; delta?: React.ReactNode }> = ({ label, v, good, ok, lowerBetter, info, delta }) => {
  const tone = toneOf(v, good, ok, lowerBetter);
  return (
    <div className="border border-brand-gray/15 rounded-2xl p-3 text-center bg-white">
      <div className="text-[10px] uppercase font-bold text-brand-gray tracking-wider flex items-center justify-center gap-1">{label}<InfoTip text={info} /></div>
      <div className={`mt-2 inline-block px-3 py-1 rounded-full text-lg font-black font-mono ${tone}`}>{v == null ? '—' : `${Math.round(v)}%`}</div>
      {delta && <div className="mt-1.5 flex justify-center">{delta}</div>}
    </div>
  );
};

export const BarRow: React.FC<{ label: React.ReactNode; value: number; max: number; right?: React.ReactNode; color?: string; onClick?: () => void }> = ({ label, value, max, right, color = '#D32F2F', onClick }) => (
  <div className={`flex items-center gap-2 text-[11px] ${onClick ? 'cursor-pointer hover:bg-brand-gray/5 rounded-lg' : ''}`} onClick={onClick}>
    <span className="w-36 truncate font-bold text-brand-black" title={typeof label === 'string' ? label : undefined}>{label}</span>
    <div className="flex-1 h-2 bg-brand-gray/10 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%`, background: color }} /></div>
    <span className="w-24 text-right font-mono font-bold text-brand-gray">{right ?? value}</span>
  </div>
);

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' }, { id: 'all', label: 'All time' }, { id: 'custom', label: 'Custom' },
];
export const FilterBar: React.FC<{
  f: Filters; set: (f: Filters) => void; owners?: { id: string; name: string }[]; sources: string[]; rangeLabel: string;
}> = ({ f, set, owners, sources, rangeLabel }) => {
  const sel = 'bg-white border border-brand-gray/20 rounded-xl px-3 py-1.5 text-xs font-bold text-brand-black focus:outline-none focus:border-brand-red';
  const dirty = !!(f.owner.length || f.source.length);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex bg-brand-gray/10 rounded-xl p-1 gap-0.5">
        {PERIODS.map((p) => (
          <button key={p.id} onClick={() => set({ ...f, period: p.id })}
            className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-colors ${f.period === p.id ? 'bg-white text-brand-black shadow-sm' : 'text-brand-gray hover:text-brand-black'}`}>{p.label}</button>
        ))}
      </div>
      {f.period === 'custom' && (
        <>
          <input type="date" value={f.from} onChange={(e) => set({ ...f, from: e.target.value })} className={sel} aria-label="From" />
          <input type="date" value={f.to} onChange={(e) => set({ ...f, to: e.target.value })} className={sel} aria-label="To" />
        </>
      )}
      {owners && owners.length > 1 && (
        <MultiSelect options={owners.map((o) => ({ value: o.id, label: o.name }))} value={f.owner} onChange={(owner) => set({ ...f, owner })} allLabel="All salespeople" name="salespeople" className="min-w-[150px] max-w-[220px]" buttonClassName={`${sel} w-full flex items-center justify-between gap-2 text-left`} />
      )}
      <MultiSelect options={sources.map((s) => ({ value: s, label: s }))} value={f.source} onChange={(source) => set({ ...f, source })} allLabel="All sources" name="sources" className="min-w-[130px] max-w-[200px]" buttonClassName={`${sel} w-full flex items-center justify-between gap-2 text-left`} />
      {dirty && <button onClick={() => set({ ...f, owner: [], source: [] })} className="text-[10px] font-bold text-brand-red flex items-center gap-1"><X size={12} /> Clear filters</button>}
      <span className="text-[10px] font-bold text-brand-gray ml-auto">{rangeLabel}</span>
    </div>
  );
};
