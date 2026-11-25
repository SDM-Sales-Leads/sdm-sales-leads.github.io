import { crmNav } from './crmNav';
import React, { useMemo, useState } from 'react';
import { Lead } from './types';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { AlertCircle, UserPlus, Users, Clock, Flame, Hourglass, Wallet, CheckCircle } from 'lucide-react';
import { useAuth } from '../../services/AuthContext';
import {
  DEFAULT_FILTERS, Filters, analyse, buckets, crmScopeOf, fmtEGP, fmtPct, funnelRows, isManagerScope, mean, periodRange, prepare,
  prevRange, repRates, selectPool, teamDay, todayISO, VIP_SLA_HOURS, NEGLECT_HOURS,
} from './leadMetrics';
import { Card, Delta, FilterBar, InfoTip, Kpi, RateDial } from './CrmMetricsUi';
import { PRIORITIES, SOURCES } from './leadConfig';

interface CrmDashboardProps {
  leads: Lead[];
  /** inside the Reports page: that page owns the filters (one filter bar for the whole dashboard) and the page title */
  filters?: Filters;
}

const COLORS = ['#D32F2F', '#1976D2', '#388E3C', '#FBC02D', '#7B1FA2', '#00796B', '#E64A19', '#F57C00'];
const PRIORITY_COLORS: Record<string, string> = { VIP: '#7B1FA2', High: '#E64A19', Medium: '#FBC02D', Low: '#388E3C' };
const fmtSpan = (days: number | null) => {
  if (days == null) return '—';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} h`;
  return `${days.toFixed(1)} days`;
};

export const CrmDashboard: React.FC<CrmDashboardProps> = ({ leads, filters }) => {
  const { user, permissions } = useAuth();
  const scope = crmScopeOf(user, permissions);
  const manager = isManagerScope(scope);
  const [own, setF] = useState<Filters>(DEFAULT_FILTERS);
  const f = filters ?? own;
  const embedded = !!filters;

  // one pass over the leads; every filter change afterwards is O(n)
  const all = useMemo(() => prepare(leads), [leads]);
  const range = useMemo(() => periodRange(f.period, f.from, f.to), [f.period, f.from, f.to]);
  const prev = useMemo(() => prevRange(range, f.period), [range, f.period]);
  const pool = useMemo(() => selectPool(all, f, range), [all, f, range]);
  const A = useMemo(() => analyse(pool, range, f.period), [pool, range, f.period]);
  const prevAgg = useMemo(() => {
    if (!prev) return undefined;
    return analyse(selectPool(all, f, prev), prev, f.period === 'all' ? 'custom' : f.period).total;
  }, [all, f, prev]);
  const trend = useMemo(() => buckets(pool, range, f.period), [pool, range, f.period]);
  const team = useMemo(() => (manager ? teamDay(leads, todayISO(), Date.now()) : null), [leads, manager]);

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

  const t = A.total;
  const rates = repRates(t);
  const prevRates = prevAgg ? repRates(prevAgg) : undefined;
  const drill = (title: string, pred: (p: (typeof pool)[number]) => boolean) => () => crmNav.leads({ ids: pool.filter(pred).map((p) => String(p.l.id)), title: `${title} · ${range.label}` });
  const conv = rates.winAll;
  const avgDeal = t.won > 0 && t.wonWithValue > 0 ? t.wonValue / t.wonWithValue : null;
  const avgCycle = mean(t.cycles);
  const funnel = funnelRows(t);
  const dRate = (k: keyof typeof rates, lower = false) => (prevRates ? <Delta now={rates[k]} prev={prevRates[k]} lowerIsBetter={lower} /> : undefined);

  const sourceChart = A.bySource.map((b) => ({ name: b.label, value: b.agg.total })).sort((a, b) => b.value - a.value).slice(0, 10);
  const projectChart = A.byProject.map((b) => ({ name: b.label, count: b.agg.total })).sort((a, b) => b.count - a.count).slice(0, 9);
  const statusChart = useMemo(() => {
    const m: Record<string, number> = {};
    pool.forEach((p) => { m[p.l.status] = (m[p.l.status] || 0) + 1; });
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [pool]);
  const priorityChart = useMemo(() => {
    const c: Record<string, number> = {};
    pool.forEach((p) => { const k = p.l.priority === 'Urgent' ? 'VIP' : p.l.priority === 'Normal' ? 'Medium' : p.l.priority; c[k] = (c[k] || 0) + 1; });
    return PRIORITIES.map((name) => ({ name, count: c[name] || 0 }));
  }, [pool]);

  return (
    <div className="space-y-6" id="crm-dashboard-root">
      {!embedded && (<>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold text-brand-black tracking-tight font-sans">CRM Executive Cockpit</h2>
          <p className="text-sm text-brand-gray/80 mt-0.5">
            {manager ? 'Leads and sales performance for the people you manage.' : 'Your own leads and sales performance.'} Hover the <InfoTip text="Every figure has one of these: it says what is counted and what it is measured against." /> icons for each definition.
          </p>
        </div>
      </div>

      <FilterBar f={f} set={setF} owners={manager ? owners : undefined} sources={sources} rangeLabel={`${range.label} · ${pool.length} leads`} />

      </>)}

      {/* 12 KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Total leads" onClick={drill('Total leads', ()=>true)} value={t.total} sub="created in the period (or won in it)" delta={prevAgg ? <Delta now={t.total} prev={prevAgg.total} /> : undefined}
          info="Leads whose lead date is in the period, plus leads won in the period. Duplicates merged into another lead are not counted." />
        <Kpi label="Contacted" onClick={drill('Contacted', (p) => p.level >= 1)} value={t.contacted} sub={`${fmtPct(rates.reached)} of leads`} delta={prevAgg ? <Delta now={t.contacted} prev={prevAgg.contacted} /> : undefined}
          info="A lead counts as contacted when it has a first-contact time, or any status other than New, or it is further down the funnel (qualified, offer, won…). Denominator of the %: total leads." />
        <Kpi label="Qualified" onClick={drill('Qualified', (p) => p.level >= 2)} value={t.qualified} sub="real opportunities" delta={prevAgg ? <Delta now={t.qualified} prev={prevAgg.qualified} /> : undefined}
          info="Marked Qualified, or already at the offer / meeting stage or beyond." />
        <Kpi label="Opportunities" onClick={drill('Opportunities', (p) => p.level >= 3)} value={t.opportunity} sub="offer or meeting stage" delta={prevAgg ? <Delta now={t.opportunity} prev={prevAgg.opportunity} /> : undefined}
          info="Offer sent, meeting or site visit scheduled or held, negotiation, or won." />
        <Kpi label="Won deals" onClick={drill('Won deals', (p) => p.won)} value={t.won} sub={`finance-confirmed in this period${t.cashPending ? ` · ${t.cashPending} waiting for finance` : ''}`} tone="text-emerald-600" delta={prevAgg ? <Delta now={t.won} prev={prevAgg.won} /> : undefined}
          info="Leads with status Won whose closing date falls in the period. Closing date = the date typed on the lead, else EOI date (EOI path), else reservation, EOI or contract date, else lead date. It is NOT the day somebody clicked Won." />
        <Kpi label="Lost" onClick={drill('Lost', (p) => p.lost)} value={t.lost} sub="no deal" tone="text-rose-600" delta={prevAgg ? <Delta now={t.lost} prev={prevAgg.lost} lowerIsBetter /> : undefined}
          info="Status Lost, Not Interested or Low Budget (they are all closed without a deal). Counted from the leads in the period." />
        <Kpi label="Conversion" value={fmtPct(conv, 1)} sub="leads that became deals" delta={dRate('winAll')}
          info="Won in the period ÷ all leads in the period. Win rate against leads actually reached is in the strip below." />
        <Kpi label="Recognized sales" value={fmtEGP(t.wonWithValue ? t.wonValue : null)} sub={`${t.won} confirmed deals${t.cashPending ? ` · ${fmtEGP(t.cashPendingValue)} waiting for finance` : ""}`} delta={prevAgg ? <Delta now={t.wonWithValue ? t.wonValue : null} prev={prevAgg.wonWithValue ? prevAgg.wonValue : null} /> : undefined}
          info="Sum of the cash value (EGP) of the deals won in the period AND confirmed by finance. Won deals still waiting for finance are shown apart and not counted." />
        <Kpi label="Open pipeline" onClick={drill('Open pipeline', (p) => p.open)} value={t.openWithValue ? fmtEGP(t.pipelineValue) : '—'} sub={`${t.open} live leads · ${t.openWithValue} with a value`}
          info="Value of open leads (not Won, Lost, Not Interested, Low Budget, Wrong Number). Only leads that carry a deal value add to it, so it understates until values are typed." />
        <Kpi label="Weighted pipeline" value={t.openWithValue ? fmtEGP(t.weightedValue) : '—'} sub={`${t.weightedCount.toFixed(1)} expected deals`}
          info="Each open lead's value × its stage probability: contacted 5%, qualified 15%, offer or meeting 35%, negotiation 60%. 'Expected deals' is the same weighting applied to the lead count, so it works even without values." />
        <Kpi label="Average deal" value={fmtEGP(avgDeal)} sub="won deals with a value"
          info="Won revenue ÷ number of won deals that have a value." />
        <Kpi label="Average cycle" value={avgCycle == null ? '—' : `${Math.round(avgCycle)} days`} sub="lead to signature" delta={prevAgg ? <Delta now={avgCycle} prev={mean(prevAgg.cycles)} lowerIsBetter /> : undefined}
          info="Average of (won date − lead date) over the deals won in the period. Deals without both dates are skipped." />
      </div>

      {/* rates strip */}
      <Card title="How well we are converting" info="Each rate is measured against the stage before it, so you can see where leads are lost. Win and loss are measured against leads actually reached. Change is against the previous period of the same length.">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <RateDial label="Reached" v={rates.reached} good={80} ok={50} delta={dRate('reached')} info="Contacted ÷ all leads." />
          <RateDial label="Qualified" v={rates.qualify} good={40} ok={20} delta={dRate('qualify')} info="Qualified ÷ contacted." />
          <RateDial label="Got an offer" v={rates.offer} good={50} ok={25} delta={dRate('offer')} info="Offer or meeting stage ÷ qualified." />
          <RateDial label="Win rate" v={rates.win} good={10} ok={4} delta={dRate('win')} info="Won ÷ contacted. (Won ÷ all leads is the Conversion tile.)" />
          <RateDial label="Loss rate" v={rates.loss} good={20} ok={40} lowerBetter delta={dRate('loss', true)} info="Lost (incl. Not Interested and Low Budget) ÷ contacted. Lower is better." />
          <RateDial label="Settled" v={rates.decided} good={60} ok={30} delta={dRate('decided')} info="(Won + lost) ÷ all leads: how much of the book is decided." />
        </div>
      </Card>

      {/* funnel + trend */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-2" title="Funnel" info="Cumulative: a lead at a later stage counts at every earlier stage. '% of all' is against leads received, '% carried' against the previous row, 'dropped' is the absolute loss from the previous row. Won is counted by closing date in the period.">
          <div className="space-y-2">
            {funnel.map((s, i) => (
              <div key={s.name}>
                <div className="flex justify-between text-[11px] font-bold text-brand-black"><span>{s.name}</span><span className="font-mono">{s.n}</span></div>
                <div className="h-2 bg-brand-gray/10 rounded-full overflow-hidden mt-1"><div className="h-full bg-brand-red rounded-full" style={{ width: `${Math.max(s.n > 0 ? 2 : 0, s.ofAll ?? 0)}%`, opacity: 1 - i * 0.1 }} /></div>
                <div className="flex justify-between text-[10px] text-brand-gray font-semibold mt-0.5">
                  <span>{fmtPct(s.ofAll)} of all</span>
                  <span>{i === 0 ? '' : `${fmtPct(s.carried)} carried · −${s.dropped} dropped`}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="lg:col-span-3" title="Lead intake and outcomes" info={`Leads in = lead date. Won = closing date. Lost = Lost / Not Interested / Low Budget, dated by the lead date (the sheet has no lost date). Grouped by ${trend.unit}.`}>
          <div className="h-64">
            {trend.rows.length === 0 ? <div className="h-full flex items-center justify-center text-xs text-brand-gray">No dated leads in this period</div> : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <LineChart data={trend.rows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" stroke="#6b7280" fontSize={10} interval="preserveStartEnd" />
                  <YAxis stroke="#6b7280" fontSize={11} allowDecimals={false} />
                  <Tooltip /><Legend />
                  <Line type="monotone" dataKey="leads" name="Leads in" stroke="#D32F2F" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="won" name="Won" stroke="#388E3C" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="lost" name="Lost" stroke="#455A64" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Team Day (managers) */}
      {manager && team && (
        <Card title="Team day" info={`Today's operational picture across the leads you manage. VIP overdue = priority VIP, has an owner, no first contact, more than ${VIP_SLA_HOURS} h since assigned (or since 09:00 on the lead date when never assigned). Neglected = same but any priority and more than ${NEGLECT_HOURS} h. Follow-up counts use each lead's next follow-up date (open leads with an owner).`}>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            {[
              { l: 'New today', v: team.newToday.length, i: UserPlus, c: 'text-sky-600' },
              { l: 'Unassigned', v: team.unassigned.length, i: Users, c: team.unassigned.length ? 'text-amber-600' : 'text-brand-black' },
              { l: 'Overdue (team)', v: team.overdue, i: AlertCircle, c: team.overdue ? 'text-rose-600' : 'text-brand-black' },
              { l: 'Due today (team)', v: team.dueToday, i: Clock, c: 'text-brand-black' },
              { l: `VIP overdue > ${VIP_SLA_HOURS} h`, v: team.vipOverdue.length, i: Flame, c: team.vipOverdue.length ? 'text-rose-600' : 'text-brand-black' },
              { l: `Neglected > ${NEGLECT_HOURS} h`, v: team.neglected.length, i: Hourglass, c: team.neglected.length ? 'text-rose-600' : 'text-brand-black' },
              { l: 'Won, cash pending', v: team.wonAwaitingAR.length, i: Wallet, c: 'text-amber-600' },
              { l: 'Cash confirmed', v: team.cashConfirmed, i: CheckCircle, c: 'text-emerald-600' },
            ].map((x) => (
              <div key={x.l} className="border border-brand-gray/15 rounded-xl p-3">
                <x.i size={14} className="text-brand-gray/60" />
                <p className={`text-xl font-black font-mono mt-1 ${x.c}`}>{x.v}</p>
                <p className="text-[10px] font-bold text-brand-gray uppercase tracking-wide">{x.l}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-brand-gray font-bold border-b border-brand-gray/15">
                  <th className="py-2 pr-3">Salesperson</th><th className="py-2 px-2 text-right">Open leads</th><th className="py-2 px-2 text-right">Overdue</th>
                  <th className="py-2 px-2 text-right">Due today</th><th className="py-2 px-2 text-right">No date set</th><th className="py-2 px-2 text-right">Never contacted</th><th className="py-2 pl-2 text-right">Offers sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-gray/10 font-semibold">
                {team.reps.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-brand-gray">No leads are assigned yet.</td></tr>}
                {team.reps.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 font-bold text-brand-black">{r.name}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.open}</td>
                    <td className={`py-2 px-2 text-right font-mono ${r.overdue ? 'text-rose-600 font-bold' : ''}`}>{r.overdue}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.dueToday}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.noDate}</td>
                    <td className={`py-2 px-2 text-right font-mono ${r.neverContacted ? 'text-amber-600' : ''}`}>{r.neverContacted}</td>
                    <td className="py-2 pl-2 text-right font-mono">{r.offers}</td>
                  </tr>
                ))}
              </tbody>
              {team.reps.length > 1 && (() => {
                const sum = (k: 'open' | 'overdue' | 'dueToday' | 'noDate' | 'neverContacted' | 'offers') => team.reps.reduce((a, r) => a + (Number(r[k]) || 0), 0);
                return (
                  <tfoot>
                    <tr className="border-t-2 border-brand-gray/30 font-bold text-brand-black">
                      <td className="py-2 pr-3">Total ({team.reps.length})</td>
                      <td className="py-2 px-2 text-right font-mono">{sum('open')}</td>
                      <td className="py-2 px-2 text-right font-mono">{sum('overdue')}</td>
                      <td className="py-2 px-2 text-right font-mono">{sum('dueToday')}</td>
                      <td className="py-2 px-2 text-right font-mono">{sum('noDate')}</td>
                      <td className="py-2 px-2 text-right font-mono">{sum('neverContacted')}</td>
                      <td className="py-2 pl-2 text-right font-mono">{sum('offers')}</td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
          <p className="text-[10px] text-brand-gray">Open leads count only leads not Won, Lost, Not Interested, Low Budget or Wrong Number. Offers sent counts every lead of the person with an offer, closed ones included.</p>
        </Card>
      )}

      {/* speed of first contact */}
      <Card title="How fast we move" info="Wait = first-contact time minus the lead date (midnight). 'Assigned to first contact' = first-contact time minus the time the lead was handed to its owner. Leads with an owner but no first contact (and not won) are 'never contacted'.">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
          {[
            { l: 'Average wait', v: fmtSpan(A.speed.avgDays) },
            { l: 'Median wait', v: fmtSpan(A.speed.medianDays) },
            { l: 'Reached same or next day', v: A.speed.measured ? fmtPct(((A.speed.bands.same) / A.speed.measured) * 100) : '—' },
            { l: 'Assigned → first contact', v: A.speed.avgAssignHours == null ? '—' : A.speed.avgAssignHours < 48 ? `${A.speed.avgAssignHours.toFixed(1)} h` : `${(A.speed.avgAssignHours / 24).toFixed(1)} days` },
            { l: 'Never contacted', v: A.speed.never },
          ].map((x) => (
            <div key={x.l} className="border border-brand-gray/15 rounded-xl p-3">
              <p className="text-lg font-black font-mono text-brand-black">{x.v}</p>
              <p className="text-[10px] font-bold text-brand-gray uppercase tracking-wide">{x.l}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-brand-gray">{A.speed.measured} leads have a first-contact time{A.speed.assignMeasured ? `; ${A.speed.assignMeasured} also have an assignment time` : ''}.</p>
      </Card>

      {/* distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Leads by channel" info="Source after merging spellings (Fb, FB leads → Facebook). Top 10 by lead count; leads with no source are 'Not recorded'.">
          <div className="h-56 relative">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <PieChart>
                <Pie data={sourceChart} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                  {sourceChart.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => [`${v} leads`]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {sourceChart.map((s, i) => (
              <div key={s.name} className="flex items-center gap-1.5 text-[10px] text-brand-gray font-semibold">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} /><span className="truncate">{s.name} ({s.value})</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Leads by project" info="Project name after fixing typos. Top 9 by lead count.">
          <div className="h-60">
            {projectChart.length ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={projectChart} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                  <XAxis type="number" stroke="#6b7280" fontSize={10} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" stroke="#6b7280" fontSize={9} width={110} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>{projectChart.map((_, i) => <Cell key={i} fill={COLORS[(i + 1) % COLORS.length]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-full flex items-center justify-center text-xs text-brand-gray">No leads</div>}
          </div>
        </Card>
        <Card title="Leads by status" info="Current status of every lead in the period, exactly as the team writes it (17 statuses; older statuses of earlier rows are listed too).">
          <div className="h-60">
            {statusChart.length ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={statusChart} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                  <XAxis type="number" stroke="#6b7280" fontSize={10} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" stroke="#6b7280" fontSize={9} width={130} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#388E3C" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-full flex items-center justify-center text-xs text-brand-gray">No leads</div>}
          </div>
        </Card>
      </div>
      <Card title="Leads by priority" info="Priority is set by Sales Operation. 'Urgent' on older rows is shown as VIP and 'Normal' as Medium.">
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <BarChart data={priorityChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
              <XAxis dataKey="name" stroke="#6b7280" fontSize={11} tickLine={false} />
              <YAxis stroke="#6b7280" fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>{priorityChart.map((p) => <Cell key={p.name} fill={PRIORITY_COLORS[p.name]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
};
