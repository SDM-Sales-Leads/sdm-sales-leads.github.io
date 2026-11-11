// Lara — Interactions: ONE inbox for every channel (e-mail, WhatsApp, web chat), like an omnichannel service desk.
// Paged and filtered on the server; the list reads one summary row per conversation; messages load only for the open conversation,
// 40 at a time. A salesperson can answer in any channel from here (same safety rules as Lara: test lock, opt-out, 24-hour window).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Mail, MessageSquare, MessageCircle, Search, Loader2, RefreshCw, ArrowLeft, Phone, Send, Bot, ExternalLink, Sparkles, Inbox as InboxIcon,
  UserRound, Workflow, ShieldCheck, Globe,
} from 'lucide-react';
import type { Lead } from '../crm/types';
import { crmNav } from '../crm/crmNav';
import { Pager, useDebounced } from './Pager';
import { StartWithLara } from './StartWithLara';

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api${path}`, init ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const post = (p: string, b: any) => api(p, { method: 'POST', body: JSON.stringify(b) });
const isAr = (t: string) => /[؀-ۿ]/.test(t || '');
const ago = (iso?: string | null) => {
  if (!iso) return '—';
  const m = (Date.now() - Date.parse(iso)) / 60000;
  if (m < 1) return 'now'; if (m < 60) return `${Math.floor(m)} m`; if (m < 1440) return `${Math.floor(m / 60)} h`; if (m < 10080) return `${Math.floor(m / 1440)} d`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const CH: Record<string, { label: string; icon: React.ReactNode; tone: string }> = {
  email: { label: 'E-mail', icon: <Mail size={12} />, tone: 'bg-sky-100 text-sky-800' },
  whatsapp: { label: 'WhatsApp', icon: <MessageSquare size={12} />, tone: 'bg-green-100 text-green-800' },
  web: { label: 'Chat', icon: <MessageCircle size={12} />, tone: 'bg-violet-100 text-violet-800' },
};
const ST: Record<string, { label: string; tone: string }> = {
  open: { label: 'Lara', tone: 'bg-brand-gray/10 text-brand-black' },
  handover: { label: 'Salesperson', tone: 'bg-amber-100 text-amber-800' },
  stopped: { label: 'Said stop', tone: 'bg-rose-100 text-rose-800' },
  closed: { label: 'Closed', tone: 'bg-brand-gray/20 text-brand-gray' },
};
const BY: Record<string, string> = { landbank: 'Land Bank data', qa: 'Approved answer', ai: 'AI (from approved facts)', holding: 'Holding reply', rule: 'Rule', code: 'Subject code', sender: 'Sender', phone: 'Phone', chat: 'Chat' };
const VIEWS: [string, string][] = [['', 'All'], ['unread', 'Unread'], ['waiting', 'Waiting on us'], ['handover', 'With salesperson'], ['visitors', 'Website visitors'], ['mine', 'Mine']];

export const LaraInbox: React.FC<{ leads: Lead[]; isAdmin: boolean; reload: () => void; extra?: React.ReactNode }> = ({ leads, isAdmin, reload, extra }) => {
  const [view, setView] = useState('');
  const [ch, setCh] = useState('');
  const [owner, setOwner] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [qRaw, setQRaw] = useState(''); const q = useDebounced(qRaw.trim(), 400);
  const [page, setPage] = useState(1); const [size, setSize] = useState(25);
  const [res, setRes] = useState<any>(null); const [busy, setBusy] = useState(false);
  // a conversation asked for from elsewhere (lead drawer "In Interactions"): opened once, then forgotten
  const [openId, setOpenId] = useState<string | null>(() => { try { const v = sessionStorage.getItem('lara_open_thread'); sessionStorage.removeItem('lara_open_thread'); return v; } catch { return null; } });
  useEffect(() => { const f = (e: Event) => { const id = (e as CustomEvent).detail; if (id) setOpenId(String(id)); }; window.addEventListener('lara-open-thread', f); return () => window.removeEventListener('lara-open-thread', f); }, []);
  const [more, setMore] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);   // phones: salesperson and dates fold away
  const owners = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads) { const id = l.assignedSalespersonId, n = l.assignedSalespersonName; if (id && n) m.set(String(id), String(n)); }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [leads]);
  const load = useCallback(async () => {
    setBusy(true);
    const p = new URLSearchParams({ page: String(page), size: String(size) });
    if (q) p.set('q', q); if (ch) p.set('channel', ch); if (owner) p.set('owner', owner); if (from) p.set('from', from); if (to) p.set('to', to);
    if (view === 'handover') p.set('status', 'handover'); else if (view) p.set('view', view);
    try { setRes(await api(`/lara/inbox?${p}`)); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }, [page, size, q, ch, owner, from, to, view]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, ch, owner, from, to, view, size]);
  const k = res?.counts || {};
  const count: Record<string, number | undefined> = { '': k.all, unread: k.unread, waiting: k.waiting, handover: k.handover, visitors: k.visitors };

  return (
    <div className="space-y-3 pb-20 lg:pb-0">
      <div className="bento-card bg-white border border-brand-gray/20 rounded-2xl p-3 shadow-sm space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="font-extrabold text-sm flex items-center gap-2 mr-2"><InboxIcon size={16} className="text-brand-red" />Interactions</h3>
          {VIEWS.filter(([v]) => isAdmin || v !== 'visitors').map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={`text-xs font-bold rounded-full px-3 py-1 border ${view === v ? 'bg-brand-red text-white border-brand-red' : 'border-brand-gray/20 hover:bg-brand-gray/5'}`}>
              {l}{count[v] != null && <span className={`ml-1 ${view === v ? 'text-white/80' : 'text-brand-gray'}`}>{count[v]}</span>}
            </button>
          ))}
          <button onClick={() => setStarting(true)} className="ml-auto btn-primary rounded-xl px-3 py-1 text-xs font-bold flex items-center gap-1"><Bot size={13} />New interaction</button>
          <button onClick={() => void load()} className="text-xs font-bold text-brand-gray flex items-center gap-1" title="Refresh"><RefreshCw size={13} className={busy ? 'animate-spin' : ''} />Refresh</button>
          {extra && <button onClick={() => setMore((v) => !v)} className="text-xs font-bold text-brand-gray underline">{more ? 'Hide' : 'Unknown senders & do-not-contact'}</button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]"><Search size={14} className="absolute left-3 top-2.5 text-brand-gray" /><input value={qRaw} onChange={(e) => setQRaw(e.target.value)} placeholder="Search name, phone, e-mail, code or any message text…" className="input-field w-full pl-8 text-sm" /></div>
          <div className="flex rounded-xl border border-brand-gray/20 overflow-hidden text-xs font-bold">
            {[['', 'All'], ['email', 'E-mail'], ['whatsapp', 'WhatsApp'], ['web', 'Chat']].map(([v, l]) => <button key={v} onClick={() => setCh(v)} className={`px-2.5 py-1.5 ${ch === v ? 'bg-brand-black text-white' : ''}`}>{l}</button>)}
          </div>
          <button onClick={() => setShowFilters((v) => !v)} className={`sm:hidden text-xs font-bold rounded-xl px-2.5 py-1.5 border ${owner || from || to ? 'border-brand-red text-brand-red' : 'border-brand-gray/20'}`}>Filters{owner || from || to ? ' •' : ''}</button>
          <div className={`${showFilters ? 'grid' : 'hidden'} sm:flex grid-cols-2 gap-2 w-full sm:w-auto items-center`}>
            {isAdmin && <select value={owner} onChange={(e) => setOwner(e.target.value)} className="input-field text-xs py-1.5 col-span-2 sm:max-w-[170px]"><option value="">Every salesperson</option>{owners.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
            <label className="text-[10px] text-brand-gray sm:flex sm:items-center sm:gap-1">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-field text-xs py-1 w-full sm:w-auto" /></label>
            <label className="text-[10px] text-brand-gray sm:flex sm:items-center sm:gap-1">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-field text-xs py-1 w-full sm:w-auto" /></label>
          </div>
        </div>
      </div>
      {more && extra}
      {starting && <StartWithLara onClose={() => setStarting(false)} onDone={(tid) => { void load(); if (tid) setOpenId(tid); }} />}
      <div className="grid lg:grid-cols-[minmax(280px,360px)_1fr] xl:grid-cols-[360px_1fr_280px] gap-3 items-start">
        <section className={`bento-card bg-white border border-brand-gray/20 rounded-2xl shadow-sm p-2 ${openId ? 'hidden lg:block' : ''}`}>
          {!res ? <div className="p-6 flex justify-center"><Loader2 className="animate-spin text-brand-gray" /></div> : res.rows.length === 0 ? (
            <p className="text-sm text-brand-gray p-6 text-center">{q || ch || view ? 'Nothing matches these filters.' : 'No conversations yet. They start when a customer replies, writes on WhatsApp or opens the chat.'}</p>
          ) : (
            <ul className="divide-y divide-brand-gray/10">{res.rows.map((t: any) => (
              <li key={t.id}>
                <button onClick={() => setOpenId(t.id)} className={`w-full text-left px-2.5 py-2.5 rounded-xl flex gap-2.5 hover:bg-brand-gray/5 ${openId === t.id ? 'bg-brand-red/5' : ''}`}>
                  <span className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-sm font-extrabold ${t.visitor ? 'bg-violet-100 text-violet-800' : 'bg-brand-red/10 text-brand-red'}`}>{t.visitor ? <Globe size={15} /> : String(t.customer || '?').trim().charAt(0).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5"><b className={`text-sm truncate ${t.unread ? 'text-brand-black' : 'font-semibold'}`} dir="auto">{t.customer}</b><span className="ml-auto text-[10px] text-brand-gray shrink-0">{ago(t.last_at)}</span></span>
                    <span className="flex items-center gap-1 text-[11px] text-brand-gray">
                      {(t.channels || []).map((c: string) => <span key={c} className={`rounded px-1 ${CH[c]?.tone || ''}`}>{CH[c]?.icon}</span>)}
                      <span className="truncate" dir="auto">{t.last_dir === 'in' ? '' : 'You/Lara: '}{t.last_preview || '—'}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px] mt-0.5">
                      <span className={`rounded-full px-1.5 py-0.5 font-bold ${ST[t.status]?.tone}`}>{ST[t.status]?.label || t.status}</span>
                      {t.owner && <span className="text-brand-gray truncate">{t.owner}</span>}
                      {t.pending > 0 && <span className="text-amber-700 font-bold">{t.pending} draft</span>}
                      {t.unread > 0 && <span className="ml-auto bg-brand-red text-white rounded-full px-1.5 font-bold">{t.unread}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}</ul>
          )}
          {res && <div className="px-2 pb-1"><Pager page={page} size={size} total={res.total} onPage={setPage} onSize={setSize} busy={busy} /></div>}
        </section>
        {openId ? <Conversation key={openId} id={openId} isAdmin={isAdmin} onBack={() => setOpenId(null)} onChanged={() => { void load(); reload(); }} />
          : <section className="hidden lg:flex bento-card bg-white border border-brand-gray/20 rounded-2xl shadow-sm p-10 text-sm text-brand-gray items-center justify-center xl:col-span-2">Pick a conversation to read the whole history across e-mail, WhatsApp and chat.</section>}
      </div>
    </div>
  );
};

/** one conversation (all channels). `compact` = inside the lead / customer drawer (no side panel). Exported for the 360 views. */
export const Conversation: React.FC<{ id: string; isAdmin: boolean; onBack?: () => void; onChanged: () => void; compact?: boolean }> = ({ id, isAdmin, onBack, onChanged, compact }) => {
  const [d, setD] = useState<any>(null);
  const [older, setOlder] = useState(false);
  const [text, setText] = useState(''); const [subject, setSubject] = useState('');
  const [chan, setChan] = useState<string>('');
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try { const r = await api(`/lara/inbox/${id}`); setD(r); setChan((c) => c || (r.thread.hasChat && r.thread.last_channel === 'web' ? 'web' : r.thread.last_channel === 'whatsapp' ? 'whatsapp' : r.thread.visitor ? 'web' : 'email')); }
    catch (e: any) { toast.error(e.message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [d?.messages?.length]);
  // a live web chat refreshes itself every 20 s while this screen is visible (and only for 30 minutes after the last message)
  useEffect(() => {
    if (!d || d.thread.last_channel !== 'web' || Date.now() - Date.parse(d.thread.last_at || 0) > 30 * 60000) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 20000);
    return () => clearInterval(t);
  }, [d, load]);
  const loadOlder = async () => {
    if (!d?.messages?.length) return; setOlder(true);
    try { const r = await api(`/lara/inbox/${id}?before=${encodeURIComponent(d.messages[0].at)}`); setD((x: any) => ({ ...x, messages: [...r.messages, ...x.messages], more: r.more })); }
    catch (e: any) { toast.error(e.message); } finally { setOlder(false); }
  };
  const setStatus = async (status: string) => { try { await post(`/lara/threads/${id}/status`, { status }); toast.success('Saved'); void load(); onChanged(); } catch (e: any) { toast.error(e.message); } };
  const suggest = async () => {
    const last = [...(d?.messages || [])].reverse().find((m: any) => m.direction === 'in');
    if (!last) { toast.error('No customer message to answer'); return; }
    try {
      const r = await post('/smart/ask', { question: String(last.body).slice(0, 400) });
      const m = r.matches?.[0];
      if (r.answered && m) setText((isAr(last.body) ? m.a_ar || m.a_en : m.a_en || m.a_ar) || '');
      else toast.error('No approved answer for this question yet. Add one in Lara > Knowledge.');
    } catch (e: any) { toast.error(e.message); }
  };
  const send = async () => {
    if (!text.trim()) return; setSending(true);
    try {
      const r = await post(`/lara/inbox/${id}/reply`, { channel: chan, text, subject });
      if (r.sent) { toast.success(chan === 'web' ? 'Sent in the chat' : 'Sent'); setText(''); } else toast.error(`Not sent: ${r.note}`);
      void load(); onChanged();
    } catch (e: any) { toast.error(e.message); } finally { setSending(false); }
  };
  const openChat = async () => { try { const r = await post(`/lara/inbox/${id}/chat-link`, {}); window.open(r.url, '_blank', 'noopener'); } catch (e: any) { toast.error(e.message); } };
  if (!d) return <section className="bento-card bg-white border border-brand-gray/20 rounded-2xl shadow-sm p-10 flex justify-center xl:col-span-2"><Loader2 className="animate-spin text-brand-gray" /></section>;
  const t = d.thread, l = d.lead;
  const name = l?.customerName || t.visitor?.name || t.lead_id;
  const chans = [t.hasChat || t.visitor ? 'web' : '', t.visitor ? '' : 'email', t.visitor ? '' : 'whatsapp'].filter(Boolean);
  return (
    <>
      <section className={`bento-card bg-white border border-brand-gray/20 rounded-2xl shadow-sm flex flex-col ${compact ? 'min-h-[320px] max-h-[70vh]' : 'min-h-[60vh] max-h-[calc(100dvh-170px)]'}`}>
        <header className="p-3 border-b border-brand-gray/10 flex flex-wrap items-center gap-2">
          {onBack && !compact && <button onClick={onBack} className="lg:hidden text-brand-gray"><ArrowLeft size={18} /></button>}
          <div className="min-w-0">
            {t.visitor || compact ? <p className="font-extrabold text-sm truncate" dir="auto">{name}</p>
              : <button onClick={() => crmNav.lead(t.lead_id)} className="font-extrabold text-sm truncate hover:text-brand-red text-left" dir="auto" title="Open the lead here">{name}</button>}
            <p className="text-[11px] text-brand-gray">{t.visitor ? 'Website visitor (not a lead yet)' : t.lead_id} · <code>{t.code}</code></p>
          </div>
          <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${ST[t.status]?.tone}`}>{ST[t.status]?.label}</span>
          <div className="ml-auto flex flex-wrap gap-1.5 text-xs">
            {t.status !== 'handover' && <button onClick={() => setStatus('handover')} className="rounded-xl px-2.5 py-1 font-bold border border-amber-300 text-amber-800">Take over</button>}
            {t.status !== 'open' && t.status !== 'stopped' && <button onClick={() => setStatus('open')} className="rounded-xl px-2.5 py-1 font-bold border border-brand-gray/20">Give back to Lara</button>}
            {t.status !== 'closed' && <button onClick={() => setStatus('closed')} className="rounded-xl px-2.5 py-1 font-bold border border-brand-gray/20">Close</button>}
            {isAdmin && <button onClick={openChat} className="rounded-xl px-2.5 py-1 font-bold border border-violet-200 text-violet-800 flex items-center gap-1" title="Open the customer's chat page (staff test conversations only while Lara is on hold)"><ExternalLink size={12} />Customer view</button>}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-brand-gray/[0.03]">
          {d.more && <div className="text-center"><button onClick={loadOlder} disabled={older} className="text-xs font-bold text-brand-gray underline">{older ? 'Loading…' : 'Load older messages'}</button></div>}
          {d.messages.length === 0 && <p className="text-xs text-brand-gray text-center py-6">No messages yet.</p>}
          {d.messages.map((m: any) => {
            const out = m.direction === 'out'; const c = CH[m.channel || 'email'] || CH.email;
            const author = !out ? (t.visitor?.name || l?.customerName || 'Customer') : m.kind === 'staff' ? (m.author || 'Salesperson') : 'Lara';
            return (
              <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${out ? (m.kind === 'staff' ? 'bg-amber-50 border border-amber-200' : 'bg-brand-red/[0.06] border border-brand-red/15') : 'bg-white border border-brand-gray/15'}`}>
                  <p className="text-[10px] text-brand-gray mb-0.5 flex flex-wrap items-center gap-1">
                    <span className={`rounded px-1 flex items-center gap-0.5 ${c.tone}`}>{c.icon}{c.label}</span>
                    <b className="text-brand-black">{out && m.kind !== 'staff' ? <span className="inline-flex items-center gap-0.5"><Bot size={11} />Lara</span> : author}</b>
                    <span>{when(m.at)}</span>
                    {out && m.matched_by && BY[m.matched_by] && <span className={`rounded px-1 ${m.matched_by === 'ai' ? 'bg-fuchsia-100 text-fuchsia-800' : m.matched_by === 'holding' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{BY[m.matched_by]}</span>}
                    {m.wa_status && <span>· {m.wa_status}</span>}
                    {m.kind === 'auto' && <span className="rounded px-1 bg-brand-gray/10">automatic reply</span>}
                  </p>
                  {m.subject && m.channel !== 'web' && <p className="text-[11px] font-bold">{m.subject}</p>}
                  <p dir={isAr(m.body) ? 'rtl' : 'ltr'} className="whitespace-pre-line leading-relaxed">{m.body}</p>
                </div>
              </div>
            );
          })}
          <div ref={end} />
        </div>
        {d.pending.length > 0 && <p className="mx-3 mt-2 text-xs text-amber-900 bg-amber-50 rounded-lg px-2 py-1">{d.pending.length} Lara draft(s) for this customer wait in Drafts.</p>}
        {t.status === 'stopped' ? <p className="m-3 text-xs text-rose-800 bg-rose-50 rounded-lg px-3 py-2 flex items-center gap-1"><ShieldCheck size={13} />The customer asked to stop. No more messages on any channel.</p> : (
          <div className="p-3 border-t border-brand-gray/10 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-brand-gray">Reply by</span>
              {chans.map((c) => <button key={c} onClick={() => setChan(c)} className={`text-[11px] font-bold rounded-full px-2.5 py-1 flex items-center gap-1 border ${chan === c ? 'bg-brand-black text-white border-brand-black' : 'border-brand-gray/20'}`}>{CH[c].icon}{CH[c].label}</button>)}
              <button onClick={suggest} className="ml-auto text-[11px] font-bold text-brand-red flex items-center gap-1" title="Fill the reply with the approved answer to the customer's last question (no AI)"><Sparkles size={12} />Suggest an approved answer</button>
            </div>
            {chan === 'email' && <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (the conversation code is added)" className="input-field w-full text-sm" />}
            <div className="flex gap-2 items-end">
              <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }} dir="auto" rows={2} placeholder={chan === 'web' ? 'Write in the chat… (the customer sees it at once)' : 'Write your reply… (Ctrl/⌘ + Enter to send)'} className="input-field flex-1 text-sm" />
              <button onClick={send} disabled={sending || !text.trim() || !chan} className="btn-primary rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-1 disabled:opacity-50">{sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}Send</button>
            </div>
          </div>
        )}
      </section>
      {!compact && <aside className="hidden xl:block bento-card bg-white border border-brand-gray/20 rounded-2xl shadow-sm p-4 space-y-3 text-xs">
        {t.visitor ? (
          <>
            <p className="font-extrabold text-sm flex items-center gap-1.5"><Globe size={14} className="text-violet-700" />Website visitor</p>
            <Info k="Name" v={t.visitor.name} /><Info k="Mobile" v={t.visitor.phone ? <a href={`tel:+${t.visitor.phone}`} className="text-brand-red font-bold">+{t.visitor.phone}</a> : '—'} /><Info k="E-mail" v={t.visitor.email || '—'} /><Info k="Started" v={when(t.visitor.at)} />
            {t.match_lead_id ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-2 space-y-1.5">
                <p className="text-[11px] text-amber-900">Same mobile or e-mail as <button onClick={() => crmNav.lead(t.match_lead_id)} className="font-bold underline">{t.match_lead_id}</button>. Typed numbers prove nothing: check it is really the same customer before linking (their old history then joins this chat).</p>
                {isAdmin && <button onClick={async () => { if (!window.confirm(`Link this chat to ${t.match_lead_id}?`)) return; try { await post(`/lara/inbox/${id}/link-lead`, { leadId: t.match_lead_id }); toast.success('Linked to the lead'); onChanged(); } catch (e: any) { toast.error(e.message); } }} className="btn-primary w-full rounded-xl py-1 font-bold">It is the same customer — link</button>}
              </div>
            ) : <p className="text-[11px] text-brand-gray">Not a lead yet. Add them as a lead in Leads if they are a real customer; their chat stays here.</p>}
          </>
        ) : l ? (
          <>
            <p className="font-extrabold text-sm flex items-center gap-1.5"><UserRound size={14} className="text-brand-red" />Customer</p>
            <Info k="Status" v={l.status} /><Info k="Salesperson" v={l.assignedSalespersonName || '—'} /><Info k="Park" v={l.project || '—'} />
            <Info k="Size" v={l.requiredSize || '—'} /><Info k="Budget" v={l.budget || '—'} /><Info k="Source" v={l.source || '—'} />
            <Info k="Mobile" v={l.phoneNumber ? <a href={`tel:${l.phoneNumber}`} className="text-brand-red font-bold flex items-center gap-1"><Phone size={11} />{l.phoneNumber}</a> : '—'} />
            <Info k="E-mail" v={l.email || '—'} /><Info k="Last contact" v={l.lastContactDate ? String(l.lastContactDate).slice(0, 10) : '—'} /><Info k="Next follow-up" v={l.nextFollowUpDate ? String(l.nextFollowUpDate).slice(0, 10) : '—'} />
            <button onClick={() => crmNav.lead(t.lead_id)} className="btn-primary w-full rounded-xl py-1.5 font-bold">Open the lead here</button>
          </>
        ) : <p className="text-brand-gray">Lead not found.</p>}
        {d.workflow && (
          <div className="border-t border-brand-gray/10 pt-3 space-y-1">
            <p className="font-extrabold flex items-center gap-1.5"><Workflow size={13} className="text-brand-red" />Workflow</p>
            <p><b>{d.workflow.lara_workflows?.name || '—'}</b> · {d.workflow.status}</p>
            <p className="text-brand-gray">{d.workflow.why}</p>
            {d.workflow.status === 'active' && <p className="text-brand-gray">Next step {when(d.workflow.next_at)}</p>}
          </div>
        )}
        <div className="border-t border-brand-gray/10 pt-3 text-brand-gray">Channels used: {(t.channels || []).map((c: string) => CH[c]?.label || c).join(', ') || '—'} · {t.msg_count} messages</div>
        {t.memory && (t.memory.parks?.length || t.memory.asked) && <Memory m={t.memory} />}
      </aside>}
    </>
  );
};
const Info: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => <div className="flex justify-between gap-2"><span className="text-brand-gray">{k}</span><span className="text-right font-semibold" dir="auto">{v}</span></div>;

/** what Lara remembers about THIS conversation (rules, no AI) */
export const Memory: React.FC<{ m: any }> = ({ m }) => (
  <div className="border-t border-brand-gray/10 pt-3 space-y-1">
    <p className="font-extrabold flex items-center gap-1.5"><Sparkles size={13} className="text-brand-red" />Lara remembers</p>
    {m.parks?.length > 0 && <p>Interested in <b>{m.parks.join(', ')}</b>{m.size ? <> · about <b>{Number(m.size).toLocaleString('en-US')} m²</b></> : null}</p>}
    {m.asked && <p className="text-brand-gray" dir="auto">Last question: "{m.asked}"</p>}
    {m.offer?.at && <p>Initial offer sent {when(m.offer.at)}</p>}
    {m.handover && <p>Asked for a call {when(m.handover)}</p>}
  </div>
);
