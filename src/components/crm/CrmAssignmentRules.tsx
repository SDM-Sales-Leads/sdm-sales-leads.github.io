import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { AssignmentMethod, Lead } from './types';
import { crmService } from './crmService';
import { isOpenStatus } from './leadConfig';
import { dayOf, fmtDay, isEngaged, todayISO } from './leadMetrics';
import { InfoTip } from './CrmMetricsUi';
import { 
  GitMerge, 
  HelpCircle, 
  User, 
  Settings, 
  CheckCircle, 
  AlertCircle,
  TrendingUp,
  UserCheck,
  Shield,
  Layers,
  Sparkles
} from 'lucide-react';
import { motion } from 'motion/react';

const sqmOf = (v: any) => { const n = Number(String(v ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
const fmtSqm = (n: number) => `${Math.round(n).toLocaleString('en-US')} sqm`;

interface CrmAssignmentRulesProps {
  onRulesUpdated: () => void;
  currentRole: string;
}

export const CrmAssignmentRules: React.FC<CrmAssignmentRulesProps> = ({ onRulesUpdated, currentRole }) => {
  const [activeStrategy, setActiveStrategy] = useState<AssignmentMethod>('Round Robin');
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [sqmWeight, setSqmWeight] = useState(50);
  const [maxSqm, setMaxSqm] = useState('');
  const [maxOpen, setMaxOpen] = useState('');
  const [maxDay, setMaxDay] = useState('');
  const [pool, setPool] = useState<{ unassigned: number; maxOpen: number } | null>(null);
  const [poolBusy, setPoolBusy] = useState(false);
  const loadPool = () => { fetch('/api/crm/pool/status').then((r) => (r.ok ? r.json() : null)).then((j) => j && setPool(j)).catch(() => {}); };
  useEffect(() => { loadPool(); }, []);
  const fillPool = async () => {
    setPoolBusy(true);
    try {
      const r = await fetch('/api/crm/pool/fill', { method: 'POST' }); const j = await r.json().catch(() => ({}));
      if (!r.ok) toast.error(j.error || 'The pool could not be handed out.');
      else toast.success(`${j.assigned || 0} leads handed out. ${j.left || 0} still waiting${j.left ? ' (everyone is at the limit)' : ''}.`);
      loadPool(); void crmService.refreshDelta({ force: true });
    } catch { toast.error('Could not reach the server.'); } finally { setPoolBusy(false); }
  };
  const [unknownSqm, setUnknownSqm] = useState('');
  const [testSizes, setTestSizes] = useState('10000, 5000, 5000');
  const [testing, setTesting] = useState(false);
  const [testOut, setTestOut] = useState<any>(null);
  const [testErr, setTestErr] = useState('');

  // The leads are read from the cache of this tab (the same list the other pages use) and refreshed when it changes.
  const [leads, setLeads] = useState<Lead[]>(() => crmService.getLeads());
  const [people, setPeople] = useState<any[]>(() => crmService.getSalesPeople());
  const [settings, setSettings] = useState(() => crmService.getQueueSettings());

  useEffect(() => {
    const s = crmService.getQueueSettings();
    if (s && s.assignmentMethod) setActiveStrategy(s.assignmentMethod);
    if (s) { setMaxDay(Number(s.maxDailyAssignment) > 0 ? String(s.maxDailyAssignment) : ''); setMaxOpen(Number(s.maxLeadsPerSalesperson) > 0 ? String(s.maxLeadsPerSalesperson) : ''); setSqmWeight(typeof s.sqmWeight === 'number' ? s.sqmWeight : 50); setMaxSqm(Number(s.maxSqmPerSalesperson) > 0 ? String(s.maxSqmPerSalesperson) : ''); setUnknownSqm(Number(s.unknownLeadSqm) > 0 ? String(s.unknownLeadSqm) : ''); }
    const refresh = () => { setLeads(crmService.getLeads()); setPeople(crmService.getSalesPeople()); setSettings(crmService.getQueueSettings()); };
    window.addEventListener('crm-data-changed', refresh);
    return () => window.removeEventListener('crm-data-changed', refresh);
  }, []);

  // One pass over the leads for every person: nothing is scanned per row.
  const fairness = useMemo(() => {
    const today = todayISO();
    const byId = new Map<string, { open: number; total: number; untouched: number; today: number; sqm: number }>();
    const get = (k: string) => { let r = byId.get(k); if (!r) { r = { open: 0, total: 0, untouched: 0, today: 0, sqm: 0 }; byId.set(k, r); } return r; };
    let unassigned = 0;
    const assigned: Lead[] = [];
    for (const l of leads) {
      if (l.mergedInto || l.status === 'Duplicate') continue;
      const open = isOpenStatus(l.status);
      const k = String(l.assignedSalespersonId || '');
      if (!k) { if (open) unassigned++; continue; }
      const r = get(k);
      r.total++;
      if (open) { r.open++; r.sqm += sqmOf(l.requiredSize); if (!isEngaged(l)) r.untouched++; }
      if (dayOf(l.assignedDate) === today) r.today++;
      if (l.assignedDate) assigned.push(l);
    }
    assigned.sort((a, b) => String(b.assignedDate).localeCompare(String(a.assignedDate)));
    return { byId, unassigned, last: assigned.slice(0, 12) };
  }, [leads]);

  const agents = useMemo(() => people.map((s: any) => {
    const f = fairness.byId.get(String(s.id)) || { open: 0, total: 0, untouched: 0, today: 0, sqm: 0 };
    return {
      id: String(s.id),
      name: s.name,
      status: s.leave ? 'Away' : (s.active ? 'Online' : 'Offline'),
      // No invented defaults: personal weight/cap only when set; the cap otherwise comes from the queue settings
      weight: typeof s.weight === 'number' && s.weight > 0 ? s.weight : null,
      cap: Number(s.cap) > 0 ? Number(s.cap) : (Number(settings?.maxLeadsPerSalesperson) > 0 ? Number(settings.maxLeadsPerSalesperson) : null),
      activeLeads: f.open, openSqm: f.sqm, totalLeads: f.total, untouched: f.untouched, assignedToday: f.today,
      projects: Array.isArray(s.projects) ? s.projects : [],
    };
  }), [people, fairness, settings]);
  const maxOpenLeads = Math.max(1, ...agents.map((a) => a.activeLeads));
  const maxOpenSqm = Math.max(1, ...agents.map((a) => a.openSqm));
  const sqmSpread = agents.length > 1 ? Math.max(...agents.map((a) => a.openSqm)) - Math.min(...agents.map((a) => a.openSqm)) : null;
  const spread = agents.length > 1 ? Math.max(...agents.map((a) => a.activeLeads)) - Math.min(...agents.map((a) => a.activeLeads)) : null;

  // Only the methods the server really applies are offered. An assigned lead keeps the status New: the team's vocabulary has no "Assigned".
  const strategies: { value: AssignmentMethod; title: string; description: string }[] = [
    { value: 'Round Robin', title: 'Round Robin', description: 'Hands each new lead to the next eligible person in name order, so everybody gets the same number.' },
    { value: 'Least Active Leads', title: 'Least Active Leads', description: 'Gives the lead to the eligible person with the fewest open leads (ties: fewest leads overall).' },
    { value: 'Least Total Leads', title: 'Least Total Leads', description: 'Gives the lead to the eligible person who has received the fewest leads in total.' },
    { value: 'Balanced Sqm and Leads', title: 'Fair: sqm + number of leads', description: 'Balances BOTH the area (sqm) and the number of leads each person holds. You choose how much weight sqm gets. One 10,000 sqm lead is worth two 5,000 sqm leads.' },
    { value: 'Least Open Sqm', title: 'Fair: least sqm', description: 'Gives the lead to the person holding the fewest open sqm (ties: fewest open leads). Best when sqm is what the team sells.' },
    { value: 'Random', title: 'Random', description: 'Picks one eligible person at random.' },
    { value: 'Manual Assignment Only', title: 'Manual only', description: 'New leads stay unassigned (status New) until Sales Operation distributes them.' },
  ];
  const unsupported = !strategies.some((x) => x.value === activeStrategy);

  const handleSaveStrategy = () => {
    const currentSettings = crmService.getQueueSettings();
    crmService.saveQueueSettings({
      ...currentSettings,
      assignmentMethod: activeStrategy,
      sqmWeight,
      maxLeadsPerSalesperson: Math.max(0, Math.floor(Number(maxOpen) || 0)),
      maxDailyAssignment: Math.max(0, Math.floor(Number(maxDay) || 0)),
      maxSqmPerSalesperson: sqmOf(maxSqm),
      unknownLeadSqm: sqmOf(unknownSqm),
    });
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 3000);
    onRulesUpdated();
  };

  const runTest = async () => {
    const sizes = testSizes.split(/[,\s;]+/).map((x) => sqmOf(x)).filter((x) => x > 0);
    setTestErr(''); setTestOut(null);
    if (!sizes.length) { setTestErr('Type the lead sizes in sqm, separated by commas.'); return; }
    setTesting(true);
    try {
      const res = await fetch('/api/crm/routing/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sizes, method: activeStrategy }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'The test could not run.');
      setTestOut(j);
    } catch (e: any) { setTestErr(e.message || 'The test could not run.'); } finally { setTesting(false); }
  };

  const hasAdminRole = currentRole === 'Admin' || currentRole === 'System Admin' || currentRole === 'System Administrator' || currentRole === 'Sales Manager' || currentRole === 'Sales Operations Manager' || currentRole === 'Sales Operation';

  return (
    <div className="space-y-6" id="crm-assignment-rules-root">
      
      {/* Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-xl font-bold text-brand-black flex items-center gap-2">
            <span>Enterprise Lead Routing Engine</span>
            <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2.5 py-0.5 rounded-full">
              Automated ruleset
            </span>
          </h3>
          <p className="text-xs text-brand-gray/80 mt-1">
            Choose how new leads from the website, ads and the mailbox are shared among the salespeople. Only Sales Operation changes it; the server applies it and keeps the audit trail.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
        
        {/* Strategy list */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 space-y-4">
            <h4 className="font-bold text-brand-black text-sm uppercase tracking-wide">Active Routing Strategy</h4>
            {unsupported && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[11px] font-semibold flex items-center gap-2">
                <AlertCircle size={14} />
                <span>The saved method "{activeStrategy}" is not modelled by the server: it routes like Least Active Leads. Choose one of the methods below to make it explicit.</span>
              </div>
            )}
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {strategies.map((strat) => {
                const isActive = activeStrategy === strat.value;
                return (
                  <div
                    key={strat.value}
                    role="radio"
                    aria-checked={isActive}
                    aria-disabled={!hasAdminRole}
                    tabIndex={hasAdminRole ? 0 : -1}
                    onKeyDown={(e) => { if (hasAdminRole && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setActiveStrategy(strat.value); } }}
                    onClick={() => hasAdminRole && setActiveStrategy(strat.value)}
                    className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${isActive ? 'border-brand-red bg-brand-red/5' : 'border-brand-gray/15 bg-white hover:bg-brand-gray/5'}`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <h5 className="font-bold text-brand-black">{strat.title}</h5>
                      <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${isActive ? 'border-brand-red bg-brand-red' : 'border-brand-gray/30'}`}>
                        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                    </div>
                    <p className="text-[10px] text-brand-gray font-semibold leading-relaxed">{strat.description}</p>
                  </div>
                );
              })}
            </div>

            {(
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-brand-gray/10">
                <label className={`block ${activeStrategy === 'Balanced Sqm and Leads' ? '' : 'opacity-50'}`}>
                  <span className="font-bold text-brand-black">Weight of sqm: {sqmWeight}%</span>
                  <input type="range" min={0} max={100} step={5} value={sqmWeight} disabled={!hasAdminRole || activeStrategy !== 'Balanced Sqm and Leads'} onChange={(e) => setSqmWeight(Number(e.target.value))} className="w-full accent-brand-red" />
                  <span className="text-[10px] text-brand-gray font-semibold">{sqmWeight}% follows sqm, {100 - sqmWeight}% follows number of leads. Only for the "sqm + number of leads" method.</span>
                </label>
                <label className="block">
                  <span className="font-bold text-brand-black">Max open sqm per person</span>
                  <input type="number" min={0} className="input-field mt-1" placeholder="No limit" value={maxSqm} disabled={!hasAdminRole} onChange={(e) => setMaxSqm(e.target.value)} />
                  <span className="text-[10px] text-brand-gray font-semibold">Someone at this total gets no more leads (an empty person can still take one big lead).</span>
                </label>
                <label className="block">
                  <span className="font-bold text-brand-black">Size to assume if a lead has none</span>
                  <input type="number" min={0} className="input-field mt-1" placeholder="0 = count as one lead" value={unknownSqm} disabled={!hasAdminRole} onChange={(e) => setUnknownSqm(e.target.value)} />
                  <span className="text-[10px] text-brand-gray font-semibold">Website leads often have no sqm. Leave empty to not guess.</span>
                </label>
              </div>
            )}

            <div className="rounded-xl border border-brand-red/25 bg-brand-red/5 p-3.5 text-xs flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="font-extrabold text-brand-black text-sm">Pool of unassigned leads: {pool ? pool.unassigned.toLocaleString('en-US') : '…'}</div>
                <div className="text-brand-gray font-semibold mt-0.5">Leads nobody worked on wait here. Every 5 minutes the oldest ones (call center first) go to whoever has fewer open leads than the limit, fair by number and size.</div>
              </div>
              {hasAdminRole && <button type="button" disabled={poolBusy} onClick={fillPool} className="bg-brand-red disabled:opacity-50 text-white px-4 py-2 rounded-xl font-bold">{poolBusy ? 'Handing out…' : 'Hand out the pool now'}</button>}
            </div>

            <label className="block text-xs">
              <span className="font-bold text-brand-black">Max open leads per salesperson</span>
              <input type="number" min={0} className="input-field mt-1" placeholder="No limit (e.g. 300)" value={maxOpen} disabled={!hasAdminRole} onChange={(e) => setMaxOpen(e.target.value)} />
              <span className="text-[10px] text-brand-gray font-semibold">Open = not Won, Lost, Not Interested, Low Budget or Wrong Number (contacted or not). At this number the person gets no new leads; closing one frees a place. Call center leads ignore this limit.</span>
            </label>

            <label className="block text-xs">
              <span className="font-bold text-brand-black">Max new leads per person per day</span>
              <input type="number" min={0} className="input-field mt-1" placeholder="No limit" value={maxDay} disabled={!hasAdminRole} onChange={(e) => setMaxDay(e.target.value)} />
              <span className="text-[10px] text-brand-gray font-semibold">Leave empty for no daily limit. Call center leads ignore it.</span>
            </label>

            {hasAdminRole ? (
              <div className="flex items-center justify-between pt-4 border-t border-brand-gray/10">
                <span className="text-[10px] text-brand-gray font-bold">Policy updates apply immediately across API integrations.</span>
                <button
                  onClick={handleSaveStrategy}
                  className="bg-brand-red hover:bg-brand-red-dark text-white px-5 py-2 rounded-xl font-bold shadow"
                >
                  Save Active Policy
                </button>
              </div>
            ) : (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 flex items-center gap-2">
                <AlertCircle size={16} />
                <span className="font-semibold">View-only mode. You require Sales Operations permissions to rewrite routing variables.</span>
              </div>
            )}

            {showSavedToast && (
              <div className="p-3 bg-emerald-100 text-emerald-800 rounded-xl border border-emerald-200 font-bold flex items-center gap-2">
                <CheckCircle size={16} className="text-emerald-600" />
                <span>Assignment rules updated and persisted to CRM system backend.</span>
              </div>
            )}
          </div>
        </div>

        {/* Workload and Agent Availability Panel */}
        <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <h4 className="font-bold text-brand-black text-sm uppercase tracking-wide">Live Agent Workloads</h4>
            
            <div className="space-y-3">
              {agents.length === 0 && <p className="text-brand-gray text-center py-4">No salespeople configured.</p>}
              {agents.map((agent) => {
                const percentage = agent.cap ? Math.min(100, Math.round((agent.activeLeads / agent.cap) * 100)) : 0;
                const isOnline = agent.status === 'Online';
                return (
                  <div key={agent.id} className="p-3 bg-brand-gray/5 border border-brand-gray/15 rounded-xl space-y-2">
                    <div className="flex justify-between items-center font-bold">
                      <span className="text-brand-black font-extrabold flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-brand-gray'}`} />
                        {agent.name}
                      </span>
                      <span className="text-brand-gray font-mono text-[10px]">
                        {agent.activeLeads} / {agent.cap ?? '—'} Active
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div>
                        <div className="flex justify-between text-[10px] font-bold text-brand-gray"><span>Leads</span><span className="font-mono text-brand-black">{agent.activeLeads}</span></div>
                        <div className="w-full bg-brand-gray/20 h-2 rounded-full overflow-hidden"><div className={`h-full rounded-full ${percentage > 85 ? 'bg-rose-500' : 'bg-brand-red'}`} style={{ width: `${Math.round((agent.activeLeads / maxOpenLeads) * 100)}%` }} /></div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] font-bold text-brand-gray"><span>Area assigned</span><span className="font-mono text-brand-black">{agent.openSqm > 0 ? fmtSqm(agent.openSqm) : '—'}</span></div>
                        <div className="w-full bg-brand-gray/20 h-2 rounded-full overflow-hidden"><div className="h-full rounded-full bg-sky-600" style={{ width: `${Math.round((agent.openSqm / maxOpenSqm) * 100)}%` }} /></div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-[9px] text-brand-gray font-bold uppercase tracking-wider">
                      <span>Projects: {agent.projects.length ? agent.projects.join(', ') : 'all'}</span>
                      <span>{agent.untouched} not yet contacted</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-3.5 bg-brand-gray/5 rounded-xl border border-brand-gray/15 text-[10px] text-brand-gray font-semibold leading-relaxed mt-4">
            <p>Open leads = not Won, Lost, Not Interested, Low Budget or Wrong Number. A routed lead keeps the status New with an owner until the salesperson works it.</p>
          </div>
        </div>

      </div>

      {/* Test the routing: nothing is assigned */}
      <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 space-y-3 text-xs">
        <h4 className="font-bold text-brand-black text-sm uppercase tracking-wide">Test the routing <span className="text-[10px] normal-case text-brand-gray font-semibold">(no lead is assigned, nobody is notified)</span></h4>
        <p className="text-brand-gray font-semibold">Type the sizes (sqm) of leads that arrive one after the other. It shows who would get each, using the selected method and today's real workload.</p>
        <div className="flex flex-wrap gap-2">
          <input className="input-field flex-1 min-w-[220px]" value={testSizes} onChange={(e) => setTestSizes(e.target.value)} placeholder="10000, 5000, 5000" />
          <button onClick={runTest} disabled={testing} className="bg-brand-black text-white px-4 py-2 rounded-xl font-bold disabled:opacity-60">{testing ? 'Testing…' : 'Run test'}</button>
        </div>
        {testErr && <p className="text-brand-red font-bold">{testErr}</p>}
        {testOut && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-1">{testOut.steps.map((st: any, i: number) => (
              <div key={i} className="flex justify-between bg-brand-gray/5 rounded-lg px-3 py-1.5"><span className="font-semibold">Lead {i + 1} · {st.sqm ? fmtSqm(st.sqm) : 'no size'}</span><span className="font-bold text-brand-black">→ {st.to || 'stays unassigned'}</span></div>
            ))}</div>
            <table className="w-full text-left"><thead><tr className="text-[10px] uppercase text-brand-gray font-bold border-b border-brand-gray/15"><th className="py-1">Person</th><th className="py-1 text-right">Leads before → after</th><th className="py-1 text-right">Sqm before → after</th></tr></thead>
              <tbody className="divide-y divide-brand-gray/10 font-semibold">{testOut.people.map((p: any) => (
                <tr key={p.name}><td className="py-1">{p.name}{!p.eligible && <span className="ml-1 text-[9px] text-brand-gray">(at a limit)</span>}</td><td className="py-1 text-right font-mono">{p.openBefore} → {p.openAfter}</td><td className="py-1 text-right font-mono">{Math.round(p.sqmBefore).toLocaleString('en-US')} → {Math.round(p.sqmAfter).toLocaleString('en-US')}</td></tr>
              ))}</tbody></table>
          </div>
        )}
      </div>

      {/* Fairness: read-only, from the leads themselves */}
      <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 space-y-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-bold text-brand-black text-sm uppercase tracking-wide flex items-center gap-1.5">
            Fairness <InfoTip wide text="Counts come straight from the lead list, nothing is estimated. Open = not Won, Lost, Not Interested, Low Budget or Wrong Number. 'Not yet contacted' = open leads with no first contact, no contact date and no status other than New. 'Assigned today' counts leads whose assignment date is today. The spread is the difference between the highest and lowest open count." />
          </h4>
          <div className="flex gap-4 text-[10px] font-bold text-brand-gray">
            <span>Unassigned open leads: <span className={`font-mono ${fairness.unassigned ? 'text-amber-600' : 'text-brand-black'}`}>{fairness.unassigned}</span></span>
            <span>Spread between people: <span className="font-mono text-brand-black">{spread == null ? '—' : spread}</span></span>
            <span>Sqm spread: <span className="font-mono text-brand-black">{sqmSpread == null ? '—' : fmtSqm(sqmSpread)}</span></span>
            <span>Cap per person: <span className="font-mono text-brand-black">{Number(settings?.maxLeadsPerSalesperson) > 0 ? settings.maxLeadsPerSalesperson : '—'}</span></span>
            <span>Daily limit: <span className="font-mono text-brand-black">{Number(settings?.maxDailyAssignment) > 0 ? settings.maxDailyAssignment : '—'}</span></span>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead><tr className="text-[10px] uppercase text-brand-gray font-bold border-b border-brand-gray/15">
                <th className="py-2 pr-2">Salesperson</th><th className="py-2 px-2 text-right">Open</th><th className="py-2 px-2 text-right">Open sqm</th><th className="py-2 px-2 text-right">Not yet contacted</th><th className="py-2 px-2 text-right">Assigned today</th><th className="py-2 pl-2 text-right">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-brand-gray/10 font-semibold">
                {agents.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-brand-gray">No salespeople configured.</td></tr>}
                {[...agents].sort((a, b) => b.activeLeads - a.activeLeads).map((a) => (
                  <tr key={a.id}><td className="py-2 pr-2 font-bold text-brand-black">{a.name}{a.status !== 'Online' && <span className="ml-1 text-[9px] text-brand-gray font-bold">({a.status})</span>}</td>
                    <td className="py-2 px-2 text-right font-mono">{a.activeLeads}</td><td className="py-2 px-2 text-right font-mono">{a.openSqm > 0 ? a.openSqm.toLocaleString('en-US') : '—'}</td><td className="py-2 px-2 text-right font-mono">{a.untouched}</td>
                    <td className="py-2 px-2 text-right font-mono">{a.assignedToday}</td><td className="py-2 pl-2 text-right font-mono text-brand-gray">{a.totalLeads}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <p className="text-[10px] uppercase text-brand-gray font-bold mb-2">Last assignments</p>
            <div className="space-y-1.5">
              {fairness.last.length === 0 && <p className="text-brand-gray py-4 text-center">No assignment dates recorded yet.</p>}
              {fairness.last.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 bg-brand-gray/5 rounded-lg px-3 py-1.5">
                  <span className="min-w-0 truncate"><span className="font-mono font-bold text-brand-red">{l.id}</span> <span className="font-semibold text-brand-black">{l.customerName}</span></span>
                  <span className="text-[10px] text-brand-gray font-semibold shrink-0">to <span className="font-bold text-brand-black">{l.assignedSalespersonName || '—'}</span> · {fmtDay(dayOf(l.assignedDate))} · {l.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};
