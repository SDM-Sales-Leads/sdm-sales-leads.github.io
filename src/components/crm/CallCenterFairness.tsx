import React, { useEffect, useState } from 'react';

interface P { id: string; name: string; leads: number; sqm: number; sharePct: number | null; sqmSharePct: number | null }
interface F { days: number; total: number; totalSqm: number; waiting: number; nextName: string | null; people: P[] }

/** preview of how the call center leads were shared between the sales team (they ignore the limits and go to whoever holds the fewest, by number and size) */
export const CallCenterFairness: React.FC = () => {
  const [d, setD] = useState<F | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/crm/call-center/fairness').then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setD(j); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!d) return null;
  const maxLeads = Math.max(1, ...d.people.map((p) => p.leads));
  const fmt = (n: number) => (n > 0 ? Math.round(n).toLocaleString('en-US') : '—');
  return (
    <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-bold text-brand-black text-sm">Call center leads: fair share (last {d.days} days)</h4>
        <span className="text-[11px] text-brand-gray">Next call center lead goes to <b className="text-brand-black">{d.nextName || '—'}</b> · waiting in the pool: <b className="text-brand-black">{d.waiting}</b></span>
      </div>
      <p className="text-[11px] text-brand-gray mt-1">Call center leads ignore the 300 / 300 limits. Each one goes to the person who holds the fewest of them (number and size balanced), so nobody is left behind.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-[10px] uppercase text-brand-gray"><th className="py-1 pr-3">Salesperson</th><th className="py-1 pr-3 w-[38%]">Call center leads</th><th className="py-1 pr-3">Share</th><th className="py-1 pr-3">Size (sqm)</th><th className="py-1">Size share</th></tr></thead>
          <tbody>
            {d.people.map((p) => (
              <tr key={p.id} className="border-t border-brand-gray/10">
                <td className="py-1.5 pr-3 font-semibold">{p.name}{p.name === d.nextName ? <span className="ml-2 text-[10.5px] font-bold text-brand-red">NEXT</span> : null}</td>
                <td className="py-1.5 pr-3"><div className="flex items-center gap-2"><div className="h-2 rounded-full bg-brand-red" style={{ width: `${Math.round((p.leads / maxLeads) * 100)}%`, minWidth: p.leads ? 4 : 0 }} /><span className="font-mono">{p.leads}</span></div></td>
                <td className="py-1.5 pr-3 font-mono">{p.sharePct === null ? '—' : `${p.sharePct}%`}</td>
                <td className="py-1.5 pr-3 font-mono">{fmt(p.sqm)}</td>
                <td className="py-1.5 font-mono">{p.sqmSharePct === null ? '—' : `${p.sqmSharePct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
