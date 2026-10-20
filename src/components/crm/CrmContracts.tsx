import React, { useEffect, useMemo, useState } from 'react';
import { MultiSelect } from '../ui/MultiSelect';
import { ContractRecord, ContractStep, Lead } from './types';
import { CONTRACT_STEPS } from './leadConfig';
import { crmService } from './crmService';
import { useAuth } from '../../services/AuthContext';
import { toast } from 'sonner';
import { Search, Download, X, Play, SkipForward, Pause, Ban, ShieldAlert, CheckCircle2, ChevronRight } from 'lucide-react';
import { downloadCsv, fmtEgp, todayIso } from './crmCsv';

export interface CrmContractsProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string;
  setActiveSubTab?: (tab: string) => void;
}

const DAY = 864e5;
const BLOCK_REASONS = ['Waiting for client', 'Missing documents', 'Payment / finance issue', 'Legal comment open', 'Plot / area issue', 'Approval pending', 'Other'];
const stepLabel = (k: string) => CONTRACT_STEPS.find((s) => s.key === k)?.label || k;
const slaOf = (k: string) => CONTRACT_STEPS.find((s) => s.key === k)?.slaDays ?? 2;

type View = {
  key: 'none' | 'progress' | 'hold' | 'signed' | 'cancelled';
  label: string;
  step?: ContractStep;
  blocked: boolean;
  overdueDays: number; // whole days past the SLA (0 = not overdue)
  ageDays: number;     // days at the current step
  due?: string;
};

function heldSince(c: ContractRecord): number | null {
  for (let i = c.history.length - 1; i >= 0; i--) {
    const t = c.history[i].text;
    if (t.startsWith('Put on hold')) return Date.parse(c.history[i].at);
    if (t.startsWith('Resumed')) return null;
  }
  return null;
}

function viewOf(l: Lead, now: number): View {
  const c = l.contract;
  if (!c) return { key: 'none', label: 'Not started', blocked: false, overdueDays: 0, ageDays: 0 };
  if (c.status === 'Signed') return { key: 'signed', label: 'Signed', blocked: false, overdueDays: 0, ageDays: 0 };
  if (c.status === 'Cancelled') return { key: 'cancelled', label: 'Cancelled', blocked: false, overdueDays: 0, ageDays: 0 };
  const step = c.steps.find((s) => s.status === 'In Progress' || s.status === 'Blocked');
  const blocked = !!c.blocker || step?.status === 'Blocked';
  const started = step?.startedAt ? Date.parse(step.startedAt) : NaN;
  const ageDays = isNaN(started) ? 0 : Math.max(0, (now - started) / DAY);
  const dueMs = step?.dueAt ? Date.parse(step.dueAt) : NaN;
  const held = c.status === 'On Hold';
  // blocked or on-hold contracts are never counted overdue: nobody can act on them
  const overdueDays = !blocked && !held && !isNaN(dueMs) && now > dueMs ? Math.max(1, Math.floor((now - dueMs) / DAY)) : 0;
  const due = !isNaN(dueMs) ? new Date(dueMs).toISOString().slice(0, 10) : undefined;
  if (held) return { key: 'hold', label: `On hold${step ? ' at ' + stepLabel(step.key) : ''}`, step, blocked, overdueDays: 0, ageDays, due };
  return { key: 'progress', label: step ? `In progress: ${stepLabel(step.key)}` : 'In progress', step, blocked, overdueDays, ageDays, due };
}

function newNumber(taken: Set<string>): string {
  const y = new Date().getFullYear();
  for (let i = 0; i < 200; i++) {
    const r = new Uint32Array(1); crypto.getRandomValues(r);
    const n = `CT-${y}-${String(r[0] % 10000).padStart(4, '0')}`;
    if (!taken.has(n)) return n;
  }
  const r = new Uint32Array(1); crypto.getRandomValues(r);
  return `CT-${y}-${String(r[0] % 1000000).padStart(6, '0')}`;
}

const pill = (v: View) => {
  const cls = v.key === 'signed' ? 'bg-emerald-50 text-emerald-700' : v.key === 'cancelled' ? 'bg-gray-100 text-gray-600'
    : v.key === 'hold' ? 'bg-sky-50 text-sky-700' : v.key === 'none' ? 'bg-gray-50 text-brand-gray'
    : v.blocked ? 'bg-red-50 text-red-700' : v.overdueDays ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700';
  return cls;
};

export const CrmContracts: React.FC<CrmContractsProps> = ({ leads, onLeadsUpdated, setActiveSubTab }) => {
  const { user, permissions } = useAuth();
  const canEdit = !!permissions?.canManageContracts;
  const who = user?.name || 'User';

  const [tab, setTab] = useState<'list' | 'control'>('list');
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fProject, setFProject] = useState<string[]>([]);
  const [fOwner, setFOwner] = useState<string[]>([]);
  const [size, setSize] = useState(50);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [over, setOver] = useState<Record<string, Lead>>({});
  const [note, setNote] = useState('');
  const [blockReason, setBlockReason] = useState(BLOCK_REASONS[0]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDq(q.trim().toLowerCase()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(0); }, [dq, fStatus, fProject, fOwner, size]);
  useEffect(() => { setOver({}); }, [leads]);

  const won = useMemo(() => leads.filter((l) => l.status === 'Won' && !l.mergedInto).map((l) => over[l.id] || l), [leads, over]);
  const now = Date.now();
  const items = useMemo(() => won.map((l) => ({ l, v: viewOf(l, Date.now()) })), [won]);
  const projects = useMemo(() => [...new Set(won.map((l) => l.project).filter(Boolean))].sort(), [won]);
  const owners = useMemo(() => [...new Set(won.map((l) => l.assignedSalespersonName || '').filter(Boolean))].sort(), [won]);

  const filtered = useMemo(() => items.filter(({ l, v }) => {
    if (fStatus.length && !fStatus.some((st) => v.key === st || (st === 'overdue' && v.overdueDays) || (st === 'blocked' && v.blocked))) return false;
    if (fProject.length && !fProject.includes(l.project as string)) return false;
    if (fOwner.length && !fOwner.includes(l.assignedSalespersonName || '')) return false;
    if (dq && !`${l.id} ${l.customerName} ${l.companyName || ''} ${l.project} ${l.plotNo || ''} ${l.contract?.number || ''}`.toLowerCase().includes(dq)) return false;
    return true;
  }).sort((a, b) => (b.v.overdueDays - a.v.overdueDays) || (Number(b.l.dealValue) || 0) - (Number(a.l.dealValue) || 0)), [items, fStatus, fProject, fOwner, dq]);

  const control = useMemo(() => {
    const perStep = CONTRACT_STEPS.map((s) => ({ ...s, active: 0, overdue: 0, blocked: 0, ageSum: 0 }));
    let none = 0, hold = 0, signed = 0, cancelled = 0, overdue = 0, blocked = 0;
    for (const { v } of items) {
      if (v.key === 'none') none++; else if (v.key === 'signed') signed++; else if (v.key === 'cancelled') cancelled++;
      else {
        if (v.key === 'hold') hold++;
        if (v.blocked) blocked++;
        if (v.overdueDays) overdue++;
        const p = perStep.find((s) => s.key === v.step?.key);
        if (p) { p.active++; p.ageSum += v.ageDays; if (v.overdueDays) p.overdue++; if (v.blocked) p.blocked++; }
      }
    }
    return { perStep, none, hold, signed, cancelled, overdue, blocked };
  }, [items]);

  const blockers = useMemo(() => items.filter(({ l, v }) => v.blocked && l.contract?.blocker), [items]);

  const pageCount = size === 0 ? 1 : Math.max(1, Math.ceil(filtered.length / size));
  const shown = size === 0 ? filtered : filtered.slice(page * size, page * size + size);
  const openLead = openId ? won.find((l) => l.id === openId) || null : null;

  // ---- saving: re-read the cache right before writing so nothing else is overwritten ----
  const mutate = async (id: string, fn: (c: ContractRecord | undefined, lead: Lead) => ContractRecord | string) => {
    if (!canEdit) { toast.error('You can view contracts but not change them.'); return false; }
    setBusy(true);
    try {
      const all = crmService.getLeads();
      const cur = all.find((x) => x.id === id);
      if (!cur) { toast.error('This deal was not found. Reload and try again.'); return false; }
      const res = fn(cur.contract, cur);
      if (typeof res === 'string') { toast.error(res); return false; }
      const next: Lead = { ...cur, contract: res, lastUpdated: new Date().toISOString() };
      crmService.saveLeads(all.map((x) => (x.id === id ? next : x)));
      setOver((o) => ({ ...o, [id]: next }));
      await crmService.whenSaved();
      onLeadsUpdated();
      return true;
    } finally { setBusy(false); }
  };

  const hist = (c: ContractRecord, text: string): ContractRecord['history'] => [...c.history, { at: new Date().toISOString(), by: who, text }];
  const withNote = (t: string) => (note.trim() ? `${t}. ${note.trim()}` : t);
  const done = (ok: boolean) => { if (ok) setNote(''); };

  const start = (l: Lead) => mutate(l.id, (c) => {
    if (c) return 'This deal already has a contract route.';
    const taken = new Set<string>();
    for (const x of crmService.getLeads()) if (x.contract?.number) taken.add(x.contract.number);
    for (const x of leads) if (x.contract?.number) taken.add(x.contract.number);
    const t = Date.now();
    const steps: ContractStep[] = CONTRACT_STEPS.map((s, i) => ({
      key: s.key, department: s.department, status: i === 0 ? 'In Progress' : 'Pending',
      ...(i === 0 ? { startedAt: new Date(t).toISOString(), dueAt: new Date(t + s.slaDays * DAY).toISOString(), by: who } : {}),
    }));
    return { number: newNumber(taken), status: 'In Progress', steps, blocker: null, history: [{ at: new Date(t).toISOString(), by: who, text: withNote('Contract route started') }] };
  }).then((ok) => { done(ok); if (ok) toast.success('Contract route started'); });

  // move past the current step (mode done | skip); last step done = signed
  const advance = (l: Lead, mode: 'done' | 'skip') => mutate(l.id, (c) => {
    if (!c || c.status !== 'In Progress') return 'The contract must be in progress (not on hold, signed or cancelled).';
    if (c.blocker) return 'Clear the blocker first.';
    const i = c.steps.findIndex((s) => s.status === 'In Progress');
    if (i < 0) return 'No active step.';
    const t = Date.now(); const iso = new Date(t).toISOString();
    const steps = c.steps.map((s) => ({ ...s }));
    steps[i] = { ...steps[i], status: mode === 'done' ? 'Done' : 'Skipped', doneAt: iso, by: who, ...(note.trim() ? { note: note.trim() } : {}) };
    const lbl = stepLabel(steps[i].key);
    const verb = mode === 'done' ? `${lbl} completed` : `${lbl} skipped`;
    const nx = steps.findIndex((s, j) => j > i && s.status === 'Pending');
    if (nx < 0) return { ...c, steps, status: 'Signed', signedAt: iso, blocker: null, history: hist(c, withNote(`${verb}. Contract signed`)) };
    steps[nx] = { ...steps[nx], status: 'In Progress', startedAt: iso, dueAt: new Date(t + slaOf(steps[nx].key) * DAY).toISOString() };
    return { ...c, steps, history: hist(c, withNote(`${verb}. Moved to ${stepLabel(steps[nx].key)}`)) };
  }).then(done);

  const block = (l: Lead) => mutate(l.id, (c) => {
    if (!c || c.status !== 'In Progress') return 'Only a contract in progress can be blocked.';
    if (c.blocker) return 'Already blocked.';
    const i = c.steps.findIndex((s) => s.status === 'In Progress');
    if (i < 0) return 'No active step.';
    const steps = c.steps.map((s, j) => (j === i ? { ...s, status: 'Blocked' as const } : s));
    return { ...c, steps, blocker: { reason: blockReason, department: steps[i].department, since: new Date().toISOString(), by: who }, history: hist(c, withNote(`Blocked at ${stepLabel(steps[i].key)}: ${blockReason}`)) };
  }).then(done);

  const unblock = (l: Lead) => mutate(l.id, (c) => {
    if (!c?.blocker) return 'Not blocked.';
    const t = Date.now(); const since = Date.parse(c.blocker.since);
    const steps = c.steps.map((s) => {
      if (s.status !== 'Blocked') return s;
      // the SLA clock did not run while blocked: push the due date by the blocked time
      const due = s.dueAt && !isNaN(since) ? new Date(Date.parse(s.dueAt) + (t - since)).toISOString() : s.dueAt;
      return { ...s, status: 'In Progress' as const, dueAt: due };
    });
    return { ...c, steps, blocker: null, history: hist(c, withNote(`Blocker cleared (${c.blocker.reason})`)) };
  }).then(done);

  const hold = (l: Lead) => mutate(l.id, (c) => {
    if (!c || c.status !== 'In Progress') return 'Only a contract in progress can be put on hold.';
    return { ...c, status: 'On Hold', history: hist(c, withNote('Put on hold')) };
  }).then(done);

  const resume = (l: Lead) => mutate(l.id, (c) => {
    if (!c || c.status !== 'On Hold') return 'The contract is not on hold.';
    const since = heldSince(c); const t = Date.now();
    const steps = c.steps.map((s) => (s.status === 'In Progress' && s.dueAt && since ? { ...s, dueAt: new Date(Date.parse(s.dueAt) + (t - since)).toISOString() } : s));
    return { ...c, steps, status: 'In Progress', history: hist(c, withNote('Resumed')) };
  }).then(done);

  const cancel = (l: Lead) => {
    if (!note.trim()) { toast.error('Write the reason for cancelling in the note box.'); return; }
    if (!window.confirm('Cancel this contract route? The contract number is kept.')) return;
    return mutate(l.id, (c) => {
      if (!c || c.status === 'Cancelled' || c.status === 'Signed') return 'This contract cannot be cancelled.';
      return { ...c, status: 'Cancelled', blocker: null, history: hist(c, withNote('Cancelled')) };
    }).then(done);
  };

  // the SAME contract number is kept on restart: it is never re-issued
  const restart = (l: Lead) => mutate(l.id, (c) => {
    if (!c || c.status !== 'Cancelled') return 'Only a cancelled contract can be restarted.';
    const t = Date.now();
    const steps: ContractStep[] = CONTRACT_STEPS.map((s, i) => ({
      key: s.key, department: s.department, status: i === 0 ? 'In Progress' : 'Pending',
      ...(i === 0 ? { startedAt: new Date(t).toISOString(), dueAt: new Date(t + s.slaDays * DAY).toISOString(), by: who } : {}),
    }));
    return { ...c, status: 'In Progress', steps, blocker: null, signedAt: undefined, history: hist(c, withNote('Restarted from the beginning')) };
  }).then(done);

  const addNote = (l: Lead) => {
    if (!note.trim()) return;
    return mutate(l.id, (c) => (c ? { ...c, history: hist(c, `Note: ${note.trim()}`) } : 'Start the route first.')).then(done);
  };

  const exportCsv = () => {
    const rows = items.filter(({ l }) => l.contract).map(({ l, v }) => {
      const c = l.contract!;
      const last = c.history[c.history.length - 1];
      return [c.number || '', l.id, l.companyName || l.customerName, l.customerName, l.project || '', l.plotNo || '', l.dealValue ?? '',
        v.step ? stepLabel(v.step.key) : '', last?.by || '', v.label, v.step?.startedAt?.slice(0, 10) || '', v.due || '',
        v.step ? v.ageDays.toFixed(1) : '', v.key === 'signed' ? 'Completed' : v.blocked ? 'Blocked' : v.overdueDays ? `Overdue ${v.overdueDays}d` : v.key === 'hold' ? 'On hold' : v.key === 'progress' ? 'On track' : '',
        v.blocked ? 'Blocked' : 'Clear', c.blocker?.reason || '', '', last ? `${last.at.slice(0, 10)} ${last.text}` : ''];
    });
    downloadCsv(`Contracts_${todayIso()}.csv`, ['Contract No.', 'Lead ID', 'Customer', 'Contact', 'Project', 'Plot', 'Contract Value', 'Department', 'Responsible', 'Status', 'Entered Department', 'Due Date', 'Days In Department', 'SLA State', 'Construction Status', 'Blocker Reason', 'Blocker Expected', 'Notes'], rows);
  };

  const goLead = (id: string) => { try { localStorage.setItem('selected_lead_id', id); } catch { /* ignore */ } setActiveSubTab?.('leads'); };

  const tile = (label: string, n: number, tone: string, onClick?: () => void) => (
    <button onClick={onClick} className="text-left bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-gray-300">
      <div className="text-xs font-bold text-brand-gray uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-black mt-1 ${tone}`}>{n.toLocaleString('en-US')}</div>
    </button>
  );

  const btn = 'inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50';
  const dv = openLead ? viewOf(openLead, now) : null;
  const dc = openLead?.contract;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-brand-dark">Contracts</h2>
          <p className="text-sm text-brand-gray">Every won deal, from revision to signature.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm font-bold">
            {(['list', 'control'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 ${tab === t ? 'bg-brand-red text-white' : 'bg-white text-brand-dark'}`}>{t === 'list' ? 'Contracts' : 'Control centre'}</button>)}
          </div>
          <button onClick={exportCsv} className={`${btn} border border-gray-200 bg-white`}><Download size={14} /> Export (Excel / CSV)</button>
        </div>
      </div>

      {tab === 'control' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {tile('Not started', control.none, 'text-brand-dark', () => { setFStatus(['none']); setTab('list'); })}
            {tile('Overdue vs SLA', control.overdue, control.overdue ? 'text-red-600' : 'text-brand-dark', () => { setFStatus(['overdue']); setTab('list'); })}
            {tile('Blocked', control.blocked, control.blocked ? 'text-red-600' : 'text-brand-dark', () => { setFStatus(['blocked']); setTab('list'); })}
            {tile('On hold', control.hold, 'text-sky-600', () => { setFStatus(['hold']); setTab('list'); })}
            {tile('Signed', control.signed, 'text-emerald-600', () => { setFStatus(['signed']); setTab('list'); })}
            {tile('Cancelled', control.cancelled, 'text-brand-gray', () => { setFStatus(['cancelled']); setTab('list'); })}
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-brand-gray border-b border-gray-100">
                {['Step', 'SLA (days)', 'Active', 'Overdue', 'Blocked', 'Average days here'].map((h) => <th key={h} className="px-3 py-3 font-bold">{h}</th>)}
              </tr></thead>
              <tbody>{control.perStep.map((s) => (
                <tr key={s.key} className="border-b border-gray-50">
                  <td className="px-3 py-2.5 font-bold">{s.label}</td><td className="px-3 py-2.5">{s.slaDays}</td>
                  <td className="px-3 py-2.5">{s.active}</td>
                  <td className={`px-3 py-2.5 ${s.overdue ? 'text-red-600 font-bold' : ''}`}>{s.overdue}</td>
                  <td className={`px-3 py-2.5 ${s.blocked ? 'text-red-600 font-bold' : ''}`}>{s.blocked}</td>
                  <td className={`px-3 py-2.5 ${s.active && s.ageSum / s.active > s.slaDays ? 'text-red-600 font-bold' : ''}`}>{s.active ? (s.ageSum / s.active).toFixed(1) : '—'}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
            <h3 className="font-black text-brand-dark mb-1 flex items-center gap-2"><ShieldAlert size={16} /> Blockers</h3>
            <p className="text-xs text-brand-gray mb-3">A blocked contract is waiting on something outside the department, so it is never counted as overdue.</p>
            {blockers.length === 0 ? <div className="text-sm text-brand-gray">No blocked contracts.</div> : (
              <div className="space-y-2">{blockers.map(({ l }) => (
                <button key={l.id} onClick={() => setOpenId(l.id)} className="w-full text-left flex items-center justify-between gap-3 border border-gray-100 rounded-xl px-3 py-2 hover:bg-gray-50">
                  <span><b>{l.contract?.number}</b> · {l.companyName || l.customerName} · {l.project || '—'}</span>
                  <span className="text-xs text-red-600">{l.contract?.blocker?.reason} · {l.contract?.blocker?.department} · since {l.contract?.blocker?.since.slice(0, 10)}</span>
                </button>))}</div>)}
          </div>
        </div>
      )}

      {tab === 'list' && (
        <>
          <div className="bg-white border border-gray-100 rounded-2xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-gray" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contract no., customer, plot…" className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm" />
            </div>
            <MultiSelect options={[{ value: 'none', label: 'Not started' }, { value: 'progress', label: 'In progress' }, { value: 'overdue', label: 'Overdue' }, { value: 'blocked', label: 'Blocked' }, { value: 'hold', label: 'On hold' }, { value: 'signed', label: 'Signed' }, { value: 'cancelled', label: 'Cancelled' }]} value={fStatus} onChange={setFStatus} allLabel="All statuses" name="statuses" className="min-w-[140px] max-w-[220px]" buttonClassName={`px-3 py-2 rounded-xl border text-sm bg-white flex items-center justify-between gap-2 text-left w-full ${fStatus.length ? 'border-brand-red/50 text-brand-red' : 'border-gray-200'}`} />
            <MultiSelect options={projects.map((x) => ({ value: x, label: x }))} value={fProject} onChange={setFProject} allLabel="All projects" name="projects" className="min-w-[140px] max-w-[220px]" buttonClassName={`px-3 py-2 rounded-xl border text-sm bg-white flex items-center justify-between gap-2 text-left w-full ${fProject.length ? 'border-brand-red/50 text-brand-red' : 'border-gray-200'}`} />
            <MultiSelect options={owners.map((x) => ({ value: x, label: x }))} value={fOwner} onChange={setFOwner} allLabel="All owners" name="owners" className="min-w-[140px] max-w-[220px]" buttonClassName={`px-3 py-2 rounded-xl border text-sm bg-white flex items-center justify-between gap-2 text-left w-full ${fOwner.length ? 'border-brand-red/50 text-brand-red' : 'border-gray-200'}`} />
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-brand-gray border-b border-gray-100">
                {['Contract', 'Lead', 'Project / plot', 'Value (EGP)', 'Status', 'Due', ''].map((h, i) => <th key={i} className="px-3 py-3 font-bold whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {shown.map(({ l, v }) => (
                  <tr key={l.id} onClick={() => { setOpenId(l.id); setNote(''); }} className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer">
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap">{l.contract?.number || '—'}</td>
                    <td className="px-3 py-2.5">{l.customerName || l.id}<div className="text-xs text-brand-gray">{l.companyName || '—'} · {l.assignedSalespersonName || '—'}</div></td>
                    <td className="px-3 py-2.5">{l.project || '—'}<div className="text-xs text-brand-gray">{l.plotNo || '—'}</div></td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{fmtEgp(l.dealValue)}</td>
                    <td className="px-3 py-2.5"><span className={`px-2 py-1 rounded-full text-xs font-bold ${pill(v)}`}>{v.blocked ? 'Blocked · ' : ''}{v.label}</span>{v.overdueDays > 0 && <div className="text-[11px] text-red-600 mt-0.5">{v.overdueDays} day(s) over SLA</div>}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{v.due || '—'}</td>
                    <td className="px-3 py-2.5 text-brand-gray"><ChevronRight size={16} /></td>
                  </tr>))}
                {!shown.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-brand-gray">{won.length ? 'No contracts match these filters.' : 'No won deals yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-brand-gray">
            <div className="flex items-center gap-2">Rows
              <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="px-2 py-1 rounded-lg border border-gray-200"><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={0}>All</option></select>
              <span>{filtered.length.toLocaleString('en-US')} deal(s)</span>
            </div>
            {size !== 0 && <div className="flex items-center gap-2">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40">Prev</button>
              <span>Page {page + 1} / {pageCount}</span>
              <button disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)} className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40">Next</button>
            </div>}
          </div>
        </>
      )}
      {!canEdit && <p className="text-xs text-brand-gray">Read-only: contracts are managed by Sales Operations.</p>}

      {openLead && dv && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={() => setOpenId(null)}>
          <div className="bg-white w-full max-w-xl h-full overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-brand-gray">{dc?.number || 'No contract number yet'}</div>
                <h3 className="text-lg font-black text-brand-dark">{openLead.companyName || openLead.customerName}</h3>
                <div className="text-sm text-brand-gray">{openLead.project || '—'} · {openLead.plotNo || '—'} · EGP {fmtEgp(openLead.dealValue)}</div>
                <button onClick={() => goLead(openLead.id)} className="text-xs font-bold text-brand-red mt-1">Open lead {openLead.id}</button>
              </div>
              <button onClick={() => setOpenId(null)} className="p-2 rounded-lg hover:bg-gray-100"><X size={18} /></button>
            </div>
            <span className={`inline-block px-2 py-1 rounded-full text-xs font-bold ${pill(dv)}`}>{dv.blocked ? 'Blocked · ' : ''}{dv.label}</span>
            {dv.key === 'progress' && dv.step && <div className="text-xs text-brand-gray">Here for {dv.ageDays.toFixed(1)} day(s). Due {dv.due || '—'}{dv.overdueDays ? ` (${dv.overdueDays} day(s) over)` : ''}.</div>}
            {dc?.blocker && <div className="text-sm bg-red-50 text-red-700 rounded-xl p-3">Blocked: {dc.blocker.reason} ({dc.blocker.department}) since {dc.blocker.since.slice(0, 10)} by {dc.blocker.by}</div>}

            {dc ? (
              <ol className="space-y-1.5">
                {dc.steps.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-2 border border-gray-100 rounded-xl px-3 py-2 text-sm">
                    <span className="font-bold">{stepLabel(s.key)}</span>
                    <span className="text-xs text-brand-gray">{s.status}{s.doneAt ? ` · ${s.doneAt.slice(0, 10)}` : s.dueAt && s.status !== 'Pending' ? ` · due ${s.dueAt.slice(0, 10)}` : ''}{s.by ? ` · ${s.by}` : ''}</span>
                  </li>))}
              </ol>
            ) : <div className="text-sm text-brand-gray">The contract route has not started. It runs {CONTRACT_STEPS.map((s) => s.label).join(' → ')}.</div>}

            {canEdit && (
              <div className="space-y-2">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Note (kept in the history)" className="w-full border border-gray-200 rounded-xl p-2 text-sm" />
                <div className="flex flex-wrap gap-2">
                  {!dc && <button disabled={busy} onClick={() => start(openLead)} className={`${btn} bg-brand-red text-white`}><Play size={14} /> Start contract route</button>}
                  {dc?.status === 'In Progress' && !dc.blocker && <>
                    <button disabled={busy} onClick={() => advance(openLead, 'done')} className={`${btn} bg-brand-red text-white`}><CheckCircle2 size={14} /> {dc.steps.filter((s) => s.status === 'Pending').length ? 'Complete step and move on' : 'Complete and sign'}</button>
                    <button disabled={busy} onClick={() => advance(openLead, 'skip')} className={`${btn} border border-gray-200`}><SkipForward size={14} /> Skip step</button>
                  </>}
                  {dc?.status === 'In Progress' && !dc.blocker && <>
                    <select value={blockReason} onChange={(e) => setBlockReason(e.target.value)} className="px-2 py-2 rounded-xl border border-gray-200 text-xs">{BLOCK_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                    <button disabled={busy} onClick={() => block(openLead)} className={`${btn} border border-red-200 text-red-700`}><ShieldAlert size={14} /> Block</button>
                  </>}
                  {dc?.blocker && <button disabled={busy} onClick={() => unblock(openLead)} className={`${btn} bg-brand-red text-white`}>Clear blocker</button>}
                  {dc?.status === 'In Progress' && <button disabled={busy} onClick={() => hold(openLead)} className={`${btn} border border-gray-200`}><Pause size={14} /> Hold</button>}
                  {dc?.status === 'On Hold' && <button disabled={busy} onClick={() => resume(openLead)} className={`${btn} bg-brand-red text-white`}><Play size={14} /> Resume</button>}
                  {dc && dc.status !== 'Cancelled' && dc.status !== 'Signed' && <button disabled={busy} onClick={() => cancel(openLead)} className={`${btn} border border-gray-200 text-brand-gray`}><Ban size={14} /> Cancel</button>}
                  {dc?.status === 'Cancelled' && <button disabled={busy} onClick={() => restart(openLead)} className={`${btn} bg-brand-red text-white`}>Restart (same number)</button>}
                  {dc && <button disabled={busy || !note.trim()} onClick={() => addNote(openLead)} className={`${btn} border border-gray-200`}>Add note only</button>}
                </div>
              </div>
            )}

            {dc && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-brand-gray mb-2">History</h4>
                <ul className="space-y-1.5">
                  {[...dc.history].reverse().map((h, i) => (
                    <li key={i} className="text-sm border-l-2 border-gray-200 pl-3">
                      <div>{h.text}</div><div className="text-[11px] text-brand-gray">{h.at.slice(0, 16).replace('T', ' ')} · {h.by}</div>
                    </li>))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
