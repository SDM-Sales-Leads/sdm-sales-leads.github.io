import React, { useEffect, useState } from 'react';

interface Person { id: string; name: string; touched: number; untouched: number }
interface Load { maxTouched: number; maxUntouched: number; me: Person; people: Person[] }

const Meter: React.FC<{ label: string; n: number; max: number; tone: string }> = ({ label, n, max, tone }) => {
  const pct = max > 0 ? Math.min(100, Math.round((n / max) * 100)) : 0;
  return (
    <div className="min-w-[150px] flex-1">
      <div className="flex items-baseline justify-between text-[11px] font-bold text-brand-black"><span>{label}</span><span className="font-mono">{n}{max > 0 ? ` / ${max}` : ''}</span></div>
      <div className="h-1.5 mt-1 rounded-full bg-brand-gray/15 overflow-hidden"><div className={`h-full rounded-full ${n >= max && max > 0 ? 'bg-rose-500' : tone}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
};

/** every salesperson sees how many open leads are touched (worked on) and untouched (new), against the two limits; managers see everybody */
export const LoadBar: React.FC<{ showPeople?: boolean; defaultOpen?: boolean }> = ({ showPeople, defaultOpen }) => {
  const [d, setD] = useState<Load | null>(null);
  const [open, setOpen] = useState(!!defaultOpen);
  useEffect(() => {
    let live = true;
    const go = () => fetch('/api/crm/load').then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setD(j); }).catch(() => {});
    go();
    const h = () => go();
    window.addEventListener('crm-data-changed', h);
    return () => { live = false; window.removeEventListener('crm-data-changed', h); };
  }, []);
  if (!d) return null;
  const many = d.people.length > 1;
  return (
    <div className="bg-white border border-brand-gray/15 rounded-2xl px-4 py-2.5 shadow-sm" aria-label="My leads load">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="text-[10px] uppercase font-extrabold text-brand-gray">{many && showPeople ? 'My open leads' : 'Open leads'}</span>
        <Meter label="Touched" n={d.me.touched} max={d.maxTouched} tone="bg-emerald-500" />
        <Meter label="Untouched" n={d.me.untouched} max={d.maxUntouched} tone="bg-amber-500" />
        {many && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-[11px] font-bold text-brand-red hover:underline">{open ? 'Hide team' : 'Show team'}</button>
        )}
      </div>
      {many && open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[10px] uppercase text-brand-gray"><th className="py-1 pr-3">Salesperson</th><th className="py-1 pr-3">Touched</th><th className="py-1 pr-3">Untouched</th><th className="py-1">Total</th></tr></thead>
            <tbody>
              {d.people.map((p) => (
                <tr key={p.id} className="border-t border-brand-gray/10">
                  <td className="py-1 pr-3 font-semibold">{p.name}</td>
                  <td className={`py-1 pr-3 font-mono ${d.maxTouched > 0 && p.touched >= d.maxTouched ? 'text-rose-600 font-bold' : ''}`}>{p.touched}</td>
                  <td className={`py-1 pr-3 font-mono ${d.maxUntouched > 0 && p.untouched >= d.maxUntouched ? 'text-rose-600 font-bold' : ''}`}>{p.untouched}</td>
                  <td className="py-1 font-mono">{p.touched + p.untouched}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
