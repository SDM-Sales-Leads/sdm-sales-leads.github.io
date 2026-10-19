import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle, XCircle, Plus, Download, RotateCcw, Trash2 } from 'lucide-react';
import { Lead } from './types';
import { useAuth } from '../../services/AuthContext';
import { adminService } from '../../services/adminService';
import { PROJECTS } from './leadConfig';
import { externalSalesService, ExternalSaleRow } from './externalSalesService';
import { cairoDateISO } from '../../lib/cairoTime';

export interface CrmExternalSalesProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string;
  setActiveSubTab?: (tab: string) => void;
}

const SALES_ROLES = ['Sales Team', 'Sales Rep', 'Sales Team Leader'];
const egp = (n: number) => `${Math.round(n).toLocaleString('en-US')} EGP`;
const todayISO = () => cairoDateISO(new Date());
const PAGES = [25, 50, 100, 0];
const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700', confirmed: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-700',
};

function downloadCsv(name: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const CrmExternalSales: React.FC<CrmExternalSalesProps> = () => {
  const { user, permissions } = useAuth();
  const [rows, setRows] = useState<ExternalSaleRow[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string; teamLeaderId?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusF, setStatusF] = useState('');
  const [personF, setPersonF] = useState('');
  const [yearF, setYearF] = useState(String(new Date().getFullYear()));
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ salespersonId: '', saleDate: todayISO(), amount: '', project: '', description: '' });

  const uid = String(user?.id ?? '');
  const isAll = user?.role === 'Admin' || user?.role === 'Sales Operation' || permissions?.canViewSalesRules === true;
  const isLeader = user?.role === 'Sales Team Leader';
  const canDecide = isAll || isLeader;
  const finOnly = !canDecide && permissions?.canConfirmCash === true && !SALES_ROLES.includes(user?.role || '');

  const load = useCallback(async () => {
    try { setRows(await externalSalesService.list()); }
    catch (e: any) { toast.error(e.message || 'Could not load external sales'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    adminService.getUsers().then((all: any[]) => {
      setPeople(all.filter((u) => SALES_ROLES.includes(u.role) && u.active !== false)
        .map((u) => ({ id: String(u.id), name: u.name, teamLeaderId: u.teamLeaderId ? String(u.teamLeaderId) : undefined })));
    }).catch(() => { /* names fall back to the saved ones */ });
  }, [load]);

  // who this user may record a sale for
  const choosable = useMemo(() => {
    if (isAll) return people;
    if (isLeader) return people.filter((p) => p.id === uid || p.teamLeaderId === uid);
    return [];
  }, [people, isAll, isLeader, uid]);

  const years = useMemo(() => {
    const s = new Set<string>([String(new Date().getFullYear())]);
    rows.forEach((r) => r.saleDate && s.add(r.saleDate.slice(0, 4)));
    return [...s].sort().reverse();
  }, [rows]);
  const sellers = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => m.set(r.salespersonId, r.salespersonName));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => rows
    .filter((r) => (!statusF || r.status === statusF) && (!personF || r.salespersonId === personF) && (!yearF || (r.saleDate || '').startsWith(yearF)))
    .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')), [rows, statusF, personF, yearF]);

  const totals = useMemo(() => {
    const t = { confirmed: 0, pending: 0, rejected: 0, nC: 0, nP: 0 };
    filtered.forEach((r) => {
      const a = Number(r.amount) || 0;
      if (r.status === 'confirmed') { t.confirmed += a; t.nC++; } else if (r.status === 'pending') { t.pending += a; t.nP++; } else t.rejected += a;
    });
    return t;
  }, [filtered]);

  const pages = size ? Math.max(1, Math.ceil(filtered.length / size)) : 1;
  const cur = Math.min(page, pages - 1);
  const visible = size ? filtered.slice(cur * size, cur * size + size) : filtered;

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); }
    catch (e: any) { toast.error(e.message || 'Not saved'); }
    finally { await load(); setBusy(false); }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!(amount > 0)) return toast.error('Enter the sale amount in EGP');
    if (!form.saleDate) return toast.error('Enter the sale date');
    if (!form.project.trim()) return toast.error('Choose or type the project');
    const sid = choosable.length ? (form.salespersonId || uid) : uid;
    const who = people.find((p) => p.id === sid)?.name || user?.name || '';
    const row: ExternalSaleRow = {
      id: externalSalesService.newId(), salespersonId: sid, salespersonName: who, saleDate: form.saleDate, amount,
      project: form.project.trim(), description: form.description.trim(), status: 'pending', createdAt: new Date().toISOString(),
    };
    run(async () => {
      await externalSalesService.save([row]);
      setShowForm(false); setForm({ salespersonId: '', saleDate: todayISO(), amount: '', project: '', description: '' });
    }, 'Sale recorded. It waits for confirmation.');
  };

  const decide = (r: ExternalSaleRow, status: 'confirmed' | 'rejected' | 'pending') => {
    if (status !== 'pending' && !window.confirm(`${status === 'confirmed' ? 'Confirm' : 'Reject'} ${egp(r.amount)} for ${r.salespersonName}?`)) return;
    const next: ExternalSaleRow = status === 'pending'
      ? { ...r, status, confirmedBy: undefined, confirmedDate: undefined }
      : { ...r, status, confirmedBy: user?.name || '', confirmedDate: new Date().toISOString() };
    run(() => externalSalesService.save([next]), status === 'confirmed' ? 'Confirmed' : status === 'rejected' ? 'Rejected' : 'Reopened');
  };

  const remove = (r: ExternalSaleRow) => {
    if (!window.confirm('Delete this entry?')) return;
    run(() => externalSalesService.save([], [r.id]), 'Deleted');
  };

  const exportCsv = () => downloadCsv(`external-sales-${yearF || 'all'}.csv`, [
    ['ID', 'Salesperson', 'Sale date', 'Amount (EGP)', 'Project', 'Description', 'Status', 'Decided by', 'Decided on', 'Recorded'],
    ...filtered.map((r) => [r.id, r.salespersonName, r.saleDate, r.amount, r.project, r.description, r.status, r.confirmedBy || '', (r.confirmedDate || '').slice(0, 10), (r.createdAt || '').slice(0, 10)]),
  ]);

  if (loading) return <div className="p-6 text-sm text-brand-gray">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">External Sales</h2>
          <p className="text-sm text-brand-gray">Deals closed outside the system. Confirmed amounts count toward the salesperson's annual target. {canDecide ? 'You cannot confirm your own entries.' : 'A team leader or Sales Operation confirms each entry.'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="px-3 py-2 rounded-xl border border-black/10 text-sm font-semibold flex items-center gap-2"><Download size={14} /> Export</button>
          {!finOnly && <button onClick={() => setShowForm((v) => !v)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={14} /> Add external sale</button>}
        </div>
      </div>

      {showForm && (
        <form onSubmit={submit} className="bento-card grid grid-cols-1 md:grid-cols-3 gap-3">
          {choosable.length > 0 && (
            <select className="input-field" value={form.salespersonId || uid} onChange={(e) => setForm({ ...form, salespersonId: e.target.value })}>
              {choosable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <input type="date" className="input-field" max={todayISO()} value={form.saleDate} onChange={(e) => setForm({ ...form, saleDate: e.target.value })} />
          <input type="number" min={1} className="input-field" placeholder="Amount (EGP)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <input list="ext-projects" className="input-field" placeholder="Project" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} />
          <datalist id="ext-projects">{PROJECTS.map((p) => <option key={p} value={p} />)}</datalist>
          <input className="input-field md:col-span-2" placeholder="Client / description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="md:col-span-3 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-brand-gray">Cancel</button>
            <button disabled={busy} className="btn-primary text-sm">Save</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bento-card !p-4"><p className="text-xs text-brand-gray">Confirmed</p><p className="text-xl font-bold text-emerald-600">{egp(totals.confirmed)}</p><p className="text-xs text-brand-gray">{totals.nC} entries</p></div>
        <div className="bento-card !p-4"><p className="text-xs text-brand-gray">Waiting for confirmation</p><p className="text-xl font-bold text-amber-600">{egp(totals.pending)}</p><p className="text-xs text-brand-gray">{totals.nP} entries</p></div>
        <div className="bento-card !p-4"><p className="text-xs text-brand-gray">Rejected</p><p className="text-xl font-bold text-brand-red">{egp(totals.rejected)}</p></div>
        <div className="bento-card !p-4"><p className="text-xs text-brand-gray">Entries shown</p><p className="text-xl font-bold">{filtered.length}</p></div>
      </div>

      <div className="flex flex-wrap gap-2">
        <select className="input-field !w-auto" value={yearF} onChange={(e) => { setYearF(e.target.value); setPage(0); }}>
          <option value="">All years</option>{years.map((y) => <option key={y}>{y}</option>)}
        </select>
        <select className="input-field !w-auto" value={statusF} onChange={(e) => { setStatusF(e.target.value); setPage(0); }}>
          <option value="">All statuses</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="rejected">Rejected</option>
        </select>
        {(canDecide || sellers.length > 1) && (
          <select className="input-field !w-auto" value={personF} onChange={(e) => { setPersonF(e.target.value); setPage(0); }}>
            <option value="">All salespeople</option>{sellers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        )}
      </div>

      <div className="bento-card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b border-black/5 text-xs uppercase text-brand-gray">
            <th className="p-3">Date</th><th className="p-3">Salesperson</th><th className="p-3">Project</th><th className="p-3">Description</th>
            <th className="p-3 text-right">Amount</th><th className="p-3">Status</th><th className="p-3">Decided</th><th className="p-3 text-right">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-black/5">
            {visible.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-brand-gray">No external sales for these filters.</td></tr>}
            {visible.map((r) => {
              const own = r.salespersonId === uid;
              return (
                <tr key={r.id}>
                  <td className="p-3 whitespace-nowrap">{r.saleDate || '—'}</td>
                  <td className="p-3">{r.salespersonName || '—'}</td>
                  <td className="p-3">{r.project || '—'}</td>
                  <td className="p-3 max-w-[260px] truncate" title={r.description}>{r.description || '—'}</td>
                  <td className="p-3 text-right font-semibold whitespace-nowrap">{egp(Number(r.amount) || 0)}</td>
                  <td className="p-3"><span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase ${STATUS_STYLE[r.status] || ''}`}>{r.status}</span></td>
                  <td className="p-3 text-xs text-brand-gray">{r.confirmedBy ? <>{r.confirmedBy}<br />{(r.confirmedDate || '').slice(0, 10)}</> : '—'}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {canDecide && !own && r.status === 'pending' && (<>
                      <button disabled={busy} onClick={() => decide(r, 'confirmed')} title="Confirm" className="text-emerald-600 mr-2"><CheckCircle size={18} /></button>
                      <button disabled={busy} onClick={() => decide(r, 'rejected')} title="Reject" className="text-brand-red"><XCircle size={18} /></button>
                    </>)}
                    {canDecide && !own && r.status !== 'pending' && (
                      <button disabled={busy} onClick={() => decide(r, 'pending')} title="Reopen" className="text-brand-gray"><RotateCcw size={16} /></button>
                    )}
                    {own && r.status === 'pending' && canDecide && <span className="text-xs text-brand-gray">Needs someone else</span>}
                    {isAll && <button disabled={busy} onClick={() => remove(r)} title="Delete" className="text-brand-gray hover:text-brand-red ml-2"><Trash2 size={15} /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-brand-gray">
        <div className="flex items-center gap-2">Rows
          <select className="input-field !w-auto !py-1" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
            {PAGES.map((p) => <option key={p} value={p}>{p || 'All'}</option>)}
          </select>
        </div>
        {size > 0 && pages > 1 && (
          <div className="flex items-center gap-2">
            <button disabled={cur === 0} onClick={() => setPage(cur - 1)} className="px-3 py-1 rounded-lg border border-black/10 disabled:opacity-40">Prev</button>
            <span>{cur + 1} / {pages}</span>
            <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="px-3 py-1 rounded-lg border border-black/10 disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
    </div>
  );
};
