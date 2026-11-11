// Lara insights (Control room): how customers reach her, how she answers, calls, ratings, what they ask about. One small request.
import React, { useEffect, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
export const LaraInsights: React.FC = () => {
  const [d, setD] = useState<any>(null); const [days, setDays] = useState(30);
  useEffect(() => { setD(null); void fetch(`/api/lara/insights?days=${days}`).then((r) => r.json()).then((j) => setD(j.success ? j : { error: j.error || 'Could not load' })).catch(() => setD({ error: 'Could not load' })); }, [days]);
  const Bar: React.FC<{ label: string; n: number; of: number; tone: string }> = ({ label, n, of, tone }) => (
    <div className="text-xs"><div className="flex justify-between"><span>{label}</span><b>{n} <span className="text-brand-gray font-normal">{pct(n, of)}</span></b></div><div className="h-1.5 bg-brand-gray/10 rounded-full overflow-hidden"><div className={`h-full ${tone}`} style={{ width: of > 0 ? `${Math.max(2, (n / of) * 100)}%` : '0%' }} /></div></div>
  );
  return (
    <section className="bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-3 lg:col-span-2">
      <div className="flex items-center justify-between"><h3 className="font-extrabold text-sm flex items-center gap-2"><BarChart3 size={16} className="text-brand-red" />Lara insights</h3>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input-field text-xs py-1"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></div>
      {!d ? <Loader2 className="animate-spin text-brand-gray" /> : d.error ? <p className="text-xs text-brand-gray">{d.error}</p> : (
        <div className="grid md:grid-cols-4 gap-5">
          <div className="space-y-2"><p className="text-[11px] font-extrabold text-brand-gray">CUSTOMERS REACHED LARA BY</p>
            <Bar label="Chat" n={d.in_chat} of={d.customer_msgs} tone="bg-violet-500" /><Bar label="Voice call" n={d.in_call} of={d.customer_msgs} tone="bg-rose-500" /><Bar label="E-mail" n={d.in_email} of={d.customer_msgs} tone="bg-sky-500" /><Bar label="WhatsApp" n={d.in_whatsapp} of={d.customer_msgs} tone="bg-green-500" />
            <p className="text-[11px] text-brand-gray">{d.customers} customers · {d.customer_msgs} messages</p></div>
          <div className="space-y-2"><p className="text-[11px] font-extrabold text-brand-gray">HOW SHE ANSWERED</p>
            <Bar label="Land Bank data" n={d.by_landbank} of={d.lara_replies} tone="bg-emerald-500" /><Bar label="Approved answers" n={d.by_qa} of={d.lara_replies} tone="bg-emerald-700" /><Bar label="AI" n={d.by_ai} of={d.lara_replies} tone="bg-fuchsia-500" /><Bar label="Passed to salesperson" n={d.by_holding} of={d.lara_replies} tone="bg-amber-500" />
            <p className="text-[11px] text-brand-gray">{d.lara_replies} Lara replies · {d.by_staff} by salespeople</p></div>
          <div className="space-y-1.5 text-xs"><p className="text-[11px] font-extrabold text-brand-gray">CALLS AND RATING</p>
            <p><b className="text-lg">{d.calls}</b> voice calls · {Math.round(d.call_seconds / 60)} min · {d.recorded} recorded</p>
            <p><b className="text-lg text-amber-500">{d.avg_rating ? `${d.avg_rating} ★` : '—'}</b> from {d.ratings} rating{d.ratings === 1 ? '' : 's'}</p>
            <p>{d.with_salesperson} with a salesperson · {d.stopped} said stop</p></div>
          <div className="space-y-1.5 text-xs"><p className="text-[11px] font-extrabold text-brand-gray">WHAT CUSTOMERS ASK ABOUT</p>
            {d.parks.length === 0 ? <p className="text-brand-gray">—</p> : d.parks.map((p: any) => <p key={p.park} className="flex justify-between"><span>{p.park}</span><b>{p.n}</b></p>)}
            {d.missed.length > 0 && <><p className="text-[11px] font-extrabold text-brand-gray pt-1">TOP UNANSWERED</p>{d.missed.slice(0, 3).map((m: any, i: number) => <p key={i} className="text-brand-gray truncate" dir="auto">{m.asked}× {m.question}</p>)}</>}</div>
        </div>
      )}
    </section>
  );
};
