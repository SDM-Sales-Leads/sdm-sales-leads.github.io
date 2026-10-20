import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MultiSelect } from '../ui/MultiSelect';
import { Lead } from './types';
import { isMarketingSource, isOpenStatus } from './leadConfig';
import { toast } from 'sonner';
import { RefreshCw, Scale } from 'lucide-react';

export interface CrmAuditProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string;
  setActiveSubTab?: (tab: string) => void;
}

interface AuditRow { id?: number | string; at: string; lead_id: string; actor_name: string; action: string; from_value?: string | null; to_value?: string | null; note?: string | null }

const ACTIONS = ['status', 'owner', 'source', 'value', 'stage', 'cash', 'delete', 'create', 'import', 'merge'];
const PAGE = 50;

export const CrmAudit: React.FC<CrmAuditProps> = ({ leads, setActiveSubTab }) => {
  const [action, setAction] = useState<string[]>([]);
  const [actor, setActor] = useState(''); const [dActor, setDActor] = useState('');
  const [lead, setLead] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { const t = setTimeout(() => setDActor(actor.trim()), 350); return () => clearTimeout(t); }, [actor]);
  useEffect(() => { setPage(0); }, [action.join(','), dActor, lead, from, to]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    const p = new URLSearchParams({ page: String(page), size: String(PAGE) });
    if (action.length) p.set('action', action.join(','));
    if (dActor) p.set('actor', dActor);
    if (lead.trim()) p.set('lead', lead.trim());
    if (from) p.set('from', from);
    if (to) p.set('to', to + 'T23:59:59');
    try {
      const res = await fetch(`/api/crm/audit?${p.toString()}`);
      let j: any = null; try { j = await res.json(); } catch { /* none */ }
      if (!res.ok) { const m = j?.error || 'Could not load the audit trail.'; setErr(m); toast.error(m); setRows([]); return; }
      setRows(Array.isArray(j?.rows) ? j.rows : []);
    } catch { setErr('Could not reach the server.'); setRows([]); }
    finally { setLoading(false); }
  }, [page, action.join(','), dActor, lead, from, to]);
  useEffect(() => { void load(); }, [load]);

  const openLead = (id: string) => { try { localStorage.setItem('selected_lead_id', id); } catch { /* ignore */ } setActiveSubTab?.('leads'); };

  // distribution fairness, one pass over the leads
  const fair = useMemo(() => {
    const m = new Map<string, { open: number; unworked: number; ageSum: number; total: number; mkt: number; vip: number; re: number }>();
    const now = Date.now();
    for (const l of leads) {
      if (l.mergedInto) continue;
      const o = l.assignedSalespersonName || 'Unassigned';
      let e = m.get(o); if (!e) { e = { open: 0, unworked: 0, ageSum: 0, total: 0, mkt: 0, vip: 0, re: 0 }; m.set(o, e); }
      e.total++;
      if (isMarketingSource(l.source) && l.source) e.mkt++;
      if ((l.reassignCount || 0) > 0) e.re++;
      if (!isOpenStatus(l.status)) continue;
      e.open++;
      if (l.priority === 'VIP') e.vip++;
      if (l.status === 'New' && !l.firstContactAt && !l.lastContactDate) {
        const t = l.assignedDate || l.date; const ts = t ? Date.parse(t) : NaN;
        if (!isNaN(ts)) { e.unworked++; e.ageSum += Math.max(0, (now - ts) / 864e5); }
      }
    }
    const list = [...m.entries()].map(([name, e]) => ({ name, ...e })).sort((a, b) => b.open - a.open);
    const max = Math.max(1, ...list.map((x) => x.open));
    return { list, max };
  }, [leads]);

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-black text-brand-dark">Lead Audit Trail</h2>
        <p className="text-sm text-brand-gray">Every change to a lead is recorded by the server with who made it. It cannot be edited from here.</p>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
        <h3 className="font-black text-brand-dark flex items-center gap-2 mb-1"><Scale size={16} /> Distribution fairness</h3>
        <p className="text-xs text-brand-gray mb-3">Open leads are shared evenly when the bars are similar. Unworked = still New with no contact logged.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-brand-gray border-b border-gray-100">
              {['Owner', 'Open leads', 'Unworked', 'Avg age of unworked (days)', 'Marketing leads', 'VIP open', 'Reassigned'].map((h) => <th key={h} className="px-3 py-2 font-bold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>{fair.list.map((e) => (
              <tr key={e.name} className="border-b border-gray-50">
                <td className="px-3 py-2 font-bold">{e.name}</td>
                <td className="px-3 py-2 min-w-[160px]"><div className="flex items-center gap-2"><div className="h-2 rounded-full bg-brand-red" style={{ width: `${Math.round((e.open / fair.max) * 100)}%`, minWidth: e.open ? 4 : 0 }} /><span>{e.open}</span></div></td>
                <td className="px-3 py-2">{e.unworked}</td>
                <td className="px-3 py-2">{e.unworked ? (e.ageSum / e.unworked).toFixed(1) : '—'}</td>
                <td className="px-3 py-2">{e.total ? `${Math.round((e.mkt / e.total) * 100)}%` : '—'} <span className="text-xs text-brand-gray">({e.mkt}/{e.total})</span></td>
                <td className="px-3 py-2">{e.vip}</td>
                <td className="px-3 py-2">{e.re}</td>
              </tr>))}
              {!fair.list.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-brand-gray">No leads loaded.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
        <MultiSelect options={ACTIONS.map((a) => ({ value: a, label: a }))} value={action} onChange={setAction} allLabel="All actions" name="actions" className="min-w-[140px] max-w-[220px]" buttonClassName={`px-3 py-2 rounded-xl border text-sm bg-white flex items-center justify-between gap-2 text-left w-full ${action.length ? 'border-brand-red/50 text-brand-red' : 'border-gray-200'}`} />
        <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Actor name" className="px-3 py-2 rounded-xl border border-gray-200 text-sm" />
        <input value={lead} onChange={(e) => setLead(e.target.value)} placeholder="Lead ID" className="px-3 py-2 rounded-xl border border-gray-200 text-sm w-32" />
        <label className="flex items-center gap-1 text-xs text-brand-gray">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm" /></label>
        <label className="flex items-center gap-1 text-xs text-brand-gray">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm" /></label>
        <button onClick={() => void load()} className="ml-auto flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 text-sm font-bold hover:bg-gray-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-brand-gray border-b border-gray-100">
            {['Time', 'Lead', 'Actor', 'Action', 'Change', 'Note'].map((h) => <th key={h} className="px-3 py-3 font-bold">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.id ?? i}-${r.at}`} className="border-b border-gray-50 align-top">
                <td className="px-3 py-2 whitespace-nowrap">{r.at ? new Date(r.at).toLocaleString('en-GB') : '—'}</td>
                <td className="px-3 py-2"><button onClick={() => openLead(r.lead_id)} className="font-bold text-brand-red hover:underline">{r.lead_id}</button></td>
                <td className="px-3 py-2">{r.actor_name || '—'}</td>
                <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs font-bold">{r.action}</span></td>
                <td className="px-3 py-2">{r.from_value || r.to_value ? `${r.from_value || '—'} → ${r.to_value || '—'}` : '—'}</td>
                <td className="px-3 py-2 text-brand-gray max-w-[280px] break-words">{r.note || '—'}</td>
              </tr>))}
            {!rows.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-brand-gray">{loading ? 'Loading…' : err || 'No audit entries match these filters.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2 text-sm text-brand-gray">
        <button disabled={page === 0 || loading} onClick={() => setPage(page - 1)} className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40">Prev</button>
        <span>Page {page + 1}</span>
        <button disabled={rows.length < PAGE || loading} onClick={() => setPage(page + 1)} className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
};
