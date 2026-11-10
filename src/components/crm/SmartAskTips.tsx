// Smart Assistant, phase 7: "Ask Lara" (approved Q&A only, no AI) and tips from the person's own use of the system (last 30 days).
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bot, Lightbulb, Loader2, Search } from 'lucide-react';
import { trackFeature } from './smartService';

const call = async (path: string, b?: any) => {
  const r = await fetch(`/api${path}`, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const sum = (f: Record<string, number>, pre: string) => Object.entries(f).reduce((n, [k, v]) => n + (k.startsWith(pre) ? v : 0), 0);
// each tip: shown when the person has not used that feature in 30 days
const TIPS: { pre: string; text: string }[] = [
  { pre: 'smart_write_', text: 'Use "Write for me" on a task: it writes a ready Arabic or English message with the right plot data, in three versions.' },
  { pre: 'smart_brief', text: 'Open the lead brief before you call: last contact, budget, matching plots and what was promised, on one screen.' },
  { pre: 'smart_send_wa_', text: 'Send WhatsApp straight from a task: the message opens ready in WhatsApp and the attempt is logged on the lead.' },
  { pre: 'smart_fix_', text: 'Clear "Fix my data": leads without a park, budget or next step cannot be matched or reminded.' },
  { pre: 'smart_myday', text: 'Open "All my tasks" each morning: everything due today across your leads, best first.' },
];

export const SmartAskTips: React.FC = () => {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [use, setUse] = useState<any>(null);
  useEffect(() => { let off = false; call('/smart/my-usage').then((r) => { if (!off) setUse(r); }).catch(() => {}); return () => { off = true; }; }, []);
  const ask = async () => {
    if (q.trim().length < 3) return;
    setBusy(true); trackFeature('smart_ask');
    try { setRes(await call('/smart/ask', { question: q })); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const tips = use ? TIPS.filter((t) => sum(use.features || {}, t.pre) === 0).slice(0, 3) : [];
  const ar = /[؀-ۿ]/.test(q);
  return (
    <>
      <section className="bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-3">
        <h3 className="font-extrabold text-brand-black text-sm flex items-center gap-2"><Bot size={16} className="text-brand-red" />Ask Lara</h3>
        <p className="text-[11px] text-brand-gray">Answers come only from the approved company answers (prices, parks, payment, licences). Arabic or English.</p>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }} dir="auto" placeholder="e.g. ما هي مدة التقسيط؟" className="input-field flex-1 text-sm" />
          <button onClick={ask} disabled={busy || q.trim().length < 3} className="btn-primary rounded-xl px-3 text-xs font-bold disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}</button>
        </div>
        {res && (res.answered ? (
          <div className="space-y-2">
            {res.matches.filter((m: any, i: number) => i === 0 || m.score >= 0.5).map((m: any, i: number) => (
              <div key={i} className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs space-y-1">
                <p className="font-bold" dir="auto">{m.q}</p>
                <p dir="auto" className="whitespace-pre-wrap">{(ar ? m.a_ar || m.a_en : m.a_en || m.a_ar) || '—'}</p>
              </div>
            ))}
          </div>
        ) : <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3">No approved answer yet. Ask your manager; the admin adds new answers in Lara → Knowledge.</p>)}
      </section>
      {use && (
        <section className="bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-2">
          <h3 className="font-extrabold text-brand-black text-sm flex items-center gap-2"><Lightbulb size={16} className="text-amber-500" />Tips from how you work</h3>
          <p className="text-[11px] text-brand-gray">From your own use of the assistant in the last 30 days ({use.days} active day{use.days === 1 ? '' : 's'}).</p>
          {tips.length ? <ul className="space-y-1.5">{tips.map((t) => <li key={t.pre} className="text-xs rounded-xl border border-brand-gray/15 px-3 py-2">{t.text}</li>)}</ul>
            : <p className="text-xs text-brand-gray">You already use every part of the assistant. Well done.</p>}
        </section>
      )}
    </>
  );
};
