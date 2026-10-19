// Team Performance: one row per salesperson, leaderboard and a detail drawer. For sales managers / team leaders;
// a salesperson only ever sees their own row (the server only sends them their own leads).
import { LoadBar } from './LoadBar';
import { crmNav } from './crmNav';
import React, { useEffect, useMemo, useState } from 'react';
import { Trophy, X } from 'lucide-react';
import { useAuth } from '../../services/AuthContext';
import type { CrmOffersProps } from './CrmOffers';
import { crmService } from './crmService';
import {
  DEFAULT_FILTERS, Filters, crmScopeOf, fmtEGP, fmtPct, isManagerScope, pc, periodRange, prepare, selectPool, todayISO,
} from './leadMetrics';
import { Card, FilterBar, InfoTip, Kpi, Pill } from './CrmMetricsUi';
import { DataTable, Column, ExportBar, MiniBar, fmtDays, fmtHours, num } from './ReportParts';
import { RepPerf, activityIndex, teamPerformance } from './reportsEngine';
import { SOURCES } from './leadConfig';

const RANKS = [
  { id: 'value', label: 'Won value', get: (r: RepPerf) => (r.wonWithValue ? r.wonValue : null), higher: true, fmt: (r: RepPerf) => (r.wonWithValue ? fmtEGP(r.wonValue) : '—') },
  { id: 'won', label: 'Deals won', get: (r: RepPerf) => r.won, higher: true, fmt: (r: RepPerf) => String(r.won) },
  { id: 'conv', label: 'Conversion', get: (r: RepPerf) => (r.leads >= 10 ? r.conversion : null), higher: true, fmt: (r: RepPerf) => fmtPct(r.conversion, 1) },
  { id: 'speed', label: 'Fastest first action', get: (r: RepPerf) => (r.firstActionH.length >= 5 ? r.medianFirstH : null), higher: false, fmt: (r: RepPerf) => fmtHours(r.medianFirstH) },
  { id: 'overdue', label: 'Fewest overdue follow-ups', get: (r: RepPerf) => (r.openNow >= 5 ? r.overdue : null), higher: false, fmt: (r: RepPerf) => String(r.overdue) },
] as const;
const RANK_NOTE: Record<string, string> = {
  conv: 'needs at least 10 leads', speed: 'needs at least 5 leads with a measured first action', overdue: 'needs at least 5 open leads',
};

export interface CrmTeamPerformanceProps extends CrmOffersProps {
  /** when the page is shown inside Sales Reports the shared period / filters are passed in */
  filters?: Filters;
}

export const CrmTeamPerformance: React.FC<Partial<CrmTeamPerformanceProps> & { leads: CrmOffersProps['leads'] }> = ({ leads, filters }) => {
  const { user, permissions } = useAuth();
  const scope = crmScopeOf(user, permissions);
  const manager = isManagerScope(scope);
  const [own, setOwn] = useState<Filters>(DEFAULT_FILTERS);
  const f = filters || own;
  const [rank, setRank] = useState<(typeof RANKS)[number]['id']>('value');
  const [sel, setSel] = useState<string | null>(null);

  // activities can arrive after the leads: re-read them when the data changes
  const [actVer, setActVer] = useState(0);
  useEffect(() => { const h = () => setActVer((v) => v + 1); window.addEventListener('crm-data-changed', h); return () => window.removeEventListener('crm-data-changed', h); }, []);
  const acts = useMemo(() => crmService.getActivities(), [leads, actVer]);
  const idx = useMemo(() => activityIndex(acts), [acts]);

  const all = useMemo(() => prepare(leads), [leads]);
  const range = useMemo(() => periodRange(f.period, f.from, f.to), [f.period, f.from, f.to]);
  const allTime = f.period === 'all';
  const pool = useMemo(() => selectPool(all, f, range), [all, f, range]);
  const openAll = useMemo(() => selectPool(all, { ...f, period: 'all' }, range).filter((p) => p.open), [all, f, range]);
  const people = useMemo(() => crmService.getSalesPeople(), [leads]);
  const queue = useMemo(() => crmService.getQueueSettings(), [leads]);
  const caps = useMemo(() => { const m = new Map<string, number>(); for (const s of people) if (Number(s?.cap) > 0) m.set(String(s.id), Number(s.cap)); return m; }, [people]);
  const defaultCap = Number(queue?.maxLeadsPerSalesperson) > 0 ? Number(queue.maxLeadsPerSalesperson) : null;
  const nowMs = useMemo(() => Date.now(), [pool, idx]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = todayISO();

  const rows = useMemo(() => teamPerformance(pool, openAll, range, allTime, idx, today, nowMs, caps, defaultCap), [pool, openAll, range, allTime, idx, today, nowMs, caps, defaultCap]);
  const owners = useMemo(() => {
    const m = new Map<string, string>();
    all.forEach((p) => { if (p.owner && !m.has(p.owner)) m.set(p.owner, p.ownerName || p.owner); });
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);
  const sources = useMemo(() => { const s = new Set<string>(SOURCES); all.forEach((p) => { if (p.source !== 'Not recorded') s.add(p.source); }); return [...s].sort(); }, [all]);

  const R = RANKS.find((x) => x.id === rank)!;
  const board = useMemo(() => {
    const k = R.higher ? -1 : 1;
    const ranked = rows.map((r) => ({ r, v: R.get(r) })).filter((x) => x.v != null) as { r: RepPerf; v: number }[];
    ranked.sort((a, b) => (a.v - b.v) * k || b.r.won - a.r.won);
    const unranked = rows.filter((r) => R.get(r) == null);
    return { ranked, unranked };
  }, [rows, R]);

  const team = useMemo(() => {
    const firstH = rows.flatMap((r) => r.firstActionH); const fin = rows.flatMap((r) => r.finalDays);
    const sum = (f2: (r: RepPerf) => number) => rows.reduce((a, r) => a + f2(r), 0);
    const leadsN = sum((r) => r.leads); const won = sum((r) => r.won);
    return {
      leads: leadsN, won, lost: sum((r) => r.lost), value: sum((r) => r.wonValue), withValue: sum((r) => r.wonWithValue),
      avgFirst: firstH.length ? firstH.reduce((a, b) => a + b, 0) / firstH.length : null, avgFinal: fin.length ? fin.reduce((a, b) => a + b, 0) / fin.length : null,
      overdue: sum((r) => r.overdue), never: sum((r) => r.neverContacted), breaches: sum((r) => r.slaBreached), openNow: sum((r) => r.openNow),
    };
  }, [rows]);

  const selected = sel ? rows.find((r) => r.id === sel) || null : null;
  // a number in the table opens the leads list with exactly the leads behind it (same period and filters)
  const numLink = (r: RepPerf, what: string, value: number, pred: (p: (typeof pool)[number]) => boolean, tone = '') => {
    if (!value) return num(value);
    const ids = pool.filter((p) => p.owner === r.id && pred(p)).map((p) => String(p.l.id));
    return (
      <button type="button" className={`font-mono underline decoration-dotted underline-offset-2 hover:text-brand-red ${tone}`} title="Click to open these leads"
        onClick={(e) => { e.stopPropagation(); crmNav.leads({ ids, title: `${r.name} · ${what} · ${range.label}${ids.length !== value ? ` (table says ${value})` : ''}` }); }}>{num(value)}</button>
    );
  };
  const cols: Column<RepPerf>[] = [
    { id: 'n', head: 'Salesperson', sort: (r) => r.name, cell: (r) => <span className="font-bold whitespace-nowrap">{r.name}</span> },
    { id: 'leads', head: 'Leads', info: 'Leads of this person in the period: lead date in the window, or a deal won in the window.', right: true, sort: (r) => r.leads, cell: (r) => numLink(r, 'Leads', r.leads, () => true) },
    { id: 'open', head: 'Open', info: 'Of those leads, still open (not won, lost or closed).', right: true, sort: (r) => r.open, cell: (r) => numLink(r, 'Open leads', r.open, (p) => p.open) },
    { id: 'won', head: 'Won', info: 'Deals with a closing date in the window.', right: true, sort: (r) => r.won, cell: (r) => numLink(r, 'Won', r.won, (p) => p.won, 'text-emerald-700') },
    { id: 'lost', head: 'Lost', info: 'Lost, Not Interested and Low Budget leads of the period.', right: true, sort: (r) => r.lost, cell: (r) => numLink(r, 'Lost', r.lost, (p) => p.lost) },
    { id: 'conv', head: 'Conversion', info: 'Won ÷ leads.', right: true, sort: (r) => r.conversion, cell: (r) => <Pill v={r.conversion} good={5} ok={1} dp={1} /> },
    { id: 'val', head: 'Won value', right: true, sort: (r) => (r.wonWithValue ? r.wonValue : null), cell: (r) => (r.wonWithValue ? fmtEGP(r.wonValue) : '—') },
    { id: 'fa', head: 'Avg first action', info: 'Average time from getting the lead (assignment) to the first call, note or status change. See the definition at the bottom of the page. "—" = not measurable.', right: true, sort: (r) => r.avgFirstH, cell: (r) => fmtHours(r.avgFirstH) },
    { id: 'fin', head: 'Avg to final stage', info: 'Average days from assignment (else lead date) to Won / Lost, over the closed leads of the period where both dates exist.', right: true, sort: (r) => r.avgFinalDays, cell: (r) => fmtDays(r.avgFinalDays) },
    { id: 'od', head: 'Overdue', info: 'Open leads right now whose next follow-up date has passed.', right: true, sort: (r) => r.overdue, cell: (r) => <span className={r.overdue ? 'text-rose-600' : ''}>{num(r.overdue)}</span> },
    { id: 'nc', head: 'Never contacted', info: 'Open leads right now with no sign anybody worked them.', right: true, sort: (r) => r.neverContacted, cell: (r) => <span className={r.neverContacted ? 'text-amber-700' : ''}>{num(r.neverContacted)}</span> },
    { id: 'sla', head: 'SLA breaches', info: 'Leads of the period with an SLA deadline whose first action came late, or has not come and the deadline passed.', right: true, sort: (r) => r.slaBreached, cell: (r) => <span className={r.slaBreached ? 'text-rose-600' : ''}>{num(r.slaBreached)}</span> },
    { id: 'off', head: 'Offers sent', info: 'Leads of the period marked "offer sent".', right: true, sort: (r) => r.offers, cell: (r) => num(r.offers) },
    { id: 'load', head: 'Load / capacity', info: 'Open leads right now ÷ the capacity set for this person (else the queue-wide cap). "—" when no capacity is set.', right: true, sort: (r) => r.loadPct ?? r.openNow, cell: (r) => (r.capacity ? <span className={r.loadPct! >= 100 ? 'text-rose-600' : r.loadPct! >= 80 ? 'text-amber-700' : ''}>{r.openNow} / {r.capacity}</span> : <span title="No capacity set">{r.openNow} / —</span>) },
  ];

  const sheets = () => [
    { name: 'Team performance', rows: [
      ['Salesperson', 'Leads', 'Open (period)', 'Won', 'Lost', 'Conversion %', 'Win rate (decided) %', 'Won value (EGP)', 'Avg deal (EGP)', 'Avg first action (hours)', 'Median first action (hours)', 'Leads with measured first action', 'Avg days to final stage', 'Closed leads measured', 'Offers sent', 'SLA met', 'SLA breached', 'Open now', 'Overdue follow-ups', 'Never contacted', 'No next step', 'Capacity', 'Load %'],
      ...rows.map((r) => [r.name, r.leads, r.open, r.won, r.lost, r.conversion == null ? '' : Number(r.conversion.toFixed(1)), r.decidedWin == null ? '' : Number(r.decidedWin.toFixed(1)), r.wonWithValue ? Math.round(r.wonValue) : '', r.avgDeal == null ? '' : Math.round(r.avgDeal), r.avgFirstH == null ? '' : Number(r.avgFirstH.toFixed(1)), r.medianFirstH == null ? '' : Number(r.medianFirstH.toFixed(1)), r.firstActionH.length, r.avgFinalDays == null ? '' : Number(r.avgFinalDays.toFixed(1)), r.finalDays.length, r.offers, r.slaMet, r.slaBreached, r.openNow, r.overdue, r.neverContacted, r.noNext, r.capacity ?? '', r.loadPct == null ? '' : Number(r.loadPct.toFixed(0))]),
    ] },
    { name: 'Channels per person', rows: [['Salesperson', 'Channel', 'Leads'], ...rows.flatMap((r) => r.channels.map((c) => [r.name, c.key, c.n]))] },
    { name: 'Sources per person', rows: [['Salesperson', 'Source', 'Leads'], ...rows.flatMap((r) => r.sources.map((c) => [r.name, c.key, c.n]))] },
  ];

  return (
    <div className="space-y-6 text-xs" id="crm-team-performance">
      {!filters && (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h3 className="text-xl font-bold text-brand-black">Team Performance</h3>
            <p className="text-xs text-brand-gray/80 mt-1">{manager ? 'One row per salesperson. Click a row for the detail.' : 'Your own figures.'}</p>
          </div>
        </div>
      )}
      {!filters && <LoadBar defaultOpen />}
      {!filters && <FilterBar f={f} set={setOwn} owners={manager ? owners : undefined} sources={sources} rangeLabel={`${range.label} · ${pool.length} leads`} />}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Kpi label="Leads" value={num(team.leads)} info="Leads of the people shown, in the period." />
        <Kpi label="Won" value={num(team.won)} sub={team.withValue ? fmtEGP(team.value) : undefined} info="Deals closed in the window and their value." tone="text-emerald-600" />
        <Kpi label="Avg first action" value={fmtHours(team.avgFirst)} info="Team average time from assignment to the first action on a lead." />
        <Kpi label="Avg to final stage" value={fmtDays(team.avgFinal)} info="Team average days from assignment to Won / Lost." />
        <Kpi label="Overdue follow-ups" value={num(team.overdue)} sub={`${num(team.never)} never contacted`} info="Open leads right now with a past follow-up date." tone="text-rose-600" />
        <Kpi label="SLA breaches" value={num(team.breaches)} info="Leads of the period with a late or missing first action against their SLA deadline." />
      </div>

      <Card title="Per salesperson" info="Period columns (leads, open, won, lost, conversion, value, times, SLA, offers) cover the leads of the period. 'Overdue', 'Never contacted' and 'Load / capacity' are right now, whatever the period."
        right={<ExportBar name="team-performance" sheets={sheets} disabled={!rows.length} />}>
        <DataTable rows={rows} cols={cols} rowKey={(r) => r.id} limit={60} onRow={(r) => setSel(r.id)} defaultSort={{ id: 'val', dir: 'desc' }} empty="No assigned leads in this period." />
      </Card>

      {manager && rows.length > 1 && (
        <Card title={<span className="inline-flex items-center gap-1.5"><Trophy size={14} className="text-amber-500" />Leaderboard</span>} info="Ranks the people shown by the chosen measure. Rate and time measures need a minimum number of leads so one lucky lead cannot top the board; people below the minimum are listed unranked."
          right={<select value={rank} onChange={(e) => setRank(e.target.value as typeof rank)} className="bg-white border border-brand-gray/20 rounded-xl px-3 py-1.5 text-xs font-bold" aria-label="Rank by">{RANKS.map((x) => <option key={x.id} value={x.id}>Rank by: {x.label}</option>)}</select>}>
          <div className="space-y-2">
            {board.ranked.length === 0 && <p className="text-center text-brand-gray py-4">Nobody qualifies for this ranking yet{RANK_NOTE[rank] ? ` (${RANK_NOTE[rank]})` : ''}.</p>}
            {board.ranked.map(({ r, v }, i) => {
              const top = Math.max(1e-9, ...board.ranked.map((x) => Math.abs(x.v)));
              const w = R.higher ? Math.max(3, (Math.abs(v) / top) * 100) : Math.max(3, (1 - (Math.abs(v) - Math.min(...board.ranked.map((x) => Math.abs(x.v)))) / (top || 1)) * 100);
              return (
                <div key={r.id} className="flex items-center gap-3 cursor-pointer hover:bg-brand-gray/5 rounded-lg p-1" onClick={() => setSel(r.id)}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-slate-800' : i === 2 ? 'bg-orange-300 text-orange-900' : 'bg-brand-gray/10 text-brand-gray'}`}>{i + 1}</span>
                  <span className="w-40 truncate font-bold text-brand-black">{r.name}</span>
                  <div className="flex-1 h-2 bg-brand-gray/10 rounded-full overflow-hidden"><div className="h-full rounded-full bg-brand-red" style={{ width: `${w}%` }} /></div>
                  <span className="w-28 text-right font-mono font-bold text-brand-black">{R.fmt(r)}</span>
                </div>
              );
            })}
            {board.unranked.length > 0 && <p className="text-[10px] text-brand-gray pt-1">Not ranked ({RANK_NOTE[rank] || 'no data for this measure'}): {board.unranked.map((r) => r.name).join(', ')}.</p>}
          </div>
        </Card>
      )}

      <div className="text-[10px] text-brand-gray bg-white border border-brand-gray/20 rounded-2xl p-4 space-y-1">
        <p className="font-extrabold uppercase tracking-wider text-brand-black">How the time figures are measured</p>
        <p><b>Clock start</b> = the time the current owner received the lead (assignment time; when it is missing, the lead date if it carries a time). Leads without a clock start are not measured.</p>
        <p><b>First action</b> = the earliest of: the first-contact stamp; a logged call, WhatsApp, meeting, visit or e-mail by the owner on that lead; a note or status change of the owner in the lead timeline (priority edits do not count) — at or after the clock start. <b>Time to first action</b> = first action − clock start. Leads with no action are left out (counted under "never contacted" / "no action yet"), never counted as zero.</p>
        <p><b>Time to final stage</b> = days from assignment (else the lead date) to the closing day of a won deal, or to the day of the status change to Lost / Not Interested / Low Budget in the timeline. Closed leads without that date are left out.</p>
        <p><b>SLA breach</b> = the lead has an SLA deadline and the first action came after it, or there is none and the deadline has passed while the lead is open.</p>
      </div>

      {selected && <Drawer r={selected} onClose={() => setSel(null)} />}
    </div>
  );
};

const Drawer: React.FC<{ r: RepPerf; onClose: () => void }> = ({ r, onClose }) => {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const chMax = Math.max(1, ...r.channels.map((c) => c.n)); const srMax = Math.max(1, ...r.sources.map((c) => c.n));
  const chTotal = r.channels.reduce((a, c) => a + c.n, 0); const srTotal = r.sources.reduce((a, c) => a + c.n, 0);
  const stat = (label: string, value: React.ReactNode, info?: string) => (
    <div className="border border-brand-gray/15 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-brand-gray flex items-center gap-1">{label}{info && <InfoTip text={info} />}</p><p className="text-base font-black font-mono mt-1">{value}</p></div>
  );
  return (
    <div className="fixed inset-0 z-50 flex justify-end print:hidden" role="dialog" aria-label={`${r.name} performance`}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl p-6 space-y-5 text-xs">
        <div className="flex items-start justify-between gap-3">
          <div><h4 className="text-lg font-extrabold text-brand-black">{r.name}</h4><p className="text-brand-gray">{num(r.leads)} leads in the period · {r.openNow} open now</p></div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-brand-gray/10"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {stat('Won', `${r.won}${r.wonWithValue ? ` · ${fmtEGP(r.wonValue)}` : ''}`)}
          {stat('Lost', r.lost)}
          {stat('Conversion', fmtPct(r.conversion, 1), 'Won ÷ leads of the period.')}
          {stat('Win rate (decided)', fmtPct(r.decidedWin, 1), 'Won ÷ (won + lost).')}
          {stat('Average deal', fmtEGP(r.avgDeal), 'Won value ÷ won deals that carry a value.')}
          {stat('Offers sent', r.offers)}
          {stat('First action', `${fmtHours(r.avgFirstH)}`, `Average. Median ${fmtHours(r.medianFirstH)}. Measured on ${r.firstActionH.length} leads.`)}
          {stat('To final stage', fmtDays(r.avgFinalDays), `Average days assignment → Won / Lost, over ${r.finalDays.length} closed leads.`)}
          {stat('SLA', `${r.slaMet} met · ${r.slaBreached} late`, 'Leads of the period with an SLA deadline.')}
          {stat('Overdue follow-ups', r.overdue, 'Open leads right now with a past follow-up date.')}
          {stat('Never contacted', r.neverContacted, 'Open leads right now with no sign anybody worked them.')}
          {stat('No next step', r.noNext, 'Open leads right now with no follow-up date.')}
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-brand-gray mb-1 flex items-center gap-1">Load vs capacity <InfoTip text="Open leads right now ÷ capacity (personal cap, else the queue-wide cap)." /></p>
          {r.capacity ? (
            <div className="flex items-center gap-2"><div className="flex-1 h-2.5 bg-brand-gray/10 rounded-full overflow-hidden"><div className={`h-full rounded-full ${r.loadPct! >= 100 ? 'bg-rose-500' : r.loadPct! >= 80 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, r.loadPct!)}%` }} /></div>
              <span className="font-mono font-bold">{r.openNow} / {r.capacity} ({fmtPct(r.loadPct)})</span></div>
          ) : <p className="text-brand-gray">{r.openNow} open leads. No capacity is set for this person, so no percentage is shown.</p>}
        </div>
        <div className="space-y-2"><p className="text-[10px] uppercase font-bold text-brand-gray">Lead channels held (period)</p>
          {r.channels.length === 0 ? <p className="text-brand-gray">—</p> : r.channels.map((c) => <MiniBar key={c.key} label={c.key} n={c.n} max={chMax} total={chTotal} color="#D32F2F" />)}</div>
        <div className="space-y-2"><p className="text-[10px] uppercase font-bold text-brand-gray">Lead sources held (period)</p>
          {r.sources.length === 0 ? <p className="text-brand-gray">—</p> : r.sources.slice(0, 15).map((c) => <MiniBar key={c.key} label={c.key} n={c.n} max={srMax} total={srTotal} color="#1976D2" />)}</div>
        <p className="text-[10px] text-brand-gray">{pc(r.won + r.lost, r.leads) == null ? '' : `${fmtPct(pc(r.won + r.lost, r.leads))} of this person's leads are decided (won or lost).`}</p>
      </div>
    </div>
  );
};
