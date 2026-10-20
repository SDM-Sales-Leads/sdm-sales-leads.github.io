import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
const CrmDashboard = lazy(() => import('./CrmDashboard').then((m) => ({ default: m.CrmDashboard })));
import { Lead } from './types';
import { Printer } from 'lucide-react';
import { crmService } from './crmService';
import { ExportBar } from './ReportParts';
import { MarketingTab } from './CrmReportsMarketing';
import { ChannelsTab, DemandTab, ForecastTab, FunnelAgingTab, ReportCtx, ServiceTab, TrendTab, WinLossTab } from './CrmReportsExtra';
import { activityIndex, convOf, decidedWinOf, firstActionMs, slaResult, tallyAdd, emptyTally } from './reportsEngine';
import { useAuth } from '../../services/AuthContext';
import {
  Analysis, Agg, Breakdown, DEFAULT_FILTERS, Filters, STAGE_NAMES, STAGE_WEIGHT, analyse, buckets, crmScopeOf, dataHealth, fmtDay, fmtEGP, fmtPct, isManagerScope,
  isEngaged, mean, pc, periodRange, prepare, selectPool, todayISO,
} from './leadMetrics';
import { Card, BarRow, FilterBar, InfoTip, Kpi, Pill } from './CrmMetricsUi';
import { SOURCES, isMarketingSource } from './leadConfig';

interface CrmReportsProps {
  leads: Lead[];
}

type Tab = 'overview' | 'funnel' | 'trend' | 'winloss' | 'channels' | 'demand' | 'service' | 'forecast' | 'marketing';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'funnel', label: 'Funnel & aging' }, { id: 'trend', label: 'Leads over time' }, { id: 'winloss', label: 'Win / loss' },
  { id: 'channels', label: 'Channels & sources' }, { id: 'demand', label: 'Projects & demand' }, { id: 'service', label: 'Response & follow-up' },
  { id: 'forecast', label: 'Closing forecast' },
  { id: 'marketing', label: 'Marketing lists' },
];

const TH = 'py-2 px-2 text-[10px] uppercase text-brand-gray font-bold tracking-wide';
const TD = 'py-2 px-2 font-mono';

type Col = { head: string; info?: string; cell: (b: Breakdown) => React.ReactNode; right?: boolean };
const BreakTable: React.FC<{ rows: Breakdown[]; first: string; cols: Col[]; limit?: number; empty?: string }> = ({ rows, first, cols, limit = 30, empty = 'No data in this period.' }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-brand-gray/15">
          <th className={TH}>{first}</th>
          {cols.map((c) => <th key={c.head} className={`${TH} text-right`}><span className="inline-flex items-center gap-1">{c.head}{c.info && <InfoTip text={c.info} />}</span></th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-brand-gray/10 font-semibold text-brand-black">
        {rows.length === 0 && <tr><td colSpan={cols.length + 1} className="py-6 text-center text-brand-gray">{empty}</td></tr>}
        {rows.slice(0, limit).map((b) => (
          <tr key={b.key} className="hover:bg-brand-gray/5">
            <td className="py-2 px-2 font-bold max-w-[220px] truncate" title={b.label}>{b.label}</td>
            {cols.map((c) => <td key={c.head} className={`${TD} text-right`}>{c.cell(b)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
    {rows.length > limit && <p className="text-[10px] text-brand-gray mt-2">Showing the top {limit} of {rows.length}.</p>}
  </div>
);

const byRevenue = (a: Breakdown, b: Breakdown) => b.agg.wonValue - a.agg.wonValue || b.agg.won - a.agg.won || b.agg.total - a.agg.total;

export const CrmReports: React.FC<CrmReportsProps> = ({ leads }) => {
  const { user, permissions } = useAuth();
  const scope = crmScopeOf(user, permissions);
  const manager = isManagerScope(scope);
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<Tab>('overview');
  const [actVer, setActVer] = useState(0);
  useEffect(() => { const h = () => setActVer((v) => v + 1); window.addEventListener('crm-data-changed', h); return () => window.removeEventListener('crm-data-changed', h); }, []);
  const acts = useMemo(() => crmService.getActivities(), [leads, actVer]);

  const all = useMemo(() => prepare(leads), [leads]);
  const range = useMemo(() => periodRange(f.period, f.from, f.to), [f.period, f.from, f.to]);
  const pool = useMemo(() => selectPool(all, f, range), [all, f, range]);
  const A: Analysis = useMemo(() => analyse(pool, range, f.period), [pool, range, f.period]);
  const t: Agg = A.total;
  const trend = useMemo(() => buckets(pool, range, f.period), [pool, range, f.period]);
  const health = useMemo(() => dataHealth(all, todayISO()), [all]);

  const owners = useMemo(() => {
    const m = new Map<string, string>();
    all.forEach((p) => { if (p.owner && !m.has(p.owner)) m.set(p.owner, p.ownerName || p.owner); });
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);
  const sources = useMemo(() => {
    const s = new Set<string>(SOURCES);
    all.forEach((p) => { if (p.source !== 'Not recorded') s.add(p.source); });
    return [...s].sort();
  }, [all]);

  // deals won in the period, newest closing date first
  const deals = useMemo(() => {
    const allTime = f.period === 'all';
    return pool.filter((p) => p.won && (allTime || (p.closing >= range.from && p.closing <= range.to))).sort((a, b) => b.closing.localeCompare(a.closing));
  }, [pool, range, f.period]);

  // SLA is judged on the FIRST ACTION (not on the last update, which moves for any later edit)
  const sla = useMemo(() => {
    const idx = activityIndex(acts); const now = Date.now(); let met = 0, viol = 0, pending = 0;
    pool.forEach((p) => { const o = slaResult(p.l, firstActionMs(p.l, idx), now); if (o === 'met') met++; else if (o === 'breached') viol++; else if (o === 'pending') pending++; });
    return { met, viol, pending, rate: pc(met, met + viol) };
  }, [pool, acts]);
  const neverContacted = useMemo(() => pool.filter((p) => p.owner && p.open && !isEngaged(p.l)).length, [pool]);
  // leads right now, ignoring the period (aging, follow-up, forecast tabs)
  const openAll = useMemo(() => selectPool(all, { ...f, period: 'all' }, range).filter((p) => p.open), [all, f.owner, f.source]); // eslint-disable-line react-hooks/exhaustive-deps
  const headline = useMemo(() => { const x = emptyTally(); pool.forEach((p) => tallyAdd(x, p, range, f.period === 'all')); return x; }, [pool, range, f.period]);
  const ctx: ReportCtx = useMemo(() => ({ pool, openAll, range, allTime: f.period === 'all', today: todayISO(), nowMs: Date.now(), acts, manager, periodNote: range.label }), [pool, openAll, range, f.period, acts, manager]);

  const dealSheets = () => [{ name: 'Deals won', rows: [
    ['Closing date', 'Lead', 'Client', 'Company', 'Project', 'Source', 'Salesperson', 'Deal value (EGP)', 'Area (sqm)', 'Plot', 'Cash status'],
    ...deals.map((p) => [p.closing, p.id, p.l.customerName, p.l.companyName || '', p.project, p.source, p.ownerName, p.value || '', p.area || '', p.l.plotNo || '', p.l.cashStatus === 'confirmed' ? 'Confirmed' : 'Pending']),
  ] }];

  const maxLost = A.byReason[0]?.count || 0;
  const lostTotal = A.byReason.reduce((s, r) => s + r.count, 0);
  const stageRows = STAGE_NAMES.slice(0, 5).map((name, i) => ({ name, n: A.byStage[i] || 0, w: STAGE_WEIGHT[i] }));
  const openMax = Math.max(1, ...stageRows.map((s) => s.n));

  const rateCols: Col[] = [
    { head: 'Leads', cell: (b) => b.agg.total },
    { head: 'Reached', info: 'Contacted leads (and % of this row\'s leads).', cell: (b) => `${b.agg.contacted} (${fmtPct(pc(b.agg.contacted, b.agg.total))})` },
    { head: 'Qualified', cell: (b) => b.agg.qualified },
    { head: 'Offer / meeting', cell: (b) => b.agg.opportunity },
    { head: 'Won', cell: (b) => b.agg.won },
    { head: 'Conversion', info: 'Won ÷ leads of this row.', cell: (b) => <Pill v={pc(b.agg.won, b.agg.total)} good={5} ok={1} dp={1} /> },
    { head: 'Win rate', info: 'Won ÷ contacted leads of this row.', cell: (b) => <Pill v={pc(b.agg.won, b.agg.contacted)} good={10} ok={3} dp={1} /> },
    { head: 'Revenue', cell: (b) => (b.agg.wonWithValue ? fmtEGP(b.agg.wonValue) : '—') },
    { head: 'Lost', info: 'Lost, Not Interested and Low Budget, with % of contacted leads.', cell: (b) => `${b.agg.lost} (${fmtPct(pc(b.agg.lost, b.agg.contacted))})` },
  ];

  return (
    <div className="space-y-6 text-xs" id="crm-reports-root">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h3 className="text-xl font-bold text-brand-black">Sales Reports</h3>
          <p className="text-xs text-brand-gray/80 mt-1">{manager ? 'Team-wide figures for the leads you manage.' : 'Your own figures.'} Every column header with an info icon says what it counts and against what.</p>
        </div>
        <div className="flex gap-2">
          <ExportBar name={`deals-won-${range.from}_${range.to}`} sheets={dealSheets} disabled={!deals.length} />
          <button onClick={() => window.print()} className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5">
            <Printer size={13} /><span>Print</span>
          </button>
        </div>
      </div>

      <FilterBar f={f} set={setF} owners={manager ? owners : undefined} sources={sources} rangeLabel={`${range.label} · ${pool.length} leads`} />

      <div className="flex flex-wrap gap-1 bg-brand-gray/10 rounded-xl p-1 print:hidden" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${tab === x.id ? 'bg-white text-brand-black shadow-sm' : 'text-brand-gray hover:text-brand-black'}`}>{x.label}</button>
        ))}
      </div>

      {tab === 'funnel' && <FunnelAgingTab c={ctx} />}
      {tab === 'trend' && <TrendTab c={ctx} />}
      {tab === 'marketing' && <MarketingTab c={ctx} />}
      {tab === 'winloss' && <WinLossTab c={ctx} />}
      {tab === 'channels' && <ChannelsTab c={ctx} />}
      {tab === 'demand' && <DemandTab c={ctx} />}
      {tab === 'service' && <ServiceTab c={ctx} />}
      {tab === 'forecast' && <ForecastTab c={ctx} />}

      {tab === 'overview' && (<>
      {/* the former Executive Board: headline figures, funnel, intake, speed and (for managers) the team's day */}
      <Suspense fallback={<p className="text-brand-gray py-6 text-center">Loading…</p>}><CrmDashboard leads={leads} filters={f} /></Suspense>

      {/* deals won */}
      <Card title="Deals won" info="Leads with status Won whose closing date is in the period (typed closing date, else EOI date on the EOI path, else reservation / EOI / contract date, else lead date). Value is the cash value in EGP. 'Cash pending' = Accounts Receivable has not confirmed the cash yet; only Accounts Receivable can confirm.">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi label="Deals" value={t.won} info="Number of won deals in the period." tone="text-emerald-600" />
          <Kpi label="Value" value={t.wonWithValue ? fmtEGP(t.wonValue) : '—'} sub={`${t.wonWithValue} of ${t.won} have a value`} info="Sum of the deal value (EGP) of those deals." />
          <Kpi label="Cash confirmed" value={t.cashConfirmed && t.cashConfirmedValue ? fmtEGP(t.cashConfirmedValue) : '—'} sub={`${t.cashConfirmed} deals`} info="Deals whose cash Accounts Receivable has confirmed." tone="text-emerald-600" />
          <Kpi label="Cash pending" value={t.cashPending && t.cashPendingValue ? fmtEGP(t.cashPendingValue) : '—'} sub={`${t.cashPending} deals`} info="Won deals not yet confirmed by Accounts Receivable." tone="text-amber-600" />
          <Kpi label="Area sold" value={t.wonArea ? `${Math.round(t.wonArea).toLocaleString('en-US')} sqm` : '—'} info="Sum of the sold area on those deals (only deals with an area)." />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-brand-gray/15">
              {['Closing date', 'Lead', 'Client', 'Project', 'Salesperson', 'Value (EGP)', 'Cash'].map((h, i) => <th key={h} className={`${TH} ${i === 5 ? 'text-right' : ''}`}>{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-brand-gray/10 font-semibold text-brand-black">
              {deals.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-brand-gray">No deals won in this period.</td></tr>}
              {deals.slice(0, 100).map((p) => (
                <tr key={p.id} className="hover:bg-brand-gray/5">
                  <td className="py-2 px-2">{fmtDay(p.closing)}</td>
                  <td className="py-2 px-2 font-mono text-brand-red">{p.id}</td>
                  <td className="py-2 px-2 max-w-[200px] truncate" title={p.l.companyName || p.l.customerName}>{p.l.companyName || p.l.customerName}</td>
                  <td className="py-2 px-2">{p.project}</td>
                  <td className="py-2 px-2">{p.ownerName || '—'}</td>
                  <td className={`${TD} text-right`}>{p.value ? p.value.toLocaleString('en-US') : '—'}</td>
                  <td className="py-2 px-2"><span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${p.l.cashStatus === 'confirmed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{p.l.cashStatus === 'confirmed' ? 'Confirmed' : 'Pending'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {deals.length > 100 && <p className="text-[10px] text-brand-gray mt-2">Showing the latest 100 of {deals.length}. Export for the full list.</p>}
        </div>
      </Card>

      {/* people */}
      {manager && (
        <Card title="Salesperson performance" info="One row per owner, over the leads in the period. Conversion = won ÷ the person's leads; win rate = won ÷ contacted. Pipeline = value of the person's open leads that carry a value. Avg cycle = mean (won date − lead date).">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-brand-gray/15">
                {['Salesperson', 'Leads', 'Reached', 'Qualified', 'Offer / meeting', 'Won', 'Lost', 'Conversion', 'Revenue', 'Pipeline', 'Avg deal', 'Avg cycle'].map((h, i) => <th key={h} className={`${TH} ${i ? 'text-right' : ''}`}>{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-brand-gray/10 font-semibold text-brand-black">
                {A.byOwner.length === 0 && <tr><td colSpan={12} className="py-6 text-center text-brand-gray">No assigned leads in this period.</td></tr>}
                {[...A.byOwner].sort(byRevenue).map((b) => {
                  const g = b.agg; const cyc = mean(g.cycles);
                  return (
                    <tr key={b.key} className="hover:bg-brand-gray/5 cursor-pointer" onClick={() => setF({ ...f, owner: f.owner.includes(b.key) ? f.owner.filter((x) => x !== b.key) : [...f.owner, b.key] })} title="Click to filter the whole page by this person">
                      <td className="py-2 px-2 font-bold">{b.label}</td>
                      <td className={`${TD} text-right`}>{g.total}</td>
                      <td className={`${TD} text-right`}>{g.contacted} <span className="text-brand-gray">({fmtPct(pc(g.contacted, g.total))})</span></td>
                      <td className={`${TD} text-right`}>{g.qualified}</td>
                      <td className={`${TD} text-right`}>{g.opportunity}</td>
                      <td className={`${TD} text-right text-emerald-700`}>{g.won}</td>
                      <td className={`${TD} text-right`}>{g.lost}</td>
                      <td className={`${TD} text-right`}><Pill v={pc(g.won, g.total)} good={5} ok={1} dp={1} /></td>
                      <td className={`${TD} text-right`}>{g.wonWithValue ? fmtEGP(g.wonValue) : '—'}</td>
                      <td className={`${TD} text-right`}>{g.openWithValue ? fmtEGP(g.pipelineValue) : '—'}</td>
                      <td className={`${TD} text-right`}>{g.wonWithValue ? fmtEGP(g.wonValue / g.wonWithValue) : '—'}</td>
                      <td className={`${TD} text-right`}>{cyc == null ? '—' : `${Math.round(cyc)} d`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Open pipeline" info="Open leads (not Won, Lost, Not Interested, Low Budget, Wrong Number) by the furthest stage reached; 'Not contacted' leads carry no probability. Probability: contacted 5%, qualified 15%, offer or meeting 35%, negotiation 60%. Expected deals = open leads × probability. Values only include leads that carry a deal value.">
          <div className="space-y-2">
            {stageRows.map((s) => <BarRow key={s.name} label={s.name} value={s.n} max={openMax} right={`${s.n} · ${Math.round(s.w * 100)}%`} />)}
          </div>
          <div className="grid grid-cols-3 gap-3 text-center pt-2 border-t border-brand-gray/10">
            <div><p className="text-lg font-black font-mono">{t.open}</p><p className="text-[10px] text-brand-gray font-bold uppercase">Open leads</p></div>
            <div><p className="text-lg font-black font-mono">{t.weightedCount.toFixed(1)}</p><p className="text-[10px] text-brand-gray font-bold uppercase">Expected deals</p></div>
            <div><p className="text-lg font-black font-mono">{t.openWithValue ? fmtEGP(t.weightedValue) : '—'}</p><p className="text-[10px] text-brand-gray font-bold uppercase">Weighted value</p></div>
          </div>
          <p className="text-[10px] text-brand-gray">{t.openWithValue} of {t.open} open leads carry a value ({t.openWithValue ? fmtEGP(t.pipelineValue) : '—'} unweighted); the rest are counted but add no value.</p>
        </Card>

        <Card title="Why we lose" info="Reason on the lost lead (the team's list). Not Interested and Low Budget leads without a reason are listed under their status. 'Not recorded' = Lost with no reason typed. Percent is of all lost leads in the period.">
          <div className="space-y-2">
            {A.byReason.length === 0 && <p className="text-brand-gray text-center py-6">No lost leads in this period.</p>}
            {A.byReason.slice(0, 12).map((r) => <BarRow key={r.key} label={r.key} value={r.count} max={maxLost} color="#455A64" right={`${r.count} · ${fmtPct(pc(r.count, lostTotal))}`} />)}
          </div>
          {A.byReason.some((r) => r.value > 0) && <p className="text-[10px] text-brand-gray">Value lost where a deal value is recorded: {fmtEGP(A.byReason.reduce((s, r) => s + r.value, 0))}.</p>}
        </Card>
      </div>

      {/* speed */}
      <Card title="Speed to first contact" info="Wait = first-contact time − lead date. Bands: up to 1 day, up to 2 days, up to 7 days, longer. 'Never contacted' = open lead with an owner and no first-contact stamp, no contact date, no offer or meeting and still in New / Assigned. Bands are measured only on leads with a first-contact time.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Same or next day', A.speed.bands.same], ['Within two days', A.speed.bands.two], ['Inside a week', A.speed.bands.week], ['More than a week', A.speed.bands.more],
          ].map(([l, n]) => (
            <div key={String(l)} className="border border-brand-gray/15 rounded-xl p-3 text-center">
              <p className="text-lg font-black font-mono">{n as number}</p>
              <p className="text-[10px] text-brand-gray font-bold uppercase">{l}</p>
              <p className="text-[10px] text-brand-gray">{fmtPct(pc(n as number, A.speed.measured))}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-brand-gray">Never contacted: {neverContacted} (open leads with an owner and no sign anybody worked them). Leads measured: {A.speed.measured}.</p>
      </Card>

      {/* monthly */}
      {trend.unit === 'month' && trend.rows.length >= 2 && (
        <Card title="Month by month" info="Leads = lead date in the month. Reached = of those leads, contacted. Won = closing date in the month. Lost = lost leads by their lead date. Conversion = won ÷ leads of the month; growth is against the previous month.">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-brand-gray/15">{['Month', 'Leads', 'Growth', 'Reached', 'Won', 'Revenue', 'Lost', 'Conversion'].map((h, i) => <th key={h} className={`${TH} ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-brand-gray/10 font-semibold">
                {[...trend.rows].reverse().slice(0, 36).map((r, i, arr) => {
                  const prevRow = arr[i + 1];
                  const g = prevRow ? (prevRow.leads === 0 ? (r.leads > 0 ? 'new' : '—') : `${Math.round(((r.leads - prevRow.leads) / prevRow.leads) * 100)}%`) : '—';
                  return (
                    <tr key={r.key}>
                      <td className="py-2 px-2 font-bold">{r.label}</td><td className={`${TD} text-right`}>{r.leads}</td><td className={`${TD} text-right text-brand-gray`}>{g}</td>
                      <td className={`${TD} text-right`}>{r.reached}</td><td className={`${TD} text-right text-emerald-700`}>{r.won}</td>
                      <td className={`${TD} text-right`}>{r.wonValue ? fmtEGP(r.wonValue) : '—'}</td><td className={`${TD} text-right`}>{r.lost}</td>
                      <td className={`${TD} text-right`}>{fmtPct(pc(r.won, r.leads), 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* sources and projects */}
      <Card title="Source performance" info="Marketing channels are every source except Personal, Management and BD Research (self-generated, tagged below). Conversion = won ÷ leads from that source; win rate = won ÷ contacted. Sorted by revenue, then leads.">
        <BreakTable rows={[...A.bySource].sort(byRevenue)} first="Source" cols={[{ head: 'Type', cell: (b) => <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${b.key !== 'Not recorded' && !isMarketingSource(b.key) ? 'bg-indigo-100 text-indigo-800' : 'bg-brand-gray/10 text-brand-gray'}`}>{b.key !== 'Not recorded' && !isMarketingSource(b.key) ? 'self-generated' : 'marketing'}</span> }, ...rateCols]} />
      </Card>
      <Card title="By project" info="Project name after fixing typos and website page names. 'Not recorded' = no usable project. Same column definitions as the source table.">
        <BreakTable rows={[...A.byProject].sort((a, b) => b.agg.total - a.agg.total)} first="Project" cols={rateCols} />
      </Card>

      {/* record quality */}
      <Card title={<>Record quality {health.score != null && <Pill v={health.score} good={85} ok={65} />}</>} info="How complete the lead records are, over ALL leads you can see (not the period). Each line is a % with its own threshold; the overall score is the average of the eight.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
          {health.rows.map((h) => (
            <div key={h.key} className="flex items-center gap-2 text-[11px]">
              <span className="w-52 font-bold text-brand-black flex items-center gap-1">{h.label}<InfoTip text={`${h.note}. Target ${h.good}% (acceptable ${h.ok}%). Based on ${h.of} leads.`} /></span>
              <div className="flex-1 h-2 bg-brand-gray/10 rounded-full overflow-hidden"><div className={`h-full rounded-full ${h.pct == null ? '' : h.pct >= h.good ? 'bg-emerald-500' : h.pct >= h.ok ? 'bg-amber-400' : 'bg-rose-500'}`} style={{ width: `${h.pct ?? 0}%` }} /></div>
              <span className="w-24 text-right font-mono font-bold text-brand-gray">{h.pct == null ? '—' : `${h.pct.toFixed(0)}%`} <span className="font-normal">({h.n})</span></span>
            </div>
          ))}
        </div>
      </Card>

      {/* SLA (leads that carry a deadline) */}
      <Card title="SLA compliance" info="Only leads that carry an SLA deadline are measured. Met = the owner's first action came on or before the deadline. Violated = it came after, or has not come and the deadline has passed. Pending = open, no action yet, deadline still ahead (left out of the rate). The 'Response & follow-up' tab explains the first action.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          <Kpi label="Compliance" value={fmtPct(sla.rate)} info="Met ÷ (met + violated)." />
          <Kpi label="Met" value={sla.met} info="First action on time." tone="text-emerald-600" />
          <Kpi label="Violated" value={sla.viol} info="First action late or missing past the deadline." tone="text-rose-600" />
          <Kpi label="Pending" value={sla.pending} info="Deadline still ahead, no action yet." />
        </div>
      </Card>
      </>)}
    </div>
  );
};

