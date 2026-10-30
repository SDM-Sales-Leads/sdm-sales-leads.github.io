// Rep activity: who worked today, what each salesperson did between two moments (any date and time, Cairo time), how many different
// customers they contacted per hour / day / week / month, and when each one was last active. A salesperson sees their own row only;
// team leaders see their team; managers see everybody (the server decides).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Card, InfoTip, Kpi } from './CrmMetricsUi';
import { Column, DataTable, ExportBar } from './ReportParts';

interface Point { k: string; contacted: number; actions: number }
interface Recent { at: string; what: string; leadId: string; customer: string }
interface Person {
  id: string; name: string; role: string; onLeave: boolean;
  contacted: number; leadsTouched: number; actions: number; activeDays: number;
  calls: number; whatsapp: number; emails: number; meetings: number; status: number; notes: number; offers: number;
  lastAt: string | null; lastWhat: string; lastLead: string; activeToday: boolean; series: Point[]; recent: Recent[];
}
interface Data { by: string; buckets: string[]; from: string; to: string; todayStart: string; now: string; scope: string; people: Person[] }

// ---- Cairo wall-clock helpers (the team works in Cairo time whatever the browser says) ----
const TZ = 'Africa/Cairo';
const PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
const cairo = (ms: number) => { const p: Record<string, string> = {}; for (const x of PARTS.formatToParts(new Date(ms))) p[x.type] = x.value; return p; };
const p2 = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
/** "YYYY-MM-DDTHH:mm" for an instant, as the Cairo clock shows it */
const inputOf = (ms: number) => { const p = cairo(ms); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

type Preset = 'today' | 'yesterday' | 'week' | '7d' | 'month' | 'custom';
function presetRange(k: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const now = Date.now(); const p = cairo(now);
  const day = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  const at = (d: Date, hm: string) => `${ymd(d)}T${hm}`;
  if (k === 'today') return { from: at(day, '00:00'), to: inputOf(now) };
  if (k === 'yesterday') { const y = new Date(day.getTime() - 86400_000); return { from: at(y, '00:00'), to: at(y, '23:59') }; }
  if (k === 'week') return { from: at(new Date(day.getTime() - (DOW[p.weekday] ?? 0) * 86400_000), '00:00'), to: inputOf(now) };   // the week starts on Sunday
  if (k === '7d') return { from: inputOf(now - 7 * 86400_000), to: inputOf(now) };
  return { from: at(new Date(Date.UTC(+p.year, +p.month - 1, 1)), '00:00'), to: inputOf(now) };
}
const PRESETS: { id: Exclude<Preset, 'custom'>; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' }, { id: 'week', label: 'This week' }, { id: '7d', label: 'Last 7 days' }, { id: 'month', label: 'This month' },
];

const clock = (iso: string) => { const p = cairo(Date.parse(iso)); return `${p.hour}:${p.minute}`; };
const dayTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
function ago(iso: string | null, now: number): string {
  if (!iso) return '—';
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min ` : ''}ago`;
  const d = Math.floor(m / 1440); return `${d} day${d === 1 ? '' : 's'} ago`;
}
const BY = [{ id: 'hour', label: 'Hour' }, { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }];
const bucketLabel = (k: string, by: string) => {
  if (by === 'hour') return k.slice(11, 16);
  if (by === 'month') return new Date(`${k}-01T12:00:00Z`).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const d = new Date(`${k}T12:00:00Z`); const s = d.toLocaleString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return by === 'week' ? `Wk ${s}` : s;
};

export const CrmRepActivity: React.FC = () => {
  const [preset, setPreset] = useState<Preset>('today');
  const [range, setRange] = useState(() => presetRange('today'));
  const [by, setBy] = useState('hour');   // Today is the first view: by hour
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [tick, setTick] = useState(Date.now());

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      const r = await fetch(`/api/crm/productivity?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&by=${by}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error || j?.message || 'Could not load the activity report'); setData(null); }
      else { setErr(''); setData(j); }
    } catch { setErr('Could not reach the server'); }
    setBusy(false); setTick(Date.now());
  }, [range.from, range.to, by]);
  useEffect(() => { void load(); }, [load]);
  // a range that ends "now" keeps moving: refresh it every minute and move its end forward
  const live = preset !== 'custom' && preset !== 'yesterday';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') setRange(presetRange(preset)); }, 60000);   // 30 Oct 2026: a hidden tab no longer calls the server every minute
    return () => clearInterval(t);
  }, [live, preset]);

  const pick = (k: Exclude<Preset, 'custom'>) => {
    setPreset(k); setRange(presetRange(k));
    setBy(k === 'today' || k === 'yesterday' ? 'hour' : k === 'month' ? 'day' : 'day');
  };
  const people = data?.people || [];
  const nowMs = data ? Date.parse(data.now) : tick;
  const nActive = people.filter((p) => p.activeToday).length;
  const tot = useMemo(() => ({
    contacted: people.reduce((a, p) => a + p.contacted, 0), actions: people.reduce((a, p) => a + p.actions, 0),
    working: people.filter((p) => p.actions > 0).length,
  }), [people]);
  const idle = people.filter((p) => !p.activeToday && !p.onLeave);
  const selP = people.find((p) => p.id === sel) || null;
  const buckets = data?.buckets || [];
  const maxCell = Math.max(1, ...people.flatMap((p) => p.series.map((s) => s.contacted)));

  const cols: Column<Person>[] = [
    { id: 'name', head: 'Salesperson', sort: (p) => p.name, cell: (p) => <span className="font-bold">{p.name}<span className="block text-[10px] font-semibold text-brand-gray">{p.role}</span></span> },
    { id: 'today', head: 'Today', info: 'Active today = this person did something in the system since midnight (Cairo time): logged a call, WhatsApp, e-mail, meeting, status update or note, or saved a lead.', sort: (p) => (p.onLeave ? 0 : p.activeToday ? 2 : 1),
      cell: (p) => p.onLeave ? <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-brand-gray/15 text-brand-gray">On leave</span>
        : p.activeToday ? <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">● Active</span>
        : <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">No activity</span> },
    { id: 'last', head: 'Last activity', info: 'The most recent thing this person did, whatever the dates picked above: a logged call / message / meeting / status update / note, or a saved lead.', sort: (p) => (p.lastAt ? Date.parse(p.lastAt) : null),
      cell: (p) => p.lastAt ? <span>{ago(p.lastAt, nowMs)}<span className="block text-[10px] font-semibold text-brand-gray">{p.lastWhat} · {dayTime(p.lastAt)}</span></span> : <span className="text-brand-gray">None recorded</span> },
    { id: 'contacted', head: 'Customers contacted', right: true, info: 'Different customers (leads) this person logged a call, WhatsApp, e-mail, meeting or status update for in the period. The same customer counted once, however many times.', sort: (p) => p.contacted, cell: (p) => <b>{p.contacted}</b> },
    { id: 'calls', head: 'Calls', right: true, sort: (p) => p.calls, cell: (p) => p.calls || '—' },
    { id: 'wa', head: 'WhatsApp', right: true, sort: (p) => p.whatsapp, cell: (p) => p.whatsapp || '—' },
    { id: 'em', head: 'E-mails', right: true, sort: (p) => p.emails, cell: (p) => p.emails || '—' },
    { id: 'mt', head: 'Meetings', right: true, sort: (p) => p.meetings, cell: (p) => p.meetings || '—' },
    { id: 'st', head: 'Status updates', right: true, sort: (p) => p.status, cell: (p) => p.status || '—' },
    { id: 'nt', head: 'Notes', right: true, sort: (p) => p.notes, cell: (p) => p.notes || '—' },
    { id: 'ac', head: 'All actions', right: true, sort: (p) => p.actions, cell: (p) => p.actions || '—' },
    { id: 'ad', head: 'Active days', right: true, info: 'Days in the period with at least one action.', sort: (p) => p.activeDays, cell: (p) => p.activeDays || '—' },
  ];
  const sheets = () => [
    { name: 'Rep activity', rows: [['Salesperson', 'Role', 'Active today', 'Last activity', 'Last activity what', 'Customers contacted', 'Calls', 'WhatsApp', 'E-mails', 'Meetings', 'Status updates', 'Notes', 'Offers', 'All actions', 'Active days'],
      ...people.map((p) => [p.name, p.role, p.onLeave ? 'On leave' : p.activeToday ? 'Yes' : 'No', p.lastAt ? dayTime(p.lastAt) : '', p.lastWhat, p.contacted, p.calls, p.whatsapp, p.emails, p.meetings, p.status, p.notes, p.offers, p.actions, p.activeDays])] },
    { name: 'Customers per period', rows: [['Salesperson', ...buckets.map((b) => bucketLabel(b, by))], ...people.map((p) => [p.name, ...p.series.map((s) => s.contacted)])] },
  ];

  const inp = 'bg-white border border-brand-gray/20 rounded-xl px-3 py-1.5 text-xs font-bold text-brand-black focus:outline-none focus:border-brand-red';
  const chip = (on: boolean) => `px-3 py-1.5 rounded-xl text-[11px] font-bold border ${on ? 'bg-brand-red text-white border-brand-red' : 'bg-white text-brand-black border-brand-gray/20 hover:border-brand-red/40'}`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-brand-black">Rep activity</h2>
        <p className="text-xs text-brand-gray font-semibold mt-0.5">Who worked, how many customers each salesperson contacted, and when they were last active. Cairo time.</p>
      </div>

      <div className="bg-white border border-brand-gray/20 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((x) => <button key={x.id} onClick={() => pick(x.id)} className={chip(preset === x.id)}>{x.label}</button>)}
          <button onClick={() => setPreset('custom')} className={chip(preset === 'custom')}>Pick dates</button>
          <span className="flex-1" />
          <button onClick={() => void load()} disabled={busy} className="bg-brand-gray/10 hover:bg-brand-gray/20 disabled:opacity-50 px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5"><RefreshCw size={12} className={busy ? 'animate-spin' : ''} />Refresh</button>
          <ExportBar name="rep-activity" sheets={sheets} disabled={!people.length} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-[10px] uppercase font-bold text-brand-gray flex items-center gap-2">From
            <input type="datetime-local" className={inp} value={range.from} max={range.to} onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, from: e.target.value })); }} /></label>
          <label className="text-[10px] uppercase font-bold text-brand-gray flex items-center gap-2">To
            <input type="datetime-local" className={inp} value={range.to} min={range.from} onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, to: e.target.value })); }} /></label>
          <span className="text-[10px] uppercase font-bold text-brand-gray">Group by</span>
          <div className="flex gap-1">{BY.map((b) => <button key={b.id} onClick={() => setBy(b.id)} className={chip(by === b.id)}>{b.label}</button>)}</div>
        </div>
        {data && by !== data.by && <p className="text-[10px] font-semibold text-amber-700">Hourly columns only fit up to 3 days, so this range is shown by day.</p>}
      </div>

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-2xl p-3">{err}</div>}
      {!data && !err && <div className="text-xs font-bold text-brand-gray">Loading…</div>}

      {data && (<>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Active today" value={`${nActive} / ${people.filter((p) => !p.onLeave).length}`} tone={nActive ? 'text-emerald-700' : 'text-rose-700'} sub={idle.length ? `No activity yet: ${idle.map((p) => p.name.split(' ')[0]).join(', ')}` : 'Everyone has done something today'}
            info="People who did something in the system since midnight today (Cairo time). Those on leave are not counted." />
          <Kpi label="Worked in this period" value={`${tot.working} / ${people.length}`} sub="at least one action between the dates" info="People with at least one logged action between the two moments picked above." />
          <Kpi label="Customers contacted" value={tot.contacted.toLocaleString('en-US')} sub="added up per person" info="Each person's different customers contacted in the period, added together. A customer two people both contacted counts once for each." />
          <Kpi label="All actions" value={tot.actions.toLocaleString('en-US')} sub="calls, messages, meetings, updates, notes" info="Every logged call, WhatsApp, e-mail, meeting, status update, note and offer in the period." />
        </div>

        <Card title="Per salesperson" info="Counted from what people log on the leads (timeline), by the Cairo clock. A call or message the phone buttons only opened counts as the attempt it was; what the customer said is the status update afterwards." right={<span className="text-[10px] text-brand-gray font-semibold">{dayTime(data.from)} → {dayTime(data.to)}</span>}>
          <DataTable rows={people} cols={cols} rowKey={(p) => p.id} onRow={(p) => setSel(sel === p.id ? null : p.id)} defaultSort={{ id: 'contacted', dir: 'desc' }} limit={100} empty="No salespeople to show." />
          <p className="text-[10px] text-brand-gray font-semibold">Click a row to see its timeline and latest actions.</p>
        </Card>

        {selP && (
          <Card title={`${selP.name} — ${selP.contacted} customers contacted`} right={<button onClick={() => setSel(null)} className="text-[10px] font-bold text-brand-red">Close</button>}>
            <div className="grid lg:grid-cols-2 gap-5">
              <div>
                <p className="text-[10px] uppercase font-bold text-brand-gray mb-2">Customers contacted per {by}</p>
                <div className="flex items-end gap-1 h-28 overflow-x-auto pb-5">
                  {selP.series.map((s) => (
                    <div key={s.k} className="flex flex-col items-center justify-end h-full min-w-[22px]" title={`${bucketLabel(s.k, by)}: ${s.contacted} customers, ${s.actions} actions`}>
                      <span className="text-[9px] font-mono font-bold text-brand-gray">{s.contacted || ''}</span>
                      <div className="w-4 rounded-t bg-brand-red" style={{ height: `${Math.max(s.contacted ? 3 : 0, (s.contacted / Math.max(1, ...selP.series.map((x) => x.contacted))) * 80)}%` }} />
                      <span className="text-[8px] text-brand-gray mt-1 whitespace-nowrap -rotate-45 origin-top-left translate-y-1">{bucketLabel(s.k, by)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-brand-gray mb-2">Latest actions in the period</p>
                {selP.recent.length === 0 ? <p className="text-xs text-brand-gray font-semibold">Nothing logged between these dates.</p> : (
                  <ul className="divide-y divide-brand-gray/10 text-xs">
                    {selP.recent.map((r, i) => (
                      <li key={i} className="py-1.5 flex items-center justify-between gap-3">
                        <span className="font-bold">{r.what}<span className="font-semibold text-brand-gray"> · {r.customer || r.leadId}</span></span>
                        <span className="font-mono text-[10px] text-brand-gray whitespace-nowrap">{dayTime(r.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>
        )}

        <Card title={`Customers contacted per ${by}`} info="Each cell: different customers that person contacted in that hour / day / week / month. Weeks start on Sunday.">
          {buckets.length === 0 || people.length === 0 ? <p className="text-xs text-brand-gray font-semibold">No data.</p> : (
            <div className="overflow-x-auto">
              <table className="text-[11px] border-separate border-spacing-0.5">
                <thead><tr><th className="text-left text-[10px] uppercase text-brand-gray font-bold pr-3 sticky left-0 bg-white">Salesperson</th>
                  {buckets.map((b) => <th key={b} className="text-[9px] font-bold text-brand-gray px-1 min-w-[34px] whitespace-nowrap">{bucketLabel(b, data.by)}</th>)}</tr></thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id}>
                      <td className="font-bold pr-3 whitespace-nowrap sticky left-0 bg-white">{p.name}</td>
                      {p.series.map((s) => (
                        <td key={s.k} title={`${bucketLabel(s.k, data.by)}: ${s.contacted} customers, ${s.actions} actions`} className="text-center font-mono font-bold rounded"
                          style={{ background: s.contacted ? `rgba(211,47,47,${0.12 + 0.6 * (s.contacted / maxCell)})` : 'rgba(0,0,0,0.04)', color: s.contacted && s.contacted / maxCell > 0.55 ? '#fff' : undefined }}>{s.contacted || ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <p className="text-[10px] text-brand-gray font-semibold flex items-center gap-1">How it is counted <InfoTip text="Only what is logged in the system is counted: calls, WhatsApp, e-mails and meetings recorded on a lead, status updates, notes and offers. A call made on the phone that nobody logged does not appear. Imported history from the old CRM counts on its original dates." /></p>
      </>)}
    </div>
  );
};
