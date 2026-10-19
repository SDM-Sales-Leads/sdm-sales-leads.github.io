import React, { useEffect, useMemo, useState } from 'react';
import { Award, Target as TargetIcon, TrendingUp, Users, ChevronRight, Download } from 'lucide-react';
import { Lead } from './types';
import { useAuth } from '../../services/AuthContext';
import { adminService } from '../../services/adminService';
import { ACTIVE_EXCLUDE, PIPELINE_STATUSES, closingDate } from './leadConfig';
import { externalSalesService, ExternalSaleRow } from './externalSalesService';

export interface CrmTargetsProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string;
  setActiveSubTab?: (tab: string) => void;
}

const SALES_ROLES = ['Sales Team', 'Sales Rep', 'Sales Team Leader'];
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const money = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : fmt(n);
const pctTxt = (n: number | null) => n === null ? '—' : `${Math.round(n)}%`;
const barColor = (p: number) => p >= 100 ? 'bg-emerald-500' : p >= 60 ? 'bg-amber-500' : 'bg-brand-red';

// stage weights from the previous CRM (spec_D): contacted 5 %, qualified 15 %, offer / meeting 35 %, negotiation 60 %
function weight(l: Lead): number {
  if (l.status === 'Negotiation') return 0.6;
  if (PIPELINE_STATUSES.includes(String(l.status))) return 0.35;
  if (l.qualification === 'Qualified') return 0.15;
  if (l.status !== 'New') return 0.05;
  return 0;
}

interface Stat {
  leads: number; open: number; wonAll: number; wonYear: number; wonValue: number; ext: number;
  pipeline: number; weighted: number; worked: number; offers: number;
}
const blank = (): Stat => ({ leads: 0, open: 0, wonAll: 0, wonYear: 0, wonValue: 0, ext: 0, pipeline: 0, weighted: 0, worked: 0, offers: 0 });

interface Person { id: string; name: string; role: string; teamLeaderId?: string; target: number }

const ProgressBar = ({ pct, marker }: { pct: number; marker?: number }) => (
  <div className="relative h-3 rounded-full bg-black/5 overflow-hidden">
    <div className={`h-full rounded-full ${barColor(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
    {marker !== undefined && <div className="absolute top-0 bottom-0 w-0.5 bg-brand-black/60" style={{ left: `${Math.min(100, marker)}%` }} title="Share of the year that has passed" />}
  </div>
);

export const CrmTargets: React.FC<CrmTargetsProps> = ({ leads }) => {
  const { user, permissions } = useAuth();
  const uid = String(user?.id ?? '');
  const isAll = user?.role === 'Admin' || user?.role === 'Sales Operation' || permissions?.canViewSalesRules === true;
  const isLeader = user?.role === 'Sales Team Leader';
  const isManager = isAll || isLeader;

  const [people, setPeople] = useState<Person[]>([]);
  const [ext, setExt] = useState<ExternalSaleRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<'me' | 'team'>(isManager ? 'team' : 'me');
  const [viewId, setViewId] = useState(uid);
  const nowD = new Date();
  const [ptype, setPtype] = useState<'year' | 'quarter' | 'month'>('year');
  const [pyear, setPyear] = useState(nowD.getFullYear());
  const [pq, setPq] = useState(Math.floor(nowD.getMonth() / 3) + 1);
  const [pm, setPm] = useState(nowD.getMonth() + 1);
  const [tg, setTg] = useState<Record<string, Record<string, number>>>({});
  const [tlog, setTlog] = useState<any[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [editable, setEditable] = useState<string[] | 'all'>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const loadTargets = () => fetch('/api/crm/targets').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) { setTg(j.targets || {}); setTlog(j.log || []); setCanEdit(!!j.canEdit); setEditable(j.editable || []); } }).catch(() => {});
  useEffect(() => { loadTargets(); }, []);
  const pkey = ptype === 'year' ? `Y${pyear}` : ptype === 'quarter' ? `Q${pyear}-${pq}` : `M${pyear}-${String(pm).padStart(2, '0')}`;
  const plabel = ptype === 'year' ? String(pyear) : ptype === 'quarter' ? `Q${pq} ${pyear}` : new Date(pyear, pm - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  const pname = ptype === 'year' ? 'annual' : ptype === 'quarter' ? 'quarterly' : 'monthly';
  const inPeriod = (d?: string) => {
    const x = String(d || '');
    if (ptype === 'year') return x.startsWith(String(pyear));
    if (ptype === 'month') return x.startsWith(`${pyear}-${String(pm).padStart(2, '0')}`);
    const mo = Number(x.slice(5, 7)); return x.startsWith(String(pyear)) && Math.floor((mo - 1) / 3) + 1 === pq;
  };
  const mayEdit = (id: string) => canEdit && (editable === 'all' || (Array.isArray(editable) && editable.includes(id)));
  const saveTarget = async (id: string, text: string) => {
    const t = text.trim().replace(/,/g, '');
    const res = await fetch('/api/crm/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id, key: pkey, amount: t === '' ? null : Number(t) }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || 'The target was not saved'); }
    setDraft((d) => { const n = { ...d }; delete n[id + pkey]; return n; });
    await loadTargets();
  };

  useEffect(() => {
    let alive = true;
    adminService.getUsers().then((all: any[]) => {
      if (!alive) return;
      setPeople(all.filter((u) => SALES_ROLES.includes(u.role) && u.active !== false).map((u) => ({
        id: String(u.id), name: u.name, role: u.role,
        teamLeaderId: u.teamLeaderId ? String(u.teamLeaderId) : undefined, target: Number(u.annualTarget) || 0,
      })));
    }).catch(() => { /* page shows what it can */ }).finally(() => alive && setLoaded(true));
    externalSalesService.list().then((r) => alive && setExt(r)).catch(() => { /* none */ });
    return () => { alive = false; };
  }, []);

  const now = new Date();
  const year = pyear;
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const pStart = ptype === 'year' ? new Date(pyear, 0, 1) : ptype === 'quarter' ? new Date(pyear, (pq - 1) * 3, 1) : new Date(pyear, pm - 1, 1);
  const pEnd = ptype === 'year' ? new Date(pyear + 1, 0, 1) : ptype === 'quarter' ? new Date(pyear, pq * 3, 1) : new Date(pyear, pm, 1);
  const elapsed = Math.max(0, Math.min(100, ((now.getTime() - pStart.getTime()) / (pEnd.getTime() - pStart.getTime())) * 100));

  // ONE pass over the leads and the external sales: stats per salesperson id
  const stats = useMemo(() => {
    const m = new Map<string, Stat>();
    const get = (id: string) => { let s = m.get(id); if (!s) { s = blank(); m.set(id, s); } return s; };
    for (const l of leads) {
      const id = String(l.assignedSalespersonId || '');
      if (!id || l.mergedInto) continue;
      const s = get(id);
      s.leads++;
      if (l.status === 'Won') {
        s.wonAll++;
        if (inPeriod(closingDate(l))) { s.wonYear++; s.wonValue += Number(l.dealValue) || 0; }
      } else if (!ACTIVE_EXCLUDE.includes(String(l.status))) {
        s.open++;
        const v = Number(l.dealValue) || Number(l.budget) || 0;
        s.pipeline += v; s.weighted += v * weight(l);
        if (l.offerSent) s.offers++;
      }
      if ((l.lastContactDate || '').startsWith(monthKey)) s.worked++;
    }
    for (const e of ext) if (e.status === 'confirmed' && inPeriod(e.saleDate)) get(e.salespersonId).ext += Number(e.amount) || 0;
    return m;
  }, [leads, ext, year, monthKey, ptype, pq, pm]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetOf = (p: { id: string; target: number }) => { const v = tg[p.id]?.[pkey]; return v !== undefined ? v : (ptype === 'year' && pyear === nowD.getFullYear() ? p.target : 0); };
  const stat = (id: string) => stats.get(id) || blank();
  const achieved = (id: string) => stat(id).wonValue + stat(id).ext;
  const pctOf = (id: string, target: number) => target > 0 ? (achieved(id) / target) * 100 : null;

  // who the viewer may see
  const visible = useMemo(() => {
    if (isAll) return people;
    if (isLeader) return people.filter((p) => p.id === uid || p.teamLeaderId === uid);
    return people.filter((p) => p.id === uid);
  }, [people, isAll, isLeader, uid]);
  const board = useMemo(() => visible.filter((p) => p.role !== 'Sales Team Leader' || stat(p.id).leads > 0 || targetOf(p) > 0)
    .map((p) => ({ p, s: stats.get(p.id) || blank() }))
    .sort((a, b) => (b.s.wonValue + b.s.ext) - (a.s.wonValue + a.s.ext)), [visible, stats]); // eslint-disable-line react-hooks/exhaustive-deps

  const teamTarget = visible.reduce((a, p) => a + targetOf(p), 0);
  const teamAchieved = visible.reduce((a, p) => a + achieved(p.id), 0);

  // hierarchy: leaders with their members, then people with no leader
  const tree = useMemo(() => {
    const leaders = visible.filter((p) => p.role === 'Sales Team Leader');
    const leaderIds = new Set(leaders.map((l) => l.id));
    const groups = leaders.map((l) => ({ leader: l, members: visible.filter((p) => p.teamLeaderId === l.id && p.id !== l.id) }));
    const loose = visible.filter((p) => p.role !== 'Sales Team Leader' && !(p.teamLeaderId && leaderIds.has(p.teamLeaderId)));
    return { groups, loose };
  }, [visible]);

  const meP = people.find((p) => p.id === viewId) || { id: viewId, name: user?.name || '', role: user?.role || '', target: 0 } as Person;
  const ms = stat(viewId);
  const ach = achieved(viewId);
  const pct = targetOf(meP) > 0 ? (ach / targetOf(meP)) * 100 : null;
  const conv = ms.leads > 0 ? (ms.wonAll / ms.leads) * 100 : null;

  const milestones = [
    { label: 'First won deal', done: ms.wonAll >= 1 },
    { label: '10 won deals', done: ms.wonAll >= 10, note: `${Math.min(ms.wonAll, 10)} / 10` },
    { label: '50 % of the target', done: pct !== null && pct >= 50 },
    { label: '100 % of the target', done: pct !== null && pct >= 100 },
  ];

  const exportBoard = () => {
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['Salesperson', 'Leads', 'Open', `Won ${plabel}`, `Won value ${plabel} (EGP)`, 'External confirmed (EGP)', 'Conversion %', 'Target (EGP)', 'Target %'];
    const rows = board.map(({ p, s }) => [p.name, s.leads, s.open, s.wonYear, s.wonValue, s.ext, s.leads ? Math.round((s.wonAll / s.leads) * 100) : '', targetOf(p) || '', targetOf(p) ? Math.round(((s.wonValue + s.ext) / targetOf(p)) * 100) : '']);
    const blob = new Blob(['﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `targets-${pkey}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const Kpi = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) => (
    <div className="bento-card !p-4"><p className="text-xs text-brand-gray">{label}</p><p className="text-xl font-bold">{value}</p>{sub && <p className="text-xs text-brand-gray">{sub}</p>}</div>
  );

  const MemberRow = ({ p }: { p: Person }) => {
    const s = stat(p.id); const pp = pctOf(p.id, targetOf(p));
    return (
      <button onClick={() => { setViewId(p.id); setTab('me'); }} className="w-full flex items-center gap-3 py-2 text-left hover:bg-black/5 rounded-lg px-2">
        <span className="w-44 truncate text-sm font-medium">{p.name}</span>
        <div className="flex-1">{pp === null ? <span className="text-xs text-brand-gray">No target set</span> : <ProgressBar pct={pp} marker={elapsed} />}</div>
        <span className="w-24 text-right text-xs">{money(s.wonValue + s.ext)} EGP</span>
        <span className="w-12 text-right text-xs font-semibold">{pctTxt(pp)}</span>
        <ChevronRight size={14} className="text-brand-gray" />
      </button>
    );
  };

  if (!loaded) return <div className="p-6 text-sm text-brand-gray">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><TargetIcon size={22} className="text-brand-red" /> Targets & My Report — {plabel}</h2>
          <p className="text-sm text-brand-gray">Achieved = won deals closed in {plabel} (by closing date) plus confirmed external sales. {fmt(elapsed)}% of the period has passed.</p>
        </div>
        {isManager && (
          <div className="flex gap-1 p-1 rounded-xl bg-black/5 text-sm font-semibold">
            <button onClick={() => setTab('team')} className={`px-3 py-1.5 rounded-lg ${tab === 'team' ? 'bg-white shadow' : 'text-brand-gray'}`}>Team</button>
            <button onClick={() => setTab('me')} className={`px-3 py-1.5 rounded-lg ${tab === 'me' ? 'bg-white shadow' : 'text-brand-gray'}`}>{viewId === uid ? 'My report' : 'Salesperson report'}</button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex gap-1 p-1 rounded-xl bg-black/5 font-semibold">
          {(['month', 'quarter', 'year'] as const).map((t) => (
            <button key={t} onClick={() => setPtype(t)} className={`px-3 py-1.5 rounded-lg capitalize ${ptype === t ? 'bg-white shadow' : 'text-brand-gray'}`}>{t}</button>
          ))}
        </div>
        <select className="input-field !w-auto" value={pyear} onChange={(e) => setPyear(Number(e.target.value))}>
          {[nowD.getFullYear() - 1, nowD.getFullYear(), nowD.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {ptype === 'quarter' && <select className="input-field !w-auto" value={pq} onChange={(e) => setPq(Number(e.target.value))}>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}</select>}
        {ptype === 'month' && <select className="input-field !w-auto" value={pm} onChange={(e) => setPm(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2000, i, 1).toLocaleString('en-GB', { month: 'long' })}</option>)}</select>}
      </div>

      {tab === 'me' && (
        <>
          {isManager && (
            <select className="input-field !w-auto" value={viewId} onChange={(e) => setViewId(e.target.value)}>
              <option value={uid}>{user?.name} (me)</option>
              {visible.filter((p) => p.id !== uid).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="bento-card">
            <div className="flex flex-wrap justify-between gap-2 mb-3">
              <div><p className="text-xs text-brand-gray">{meP.name} — {pname} target</p>{mayEdit(meP.id) ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input type="text" inputMode="numeric" className="input-field !w-44 !py-1.5 font-bold" placeholder="Not set" value={draft[meP.id + pkey] ?? (targetOf(meP) > 0 ? String(targetOf(meP)) : '')} onChange={(e) => setDraft((d) => ({ ...d, [meP.id + pkey]: e.target.value }))} />
                    <span className="text-sm font-semibold">EGP</span>
                    <button disabled={draft[meP.id + pkey] === undefined} onClick={() => saveTarget(meP.id, draft[meP.id + pkey] ?? '')} className="px-3 py-1.5 rounded-xl bg-brand-red text-white text-xs font-bold disabled:opacity-40">Save</button>
                  </div>
                ) : <p className="text-2xl font-bold">{targetOf(meP) > 0 ? `${fmt(targetOf(meP))} EGP` : 'Not set'}</p>}</div>
              <div className="text-right"><p className="text-xs text-brand-gray">Achieved</p><p className="text-2xl font-bold">{fmt(ach)} EGP</p></div>
            </div>
            {targetOf(meP) > 0 ? (<>
              <ProgressBar pct={pct || 0} marker={elapsed} />
              <div className="flex justify-between text-xs mt-2 text-brand-gray">
                <span>{pctTxt(pct)} of target · {fmt(elapsed)}% of the period gone {pct !== null && (pct >= elapsed ? '(on or ahead of pace)' : '(behind pace)')}</span>
                <span>Still to go: {fmt(Math.max(0, targetOf(meP) - ach))} EGP</span>
              </div>
            </>) : <p className="text-sm text-brand-gray">No target is set for this period yet. Your team leader or Sales Operation sets it.</p>}
            <p className="text-xs text-brand-gray mt-2">Won in system {fmt(ms.wonValue)} EGP ({ms.wonYear} deals) + external sales {fmt(ms.ext)} EGP</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Leads" value={ms.leads} sub={`${ms.open} open`} />
            <Kpi label="Conversion" value={pctTxt(conv)} sub={`${ms.wonAll} won of ${ms.leads} leads`} />
            <Kpi label="Leads worked this month" value={ms.worked} sub="last contact date in this month" />
            <Kpi label="Offers waiting" value={ms.offers} />
            <Kpi label="Open pipeline" value={ms.pipeline > 0 ? `${money(ms.pipeline)} EGP` : '—'} sub="deal value, else budget" />
            <Kpi label="Weighted pipeline" value={ms.pipeline > 0 ? `${money(ms.weighted)} EGP` : '—'} sub="5 / 15 / 35 / 60 % by stage" />
            <Kpi label={`Won ${plabel}`} value={ms.wonYear} sub={`${fmt(ms.wonValue)} EGP`} />
            <Kpi label="External sales confirmed" value={ms.ext > 0 ? `${money(ms.ext)} EGP` : '—'} />
          </div>

          <div className="bento-card">
            <h3 className="font-bold mb-3 flex items-center gap-2"><Award size={16} className="text-brand-red" /> Milestones</h3>
            <div className="flex flex-wrap gap-2">
              {milestones.map((m) => (
                <span key={m.label} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${m.done ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'text-brand-gray border-black/10'}`}>
                  {m.done ? '✓ ' : ''}{m.label}{!m.done && m.note ? ` · ${m.note}` : ''}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'team' && isManager && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Team target" value={teamTarget > 0 ? `${fmt(teamTarget)} EGP` : 'Not set'} sub="sum of individual targets" />
            <Kpi label="Team achieved" value={`${fmt(teamAchieved)} EGP`} />
            <Kpi label="Team progress" value={teamTarget > 0 ? pctTxt((teamAchieved / teamTarget) * 100) : '—'} sub={`${fmt(elapsed)}% of the period gone`} />
            <Kpi label="Salespeople" value={visible.length} />
          </div>
          {teamTarget > 0 && <div className="bento-card"><ProgressBar pct={(teamAchieved / teamTarget) * 100} marker={elapsed} /></div>}

          <div className="bento-card !p-0 overflow-x-auto">
            <div className="flex items-center justify-between p-4"><h3 className="font-bold flex items-center gap-2"><TrendingUp size={16} className="text-brand-red" /> Leaderboard {plabel}</h3>
              <button onClick={exportBoard} className="px-3 py-1.5 rounded-xl border border-black/10 text-xs font-semibold flex items-center gap-2"><Download size={12} /> Export</button></div>
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-black/5 text-xs uppercase text-brand-gray">
                <th className="p-3">#</th><th className="p-3">Salesperson</th><th className="p-3 text-right">Leads</th><th className="p-3 text-right">Open</th>
                <th className="p-3 text-right">Won</th><th className="p-3 text-right">Won value</th><th className="p-3 text-right">External</th>
                <th className="p-3 text-right">Conv.</th><th className="p-3 text-right">Target</th><th className="p-3 text-right">Target %</th>
              </tr></thead>
              <tbody className="divide-y divide-black/5">
                {board.length === 0 && <tr><td colSpan={10} className="p-8 text-center text-brand-gray">No salespeople to show.</td></tr>}
                {board.map(({ p, s }, i) => {
                  const pp = targetOf(p) > 0 ? ((s.wonValue + s.ext) / targetOf(p)) * 100 : null;
                  return (
                    <tr key={p.id} className="hover:bg-black/5 cursor-pointer" onClick={() => { setViewId(p.id); setTab('me'); }}>
                      <td className="p-3 text-brand-gray">{i + 1}</td><td className="p-3 font-medium">{p.name}</td>
                      <td className="p-3 text-right">{s.leads}</td><td className="p-3 text-right">{s.open}</td><td className="p-3 text-right">{s.wonYear}</td>
                      <td className="p-3 text-right">{fmt(s.wonValue)}</td><td className="p-3 text-right">{s.ext ? fmt(s.ext) : '—'}</td>
                      <td className="p-3 text-right">{s.leads ? pctTxt((s.wonAll / s.leads) * 100) : '—'}</td>
                      <td className="p-3 text-right" onClick={(e) => mayEdit(p.id) && e.stopPropagation()}>
                        {mayEdit(p.id)
                          ? <input type="text" inputMode="numeric" className="input-field !w-32 !py-1 text-right" placeholder="—" value={draft[p.id + pkey] ?? (targetOf(p) ? String(targetOf(p)) : '')} onChange={(e) => setDraft((d) => ({ ...d, [p.id + pkey]: e.target.value }))} onBlur={() => { const v = draft[p.id + pkey]; if (v !== undefined) saveTarget(p.id, v); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                          : (targetOf(p) ? fmt(targetOf(p)) : '—')}
                      </td>
                      <td className="p-3 text-right font-semibold">{pctTxt(pp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bento-card">
            <h3 className="font-bold mb-3 flex items-center gap-2"><Users size={16} className="text-brand-red" /> Team structure</h3>
            {tree.groups.length === 0 && tree.loose.length === 0 && <p className="text-sm text-brand-gray">No team data.</p>}
            {tree.groups.map(({ leader, members }) => {
              const tt = [leader, ...members].reduce((a, p) => a + targetOf(p), 0);
              const ta = [leader, ...members].reduce((a, p) => a + achieved(p.id), 0);
              return (
                <div key={leader.id} className="mb-4">
                  <div className="flex items-center justify-between text-sm font-bold border-b border-black/5 pb-1 mb-1">
                    <span>{leader.name} <span className="text-xs font-normal text-brand-gray">team leader · {members.length} members</span></span>
                    <span className="text-xs font-semibold">{money(ta)} / {tt ? money(tt) : '—'} EGP · {tt ? pctTxt((ta / tt) * 100) : '—'}</span>
                  </div>
                  <MemberRow p={leader} />
                  <div className="ml-6">{members.map((m) => <MemberRow key={m.id} p={m} />)}</div>
                </div>
              );
            })}
            {tree.loose.length > 0 && (
              <div>
                <div className="text-sm font-bold border-b border-black/5 pb-1 mb-1">No team leader</div>
                {tree.loose.map((m) => <MemberRow key={m.id} p={m} />)}
              </div>
            )}
          </div>
        </>
      )}

      {tlog.length > 0 && (
        <div className="bento-card !p-0 overflow-x-auto">
          <h3 className="font-bold p-4 pb-2">Target changes</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b border-black/5 text-xs uppercase text-brand-gray"><th className="p-3">When (Cairo)</th><th className="p-3">Salesperson</th><th className="p-3">Period</th><th className="p-3 text-right">From</th><th className="p-3 text-right">To</th><th className="p-3">Changed by</th></tr></thead>
            <tbody className="divide-y divide-black/5">
              {tlog.slice(0, 50).map((e, i) => {
                const k = String(e.key); const lab = k[0] === 'Y' ? k.slice(1) : k[0] === 'Q' ? `Q${k.slice(-1)} ${k.slice(1, 5)}` : new Date(Number(k.slice(1, 5)), Number(k.slice(6, 8)) - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' });
                return (
                  <tr key={i}>
                    <td className="p-3 whitespace-nowrap">{new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="p-3 font-medium">{e.userName}</td><td className="p-3">{lab}</td>
                    <td className="p-3 text-right">{e.from === null || e.from === undefined ? 'not set' : fmt(e.from)}</td>
                    <td className="p-3 text-right font-semibold">{e.to === null || e.to === undefined ? 'not set' : fmt(e.to)}</td>
                    <td className="p-3">{e.byName}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
