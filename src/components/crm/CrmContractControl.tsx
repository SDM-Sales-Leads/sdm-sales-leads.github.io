import React, { useMemo, useRef, useState } from 'react';
import { MultiSelect } from '../ui/MultiSelect';
import { toast } from 'sonner';
import { AlertTriangle, Download, FileSpreadsheet, ShieldAlert, Upload } from 'lucide-react';
import { ContractRecord, Lead } from './types';
import { CONTRACT_STEPS } from './leadConfig';
import { crmService } from './crmService';
import { useAuth } from '../../services/AuthContext';
import { buildXlsx, readXlsx } from './xlsxLite';
import { cleanCell, normDate, parseNum } from './importEngine';
import { fmtEgp, todayIso } from './crmCsv';
import { PagerBar } from './LeadListParts';
import { usePagedList } from './usePagedList';

export interface CrmContractControlProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string;
  setActiveSubTab?: (tab: string) => void;
  /** control = Control Centre, blockers = Construction blockers, import = Contract Excel, reports = Contract Reports */
  view: 'control' | 'blockers' | 'import' | 'reports';
}

// Old "Contract Control" group (spec_C 1.7, 2.3-2.6). Works on lead.contract only (same record and saving path as CrmContracts).
// Not in the new contract record, so shown as "n/a" / left out: priority, handler, blocker severity, blocker expected date.
const DAY = 864e5;
const STALE_DAYS = 10; // spec_C 1.8: no movement for 10 days at the same step
const stepLabel = (k: string) => CONTRACT_STEPS.find((s) => s.key === k)?.label || k;
const d10 = (v?: string) => (v ? String(v).slice(0, 10) : '');

interface Item {
  l: Lead; c?: ContractRecord;
  state: 'none' | 'progress' | 'hold' | 'signed' | 'cancelled';
  stepKey?: string; blocked: boolean; overdueDays: number; ageDays: number; dueMs: number; dueSoon: boolean; dueToday: boolean;
  blockedDays: number; issues: string[];
}

function itemOf(l: Lead, now: number, todayStr: string): Item {
  const c = l.contract;
  const base = { l, c, blocked: false, overdueDays: 0, ageDays: 0, dueMs: NaN, dueSoon: false, dueToday: false, blockedDays: 0, issues: [] as string[] };
  if (!c) return { ...base, state: 'none' };
  if (c.status === 'Signed') return { ...base, state: 'signed' };
  if (c.status === 'Cancelled') return { ...base, state: 'cancelled' };
  const step = c.steps.find((s) => s.status === 'In Progress' || s.status === 'Blocked');
  const blocked = !!c.blocker || step?.status === 'Blocked';
  const started = step?.startedAt ? Date.parse(step.startedAt) : NaN;
  const ageDays = isNaN(started) ? 0 : Math.max(0, (now - started) / DAY);
  const dueMs = step?.dueAt ? Date.parse(step.dueAt) : NaN;
  const held = c.status === 'On Hold';
  const live = !blocked && !held;
  const overdueDays = live && !isNaN(dueMs) && now > dueMs ? Math.max(1, Math.floor((now - dueMs) / DAY)) : 0;
  const dueDay = isNaN(dueMs) ? '' : new Date(dueMs).toISOString().slice(0, 10);
  const dueToday = live && dueDay === todayStr;
  const dueSoon = live && !overdueDays && !isNaN(dueMs) && dueMs - now <= 3 * DAY;
  const since = c.blocker ? Date.parse(c.blocker.since) : NaN;
  const blockedDays = c.blocker && !isNaN(since) ? Math.max(0, Math.floor((now - since) / DAY)) : 0;
  const issues: string[] = [];
  if (!c.number) issues.push('No contract number');
  if (!l.project) issues.push('No project');
  if (!l.plotNo) issues.push('No plot');
  if (!(Number(l.dealValue) > 0)) issues.push('No contract value');
  if (!l.assignedSalespersonName) issues.push('Nobody responsible');
  if (live && ageDays >= STALE_DAYS) issues.push(`No movement for ${Math.floor(ageDays)} days`);
  return { ...base, state: held ? 'hold' : 'progress', stepKey: step?.key, blocked, overdueDays, ageDays, dueMs, dueSoon, dueToday, blockedDays, issues };
}

const cardCls = 'bg-white border border-gray-100 rounded-2xl shadow-sm';
const th = 'px-3 py-3 font-bold whitespace-nowrap';
const num = (n: number) => n.toLocaleString('en-US');
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f1 = (n: number | null) => (n === null ? '—' : n.toFixed(1));
const stateLabel = (i: Item) => i.state === 'none' ? 'Not started' : i.state === 'signed' ? 'Signed' : i.state === 'cancelled' ? 'Cancelled'
  : i.blocked ? 'Blocked' : i.state === 'hold' ? 'On hold' : i.overdueDays ? `Overdue ${i.overdueDays}d` : i.dueToday ? 'Due today' : i.dueSoon ? 'Due soon' : 'On track';
const stateCls = (i: Item) => i.blocked || i.overdueDays ? 'text-red-600 font-bold' : i.state === 'signed' ? 'text-emerald-600' : i.state === 'hold' ? 'text-sky-600' : i.dueToday || i.dueSoon ? 'text-amber-600' : 'text-brand-gray';

const Tile = ({ label, n, sub, tone, onClick, active }: { label: string; n: number | string; sub?: string; tone?: string; onClick?: () => void; active?: boolean }) => (
  <button onClick={onClick} disabled={!onClick} className={`text-left ${cardCls} p-4 ${active ? 'ring-2 ring-brand-red' : ''} ${onClick ? 'hover:border-gray-300' : ''}`}>
    <div className="text-xs font-bold text-brand-gray uppercase tracking-wide">{label}</div>
    <div className={`text-2xl font-black mt-1 ${tone || 'text-brand-dark'}`}>{typeof n === 'number' ? num(n) : n}</div>
    {sub && <div className="text-[11px] text-brand-gray mt-0.5">{sub}</div>}
  </button>
);

const Bars = ({ rows }: { rows: [string, number][] }) => {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return <div className="space-y-1.5">{rows.length === 0 ? <div className="text-sm text-brand-gray">—</div> : rows.map(([k, v]) => (
    <div key={k} className="flex items-center gap-2 text-sm"><span className="w-44 truncate text-brand-dark" title={k}>{k}</span>
      <div className="flex-1 h-2.5 rounded-full bg-black/5 overflow-hidden"><div className="h-full bg-brand-red rounded-full" style={{ width: `${(v / max) * 100}%` }} /></div><b className="w-10 text-right">{num(v)}</b></div>))}</div>;
};

export const CrmContractControl: React.FC<CrmContractControlProps> = ({ leads, onLeadsUpdated, setActiveSubTab, view }) => {
  const { user, permissions } = useAuth();
  const canEdit = !!permissions?.canManageContracts;
  const who = user?.name || 'User';
  const [filter, setFilter] = useState<'all' | 'overdue' | 'today' | 'soon' | 'blocked' | 'update' | 'signed'>('all');
  const [fProject, setFProject] = useState<string[]>([]);
  const [fOwner, setFOwner] = useState<string[]>([]);

  const todayStr = todayIso();
  const items = useMemo(() => {
    const now = Date.now();
    return leads.filter((l) => l.status === 'Won' && !l.mergedInto).map((l) => itemOf(l, now, todayStr));
  }, [leads, todayStr]);
  const withContract = useMemo(() => items.filter((i) => i.c), [items]);
  const projects = useMemo(() => [...new Set(items.map((i) => i.l.project).filter(Boolean))].sort(), [items]);
  const owners = useMemo(() => [...new Set(items.map((i) => i.l.assignedSalespersonName || '').filter(Boolean))].sort(), [items]);
  const scoped = useMemo(() => items.filter((i) => (!fProject.length || fProject.includes(i.l.project as string)) && (!fOwner.length || fOwner.includes(i.l.assignedSalespersonName || ''))), [items, fProject, fOwner]);

  const goLead = (id: string) => { try { localStorage.setItem('selected_lead_id', id); localStorage.setItem('crm_selected_lead_id_from_notification', id); } catch { /* ignore */ } setActiveSubTab?.('leads'); };
  const activeOnes = (a: Item[]) => a.filter((i) => i.state === 'progress' || i.state === 'hold');

  const filterBar = (
    <div className={`${cardCls} p-3 flex flex-wrap gap-2`}>
      <MultiSelect options={projects.map((x) => ({ value: x, label: x }))} value={fProject} onChange={setFProject} allLabel="All projects" name="projects" className="min-w-[140px] max-w-[220px]" buttonClassName={`px-3 py-2 rounded-xl border text-sm bg-white flex items-center justify-between gap-2 text-left w-full ${fProject.length ? 'border-brand-red/50 text-brand-red' : 'border-gray-200'}`} />
      <MultiSelect options={owners.map((x) => ({ value: x, label: x }))} value={fOwner} onChange={setFOwner} allLabel="All salespeople" name="salespeople" className="min-w-[140px] max-w-[220px]" buttonClassName={`px-3 py-2 rounded-xl border text-sm bg-white flex items-center justify-between gap-2 text-left w-full ${fOwner.length ? 'border-brand-red/50 text-brand-red' : 'border-gray-200'}`} />
    </div>
  );

  const header = (title: string, sub: string, extra?: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-black text-brand-dark">{title}</h2><p className="text-sm text-brand-gray">{sub}</p></div>
      <div className="flex gap-2">{extra}</div>
    </div>
  );

  // ============================== CONTROL CENTRE ==============================
  const control = useMemo(() => {
    const act = activeOnes(scoped);
    const perStep = CONTRACT_STEPS.map((s) => ({ ...s, active: 0, soon: 0, overdue: 0, blocked: 0, ages: [] as number[] }));
    for (const i of act) {
      const p = perStep.find((s) => s.key === i.stepKey);
      if (!p) continue;
      p.active++; p.ages.push(i.ageDays); if (i.overdueDays) p.overdue++; if (i.dueSoon || i.dueToday) p.soon++; if (i.blocked) p.blocked++;
    }
    const cnt = { active: act.length, soon: act.filter((i) => i.dueSoon).length, today: act.filter((i) => i.dueToday).length, overdue: act.filter((i) => i.overdueDays).length,
      update: act.filter((i) => i.issues.length).length, blocked: act.filter((i) => i.blocked).length, signed: scoped.filter((i) => i.state === 'signed').length };
    const val = (a: Item[]) => a.reduce((s, i) => s + (Number(i.l.dealValue) || 0), 0);
    return { act, perStep, cnt, val };
  }, [scoped]);

  const listRows = useMemo(() => {
    const pick = (i: Item) => filter === 'all' ? (i.state === 'progress' || i.state === 'hold') : filter === 'overdue' ? !!i.overdueDays : filter === 'today' ? i.dueToday : filter === 'soon' ? i.dueSoon
      : filter === 'blocked' ? i.blocked && (i.state === 'progress' || i.state === 'hold') : filter === 'update' ? (i.state === 'progress' || i.state === 'hold') && i.issues.length > 0 : i.state === 'signed';
    return scoped.filter(pick).sort((a, b) => (b.overdueDays - a.overdueDays) || (Number(b.l.dealValue) || 0) - (Number(a.l.dealValue) || 0));
  }, [scoped, filter]);
  const paged = usePagedList(listRows, 'crm.ctcontrol.page', filter + fProject.join() + fOwner.join());

  // ============================== BLOCKERS ==============================
  const blockers = useMemo(() => scoped.filter((i) => i.c?.blocker && (i.state === 'progress' || i.state === 'hold')).sort((a, b) => b.blockedDays - a.blockedDays), [scoped]);
  const blockedPaged = usePagedList(blockers, 'crm.ctblockers.page', fProject.join() + fOwner.join());

  // ============================== REPORTS ==============================
  const reports = useMemo(() => {
    const signedDurations: number[] = [];
    const perStep = CONTRACT_STEPS.map((s) => ({ ...s, done: 0, totalDays: 0, here: 0, longest: 0 }));
    const buckets = [0, 0, 0, 0, 0];
    for (const i of scoped) {
      const c = i.c; if (!c) continue;
      for (const s of c.steps) {
        const p = perStep.find((x) => x.key === s.key);
        if (p && s.status === 'Done' && s.startedAt && s.doneAt) { const d = (Date.parse(s.doneAt) - Date.parse(s.startedAt)) / DAY; if (d >= 0) { p.done++; p.totalDays += d; } }
      }
      if (i.state === 'signed' && c.signedAt) {
        const t0 = c.steps.map((s) => Date.parse(s.startedAt || '')).filter((x) => !isNaN(x)).sort((a, b) => a - b)[0];
        if (t0 !== undefined) { const d = (Date.parse(c.signedAt) - t0) / DAY; if (d >= 0) signedDurations.push(d); }
      }
      if (i.state === 'progress' || i.state === 'hold') {
        const p = perStep.find((x) => x.key === i.stepKey);
        if (p) { p.here++; p.longest = Math.max(p.longest, i.ageDays); }
        const a = i.ageDays; buckets[a <= 3 ? 0 : a <= 7 ? 1 : a <= 14 ? 2 : a <= 30 ? 3 : 4]++;
      }
    }
    const slowest = perStep.filter((p) => p.done).sort((a, b) => b.totalDays / b.done - a.totalDays / a.done)[0];
    return {
      total: scoped.length, none: scoped.filter((i) => i.state === 'none').length, progress: scoped.filter((i) => i.state === 'progress').length, hold: scoped.filter((i) => i.state === 'hold').length,
      signed: scoped.filter((i) => i.state === 'signed').length, cancelled: scoped.filter((i) => i.state === 'cancelled').length,
      overdue: scoped.filter((i) => i.overdueDays).length, blocked: scoped.filter((i) => i.blocked && (i.state === 'progress' || i.state === 'hold')).length,
      avgDuration: avg(signedDurations), perStep, buckets, slowest,
    };
  }, [scoped]);

  // ============================== EXCEL: export ==============================
  const HEADERS = ['Contract No.', 'Lead ID', 'Customer', 'Contact', 'Project', 'Plot', 'Contract Value', 'Department', 'Responsible', 'Status', 'Entered Department', 'Due Date', 'Days In Department', 'SLA State', 'Construction Status', 'Blocker Reason', 'Notes'];
  const save = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const doExport = () => {
    const rows = withContract.map((i) => {
      const c = i.c!, l = i.l;
      const lastNote = [...c.history].reverse().find((h) => h.text.startsWith('Note: '));
      const step = c.steps.find((s) => s.status === 'In Progress' || s.status === 'Blocked');
      return [c.number || '', l.id, l.companyName || l.customerName, l.customerName, l.project || '', l.plotNo || '', Number(l.dealValue) || '', i.stepKey ? stepLabel(i.stepKey) : '',
        l.assignedSalespersonName || '', c.status, d10(step?.startedAt), isNaN(i.dueMs) ? '' : new Date(i.dueMs).toISOString().slice(0, 10), i.stepKey ? Number(i.ageDays.toFixed(1)) : '',
        stateLabel(i), i.blocked ? 'Blocked' : 'Clear', c.blocker?.reason || '', lastNote ? lastNote.text.slice(6) : ''];
    });
    save(buildXlsx([{ name: 'Contracts', rows: [HEADERS, ...rows], widths: HEADERS.map((h) => (h.length > 14 ? 22 : 15)) }]), `Contracts_${todayStr}.xlsx`);
  };

  // ============================== EXCEL: import (preview, then apply) ==============================
  interface Change { field: string; from: string; to: string }
  interface PlanRow { row: number; no: string; id: string; result: 'update' | 'same' | 'dup' | 'nomatch'; changes: Change[]; notes: string[] }
  const [plan, setPlan] = useState<{ file: string; rows: PlanRow[]; apply: Map<string, Change[]> } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => {
    if (!/\.xlsx$/i.test(file.name)) return toast.error('Choose an .xlsx file (an old .xls file: open it in Excel and save as .xlsx).');
    if (file.size > 15 * 1024 * 1024) return toast.error('File is too large (max 15 MB).');
    setBusy(true);
    try {
      const sh = await readXlsx(await file.arrayBuffer(), 'Contracts');
      if (sh.rows.length < 2) throw new Error('The file has no data rows below the header row.');
      if (sh.rows.length > 20001) throw new Error('Too many rows (max 20,000).');
      const hdr = sh.rows[0].map((h) => cleanCell(h).toLowerCase());
      const col = (n: string) => hdr.indexOf(n.toLowerCase());
      const ix = { no: col('Contract No.'), id: col('Lead ID'), project: col('Project'), plot: col('Plot'), value: col('Contract Value'), due: col('Due Date'), notes: col('Notes'), block: col('Blocker Reason'), cust: col('Customer') };
      if (ix.no < 0 && ix.id < 0 && (ix.project < 0 || ix.plot < 0)) throw new Error('The file needs a "Contract No." or "Lead ID" column.');
      const cell = (r: string[], k: number) => (k >= 0 ? cleanCell(r[k]) : '');
      const byNo = new Map<string, Item>(), byId = new Map<string, Item>(), byPlot = new Map<string, Item>();
      for (const i of withContract) {
        if (i.c?.number) byNo.set(i.c.number.toLowerCase(), i); byId.set(i.l.id.toLowerCase(), i);
        if (i.l.project && i.l.plotNo) byPlot.set(`${i.l.project}|${i.l.plotNo}`.toLowerCase(), i);
      }
      const seen = new Set<string>(); const rows: PlanRow[] = []; const apply = new Map<string, Change[]>();
      sh.rows.slice(1).forEach((r, n) => {
        const no = cell(r, ix.no), id = cell(r, ix.id), project = cell(r, ix.project), plot = cell(r, ix.plot);
        if (!no && !id && !cell(r, ix.cust)) return; // blank row
        const it = (no && byNo.get(no.toLowerCase())) || (id && byId.get(id.toLowerCase())) || (project && plot && byPlot.get(`${project}|${plot}`.toLowerCase())) || undefined;
        const key = (no || id || cell(r, ix.cust)).toLowerCase();
        const pr: PlanRow = { row: n + 2, no, id, result: 'nomatch', changes: [], notes: [] };
        if (seen.has(key)) { pr.result = 'dup'; rows.push(pr); return; }
        seen.add(key);
        if (!it) { rows.push(pr); return; }
        const c = it.c!, l = it.l, ch: Change[] = [];
        pr.no = c.number || no; pr.id = l.id;
        // empty cells never clear anything
        if (project && project !== (l.project || '')) ch.push({ field: 'Project', from: l.project || '—', to: project });
        if (plot && plot !== (l.plotNo || '')) ch.push({ field: 'Plot', from: l.plotNo || '—', to: plot });
        const vRaw = cell(r, ix.value);
        if (vRaw) { const v = parseNum(vRaw); if (!(v > 0)) pr.notes.push(`Contract Value "${vRaw}" ignored`); else if (v !== (Number(l.dealValue) || 0)) ch.push({ field: 'Contract Value', from: fmtEgp(Number(l.dealValue)), to: fmtEgp(v) }); }
        const dRaw = cell(r, ix.due);
        if (dRaw) {
          const dd = normDate(dRaw);
          if (!dd) pr.notes.push(`Due Date "${dRaw}" ignored`);
          else if (!i2active(c)) pr.notes.push('Due Date ignored (no active step)');
          else if (dd !== d10(i2active(c)!.dueAt)) ch.push({ field: 'Due Date', from: d10(i2active(c)!.dueAt) || '—', to: dd });
        }
        const bRaw = cell(r, ix.block);
        if (bRaw && !c.blocker) { if (c.status === 'In Progress' && i2active(c)) ch.push({ field: 'Blocker Reason', from: 'Clear', to: bRaw.slice(0, 200) }); else pr.notes.push('Blocker ignored (contract is not in progress)'); }
        const nRaw = cell(r, ix.notes);
        if (nRaw && !c.history.some((h) => h.text === `Note: ${nRaw}`)) ch.push({ field: 'Note', from: '—', to: nRaw.slice(0, 500) });
        pr.result = ch.length ? 'update' : 'same'; pr.changes = ch;
        if (ch.length) apply.set(l.id, ch);
        rows.push(pr);
      });
      setPlan({ file: file.name, rows, apply });
    } catch (e: any) { toast.error(e?.message || 'The file could not be read.'); setPlan(null); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  function i2active(c: ContractRecord) { return c.steps.find((s) => s.status === 'In Progress' || s.status === 'Blocked'); }

  const applyPlan = async () => {
    if (!plan || !plan.apply.size) return;
    if (!canEdit) return toast.error('You can view contracts but not change them.');
    setBusy(true);
    try {
      // re-read right before writing so nothing edited meanwhile is overwritten
      const nowIso = new Date().toISOString();
      const all = crmService.getLeads(); let n = 0;
      const next = all.map((x) => {
        const chs = plan.apply.get(x.id); if (!chs || !x.contract) return x;
        const c = x.contract; let lead: Lead = { ...x }; let con: ContractRecord = { ...c, history: [...c.history] };
        for (const ch of chs) {
          const log = `${ch.field}: ${ch.from} → ${ch.to} (Excel import)`;
          if (ch.field === 'Project') lead.project = ch.to;
          else if (ch.field === 'Plot') lead.plotNo = ch.to;
          else if (ch.field === 'Contract Value') lead.dealValue = parseNum(ch.to);
          else if (ch.field === 'Due Date') con.steps = con.steps.map((s) => (s === i2active(c) || (s.key === i2active(c)?.key) ? { ...s, dueAt: new Date(`${ch.to}T12:00:00`).toISOString() } : s));
          else if (ch.field === 'Blocker Reason') {
            const st = i2active(con); if (!st || con.status !== 'In Progress' || con.blocker) continue;
            con.steps = con.steps.map((s) => (s.key === st.key ? { ...s, status: 'Blocked' as const } : s));
            con.blocker = { reason: ch.to, department: st.department, since: nowIso, by: who };
          }
          con.history.push({ at: nowIso, by: who, text: ch.field === 'Note' ? `Note: ${ch.to}` : log });
        }
        n++;
        // lead fields that are not part of the contract are saved too; the server restores anything the role may not change
        return { ...lead, contract: con, lastUpdated: nowIso };
      });
      crmService.saveLeads(next);
      await crmService.whenSaved();
      onLeadsUpdated();
      toast.success(`${num(n)} contract(s) updated`);
      setPlan(null);
    } catch (e: any) { toast.error(e?.message || 'The update failed.'); }
    finally { setBusy(false); }
  };

  const btn = 'inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50';

  // ============================== render ==============================
  if (view === 'control') {
    const { cnt } = control;
    const attention: [string, typeof filter][] = [];
    if (cnt.overdue) attention.push([`${num(cnt.overdue)} contract(s) overdue`, 'overdue']);
    if (cnt.today) attention.push([`${num(cnt.today)} due today`, 'today']);
    if (cnt.soon) attention.push([`${num(cnt.soon)} due within 3 days`, 'soon']);
    if (cnt.blocked) attention.push([`${num(cnt.blocked)} blocked by construction`, 'blocked']);
    if (cnt.update) attention.push([`${num(cnt.update)} need updating`, 'update']);
    const worst = [...control.perStep].filter((s) => s.overdue).sort((a, b) => b.overdue - a.overdue)[0];
    return (
      <div className="p-4 md:p-6 space-y-5">
        {header('Control centre', 'Where every contract is now, what is late and what needs attention.', <>
          <button onClick={doExport} className={`${btn} border border-gray-200 bg-white`}><Download size={14} /> Export to Excel</button>
          <button onClick={() => setActiveSubTab?.('contract-import')} className={`${btn} border border-gray-200 bg-white`}><Upload size={14} /> Import from Excel</button></>)}
        {filterBar}
        {attention.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex flex-wrap items-center gap-2 text-sm">
            <AlertTriangle size={16} className="text-amber-600" /><b className="text-amber-800">What needs attention</b>
            {attention.map(([t, f]) => <button key={f} onClick={() => setFilter(filter === f ? 'all' : f)} className="px-2.5 py-1 rounded-full bg-white border border-amber-200 font-semibold text-amber-800">{t}</button>)}
          </div>)}
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {([['Active', cnt.active, 'all', control.act], ['Due soon', cnt.soon, 'soon', control.act.filter((i) => i.dueSoon)], ['Due today', cnt.today, 'today', control.act.filter((i) => i.dueToday)],
            ['Overdue', cnt.overdue, 'overdue', control.act.filter((i) => i.overdueDays)], ['Update required', cnt.update, 'update', control.act.filter((i) => i.issues.length)],
            ['Construction blockers', cnt.blocked, 'blocked', control.act.filter((i) => i.blocked)], ['Completed', cnt.signed, 'signed', scoped.filter((i) => i.state === 'signed')]] as [string, number, typeof filter, Item[]][])
            .map(([l, n, f, a]) => <Tile key={l} label={l} n={n} sub={`${fmtEgp(control.val(a))} EGP`} tone={(f === 'overdue' || f === 'blocked') && n ? 'text-red-600' : f === 'signed' ? 'text-emerald-600' : undefined} active={filter === f} onClick={() => setFilter(filter === f && f !== 'all' ? 'all' : f)} />)}
        </div>
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-brand-gray border-b border-gray-100">{['Contract', 'Project / plot', 'Department', 'State', 'Due', 'Value (EGP)', 'Issues'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{paged.pageRows.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-brand-gray">No contracts here.</td></tr> : paged.pageRows.map((i) => (
              <tr key={i.l.id} onClick={() => goLead(i.l.id)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                <td className="px-3 py-2.5"><b>{i.c?.number || '—'}</b><div className="text-xs text-brand-gray">{i.l.companyName || i.l.customerName}</div></td>
                <td className="px-3 py-2.5">{i.l.project || '—'}<div className="text-xs text-brand-gray">{i.l.plotNo || '—'}</div></td>
                <td className="px-3 py-2.5">{i.stepKey ? stepLabel(i.stepKey) : '—'}<div className="text-xs text-brand-gray">{i.l.assignedSalespersonName || '—'}</div></td>
                <td className={`px-3 py-2.5 ${stateCls(i)}`}>{stateLabel(i)}{i.c?.blocker && <div className="text-xs font-normal">{i.c.blocker.reason}</div>}</td>
                <td className="px-3 py-2.5">{isNaN(i.dueMs) ? '—' : new Date(i.dueMs).toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2.5">{fmtEgp(Number(i.l.dealValue))}</td>
                <td className="px-3 py-2.5 text-xs text-brand-gray">{i.issues.length ? i.issues.join(' · ') : '—'}</td>
              </tr>))}</tbody>
          </table>
          <PagerBar total={listRows.length} page={paged.page} pageSize={paged.pageSize} onPage={paged.setPage} onSize={paged.setPageSize} shown={paged.allShown} onMore={paged.more} />
        </div>
        <div className={`${cardCls} overflow-x-auto`}>
          <div className="px-4 pt-4 font-black text-brand-dark">By department</div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-brand-gray border-b border-gray-100">{['Step', 'SLA (days)', 'Active', 'Due soon', 'Overdue', 'Blocked', 'Average days here'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{control.perStep.map((s) => { const a = avg(s.ages); return (
              <tr key={s.key} className="border-b border-gray-50"><td className="px-3 py-2.5 font-bold">{s.label}</td><td className="px-3 py-2.5">{s.slaDays}</td><td className="px-3 py-2.5">{s.active}</td><td className="px-3 py-2.5">{s.soon}</td>
                <td className={`px-3 py-2.5 ${s.overdue ? 'text-red-600 font-bold' : ''}`}>{s.overdue}</td><td className={`px-3 py-2.5 ${s.blocked ? 'text-red-600 font-bold' : ''}`}>{s.blocked}</td>
                <td className={`px-3 py-2.5 ${a !== null && a > s.slaDays ? 'text-red-600 font-bold' : ''}`}>{f1(a)}</td></tr>); })}</tbody>
          </table>
          {worst && <div className="px-4 pb-4 text-sm text-brand-gray">Biggest hold-up: <b className="text-brand-dark">{worst.label}</b> with {worst.overdue} overdue{avg(worst.ages) !== null ? ` · averaging ${f1(avg(worst.ages))} days against a ${worst.slaDays}-day target` : ''}.</div>}
        </div>
      </div>);
  }

  if (view === 'blockers') {
    const byProject = new Map<string, number>(), byReason = new Map<string, number>(); let totalDays = 0, value = 0;
    for (const i of blockers) { byProject.set(i.l.project || '—', (byProject.get(i.l.project || '—') || 0) + 1); const r = i.c!.blocker!.reason || '—'; byReason.set(r, (byReason.get(r) || 0) + 1); totalDays += i.blockedDays; value += Number(i.l.dealValue) || 0; }
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    return (
      <div className="p-4 md:p-6 space-y-5">
        {header('Construction blockers', 'A blocked contract is waiting on site work, not on a department, so it is never counted as overdue.', <button onClick={() => setActiveSubTab?.('contract-control')} className={`${btn} border border-gray-200 bg-white`}>Back to Control centre</button>)}
        {filterBar}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Contracts blocked" n={blockers.length} sub={`${fmtEgp(value)} EGP`} tone={blockers.length ? 'text-red-600' : undefined} />
          <Tile label="Total days blocked" n={totalDays} />
          <Tile label="Past resolution date" n="n/a" sub="No expected date is recorded" />
          <Tile label="Projects affected" n={byProject.size} />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className={`${cardCls} p-4`}><h3 className="font-black text-brand-dark mb-3">By project</h3><Bars rows={top(byProject)} /></div>
          <div className={`${cardCls} p-4`}><h3 className="font-black text-brand-dark mb-3">By reason</h3><Bars rows={top(byReason)} /></div>
        </div>
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-brand-gray border-b border-gray-100">{['Contract', 'Project / plot', 'Reason', 'Department', 'Since', 'Days blocked', 'Value (EGP)'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{blockedPaged.pageRows.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-brand-gray"><ShieldAlert size={14} className="inline mr-1" />No blocked contracts.</td></tr> : blockedPaged.pageRows.map((i) => (
              <tr key={i.l.id} onClick={() => goLead(i.l.id)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                <td className="px-3 py-2.5"><b>{i.c?.number || '—'}</b><div className="text-xs text-brand-gray">{i.l.companyName || i.l.customerName}</div></td>
                <td className="px-3 py-2.5">{i.l.project || '—'}<div className="text-xs text-brand-gray">{i.l.plotNo || '—'}</div></td>
                <td className="px-3 py-2.5 text-red-600 font-semibold">{i.c!.blocker!.reason}</td><td className="px-3 py-2.5">{i.c!.blocker!.department}</td>
                <td className="px-3 py-2.5">{d10(i.c!.blocker!.since) || '—'}</td><td className="px-3 py-2.5 font-bold">{i.blockedDays}</td><td className="px-3 py-2.5">{fmtEgp(Number(i.l.dealValue))}</td>
              </tr>))}</tbody>
          </table>
          <PagerBar total={blockers.length} page={blockedPaged.page} pageSize={blockedPaged.pageSize} onPage={blockedPaged.setPage} onSize={blockedPaged.setPageSize} shown={blockedPaged.allShown} onMore={blockedPaged.more} />
        </div>
      </div>);
  }

  if (view === 'reports') {
    const r = reports;
    const bucketNames = ['0–3 days', '4–7 days', '8–14 days', '15–30 days', '30+ days'];
    return (
      <div className="p-4 md:p-6 space-y-5">
        {header('Contract reports', 'How long contracts take and where they wait.')}
        {filterBar}
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <Tile label="Won deals" n={r.total} /><Tile label="Not started" n={r.none} /><Tile label="In progress" n={r.progress} /><Tile label="On hold" n={r.hold} />
          <Tile label="Signed" n={r.signed} tone="text-emerald-600" /><Tile label="Cancelled" n={r.cancelled} />
          <Tile label="Overdue vs SLA" n={r.overdue} tone={r.overdue ? 'text-red-600' : undefined} /><Tile label="Blocked" n={r.blocked} tone={r.blocked ? 'text-red-600' : undefined} />
          <Tile label="Average contract duration" n={r.avgDuration === null ? '—' : `${f1(r.avgDuration)} d`} sub="Start to signature, signed contracts" />
        </div>
        <div className={`${cardCls} p-4`}>
          <h3 className="font-black text-brand-dark mb-3">Where the time goes — average days per step</h3>
          <Bars rows={r.perStep.filter((p) => p.done).map((p) => [p.label, Math.round((p.totalDays / p.done) * 10) / 10] as [string, number])} />
          {r.slowest && <div className="text-sm text-brand-gray mt-3">Slowest step: <b className="text-brand-dark">{r.slowest.label}</b> at {f1(r.slowest.totalDays / r.slowest.done)} days on average.</div>}
        </div>
        <div className={`${cardCls} overflow-x-auto`}>
          <div className="px-4 pt-4 font-black text-brand-dark">Department performance</div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-brand-gray border-b border-gray-100">{['Step', 'Department', 'Contracts handled', 'Average duration (d)', 'Currently there', 'Longest current aging (d)', 'Total time spent (d)'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{r.perStep.map((s) => (
              <tr key={s.key} className="border-b border-gray-50"><td className="px-3 py-2.5 font-bold">{s.label}</td><td className="px-3 py-2.5">{s.department}</td><td className="px-3 py-2.5">{s.done || '—'}</td>
                <td className="px-3 py-2.5">{s.done ? f1(s.totalDays / s.done) : '—'}</td><td className="px-3 py-2.5">{s.here || '—'}</td>
                <td className={`px-3 py-2.5 ${s.longest >= 7 ? 'text-red-600 font-bold' : ''}`}>{s.here ? f1(s.longest) : '—'}</td><td className="px-3 py-2.5">{s.done ? f1(s.totalDays) : '—'}</td></tr>))}</tbody>
          </table>
        </div>
        <div className={`${cardCls} p-4`}>
          <h3 className="font-black text-brand-dark mb-3">Contract aging (days at the current step)</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{bucketNames.map((b, k) => <Tile key={b} label={b} n={r.buckets[k]} tone={k === 4 && r.buckets[k] ? 'text-red-600' : undefined} />)}</div>
        </div>
        <div className="text-xs text-brand-gray">Handler workload and priority are not part of the contract record and are not shown.</div>
      </div>);
  }

  // view === 'import'
  const sum = plan ? { upd: plan.rows.filter((x) => x.result === 'update').length, same: plan.rows.filter((x) => x.result === 'same').length, nomatch: plan.rows.filter((x) => x.result === 'nomatch').length, dup: plan.rows.filter((x) => x.result === 'dup').length } : null;
  return (
    <div className="p-4 md:p-6 space-y-5">
      {header('Contract Excel', 'Export the contracts, fix them in Excel and import them back. An import never creates a contract.', <>
        <button onClick={doExport} className={`${btn} border border-gray-200 bg-white`}><Download size={14} /> Export to Excel</button>
        <button onClick={() => setActiveSubTab?.('contract-control')} className={`${btn} border border-gray-200 bg-white`}>Back to Control centre</button></>)}
      <div className={`${cardCls} p-5 space-y-3`}>
        <div className="flex items-center gap-2 font-black text-brand-dark"><FileSpreadsheet size={16} /> Import</div>
        <p className="text-sm text-brand-gray">Rows are matched by Contract No., then Lead ID, then Project + Plot. These columns can be changed: Project, Plot, Contract Value, Due Date (of the current step), Blocker Reason (starts a blocker) and Notes. Empty cells change nothing. Every change is written to the contract history.</p>
        {!canEdit && <div className="text-sm text-amber-700">You can preview a file, but only users who manage contracts can apply it.</div>}
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
        <button onClick={() => fileRef.current?.click()} disabled={busy} className={`${btn} bg-brand-red text-white`}><Upload size={14} /> {busy ? 'Working…' : 'Choose an .xlsx file'}</button>
      </div>
      {plan && sum && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="To update" n={sum.upd} tone="text-emerald-600" /><Tile label="Unchanged" n={sum.same} /><Tile label="No match" n={sum.nomatch} tone={sum.nomatch ? 'text-red-600' : undefined} /><Tile label="Duplicate rows" n={sum.dup} />
          </div>
          <div className="flex gap-2">
            <button onClick={applyPlan} disabled={busy || !sum.upd || !canEdit} className={`${btn} bg-brand-red text-white`}>Confirm and apply {num(sum.upd)} update(s)</button>
            <button onClick={() => setPlan(null)} disabled={busy} className={`${btn} border border-gray-200 bg-white`}>Discard</button>
            <span className="text-xs text-brand-gray self-center">{plan.file}</span>
          </div>
          <PlanTable rows={plan.rows} />
        </>)}
    </div>);
};

const PlanTable: React.FC<{ rows: { row: number; no: string; id: string; result: string; changes: { field: string; from: string; to: string }[]; notes: string[] }[] }> = ({ rows }) => {
  const p = usePagedList(rows, 'crm.ctimport.page', rows);
  const label = (r: string, n: number) => r === 'update' ? `${n} change(s)` : r === 'same' ? 'Unchanged' : r === 'dup' ? 'Duplicate row' : 'No match';
  return (
    <div className={`${cardCls} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wide text-brand-gray border-b border-gray-100">{['Row', 'Contract', 'Result', 'What would change'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{p.pageRows.map((r) => (
          <tr key={r.row} className="border-b border-gray-50 align-top">
            <td className="px-3 py-2.5">{r.row}</td><td className="px-3 py-2.5 font-bold">{r.no || r.id || '—'}</td>
            <td className={`px-3 py-2.5 ${r.result === 'nomatch' ? 'text-red-600' : r.result === 'update' ? 'text-emerald-600 font-bold' : 'text-brand-gray'}`}>{label(r.result, r.changes.length)}</td>
            <td className="px-3 py-2.5 text-xs">{r.changes.map((c) => <div key={c.field}><b>{c.field}</b>: {c.from} → {c.to}</div>)}{r.notes.map((n) => <div key={n} className="text-amber-700">{n}</div>)}{!r.changes.length && !r.notes.length && '—'}</td>
          </tr>))}</tbody>
      </table>
      <PagerBar total={rows.length} page={p.page} pageSize={p.pageSize} onPage={p.setPage} onSize={p.setPageSize} shown={p.allShown} onMore={p.more} />
    </div>);
};
