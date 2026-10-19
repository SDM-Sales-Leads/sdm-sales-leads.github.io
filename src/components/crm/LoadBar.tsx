import React, { useEffect, useMemo, useState } from 'react';
import { crmService } from './crmService';
import { useAuth } from '../../services/AuthContext';
import { isTouchedLead } from './leadConfig';

interface Person { id: string; name: string; touched: number; untouched: number }

const CLOSED = new Set(['Won', 'Lost', 'Duplicate', 'Invalid', 'Not Interested', 'Low Budget', 'Wrong Number', 'Closed']);

const Meter: React.FC<{ label: string; n: number; max: number; tone: string }> = ({ label, n, max, tone }) => {
  const pct = max > 0 ? Math.min(100, Math.round((n / max) * 100)) : 0;
  return (
    <div className="min-w-[150px] flex-1">
      <div className="flex items-baseline justify-between text-[11px] font-bold text-brand-black"><span>{label}</span><span className="font-mono">{n}{max > 0 ? ` / ${max}` : ''}</span></div>
      <div className="h-1.5 mt-1 rounded-full bg-brand-gray/15 overflow-hidden"><div className={`h-full rounded-full ${n >= max && max > 0 ? 'bg-rose-500' : tone}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
};

/** every salesperson sees how many open leads are touched (worked on) and untouched (new), against the two limits; managers see everybody.
 *  Counted here from the lists already in memory: no request to the server. */
export const LoadBar: React.FC<{ showPeople?: boolean; defaultOpen?: boolean }> = ({ showPeople, defaultOpen }) => {
  const { user } = useAuth();
  const [ver, setVer] = useState(0);
  const [open, setOpen] = useState(!!defaultOpen);
  useEffect(() => { const h = () => setVer((v) => v + 1); window.addEventListener('crm-data-changed', h); return () => window.removeEventListener('crm-data-changed', h); }, []);
  const q: any = crmService.getQueueSettings();
  const maxTouched = Number(q?.maxTouchedPerSalesperson ?? 300) || 0, maxUntouched = Number(q?.maxUntouchedPerSalesperson ?? 300) || 0;
  const people = useMemo(() => {
    const m = new Map<string, Person>();
    for (const l of crmService.getLeads() as any[]) {
      const id = String(l.assignedSalespersonId || '');
      if (!id || l.mergedInto || CLOSED.has(String(l.status))) continue;
      const p = m.get(id) || { id, name: String(l.assignedSalespersonName || id), touched: 0, untouched: 0 };
      if (isTouchedLead(l)) p.touched++; else p.untouched++;
      m.set(id, p);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const me = people.find((p) => p.id === String(user?.id)) || { id: String(user?.id), name: user?.name || '', touched: 0, untouched: 0 };
  const many = people.filter((p) => p.id !== me.id).length > 0;
  if (!user) return null;
  return (
    <div className="bg-white border border-brand-gray/15 rounded-2xl px-4 py-2.5 shadow-sm" aria-label="My leads load">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="text-[10px] uppercase font-extrabold text-brand-gray">{many && showPeople ? 'My open leads' : 'Open leads'}</span>
        <Meter label="Touched" n={me.touched} max={maxTouched} tone="bg-emerald-500" />
        <Meter label="Untouched" n={me.untouched} max={maxUntouched} tone="bg-amber-500" />
        {many && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-[11px] font-bold text-brand-red hover:underline">{open ? 'Hide team' : 'Show team'}</button>
        )}
      </div>
      {many && open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[10px] uppercase text-brand-gray"><th className="py-1 pr-3">Salesperson</th><th className="py-1 pr-3">Touched</th><th className="py-1 pr-3">Untouched</th><th className="py-1">Total</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="border-t border-brand-gray/10">
                  <td className="py-1 pr-3 font-semibold">{p.name}</td>
                  <td className={`py-1 pr-3 font-mono ${maxTouched > 0 && p.touched >= maxTouched ? 'text-rose-600 font-bold' : ''}`}>{p.touched}</td>
                  <td className={`py-1 pr-3 font-mono ${maxUntouched > 0 && p.untouched >= maxUntouched ? 'text-rose-600 font-bold' : ''}`}>{p.untouched}</td>
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
