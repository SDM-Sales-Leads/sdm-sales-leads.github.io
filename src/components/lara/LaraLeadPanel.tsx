// Lara inside the lead and the customer (360): the lead's whole conversation with Lara (every channel), what she remembers, the workflow step,
// answer in place, and "Start with Lara". Loaded only when opened (lazy), one small request per lead.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bot, Loader2, Workflow, Mail, MessageSquare, MessageCircle, Inbox } from 'lucide-react';
import type { Lead } from '../crm/types';
import { crmNav } from '../crm/crmNav';
import { Conversation, Memory } from './LaraInbox';
import { StartWithLara } from './StartWithLara';

const api = async (path: string) => {
  const r = await fetch(`/api${path}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const ST: Record<string, string> = { open: 'Lara is handling it', handover: 'With the salesperson', stopped: 'Customer said stop', closed: 'Closed' };
const CHI: Record<string, React.ReactNode> = { email: <Mail size={12} />, whatsapp: <MessageSquare size={12} />, web: <MessageCircle size={12} /> };

export const LaraLeadPanel: React.FC<{ lead: Lead; isAdmin: boolean }> = ({ lead, isAdmin }) => {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  const [start, setStart] = useState(false);
  const [ver, setVer] = useState(0);
  const load = useCallback(async () => { try { setD(await api(`/lara/lead/${encodeURIComponent(lead.id)}`)); setErr(''); } catch (e: any) { setErr(e.message); } }, [lead.id]);
  useEffect(() => { void load(); }, [load, ver]);
  if (err) return <p className="text-xs text-brand-gray">{err}</p>;
  if (!d) return <div className="py-4 flex justify-center"><Loader2 className="animate-spin text-brand-gray" size={18} /></div>;
  const t = d.thread;
  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {t ? <span className="font-bold rounded-full px-2.5 py-1 bg-brand-red/10 text-brand-red flex items-center gap-1"><Bot size={12} />{ST[t.status] || t.status}</span>
          : <span className="text-brand-gray">Lara has not talked to this customer yet.</span>}
        {t && <span className="text-brand-gray flex items-center gap-1">{(t.channels || []).map((c: string) => <span key={c}>{CHI[c]}</span>)}{t.msg_count} messages · last {when(t.last_at)}{t.started_by ? ` · handed to Lara by ${t.started_by}` : ''}</span>}
        <div className="ml-auto flex gap-1.5">
          {t && <button onClick={() => crmNav.interaction(t.id)} className="btn-secondary rounded-xl px-2.5 py-1 font-bold flex items-center gap-1"><Inbox size={12} />In Interactions</button>}
          {t?.status !== 'stopped' && <button onClick={() => setStart(true)} className="btn-primary rounded-xl px-3 py-1 font-bold flex items-center gap-1"><Bot size={12} />{t ? 'Lara: new message / workflow' : 'Start with Lara'}</button>}
        </div>
      </div>
      {d.workflow && <p className="flex items-center gap-1.5 text-brand-gray"><Workflow size={12} className="text-brand-red" />Workflow <b className="text-brand-black">{d.workflow.lara_workflows?.name || '—'}</b> · {d.workflow.status}{d.workflow.status === 'active' ? ` · next step ${when(d.workflow.next_at)}` : ''}</p>}
      {d.pending?.length > 0 && <p className="text-amber-900 bg-amber-50 rounded-lg px-2 py-1">{d.pending.length} Lara draft(s) for this lead wait for approval in Lara › Drafts.</p>}
      {t?.memory && (t.memory.parks?.length || t.memory.asked) ? <div className="bg-brand-gray/5 rounded-xl px-3 pb-2"><Memory m={t.memory} /></div> : null}
      {t && <Conversation key={`${t.id}-${ver}`} id={t.id} isAdmin={isAdmin} compact onChanged={() => setVer((v) => v + 1)} />}
      {start && <StartWithLara lead={lead} onClose={() => setStart(false)} onDone={() => setVer((v) => v + 1)} />}
    </div>
  );
};

/** a customer with several leads: one row per conversation (only leads this person may see); a click opens that lead in place on its Lara tab */
export const LaraContactPanel: React.FC<{ leadIds: string[] }> = ({ leadIds }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    if (!leadIds.length) { setRows([]); return; }
    let off = false;
    void api(`/lara/contact?leads=${encodeURIComponent(leadIds.slice(0, 50).join(','))}`).then((r) => { if (!off) setRows(r.rows); }).catch((e) => { toast.error(e.message); setRows([]); });
    return () => { off = true; };
  }, [leadIds.join(',')]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <div className="py-6 flex justify-center"><Loader2 className="animate-spin text-brand-gray" size={18} /></div>;
  if (!rows.length) return <p className="text-xs text-brand-gray py-6 text-center">Lara has no conversations with this customer on leads you can see.</p>;
  return (
    <ul className="divide-y divide-brand-gray/10 bg-white rounded-2xl border border-brand-gray/20 shadow-sm">
      {rows.map((t) => (
        <li key={t.id}><button onClick={() => crmNav.lead(t.lead_id, 'lara')} className="w-full text-left px-4 py-3 hover:bg-brand-gray/5 text-xs">
          <p className="flex items-center gap-2"><b className="font-mono text-brand-red">{t.lead_id}</b><span>{t.project || '—'}</span><span className="text-brand-gray">{t.owner || 'no owner'} · {t.leadStatus}</span><span className="ml-auto text-brand-gray">{when(t.last_at)}</span></p>
          <p className="text-brand-gray mt-0.5 flex items-center gap-1">{(t.channels || []).map((c: string) => <span key={c}>{CHI[c]}</span>)}<span className="truncate" dir="auto">{t.last_dir === 'in' ? '' : 'Lara/you: '}{t.last_preview || '—'}</span><span className="ml-auto">{ST[t.status] || t.status} · {t.msg_count} messages</span></p>
        </button></li>
      ))}
    </ul>
  );
};
