import React, { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';

interface U {
  cycle: { from: string; to: string; daysLeft: number };
  monthToDate: { calls: number; egressMb: number };
  projection: { calls: number; egressMb: number };
  limits: { calls: number; egressMb: number };
  pct: { calls: number; egress: number };
  perDay: { day: string; calls: number; mb: number }[];
  top: { route: string; calls: number; mb: number }[];
  note: string;
}
const tone = (p: number) => (p >= 90 ? 'bg-rose-500' : p >= 70 ? 'bg-amber-500' : 'bg-emerald-500');
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const Bar: React.FC<{ label: string; used: string; proj: string; limit: string; pct: number; now: number }> = ({ label, used, proj, limit, pct, now }) => (
  <div className="bento-card !p-4">
    <div className="flex flex-wrap justify-between gap-2 text-sm"><b>{label}</b><span className="text-brand-gray">limit {limit}</span></div>
    <div className="h-3 rounded-full bg-black/5 overflow-hidden mt-2 relative">
      <div className={`h-full ${tone(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
      <div className="absolute top-0 bottom-0 w-0.5 bg-brand-black/60" style={{ left: `${Math.min(100, now)}%` }} title="used so far" />
    </div>
    <p className="text-xs text-brand-gray mt-2">So far <b className="text-brand-black">{used}</b> · projected for the month <b className={pct >= 70 ? 'text-rose-600' : 'text-brand-black'}>{proj}</b> ({pct}% of the limit)</p>
  </div>
);

/** month so far against the Supabase Free limits, with a projection and the heaviest routes */
export const UsagePanel: React.FC = () => {
  const [u, setU] = useState<U | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => { setBusy(true); setErr(''); fetch('/api/admin/usage').then((r) => (r.ok ? r.json() : Promise.reject())).then(setU).catch(() => setErr('Could not read the usage.')).finally(() => setBusy(false)); };
  useEffect(load, []);
  if (err) return <p className="text-sm text-rose-600">{err}</p>;
  if (!u) return <p className="text-sm text-brand-gray">Loading…</p>;
  const nowE = (u.monthToDate.egressMb / u.limits.egressMb) * 100, nowC = (u.monthToDate.calls / u.limits.calls) * 100;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-brand-gray">Billing month {u.cycle.from} to {u.cycle.to} · {u.cycle.daysLeft} days left · Free plan: no charge while inside the limits</p>
        <div className="flex gap-2">
          <a className="btn-secondary flex items-center gap-2" target="_blank" rel="noreferrer" href="https://supabase.com/dashboard/org/dpbawxjujjjanmomwttl/usage?projectRef=iyubegbevtjcvtuubpaq"><ExternalLink size={14} /> Supabase usage page</a>
          <button onClick={load} disabled={busy} className="btn-secondary flex items-center gap-2"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Refresh</button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <Bar label="Data sent out (egress)" used={`${fmt(u.monthToDate.egressMb)} MB`} proj={`${fmt(u.projection.egressMb)} MB`} limit="5,120 MB" pct={u.pct.egress} now={nowE} />
        <Bar label="Server calls" used={fmt(u.monthToDate.calls)} proj={fmt(u.projection.calls)} limit="500,000" pct={u.pct.calls} now={nowC} />
      </div>
      <div className="bento-card !p-0 overflow-x-auto">
        <h3 className="font-bold p-4 pb-2">Heaviest routes this month (data sent out)</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b border-black/5 text-xs uppercase text-brand-gray"><th className="p-3">Route</th><th className="p-3 text-right">Calls</th><th className="p-3 text-right">MB</th></tr></thead>
          <tbody className="divide-y divide-black/5">{u.top.map((t) => <tr key={t.route}><td className="p-3 font-mono text-xs">{t.route}</td><td className="p-3 text-right">{fmt(t.calls)}</td><td className="p-3 text-right font-semibold">{t.mb}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="bento-card !p-0 overflow-x-auto">
        <h3 className="font-bold p-4 pb-2">Per day</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b border-black/5 text-xs uppercase text-brand-gray"><th className="p-3">Day</th><th className="p-3 text-right">Calls</th><th className="p-3 text-right">MB out</th></tr></thead>
          <tbody className="divide-y divide-black/5">{[...u.perDay].reverse().slice(0, 14).map((d) => <tr key={d.day}><td className="p-3">{d.day}</td><td className="p-3 text-right">{fmt(d.calls)}</td><td className="p-3 text-right">{d.mb}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-brand-gray">{u.note} A warning arrives in the bell every morning the projection passes 70% of a limit.</p>
    </div>
  );
};
