import React, { useEffect, useMemo, useState } from 'react';
import { MultiSelect } from '../ui/MultiSelect';
import { Lead } from './types';
import { closingDate } from './leadConfig';
import { useAuth } from '../../services/AuthContext';
import { toast } from 'sonner';
import { Search, Download, CheckCircle2, Clock, Banknote, Briefcase, RotateCcw } from 'lucide-react';
import { downloadCsv, fmtEgp, todayIso } from './crmCsv';

export interface CrmFinanceProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string;
  setActiveSubTab?: (tab: string) => void;
}

const isConfirmed = (l: Lead) => l.cashStatus === 'confirmed';

export const CrmFinance: React.FC<CrmFinanceProps> = ({ leads, onLeadsUpdated, setActiveSubTab }) => {
  const { permissions } = useAuth();
  const canConfirm = !!permissions?.canConfirmCash;

  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState<string[]>([]);
  const [owner, setOwner] = useState<string[]>([]);
  const [project, setProject] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [size, setSize] = useState(25);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [reopening, setReopening] = useState<Lead | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => { const t = setTimeout(() => setDq(q.trim().toLowerCase()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(0); }, [dq, status, owner, project, from, to, size]);

  const won = useMemo(() => leads.filter((l) => l.status === 'Won' && !l.mergedInto), [leads]);
  const owners = useMemo(() => [...new Set(won.map((l) => l.assignedSalespersonName || '').filter(Boolean))].sort(), [won]);
  const projects = useMemo(() => [...new Set(won.map((l) => l.project || '').filter(Boolean))].sort(), [won]);

  const rows = useMemo(() => {
    const out = won.filter((l) => {
      if (status.length === 1 && (status[0] === 'pending' ? isConfirmed(l) : !isConfirmed(l))) return false;
      if (owner.length && !owner.includes(l.assignedSalespersonName || '')) return false;
      if (project.length && !project.includes(l.project || '')) return false;
      const d = closingDate(l);
      if (from && (!d || d < from)) return false;
      if (to && (!d || d > to)) return false;
      if (dq) {
        const hay = `${l.id} ${l.customerName} ${l.companyName || ''} ${l.project} ${l.plotNo || ''} ${l.assignedSalespersonName || ''}`.toLowerCase();
        if (!hay.includes(dq)) return false;
      }
      return true;
    });
    // pending first, then newest closing date
    return out.map((l) => ({ l, d: closingDate(l) })).sort((a, b) => {
      const pa = isConfirmed(a.l) ? 1 : 0, pb = isConfirmed(b.l) ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return (b.d || '').localeCompare(a.d || '');
    });
  }, [won, status, owner, project, from, to, dq]);

  const kpi = useMemo(() => {
    let value = 0, confirmed = 0, confirmedN = 0, pending = 0, pendingN = 0;
    for (const { l } of rows) {
      const v = Number(l.dealValue) || 0;
      value += v;
      if (isConfirmed(l)) { confirmed += v; confirmedN++; } else { pending += v; pendingN++; }
    }
    return { n: rows.length, value, confirmed, confirmedN, pending, pendingN };
  }, [rows]);

  const pageCount = size === 0 ? 1 : Math.max(1, Math.ceil(rows.length / size));
  const shown = size === 0 ? rows : rows.slice(page * size, page * size + size);

  const call = async (l: Lead, body: { action: 'confirm' | 'reopen'; reason?: string }) => {
    setBusy(l.id);
    try {
      const res = await fetch(`/api/crm/leads/${encodeURIComponent(l.id)}/cash`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      let j: any = null;
      try { j = await res.json(); } catch { /* no body */ }
      if (!res.ok) { toast.error(j?.error || 'The change was not saved.'); return false; }
      toast.success(body.action === 'confirm' ? 'Cash confirmed' : 'Cash re-opened');
      onLeadsUpdated();
      return true;
    } catch {
      toast.error('Could not reach the server.');
      return false;
    } finally { setBusy(null); }
  };

  const exportCsv = () => {
    downloadCsv(`Won_Deals_${todayIso()}.csv`,
      ['Lead ID', 'Customer', 'Company', 'Project', 'Plot', 'Owner', 'Closing date', 'Deal value (EGP)', 'Total sold value (EGP)', 'Sold area (sqm)', 'Cash status', 'Confirmed by', 'Confirmed on'],
      rows.map(({ l, d }) => [l.id, l.customerName, l.companyName || '', l.project || '', l.plotNo || '', l.assignedSalespersonName || '', d || '',
        l.dealValue ?? '', l.totalSoldValue ?? '', l.soldArea ?? '', isConfirmed(l) ? 'Confirmed' : 'Pending', l.cashBy || '', l.cashDate || '']));
  };

  const openLead = (id: string) => { try { localStorage.setItem('selected_lead_id', id); } catch { /* ignore */ } setActiveSubTab?.('leads'); };

  const tile = (icon: React.ReactNode, label: string, value: string, sub: string, tone = 'text-brand-dark') => (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-bold text-brand-gray uppercase tracking-wide">{icon}{label}</div>
      <div className={`text-2xl font-black mt-1 ${tone}`}>{value}</div>
      <div className="text-xs text-brand-gray mt-0.5">{sub}</div>
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-brand-dark">Won Deals & Cash</h2>
          <p className="text-sm text-brand-gray">Every won deal and whether accounts receivable has confirmed its cash value.</p>
        </div>
        <button onClick={exportCsv} disabled={!rows.length} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-bold hover:bg-gray-50 disabled:opacity-50">
          <Download size={16} /> Export (Excel / CSV)
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tile(<Briefcase size={14} />, 'Won deals', kpi.n.toLocaleString('en-US'), 'in the current filter')}
        {tile(<Banknote size={14} />, 'Deal value', `EGP ${fmtEgp(kpi.value)}`, 'cash value of these deals')}
        {tile(<CheckCircle2 size={14} />, 'Cash confirmed', `EGP ${fmtEgp(kpi.confirmed)}`, `${kpi.confirmedN} deal(s)`, 'text-emerald-600')}
        {tile(<Clock size={14} />, 'Pending', `EGP ${fmtEgp(kpi.pending)}`, `${kpi.pendingN} deal(s) awaiting AR`, kpi.pendingN ? 'text-amber-600' : 'text-brand-dark')}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-gray" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lead, company, plot, owner…" className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm" />
        </div>
        <MultiSelect options={[{ value: 'pending', label: 'Pending' }, { value: 'confirmed', label: 'Confirmed' }]} value={status} onChange={setStatus} allLabel="All cash status" name="kinds" className="min-w-[140px] max-w-[220px]" buttonClassName={`px-3 py-2 rounded-xl border text-sm bg-white flex items-center justify-between gap-2 text-left w-full ${status.length ? 'border-brand-red/50 text-brand-red' : 'border-gray-200'}`} />
        <MultiSelect options={owners.map((x) => ({ value: x, label: x }))} value={owner} onChange={setOwner} allLabel="All owners" name="owners" className="min-w-[140px] max-w-[220px]" buttonClassName={`px-3 py-2 rounded-xl border text-sm bg-white flex items-center justify-between gap-2 text-left w-full ${owner.length ? 'border-brand-red/50 text-brand-red' : 'border-gray-200'}`} />
        <MultiSelect options={projects.map((x) => ({ value: x, label: x }))} value={project} onChange={setProject} allLabel="All projects" name="projects" className="min-w-[140px] max-w-[220px]" buttonClassName={`px-3 py-2 rounded-xl border text-sm bg-white flex items-center justify-between gap-2 text-left w-full ${project.length ? 'border-brand-red/50 text-brand-red' : 'border-gray-200'}`} />
        <label className="flex items-center gap-1 text-xs text-brand-gray">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm" /></label>
        <label className="flex items-center gap-1 text-xs text-brand-gray">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm" /></label>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-brand-gray border-b border-gray-100">
              {['Closing date', 'Lead', 'Project / plot', 'Owner', 'Deal value (EGP)', 'Total sold (EGP)', 'Area (sqm)', 'Cash', ''].map((h, i) => <th key={i} className="px-3 py-3 font-bold whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ l, d }) => (
              <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                <td className="px-3 py-2.5 whitespace-nowrap">{d || '—'}</td>
                <td className="px-3 py-2.5">
                  <button onClick={() => openLead(l.id)} className="font-bold text-brand-dark hover:text-brand-red text-left">{l.customerName || l.id}</button>
                  <div className="text-xs text-brand-gray">{l.companyName || '—'} · {l.id}</div>
                </td>
                <td className="px-3 py-2.5">{l.project || '—'}<div className="text-xs text-brand-gray">{l.plotNo || '—'}</div></td>
                <td className="px-3 py-2.5">{l.assignedSalespersonName || '—'}</td>
                <td className="px-3 py-2.5 font-bold whitespace-nowrap">{fmtEgp(l.dealValue)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{fmtEgp(l.totalSoldValue)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{l.soldArea ? Math.round(l.soldArea).toLocaleString('en-US') : '—'}</td>
                <td className="px-3 py-2.5">
                  {isConfirmed(l)
                    ? <span className="px-2 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">Confirmed</span>
                    : <span className="px-2 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700">Pending AR</span>}
                  {isConfirmed(l) && <div className="text-[11px] text-brand-gray mt-0.5">{l.cashBy || '—'} · {l.cashDate || '—'}</div>}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  {canConfirm && (isConfirmed(l)
                    ? <button disabled={busy === l.id} onClick={() => { setReopening(l); setReason(''); }} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold hover:bg-gray-50"><RotateCcw size={13} /> Re-open</button>
                    : <button disabled={busy === l.id} onClick={() => call(l, { action: 'confirm' })} className="px-3 py-1.5 rounded-lg bg-brand-red text-white text-xs font-bold hover:opacity-90 disabled:opacity-50">{busy === l.id ? 'Saving…' : 'Confirm cash'}</button>)}
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={9} className="px-3 py-10 text-center text-brand-gray">{won.length ? 'No won deals match these filters.' : 'No won deals yet. When a deal is marked Won it appears here for cash confirmation.'}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-brand-gray">
        <div className="flex items-center gap-2">Rows
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="px-2 py-1 rounded-lg border border-gray-200">
            <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={0}>All</option>
          </select>
          <span>{rows.length.toLocaleString('en-US')} deal(s)</span>
        </div>
        {size !== 0 && (
          <div className="flex items-center gap-2">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40">Prev</button>
            <span>Page {page + 1} / {pageCount}</span>
            <button disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)} className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
      {!canConfirm && <p className="text-xs text-brand-gray">Read-only: cash is confirmed by the Accounts Receivable team.</p>}

      {reopening && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setReopening(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-black text-brand-dark">Re-open cash for {reopening.customerName || reopening.id}</h3>
            <p className="text-sm text-brand-gray">The deal goes back to Pending. Say why (it is kept in the audit trail).</p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} className="w-full border border-gray-200 rounded-xl p-2 text-sm" placeholder="Reason" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setReopening(null)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-bold">Cancel</button>
              <button disabled={!reason.trim() || busy === reopening.id} onClick={async () => { if (await call(reopening, { action: 'reopen', reason: reason.trim() })) setReopening(null); }} className="px-4 py-2 rounded-xl bg-brand-red text-white text-sm font-bold disabled:opacity-50">Re-open</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
