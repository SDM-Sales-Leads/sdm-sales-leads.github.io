// Extra Sales Report tabs: funnel & aging, trend, win / loss, channels & sources, demand, service & follow-up, forecast.
// Every tab works on the period pool prepared once in CrmReports (so a tab switch costs one O(n) pass at most).
import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SalespersonActivity } from './types';
import { P, Range, fmtDay, fmtEGP, fmtPct, pc } from './leadMetrics';
import { BarRow, Card, Kpi, Pill } from './CrmMetricsUi';
import { crmNav } from './crmNav';
import { DrillNum } from './DrillNum';
import { DataTable, Column, ExportBar, MiniBar, TD, TH, fmtHours, num } from './ReportParts';
import {
  Group, Tally, TrendUnit, activityIndex, agingOf, avgDealOf, byLeadsDesc, channelReport, convOf, decidedWinOf, forecastOf,
  funnelCohort, groupBy, industryOf, lostAnalysis, projectDemand, serviceReport, sizeDemand, statusMix, trendOf,
} from './reportsEngine';

export interface ReportCtx {
  pool: P[];            // leads of the period (lead date in the window, or won in the window)
  openAll: P[];         // open leads right now, owner / source filter applied, ignoring the period
  range: Range; allTime: boolean; today: string; nowMs: number;
  acts: SalespersonActivity[];
  manager: boolean;
  periodNote: string;
}
const P0 = 'Leads of the period = lead date inside the window, plus deals won inside it. ';

const tallyCols = (first: string): Column<Group>[] => [
  { id: 'k', head: first, sort: (g) => g.label, cell: (g) => <span className="font-bold max-w-[220px] truncate inline-block align-bottom" title={g.label}>{g.label}</span> },
  { id: 'leads', head: 'Leads', right: true, sort: (g) => g.t.leads, cell: (g) => <DrillNum n={g.t.leads} ids={g.t.ids?.leads} title={`${g.label} · Leads`} /> },
  { id: 'won', head: 'Won', right: true, sort: (g) => g.t.won, cell: (g) => <DrillNum n={g.t.won} ids={g.t.ids?.won} title={`${g.label} · Won`} className="text-emerald-700" /> },
  { id: 'lost', head: 'Lost', info: 'Lost, Not Interested and Low Budget.', right: true, sort: (g) => g.t.lost, cell: (g) => <DrillNum n={g.t.lost} ids={g.t.ids?.lost} title={`${g.label} · Lost`} /> },
  { id: 'conv', head: 'Conversion', info: 'Won ÷ leads of this row (open leads included).', right: true, sort: (g) => convOf(g.t), cell: (g) => <Pill v={convOf(g.t)} good={5} ok={1} dp={1} /> },
  { id: 'dec', head: 'Win rate (decided)', info: 'Won ÷ (won + lost). Leads still open are left out, so a young period is not punished.', right: true, sort: (g) => decidedWinOf(g.t), cell: (g) => <Pill v={decidedWinOf(g.t)} good={30} ok={15} dp={0} /> },
  { id: 'val', head: 'Won value', right: true, sort: (g) => (g.t.wonWithValue ? g.t.wonValue : null), cell: (g) => (g.t.wonWithValue ? fmtEGP(g.t.wonValue) : '—') },
  { id: 'avg', head: 'Avg deal', info: 'Won value ÷ won deals that carry a value.', right: true, sort: (g) => avgDealOf(g.t), cell: (g) => fmtEGP(avgDealOf(g.t)) },
];
const tallyRow = (g: Group) => [g.label, g.t.leads, g.t.won, g.t.lost, convOf(g.t) == null ? '' : Number(convOf(g.t)!.toFixed(1)), decidedWinOf(g.t) == null ? '' : Number(decidedWinOf(g.t)!.toFixed(1)), g.t.wonWithValue ? Math.round(g.t.wonValue) : '', avgDealOf(g.t) == null ? '' : Math.round(avgDealOf(g.t)!)];
type PG = Group & { sizes: number[] };
const TALLY_HEAD = ['Leads', 'Won', 'Lost', 'Conversion %', 'Win rate (decided) %', 'Won value (EGP)', 'Avg deal (EGP)'];

// ---------------------------------------------------------------------------------------------
export const FunnelAgingTab: React.FC<{ c: ReportCtx }> = ({ c }) => {
  const F = useMemo(() => funnelCohort(c.pool, c.range, c.allTime), [c.pool, c.range, c.allTime]);
  const mix = useMemo(() => statusMix(c.pool), [c.pool]);
  const AG = useMemo(() => agingOf(c.openAll, c.today), [c.openAll, c.today]);
  const max0 = F.steps[0]?.n || 1;
  const ageMax = Math.max(1, ...AG.age.map((r) => r.n));
  const idleMax = Math.max(1, ...AG.idle.map((r) => r.n), AG.never.n, AG.noTouch.n);
  return (
    <div className="space-y-6">
      <Card title="Funnel by stage" info={`${P0}Cohort = leads whose lead date is in the window. Each lead counts once for every stage up to the furthest it reached (Reached = contacted or any later stage; Qualified; Offer or meeting; Negotiation; Won). 'Carried' = this stage ÷ the previous stage. 'Dropped' = previous stage − this stage. 'Lost here' = leads that were lost while their furthest stage was this one.`}
        right={<ExportBar name="funnel" sheets={() => [
          { name: 'Funnel', rows: [['Stage', 'Leads', '% of all', '% carried from previous', 'Dropped', 'Lost at this stage'], ...F.steps.map((s) => [s.name, s.n, s.ofAll == null ? '' : Number(s.ofAll.toFixed(1)), s.carried == null ? '' : Number(s.carried.toFixed(1)), s.dropped, s.lostHere])] },
          { name: 'Statuses', rows: [['Status', 'Leads', 'Value (EGP)', 'Leads with value'], ...mix.map((m) => [m.status, m.n, Math.round(m.value), m.withValue])] },
        ]} />}>
        {F.cohort === 0 ? <p className="text-center text-brand-gray py-6">No leads in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-brand-gray/15">{['Stage', '', 'Leads', '% of all', 'Carried', 'Dropped', 'Lost here'].map((h, i) => <th key={i} className={`${TH} ${i > 1 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-brand-gray/10 font-semibold text-brand-black">
                {F.steps.map((s) => (
                  <tr key={s.name}>
                    <td className="py-2 px-2 font-bold whitespace-nowrap">{s.name}</td>
                    <td className="py-2 px-2 w-1/3"><div className="h-2 bg-brand-gray/10 rounded-full overflow-hidden"><div className="h-full rounded-full bg-brand-red" style={{ width: `${Math.max(1, (s.n / max0) * 100)}%` }} /></div></td>
                    <td className={`${TD} text-right`}>{num(s.n)}</td><td className={`${TD} text-right`}>{fmtPct(s.ofAll)}</td>
                    <td className={`${TD} text-right`}>{fmtPct(s.carried)}</td><td className={`${TD} text-right text-rose-600`}>{s.dropped ? `−${num(s.dropped)}` : '—'}</td>
                    <td className={`${TD} text-right`}>{s.lostHere ? num(s.lostHere) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-brand-gray mt-2">{num(F.cohort)} leads in the cohort. Leads still open at a stage are neither dropped nor lost yet.</p>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Where the leads are now" info={`${P0}Current status of each lead. Value only for leads that carry a deal value.`}>
          <DataTable rows={mix} rowKey={(m) => m.status} limit={20} cols={[
            { id: 's', head: 'Status', sort: (m) => m.status, cell: (m) => <span className="font-bold">{m.status}</span> },
            { id: 'n', head: 'Leads', right: true, sort: (m) => m.n, cell: (m) => <DrillNum n={m.n} ids={c.pool.filter((p) => p.l.status === m.status).map((p) => p.id)} title={`Status: ${m.status}`} /> },
            { id: 'p', head: '%', right: true, cell: (m) => fmtPct(pc(m.n, c.pool.length)) },
            { id: 'v', head: 'Value', right: true, sort: (m) => (m.withValue ? m.value : null), cell: (m) => (m.withValue ? fmtEGP(m.value) : '—') },
          ]} defaultSort={{ id: 'n', dir: 'desc' }} />
        </Card>
        <Card title="Lead aging (open leads)" info="Open leads right now (not period-filtered; owner and source filters apply). Age = today − lead date. 'Since last touch' = today − the last contact date (else first contact). 'Never touched' = no contact date and no sign anybody worked the lead.">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-lg font-black font-mono">{num(c.openAll.length)}</p><p className="text-[10px] text-brand-gray font-bold uppercase">Open leads</p></div>
            <div><p className="text-lg font-black font-mono">{AG.avgAge == null ? '—' : `${Math.round(AG.avgAge)} d`}</p><p className="text-[10px] text-brand-gray font-bold uppercase">Average age</p></div>
            <div><p className="text-lg font-black font-mono">{AG.medianAge == null ? '—' : `${Math.round(AG.medianAge)} d`}</p><p className="text-[10px] text-brand-gray font-bold uppercase">Median age</p></div>
          </div>
          <p className="text-[10px] uppercase font-bold text-brand-gray">Age of the lead</p>
          <div className="space-y-2">{AG.age.map((r) => <BarRow key={r.key} label={r.label} value={r.n} max={ageMax} right={`${num(r.n)} · ${r.withValue ? fmtEGP(r.value) : '—'}`} />)}
            {AG.noDate.n > 0 && <BarRow label={AG.noDate.label} value={AG.noDate.n} max={ageMax} color="#9E9E9E" />}</div>
          <p className="text-[10px] uppercase font-bold text-brand-gray pt-2">Since the last touch</p>
          <div className="space-y-2">{AG.idle.map((r) => <BarRow key={r.key} label={r.label} value={r.n} max={idleMax} color="#455A64" right={num(r.n)} />)}
            <BarRow label={AG.never.label} value={AG.never.n} max={idleMax} color="#E64A19" right={num(AG.never.n)} />
            {AG.noTouch.n > 0 && <BarRow label="Worked, no contact date" value={AG.noTouch.n} max={idleMax} color="#9E9E9E" right={num(AG.noTouch.n)} />}</div>
        </Card>
      </div>
      <ExportBarAging c={c} AG={AG} />
    </div>
  );
};
const ExportBarAging: React.FC<{ c: ReportCtx; AG: ReturnType<typeof agingOf> }> = ({ c, AG }) => (
  <div className="flex items-center justify-end gap-2 text-[10px] text-brand-gray">Aging table:
    <ExportBar name="lead-aging" sheets={() => [{ name: 'Aging', rows: [['Band', 'Open leads', 'Value (EGP)', 'Leads with value'], ...AG.age.map((r) => ['Age ' + r.label, r.n, Math.round(r.value), r.withValue]), ...AG.idle.map((r) => ['Last touch: ' + r.label, r.n, Math.round(r.value), r.withValue]), [AG.never.label, AG.never.n, Math.round(AG.never.value), AG.never.withValue], ['No lead date', AG.noDate.n, Math.round(AG.noDate.value), AG.noDate.withValue]] }]} disabled={!c.openAll.length} />
  </div>
);

// ---------------------------------------------------------------------------------------------
export const TrendTab: React.FC<{ c: ReportCtx }> = ({ c }) => {
  const [unit, setUnit] = useState<TrendUnit | 'auto'>('auto');
  const T = useMemo(() => trendOf(c.pool, c.range, c.allTime, c.today, unit), [c.pool, c.range, c.allTime, c.today, unit]);
  const tot = useMemo(() => T.rows.reduce((a, r) => ({ leads: a.leads + r.leads, won: a.won + r.won, value: a.value + r.wonValue, lost: a.lost + r.lost }), { leads: 0, won: 0, value: 0, lost: 0 }), [T]);
  const span = T.rows.length;
  const perDay = span ? tot.leads / span : null;
  const sel = 'bg-white border border-brand-gray/20 rounded-xl px-3 py-1.5 text-xs font-bold text-brand-black';
  return (
    <div className="space-y-6">
      <Card title="Leads created over time" info={`${P0}Leads = lead date in the bucket. Reached = of those leads, contacted. Won = closing date in the bucket (so a deal can fall in a later bucket than its lead). Lost = lost leads by their lead date. Weeks start on Sunday.`}
        right={<div className="flex items-center gap-2">
          <select value={unit} onChange={(e) => setUnit(e.target.value as TrendUnit | 'auto')} className={sel} aria-label="Group by">
            <option value="auto">Group: automatic</option><option value="day">Per day</option><option value="week">Per week</option><option value="month">Per month</option>
          </select>
          <ExportBar name={`leads-per-${T.unit}`} sheets={() => [{ name: 'Trend', rows: [[T.unit === 'day' ? 'Day' : T.unit === 'week' ? 'Week starting' : 'Month', 'Leads', 'Reached', 'Won', 'Won value (EGP)', 'Lost'], ...T.rows.map((r) => [r.key, r.leads, r.reached, r.won, Math.round(r.wonValue), r.lost])] }]} disabled={!T.rows.length} />
        </div>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Leads" value={num(tot.leads)} info="Leads with a lead date inside the shown range." />
          <Kpi label={`Average per ${T.unit}`} value={perDay == null ? '—' : perDay.toFixed(1)} info={`Leads ÷ number of ${T.unit}s shown (quiet ${T.unit}s count as zero).`} />
          <Kpi label="Won" value={num(tot.won)} info="Deals with a closing date inside the shown range." tone="text-emerald-600" />
          <Kpi label="Won value" value={tot.won ? fmtEGP(tot.value) : '—'} info="Deal value of those deals." />
        </div>
        {T.rows.length < 2 ? <p className="text-center text-brand-gray py-6">Not enough data for a trend.</p> : (
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={T.rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="leads" name="Leads" fill="#D32F2F" radius={[3, 3, 0, 0]} /><Bar dataKey="won" name="Won" fill="#388E3C" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <details className="text-xs"><summary className="cursor-pointer font-bold text-brand-gray text-[10px] uppercase">Table</summary>
          <div className="mt-2"><DataTable rows={[...T.rows].reverse()} rowKey={(r) => r.key} limit={40} cols={[
            { id: 'k', head: T.unit === 'week' ? 'Week from' : T.unit === 'day' ? 'Day' : 'Month', sort: (r) => r.key, cell: (r) => (T.unit === 'month' ? r.label : fmtDay(r.key)) },
            { id: 'l', head: 'Leads', right: true, sort: (r) => r.leads, cell: (r) => r.leads },
            { id: 'r', head: 'Reached', right: true, sort: (r) => r.reached, cell: (r) => `${r.reached} (${fmtPct(pc(r.reached, r.leads))})` },
            { id: 'w', head: 'Won', right: true, sort: (r) => r.won, cell: (r) => r.won },
            { id: 'v', head: 'Won value', right: true, sort: (r) => r.wonValue, cell: (r) => (r.wonValue ? fmtEGP(r.wonValue) : '—') },
            { id: 'x', head: 'Lost', right: true, sort: (r) => r.lost, cell: (r) => r.lost },
          ]} /></div>
        </details>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
export const WinLossTab: React.FC<{ c: ReportCtx }> = ({ c }) => {
  const L = useMemo(() => lostAnalysis(c.pool), [c.pool]);
  const T = useMemo(() => { const g = groupBy(c.pool, c.range, c.allTime, () => 'all')[0]; return g?.t; }, [c.pool, c.range, c.allTime]);
  const bySrc = useMemo(() => groupBy(c.pool, c.range, c.allTime, (p) => p.source).filter((g) => g.t.won + g.t.lost > 0).sort((a, b) => (b.t.won + b.t.lost) - (a.t.won + a.t.lost)), [c.pool, c.range, c.allTime]);
  const max = Math.max(1, ...L.reasons.map((r) => r.n));
  const maxS = Math.max(1, ...L.byStage.map((r) => r.n));
  return (
    <div className="space-y-6">
      <Card title="Win rate" info={`${P0}Won = deals with a closing date in the window. Lost = Lost, Not Interested and Low Budget leads of the period. Win rate (decided) = won ÷ (won + lost); open leads are left out so a young period is not punished. Conversion = won ÷ all leads of the period.`}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi label="Won" value={T ? num(T.won) : '—'} info="Deals won inside the window." tone="text-emerald-600" />
          <Kpi label="Lost" value={T ? num(T.lost) : '—'} info="Lost, Not Interested and Low Budget leads." tone="text-rose-600" />
          <Kpi label="Win rate (decided)" value={T ? fmtPct(decidedWinOf(T), 1) : '—'} info="Won ÷ (won + lost)." />
          <Kpi label="Conversion" value={T ? fmtPct(convOf(T), 1) : '—'} info="Won ÷ all leads of the period (open leads included)." />
          <Kpi label="Value lost" value={L.reasons.some((r) => r.withValue) ? fmtEGP(L.reasons.reduce((s, r) => s + r.value, 0)) : '—'} sub="only leads with a value" info="Deal value of lost leads that carry one." />
        </div>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Lost-reason analysis" info="Reason typed on the lost lead (the team's list). Not Interested and Low Budget leads without a reason are listed under their status. 'Not recorded' = lost with no reason typed. Value and required area only where recorded."
          right={<ExportBar name="lost-reasons" sheets={() => [{ name: 'Lost reasons', rows: [['Reason', 'Leads', '% of lost', 'Value (EGP)', 'Leads with value', 'Required area (sqm)'], ...L.reasons.map((r) => [r.key, r.n, Number((pc(r.n, L.lost) ?? 0).toFixed(1)), Math.round(r.value), r.withValue, Math.round(r.area)])] }, { name: 'Lost by stage', rows: [['Furthest stage reached', 'Lost leads'], ...L.byStage.map((s) => [s.name, s.n])] }]} disabled={!L.lost} />}>
          {L.lost === 0 ? <p className="text-center text-brand-gray py-6">No lost leads in this period.</p> : (
            <>
              <DataTable rows={L.reasons} rowKey={(r) => r.key} limit={15} cols={[
                { id: 'r', head: 'Reason', sort: (r) => r.key, cell: (r) => <span className="font-bold">{r.key}</span> },
                { id: 'n', head: 'Leads', right: true, sort: (r) => r.n, cell: (r) => <DrillNum n={r.n} ids={r.ids} title={`Lost: ${r.key}`} /> },
                { id: 'p', head: '% of lost', right: true, sort: (r) => r.n, cell: (r) => fmtPct(pc(r.n, L.lost)) },
                { id: 'v', head: 'Value', right: true, sort: (r) => (r.withValue ? r.value : null), cell: (r) => (r.withValue ? fmtEGP(r.value) : '—') },
                { id: 'a', head: 'Area asked', right: true, sort: (r) => r.area || null, cell: (r) => (r.area ? `${num(r.area)} sqm` : '—') },
              ]} defaultSort={{ id: 'n', dir: 'desc' }} />
              {L.notRecorded > 0 && <p className="text-[10px] text-amber-700 font-semibold">{L.notRecorded} of {L.lost} lost leads ({fmtPct(pc(L.notRecorded, L.lost))}) have no reason recorded.</p>}
            </>
          )}
        </Card>
        <Card title="At which stage we lose them" info="Furthest funnel stage the lead had reached when it was lost.">
          <div className="space-y-2">{L.byStage.map((s) => <BarRow key={s.name} label={s.name} value={s.n} max={maxS} color="#455A64" right={`${s.n} · ${fmtPct(pc(s.n, L.lost))}`} />)}</div>
          {L.byOwner.length > 0 && c.manager && (<>
            <p className="text-[10px] uppercase font-bold text-brand-gray pt-2">Lost leads by salesperson</p>
            <div className="space-y-2">{L.byOwner.slice(0, 8).map((o) => <BarRow key={o.key} label={o.key} value={o.n} max={L.byOwner[0].n} color="#7B1FA2" right={`${o.n}`} />)}</div>
          </>)}
        </Card>
      </div>
      <Card title="Win rate by source" info="Only sources that have at least one won or lost lead. Win rate = won ÷ (won + lost).">
        <DataTable rows={bySrc} rowKey={(g) => g.key} cols={tallyCols('Source')} defaultSort={{ id: 'leads', dir: 'desc' }} />
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
export const ChannelsTab: React.FC<{ c: ReportCtx }> = ({ c }) => {
  const R = useMemo(() => channelReport(c.pool, c.range, c.allTime), [c.pool, c.range, c.allTime]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [mx, setMx] = useState<'leads' | 'won'>('leads');
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const head = (
    <tr className="border-b border-brand-gray/15">{['Channel / source', 'Leads', 'Share', 'Won', 'Lost', 'Conversion', 'Win rate (decided)', 'Won value', 'Avg deal'].map((h, i) => <th key={h} className={`${TH} ${i ? 'text-right' : ''}`}>{h}</th>)}</tr>
  );
  const cells = (t: Tally, total: number) => (<>
    <td className={`${TD} text-right`}>{num(t.leads)}</td><td className={`${TD} text-right text-brand-gray`}>{fmtPct(pc(t.leads, total))}</td>
    <td className={`${TD} text-right text-emerald-700`}>{num(t.won)}</td><td className={`${TD} text-right`}>{num(t.lost)}</td>
    <td className={`${TD} text-right`}><Pill v={convOf(t)} good={5} ok={1} dp={1} /></td><td className={`${TD} text-right`}><Pill v={decidedWinOf(t)} good={30} ok={15} /></td>
    <td className={`${TD} text-right`}>{t.wonWithValue ? fmtEGP(t.wonValue) : '—'}</td><td className={`${TD} text-right`}>{fmtEGP(avgDealOf(t))}</td>
  </>);
  const total = c.pool.length;
  const exportSheets = () => [
    { name: 'Channels & sources', rows: [['Channel', 'Source', ...TALLY_HEAD], ...R.rows.flatMap((ch) => [[ch.key, 'ALL SOURCES', ...tallyRow({ key: ch.key, label: ch.key, t: ch.t }).slice(1)], ...ch.sources.map((s) => [ch.key, s.label, ...tallyRow(s).slice(1)])])] },
    { name: 'Source x channel (leads)', rows: [['Source', ...R.rows.map((r) => r.key), 'Total'], ...R.sources.map((s) => [s, ...R.rows.map((r) => R.cell(r.key, s)?.leads || 0), R.rows.reduce((a, r) => a + (R.cell(r.key, s)?.leads || 0), 0)])] },
    { name: 'Source x channel (won)', rows: [['Source', ...R.rows.map((r) => r.key), 'Total'], ...R.sources.map((s) => [s, ...R.rows.map((r) => R.cell(r.key, s)?.won || 0), R.rows.reduce((a, r) => a + (R.cell(r.key, s)?.won || 0), 0)])] },
  ];
  const colMax = (k: string) => Math.max(1, ...R.sources.map((s) => (R.cell(k, s)?.[mx]) || 0));
  return (
    <div className="space-y-6">
      <Card title="Channels & sources" info={`${P0}CHANNEL (main) = where the lead reached us: Mobile App, Call Center, Facebook Leads, Walk-in. When a lead has no channel typed it is derived from the source where that is certain (Walk-In, Mobile App, Facebook / Instagram forms); otherwise 'Not set'. SOURCE (sub) = what the customer says brought them (Website, Billboard, Google SEM, Referral…). Won counts deals closed in the window. Conversion = won ÷ leads; win rate = won ÷ (won + lost). Open a channel to see its sources.`}
        right={<ExportBar name="channels-sources" sheets={exportSheets} disabled={!total} />}>
        {total === 0 ? <p className="text-center text-brand-gray py-6">No leads in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>{head}</thead>
              <tbody className="font-semibold text-brand-black">
                {R.rows.map((ch) => (
                  <React.Fragment key={ch.key}>
                    <tr className="border-t border-brand-gray/15 bg-brand-gray/5 hover:bg-brand-gray/10 cursor-pointer" onClick={() => toggle(ch.key)}>
                      <td className="py-2 px-2 font-extrabold whitespace-nowrap"><span className="inline-flex items-center gap-1">{open.has(ch.key) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{ch.key}<span className="text-[10.5px] text-brand-gray font-bold">({ch.sources.length} sources)</span></span></td>
                      {cells(ch.t, total)}
                    </tr>
                    {open.has(ch.key) && ch.sources.map((s) => (
                      <tr key={s.key} className="border-t border-brand-gray/10">
                        <td className="py-1.5 pl-9 pr-2 text-brand-black/80 whitespace-nowrap">{s.label}</td>{cells(s.t, ch.t.leads)}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-brand-gray mt-2">Share of a channel = of all leads; share of a source = of its channel.</p>
          </div>
        )}
      </Card>
      <Card title="Source by channel" info="Each cell = leads (or won deals) of that source that came through that channel. Darker = more."
        right={<select value={mx} onChange={(e) => setMx(e.target.value as 'leads' | 'won')} className="bg-white border border-brand-gray/20 rounded-xl px-3 py-1.5 text-xs font-bold" aria-label="Matrix measure"><option value="leads">Leads</option><option value="won">Won deals</option></select>}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead><tr className="border-b border-brand-gray/15"><th className={TH}>Source</th>{R.rows.map((r) => <th key={r.key} className={`${TH} text-right`}>{r.key}</th>)}<th className={`${TH} text-right`}>Total</th></tr></thead>
            <tbody className="divide-y divide-brand-gray/10 font-semibold">
              {R.sources.map((s) => {
                let sum = 0;
                return (
                  <tr key={s}>
                    <td className="py-1.5 px-2 font-bold whitespace-nowrap">{s}</td>
                    {R.rows.map((r) => {
                      const v = R.cell(r.key, s)?.[mx] || 0; sum += v;
                      return <td key={r.key} className="py-1.5 px-2 text-right font-mono" style={{ background: v ? `rgba(211,47,47,${0.08 + 0.45 * (v / colMax(r.key))})` : undefined }}>{v || '·'}</td>;
                    })}
                    <td className="py-1.5 px-2 text-right font-mono font-black">{sum}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
export const DemandTab: React.FC<{ c: ReportCtx }> = ({ c }) => {
  const prj = useMemo(() => projectDemand(c.pool, c.range, c.allTime), [c.pool, c.range, c.allTime]);
  const sz = useMemo(() => sizeDemand(c.pool, c.range, c.allTime), [c.pool, c.range, c.allTime]);
  const ind = useMemo(() => groupBy(c.pool, c.range, c.allTime, (p) => industryOf(p.l)).sort(byLeadsDesc), [c.pool, c.range, c.allTime]);
  const maxP = Math.max(1, ...prj.map((g) => g.t.leads));
  const maxS = Math.max(1, ...sz.map((g) => g.t.leads));
  const maxI = Math.max(1, ...ind.map((g) => g.t.leads));
  const med = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return (
    <div className="space-y-6">
      <Card title="Project demand" info={`${P0}Project name after fixing typos; 'Not recorded' = none usable. Won value = deals closed in the window. Median size = median of the required area typed on those leads (only leads that have one).`}
        right={<ExportBar name="project-demand" sheets={() => [{ name: 'Projects', rows: [['Project', ...TALLY_HEAD, 'Median required size (sqm)'], ...prj.map((g) => [...tallyRow(g), med(g.sizes) ?? ''])] }]} disabled={!prj.length} />}>
        <div className="space-y-2">{prj.slice(0, 10).map((g) => <BarRow key={g.key} onClick={() => crmNav.leads({ ids: g.t.ids?.leads || [], title: `${g.label} · Leads` })} label={g.label} value={g.t.leads} max={maxP} right={`${num(g.t.leads)} · ${g.t.won} won`} />)}</div>
        <DataTable rows={prj} rowKey={(g) => g.key} limit={20} cols={[...(tallyCols('Project') as Column<PG>[]), { id: 'med', head: 'Median size', info: 'Median required area on the leads of this project (leads with an area only).', right: true, sort: (g) => med(g.sizes), cell: (g) => { const m = med(g.sizes); return m == null ? '—' : `${num(m)} sqm`; } }] as Column<PG>[]} defaultSort={{ id: 'leads', dir: 'desc' }} />
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Plot-size demand" info={`${P0}Required area typed on the lead, in bands. 'Size not recorded' = none typed. Won value = deals closed in the window.`}
          right={<ExportBar name="plot-size-demand" sheets={() => [{ name: 'Plot size', rows: [['Required size', ...TALLY_HEAD], ...sz.map(tallyRow)] }]} disabled={!sz.length} />}>
          <div className="space-y-2">{sz.map((g) => <BarRow key={g.key} onClick={() => crmNav.leads({ ids: g.t.ids?.leads || [], title: `${g.label} · Leads` })} label={g.label} value={g.t.leads} max={maxS} color={g.key === 'Size not recorded' ? '#9E9E9E' : '#D32F2F'} right={`${num(g.t.leads)} · ${g.t.won} won`} />)}</div>
          <DataTable rows={sz} rowKey={(g) => g.key} cols={tallyCols('Required size').filter((x) => ['k', 'leads', 'won', 'conv', 'val'].includes(x.id))} />
        </Card>
        <Card title="Industry" info={`${P0}Industry typed on the lead (spelling / capital letters merged). 'Not recorded' = none typed.`}
          right={<ExportBar name="industry" sheets={() => [{ name: 'Industry', rows: [['Industry', ...TALLY_HEAD], ...ind.map(tallyRow)] }]} disabled={!ind.length} />}>
          <div className="space-y-2">{ind.slice(0, 10).map((g) => <BarRow key={g.key} onClick={() => crmNav.leads({ ids: g.t.ids?.leads || [], title: `${g.label} · Leads` })} label={g.label} value={g.t.leads} max={maxI} color="#1976D2" right={`${num(g.t.leads)} · ${g.t.won} won`} />)}</div>
          <DataTable rows={ind} rowKey={(g) => g.key} limit={15} cols={tallyCols('Industry').filter((x) => ['k', 'leads', 'won', 'conv', 'val'].includes(x.id))} defaultSort={{ id: 'leads', dir: 'desc' }} />
        </Card>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
export const ServiceTab: React.FC<{ c: ReportCtx }> = ({ c }) => {
  const idx = useMemo(() => activityIndex(c.acts), [c.acts]);
  const S = useMemo(() => serviceReport(c.pool, c.openAll, idx, c.today, c.nowMs), [c.pool, c.openAll, idx, c.today, c.nowMs]);
  const maxB = Math.max(1, ...S.bands.map((b) => b.n), S.noAction);
  const maxO = Math.max(1, ...S.followup.overdueBands.map((b) => b.n));
  const sheets = () => [
    { name: 'By salesperson', rows: [['Salesperson', 'Leads measured', 'Avg first action (h)', 'Median first action (h)', 'SLA met', 'SLA breached', 'Open leads now', 'Overdue follow-ups', 'No next step'], ...S.byOwner.map((o) => [o.name, o.measured, o.avgH == null ? '' : Number(o.avgH.toFixed(1)), o.medianH == null ? '' : Number(o.medianH.toFixed(1)), o.met, o.breached, o.openN, o.overdue, o.noNext])] },
    { name: 'Overdue follow-ups', rows: [['Lead', 'Client', 'Salesperson', 'Days overdue'], ...S.followup.oldestOverdue.map((o) => [o.id, o.name, o.owner, o.days])] },
  ];
  return (
    <div className="space-y-6">
      <Card title="Response time and SLA" info={`${P0}Response time = time from the moment the current owner got the lead (assignment time; else the lead date when it has a time) to their FIRST ACTION: first contact stamp, a logged call / WhatsApp / meeting / visit / e-mail, or a note / status change of theirs. Leads where no start time or no action exists are not measured. SLA: only leads that carry an SLA deadline. Met = first action on or before the deadline; breached = after it, or no action yet and the deadline has passed; pending = deadline still ahead.`}
        right={<ExportBar name="service-sla" sheets={sheets} disabled={!c.pool.length} />}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi label="Average response" value={fmtHours(S.avgHours)} sub={`${num(S.measured)} leads measured`} info="Mean time to first action over the measured leads." />
          <Kpi label="Median response" value={fmtHours(S.medianHours)} info="Half of the leads were handled faster than this." />
          <Kpi label="SLA compliance" value={fmtPct(S.sla.rate)} sub={`${S.sla.met} met · ${S.sla.breached} breached`} info="Met ÷ (met + breached). Pending leads are left out." />
          <Kpi label="SLA pending" value={num(S.sla.pending)} info="Open leads with a deadline still ahead and no action yet." />
          <Kpi label="No action yet" value={num(S.noAction)} info="Open leads of the period with an owner but no first action recorded (or no start time)." tone="text-rose-600" />
        </div>
        <p className="text-[10px] uppercase font-bold text-brand-gray">Time to first action</p>
        <div className="space-y-2">{S.bands.map((b) => <BarRow key={b.label} label={b.label} value={b.n} max={maxB} color="#455A64" right={`${num(b.n)} · ${fmtPct(pc(b.n, S.measured))}`} />)}
          <BarRow label="No action yet" value={S.noAction} max={maxB} color="#E64A19" right={num(S.noAction)} /></div>
      </Card>
      <Card title="Follow-up discipline" info="Open leads right now (owner and source filters apply, period ignored). Overdue = next follow-up date before today. 'No next step' = no follow-up date set. Days late = today − follow-up date.">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi label="Open leads" value={num(S.followup.open)} info="Open leads that have an owner." />
          <Kpi label="Overdue" value={num(S.followup.overdue)} sub={fmtPct(pc(S.followup.overdue, S.followup.open)) + ' of open'} info="Follow-up date is in the past." tone="text-rose-600" />
          <Kpi label="Due today" value={num(S.followup.today)} info="Follow-up date is today." tone="text-amber-600" />
          <Kpi label="Upcoming" value={num(S.followup.upcoming)} info="Follow-up date is after today." />
          <Kpi label="No next step" value={num(S.followup.noDate)} sub={fmtPct(pc(S.followup.noDate, S.followup.open)) + ' of open'} info="Open leads with no follow-up date." />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-2"><p className="text-[10px] uppercase font-bold text-brand-gray">How late</p>
            {S.followup.overdueBands.map((b) => <BarRow key={b.label} label={b.label} value={b.n} max={maxO} color="#D32F2F" right={num(b.n)} />)}</div>
          <div><p className="text-[10px] uppercase font-bold text-brand-gray mb-1">Longest overdue</p>
            <DataTable rows={S.followup.oldestOverdue} rowKey={(o) => o.id} limit={10} empty="Nothing overdue." cols={[
              { id: 'i', head: 'Lead', cell: (o) => <span className="font-mono text-brand-red">{o.id}</span> },
              { id: 'n', head: 'Client', cell: (o) => <span className="max-w-[160px] truncate inline-block align-bottom" title={o.name}>{o.name}</span> },
              { id: 'o', head: 'Salesperson', cell: (o) => o.owner },
              { id: 'd', head: 'Days late', right: true, cell: (o) => o.days },
            ]} /></div>
        </div>
      </Card>
      {c.manager && (
        <Card title="By salesperson" info="Response time over the period's leads; follow-up figures over their open leads right now.">
          <DataTable rows={S.byOwner} rowKey={(o) => o.key} defaultSort={{ id: 'od', dir: 'desc' }} cols={[
            { id: 'n', head: 'Salesperson', sort: (o) => o.name, cell: (o) => <span className="font-bold">{o.name}</span> },
            { id: 'm', head: 'Measured', right: true, sort: (o) => o.measured, cell: (o) => o.measured },
            { id: 'a', head: 'Avg response', right: true, sort: (o) => o.avgH, cell: (o) => fmtHours(o.avgH) },
            { id: 'md', head: 'Median', right: true, sort: (o) => o.medianH, cell: (o) => fmtHours(o.medianH) },
            { id: 'sm', head: 'SLA met', right: true, sort: (o) => o.met, cell: (o) => o.met },
            { id: 'sb', head: 'SLA breached', right: true, sort: (o) => o.breached, cell: (o) => <span className={o.breached ? 'text-rose-600' : ''}>{o.breached}</span> },
            { id: 'op', head: 'Open now', right: true, sort: (o) => o.openN, cell: (o) => o.openN },
            { id: 'od', head: 'Overdue', right: true, sort: (o) => o.overdue, cell: (o) => <span className={o.overdue ? 'text-rose-600' : ''}>{o.overdue}</span> },
            { id: 'nn', head: 'No next step', right: true, sort: (o) => o.noNext, cell: (o) => o.noNext },
          ]} />
        </Card>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
export const ForecastTab: React.FC<{ c: ReportCtx }> = ({ c }) => {
  const F = useMemo(() => forecastOf(c.openAll, c.today), [c.openAll, c.today]);
  const max = Math.max(1, ...F.rows.map((r) => r.weighted));
  return (
    <Card title="Expected-closing forecast" info="Open leads right now (owner and source filters apply, period ignored), grouped by the month of their expected closing date. Expected deals = leads × stage probability (contacted 5%, qualified 15%, offer or meeting 35%, negotiation 60%). Weighted value = deal value × the same probability; only leads that carry a deal value add value. Leads without an expected date are shown on their own line, not guessed into a month."
      right={<ExportBar name="closing-forecast" sheets={() => [{ name: 'Forecast', rows: [['Expected closing', 'Open leads', 'Expected deals', 'Leads with value', 'Value (EGP)', 'Weighted value (EGP)'], ...F.rows.map((r) => [r.label, r.n, Number(r.expectedDeals.toFixed(2)), r.withValue, Math.round(r.value), Math.round(r.weighted)])] }]} disabled={!c.openAll.length} />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Open leads" value={num(F.total.n)} info="Open leads in scope." />
        <Kpi label="Expected deals" value={F.total.expectedDeals.toFixed(1)} info="Sum of the stage probabilities." />
        <Kpi label="Pipeline value" value={F.total.withValue ? fmtEGP(F.total.value) : '—'} sub={`${F.total.withValue} of ${F.total.n} carry a value`} info="Unweighted deal value of open leads that have one." />
        <Kpi label="Weighted value" value={F.total.withValue ? fmtEGP(F.total.weighted) : '—'} info="Deal value × stage probability." />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead><tr className="border-b border-brand-gray/15">{['Expected closing', '', 'Open leads', 'Expected deals', 'Value', 'Weighted value'].map((h, i) => <th key={i} className={`${TH} ${i > 1 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-brand-gray/10 font-semibold text-brand-black">
            {F.rows.filter((r) => r.n > 0 || /^\d{4}/.test(r.key)).map((r) => (
              <tr key={r.key} className={r.key === 'overdue' ? 'bg-rose-50/60' : ''}>
                <td className="py-2 px-2 font-bold whitespace-nowrap">{r.label}</td>
                <td className="py-2 px-2 w-1/4"><div className="h-2 bg-brand-gray/10 rounded-full overflow-hidden"><div className="h-full rounded-full bg-brand-red" style={{ width: `${r.weighted ? Math.max(2, (r.weighted / max) * 100) : 0}%` }} /></div></td>
                <td className={`${TD} text-right`}>{num(r.n)}</td><td className={`${TD} text-right`}>{r.expectedDeals ? r.expectedDeals.toFixed(1) : '—'}</td>
                <td className={`${TD} text-right`}>{r.withValue ? fmtEGP(r.value) : '—'}</td><td className={`${TD} text-right`}>{r.withValue ? fmtEGP(r.weighted) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-brand-gray mt-2">'Date already passed' leads are open leads whose expected closing date is before today: the date needs updating by the owner.</p>
      </div>
    </Card>
  );
};

