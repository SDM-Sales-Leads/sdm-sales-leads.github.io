// Lara Sales AI — phase 2 (docs/LARA-SALES-AI-PLAN.md). Admin only (the server checks too). SHADOW mode: Lara writes the follow-ups
// she would send; the admin approves or rejects them to judge her quality. Nothing is sent. No AI: rules, templates, approved Q&A.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Bot, Play, Inbox, BookOpen, HelpCircle, Settings, ScrollText, CheckCircle2, XCircle, MessageSquare, Mail, Loader2, Search, Plus, Archive,
  RotateCcw, Send, ShieldCheck, Sparkles, ChevronRight, Database, Pencil,
} from 'lucide-react';
import type { Lead } from '../crm/types';
import { crmNav } from '../crm/crmNav';
import { SITUATION_LABEL } from '../crm/smartWriter';
import { LaraWorkflows } from './LaraWorkflows';
import { LaraWhatsApp } from './LaraWhatsApp';
import { LaraInbox } from './LaraInbox';
import { LaraChannels } from './LaraChannels';
import { LaraInsights } from './LaraInsights';
import { Pager, useDebounced } from './Pager';
import { LaraOffers, openInLandBank, openOfferPdf } from './LaraOffers';

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api${path}`, init ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const post = (path: string, b: any, method = 'POST') => api(path, { method, body: JSON.stringify(b) });
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const isAr = (t: string) => /[؀-ۿ]/.test(t || '');

const Card: React.FC<{ title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, right, children, className = '' }) => (
  <section className={`bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-3 ${className}`}>
    {(title || right) && <div className="flex items-center justify-between gap-2">{title && <h3 className="font-extrabold text-sm text-brand-black flex items-center gap-2">{title}</h3>}{right}</div>}
    {children}
  </section>
);
const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: string; tone?: string }> = ({ label, value, sub, tone = '' }) => (
  <div className="bg-white/10 rounded-2xl px-4 py-3"><p className="text-[10px] uppercase tracking-wider font-bold text-white/70">{label}</p><p className={`text-2xl font-extrabold ${tone}`}>{value}</p>{sub && <p className="text-[10px] text-white/70">{sub}</p>}</div>
);

interface Props { sub: string; leads: Lead[]; setActiveSubTab: (t: string) => void }

export const LaraModule: React.FC<Props> = ({ sub, leads, setActiveSubTab }) => {
  const [ov, setOv] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => { try { setOv(await api('/lara/overview')); setErr(''); } catch (e: any) { setErr(e.message); } }, []);
  useEffect(() => { void load(); }, [load]);   // once; actions call reload() (no re-download on every tab switch)
  const leadName = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  const slim = sub !== 'lara';   // the full header only on the Control room; the other tabs keep the screen for work (phone)
  return (
    <div className="space-y-5" id="lara-module">
      {slim && (
        <div className="rounded-2xl px-4 py-3 text-white bg-gradient-to-r from-brand-black to-brand-red flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="font-extrabold flex items-center gap-1.5"><Bot size={15} />Lara · {ov?.config?.mode === 'off' ? 'off' : ov?.config?.mode === 'approve' || ov?.config?.mode === 'auto' ? `${ov?.config?.mode === 'auto' ? 'Autopilot' : 'Approve first'} · sending ${ov?.config?.sendEnabled && ov?.channels?.email ? 'ON' : 'off'}` : 'Shadow mode'}</span>
          {ov && <><span>{ov.drafts30.shadow} drafts waiting</span><span>{ov.kbActive} answers</span><span className={ov.missedOpen ? 'text-amber-200 font-bold' : ''}>{ov.missedOpen} missed questions</span></>}
          <span className="ml-auto flex items-center gap-1 text-white/80"><ShieldCheck size={12} />{ov?.config?.mode === 'approve' && ov?.config?.sendEnabled && ov?.channels?.email ? 'only approved e-mails are sent' : 'nothing is sent'}</span>
        </div>
      )}
      <div className={`${slim ? 'hidden' : ''} rounded-3xl p-6 text-white shadow-lg bg-gradient-to-br from-brand-black via-[#3b2a33] to-brand-red relative overflow-hidden`}>
        <div className="absolute -right-12 -bottom-16 w-56 h-56 rounded-full bg-brand-red/40 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-widest text-white/70 flex items-center gap-1.5"><Bot size={14} />Lara Sales AI · admin preview</p>
            <h2 className="text-2xl font-extrabold">{ov?.config?.mode === 'off' ? 'Lara is switched off' : ov?.config?.mode === 'approve' ? 'Lara is working in Approve-first mode' : ov?.config?.mode === 'auto' ? 'Lara is on Autopilot' : 'Lara is working in Shadow mode'}</h2>
            <p className="text-sm text-white/85 max-w-2xl">She finds the leads nobody followed up and writes the message she would send. <b>Nothing is sent</b> and no lead is changed: you approve or reject each draft to judge her before she gets a channel. She uses rules, the team's message writer and your approved answers — <b>no AI, no cost</b>.</p>
          </div>
          <span className="text-[11px] font-bold bg-white/15 rounded-full px-3 py-1 flex items-center gap-1"><ShieldCheck size={13} />{ov?.config?.mode === 'approve' && ov?.config?.sendEnabled && ov?.channels?.email ? 'Only e-mails you approve are sent' : 'Safe: no messages leave the system'}</span>
        </div>
        {ov && (
          <div className="relative grid grid-cols-2 md:grid-cols-5 gap-3 mt-5">
            <Kpi label="Drafts waiting" value={ov.drafts30.shadow} />
            <Kpi label="Approved (30 d)" value={ov.drafts30.approved} sub={ov.drafts30.edited ? `${ov.drafts30.edited} edited first` : undefined} />
            <Kpi label="Rejected (30 d)" value={ov.drafts30.rejected} />
            <Kpi label="Approved answers" value={ov.kbActive} />
            <Kpi label="Missed questions" value={ov.missedOpen} tone={ov.missedOpen ? 'text-amber-200' : ''} />
          </div>
        )}
      </div>
      {ov?.testLock && <p className="text-xs font-bold text-amber-900 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 flex items-center gap-2"><ShieldCheck size={14} />ON HOLD for testing: Lara can e-mail only staff addresses (test lock). No customer receives anything until the owner lifts the lock.</p>}
      {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{err}</p>}

      {sub === 'lara' && (ov?.user ? <DraftInbox leadName={leadName} reload={load} ov={ov} /> : <Control ov={ov} reload={load} go={setActiveSubTab} />)}
      {sub === 'lara-inbox' && <DraftInbox leadName={leadName} reload={load} ov={ov} />}
      {sub === 'lara-convos' && <LaraInbox leads={leads} isAdmin={!ov?.user} reload={load} extra={ov && !ov.user ? <MailLists /> : undefined} />}
      {sub === 'lara-flows' && <LaraWorkflows reload={load} />}
      {sub === 'lara-offers' && <LaraOffers leads={leads} reload={load} go={setActiveSubTab} />}
      {sub === 'lara-kb' && <Knowledge reload={load} />}
      {sub === 'lara-missed' && <Missed reload={load} />}
      {sub === 'lara-settings' && <SettingsTab ov={ov} reload={load} />}
      {sub === 'lara-log' && <LogTab />}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Control room
// ---------------------------------------------------------------------------------------------
const Control: React.FC<{ ov: any; reload: () => void; go: (t: string) => void }> = ({ ov, reload, go }) => {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const r = await post('/lara/run', {}); toast.success(r.skipped ? `Not run: ${r.reason}` : `Lara wrote ${r.drafted} drafts (${r.eligible} leads needed a follow-up). Nothing was sent.`); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const labels = ov?.ruleLabels || {};
  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <div className="lg:col-span-3 grid"><LaraInsights /></div>
      <Card title={<><Play size={16} className="text-brand-red" />Run Lara</>} className="lg:col-span-1">
        <p className="text-xs text-brand-gray">Lara runs by herself every working day (Sun–Thu) at 09:00 Cairo time. You can also run her now. A lead that already has a draft waiting is skipped.</p>
        <button onClick={run} disabled={busy || ov?.config?.mode === 'off'} className="btn-primary w-full rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}Run Shadow now</button>
        <div className="text-xs bg-brand-gray/5 rounded-xl p-3">
          <p className="font-bold text-brand-black mb-1">Last run</p>
          {ov?.lastRun ? <><p>{when(ov.lastRun.at)} · {ov.lastRun.actor}</p><p className="text-brand-gray">{ov.lastRun.text}</p></> : <p className="text-brand-gray">Not run yet.</p>}
        </div>
      </Card>
      <Card title={<><Inbox size={16} className="text-brand-red" />Drafts waiting for you</>} right={<button onClick={() => go('lara-inbox')} className="text-xs font-bold text-brand-red flex items-center">Open inbox<ChevronRight size={14} /></button>} className="lg:col-span-2">
        {!ov ? <Loader2 className="animate-spin text-brand-gray" /> : (
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] uppercase font-bold text-brand-gray mb-1">Why Lara picked them</p>
              {Object.keys(ov.openByRule).length === 0 && <p className="text-xs text-brand-gray">No drafts waiting.</p>}
              {Object.entries(ov.openByRule).map(([k, v]: any) => <Row key={k} label={labels[k] || k} value={v} />)}
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-brand-gray mb-1">What she would say</p>
              {Object.entries(ov.openBySituation).map(([k, v]: any) => <Row key={k} label={(SITUATION_LABEL as any)[k] || k} value={v} />)}
            </div>
          </div>
        )}
      </Card>
      <Card title={<><Sparkles size={16} className="text-brand-red" />How Lara works (no AI)</>} className="lg:col-span-2">
        <ol className="text-xs text-brand-black space-y-1.5 list-decimal pl-4">
          <li><b>Follows your Workflows</b>: each one says when she starts on a lead (no first contact, overdue follow-up, offer without follow-up, no answer, stuck status, old lead), which leads, the steps and when she stops. Closed leads and leads with a planned meeting are left alone.</li>
          <li><b>Writes</b> the message with the team's smart writer: the customer's situation, name, park, size and real available Land Bank plots, in Arabic or English. No prices, no invented claims.</li>
          <li><b>Answers</b> customer questions only from the approved Q&A and the Land Bank list. A question she cannot answer goes to <b>Missed questions</b> for you.</li>
          <li><b>Learns from you</b>: every approval, edit and rejection is counted, so you see her quality before she gets a channel (phase 3).</li>
        </ol>
      </Card>
      <Card title={<><ShieldCheck size={16} className="text-emerald-600" />Channels</>}>
        <Row label="E-mail (own mailbox)" value={ov?.channels?.email ? <span className="text-emerald-700">Connected{ov.mailbox?.address ? ` · ${ov.mailbox.address}` : ''}</span> : <span className="text-amber-700">Not set up</span>} />
        <Row label="Sending" value={ov?.config?.mode === 'approve' && ov?.config?.sendEnabled ? <span className="text-emerald-700">On (approved only)</span> : <span className="text-brand-gray">Off</span>} />
        {ov?.send && <Row label="E-mails (30 d)" value={`${ov.send.sent} sent · ${ov.send.queued} queued · ${ov.send.failed} failed`} />}
        {ov && <Row label="Conversations" value={`${ov.threads?.open || 0} open · ${ov.threads?.handover || 0} handed over · ${ov.threads?.stopped || 0} stopped`} />}
        <Row label="WhatsApp (Meta Cloud API)" value={ov?.channels?.whatsapp ? <span className="text-emerald-700">Connected</span> : <span className="text-amber-700">Not set up</span>} />
        <Row label="AI model" value={<span className="text-emerald-700 font-bold">Not used</span>} />
        <button onClick={() => go('lara-settings')} className="text-xs font-bold text-brand-red flex items-center">Settings<ChevronRight size={14} /></button>
      </Card>
    </div>
  );
};
const Row: React.FC<{ label: React.ReactNode; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between text-xs py-1 border-b border-brand-gray/10 last:border-0"><span>{label}</span><b>{value}</b></div>
);

// ---------------------------------------------------------------------------------------------
// Inbox: shadow drafts to approve / reject
// ---------------------------------------------------------------------------------------------
const LABEL: Record<string, string> = { ...(SITUATION_LABEL as any), offer_initial: 'Initial financial offer (PDF)', reply_answer: 'Reply with an approved answer', reply_holding: 'Holding reply (no approved answer)' };
const REJECT = ['Wrong situation', 'Wrong tone', 'Wrong facts', 'Owner is already on it', 'Do not contact'];
const DraftInbox: React.FC<{ leadName: Map<string, Lead>; reload: () => void; ov: any }> = ({ leadName, reload, ov }) => {
  const canSend = (ov?.config?.mode === 'approve' || ov?.config?.mode === 'auto') && ov?.config?.sendEnabled && ov?.channels?.email;
  const [status, setStatus] = useState<'shadow' | 'approved' | 'rejected' | 'expired'>('shadow');
  const [rows, setRows] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1); const [size, setSize] = useState(10);
  const [qRaw, setQRaw] = useState(''); const q = useDebounced(qRaw.trim(), 400);
  const [ch, setCh] = useState(''); const [kind, setKind] = useState('');
  const [busy, setBusy] = useState(false);
  // one page from the server (10 by default) with only the fields the card needs; search and filters run on the server
  const load = useCallback(async () => {
    setBusy(true);
    const p = new URLSearchParams({ status, page: String(page), size: String(size) });
    if (q) p.set('q', q); if (ch) p.set('channel', ch); if (kind) p.set('kind', kind);
    try { const r = await api(`/lara/drafts?${p}`); setRows(r.rows); setTotal(r.total); } catch (e: any) { toast.error(e.message); setRows([]); } finally { setBusy(false); }
  }, [status, page, size, q, ch, kind]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, size, q, ch, kind]);
  const shown = rows || [];
  return (
    <Card title={<><Inbox size={16} className="text-brand-red" />{ov?.config?.mode === 'approve' ? 'Drafts to approve' : 'Shadow inbox'}</>} right={
      <div className="flex rounded-xl border border-brand-gray/20 overflow-hidden text-xs font-bold">
        {(['shadow', 'approved', 'rejected', 'expired'] as const).map((s) => <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 ${status === s ? 'bg-brand-red text-white' : ''}`}>{s === 'shadow' ? 'Waiting' : s[0].toUpperCase() + s.slice(1)}</button>)}
      </div>}>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]"><Search size={14} className="absolute left-3 top-2.5 text-brand-gray" /><input value={qRaw} onChange={(e) => setQRaw(e.target.value)} placeholder="Search customer, salesperson or lead number…" className="input-field w-full pl-8 text-sm" /></div>
        <select value={ch} onChange={(e) => setCh(e.target.value)} className="input-field text-xs py-1.5"><option value="">Every channel</option><option value="email">E-mail</option><option value="whatsapp">WhatsApp</option></select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="input-field text-xs py-1.5"><option value="">Every kind</option><option value="followup">Follow-ups</option><option value="reply">Replies to customers</option><option value="offer">Offers</option></select>
      </div>
      {rows === null ? <Loader2 className="animate-spin text-brand-gray" /> : shown.length === 0 ? <p className="text-sm text-brand-gray py-6 text-center">{q || ch || kind ? 'Nothing matches these filters.' : status === 'shadow' ? 'No drafts waiting. Run Lara from the Control room.' : 'Nothing here.'}</p> : (
        <div className={`space-y-3 ${busy ? 'opacity-60' : ''}`}>{shown.map((d) => <DraftCard key={d.id} d={d} canSend={canSend} lead={leadName.get(d.lead_id)} onDone={() => { setRows((r) => (r || []).filter((x) => x.id !== d.id)); setTotal((n) => Math.max(0, n - 1)); reload(); }} />)}</div>
      )}
      <Pager page={page} size={size} total={total} onPage={(p) => { setPage(p); document.getElementById('lara-module')?.scrollIntoView({ behavior: 'smooth' }); }} onSize={setSize} busy={busy} />
    </Card>
  );
};
const DraftCard: React.FC<{ d: any; lead?: Lead; onDone: () => void; canSend?: boolean }> = ({ d, lead, onDone, canSend }) => {
  const sends = !!canSend && d.channel === 'email';
  const [text, setText] = useState(d.body);
  const [editing, setEditing] = useState(false);
  const [rej, setRej] = useState(false);
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'approved' | 'rejected', feedback = '') => {
    setBusy(true);
    try {
      const r = await post(`/lara/drafts/${d.id}/decide`, { decision, feedback, body: text });
      if (decision === 'rejected') toast.success('Rejected. Lara will learn from it.');
      else if (r.sent) toast.success('Approved and sent by e-mail.');
      else toast.success(r.sendNote ? `Approved. Not sent yet: ${r.sendNote}` : 'Approved. Nothing is sent in this mode.');
      onDone();
    }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const open = d.status === 'shadow';
  return (
    <div className="border border-brand-gray/15 rounded-2xl p-4 space-y-2 hover:shadow-sm transition">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <button onClick={() => crmNav.lead(d.lead_id)} className="font-extrabold text-sm text-brand-black hover:text-brand-red">{d.customer}</button>
          <p className="text-[11px] text-brand-gray">{d.lead_id} · owner {d.owner_name || '—'}{lead ? ` · ${lead.status}` : ''} · {when(d.created_at)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
          {d.kind === 'reply' && <span className="bg-violet-100 text-violet-800 rounded-full px-2 py-0.5">Reply to customer</span>}
          {d.kind === 'offer' && (d.offer?.pdf ? <button onClick={() => openOfferPdf(d.id, d.offer?.ref)} className="bg-sky-100 text-sky-800 rounded-full px-2 py-0.5 underline">Initial financial offer · open PDF</button> : <button onClick={() => openInLandBank(d.id)} className="bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 underline">Build the PDF in Land Bank</button>)}
          <span className="bg-brand-red/10 text-brand-red rounded-full px-2 py-0.5">{LABEL[d.situation] || d.situation}</span>
          {d.send_status && d.send_status !== 'none' && <span className={`rounded-full px-2 py-0.5 ${d.send_status === 'sent' ? 'bg-emerald-100 text-emerald-800' : d.send_status === 'failed' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>{d.send_status}</span>}
          <span className={`rounded-full px-2 py-0.5 flex items-center gap-1 ${d.channel === 'whatsapp' ? 'bg-green-100 text-green-800' : 'bg-sky-100 text-sky-800'}`}>{d.channel === 'whatsapp' ? <MessageSquare size={11} /> : <Mail size={11} />}{d.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'}</span>
        </div>
      </div>
      <p className="text-xs text-amber-900 bg-amber-50 rounded-lg px-2 py-1"><b>Why:</b> {d.reason}</p>
      {d.channel === 'email' && d.subject && <p className="text-xs"><b>Subject:</b> {d.subject}</p>}
      {editing ? <textarea value={text} onChange={(e) => setText(e.target.value)} dir={isAr(text) ? 'rtl' : 'ltr'} rows={9} className="input-field w-full text-sm leading-relaxed" />
        : <p dir={isAr(text) ? 'rtl' : 'ltr'} className="text-sm whitespace-pre-line bg-brand-gray/5 rounded-xl p-3 leading-relaxed">{text}</p>}
      {d.to_addr && d.channel === 'email' && <p className="text-[11px] text-brand-gray">To: {d.to_addr}</p>}
      {d.send_error && d.send_status !== 'sent' && <p className="text-[11px] text-rose-700">Not sent: {d.send_error}{d.status === 'approved' && <button onClick={async () => { try { const r = await post(`/lara/drafts/${d.id}/send`, {}); toast[r.sent ? 'success' : 'error'](r.sent ? 'Sent' : r.sendNote); onDone(); } catch (e: any) { toast.error(e.message); } }} className="ml-2 font-bold underline">Try again</button>}</p>}
      {!open && <p className="text-[11px] text-brand-gray">{d.status} by {d.decided_by || '—'} · {when(d.decided_at)}{d.feedback ? ` · "${d.feedback}"` : ''}{d.edited ? ' · edited' : ''}</p>}
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy} onClick={() => decide('approved')} className="bg-emerald-600 text-white rounded-xl px-3 py-1.5 text-xs font-extrabold flex items-center gap-1 disabled:opacity-50"><CheckCircle2 size={14} />{sends ? (text !== d.body ? 'Approve my edit & send' : 'Approve & send') : (text !== d.body ? 'Approve with my edit' : 'Approve')}</button>
          <button disabled={busy} onClick={() => setEditing((v) => !v)} className="btn-secondary rounded-xl px-3 py-1.5 text-xs font-bold flex items-center gap-1"><Pencil size={13} />{editing ? 'Done editing' : 'Edit'}</button>
          <button disabled={busy} onClick={() => setRej((v) => !v)} className="rounded-xl px-3 py-1.5 text-xs font-bold border border-rose-200 text-rose-700 flex items-center gap-1"><XCircle size={14} />Reject</button>
          {rej && <div className="flex flex-wrap gap-1.5 w-full">{REJECT.map((r) => <button key={r} disabled={busy} onClick={() => decide('rejected', r)} className="text-[11px] rounded-full border border-rose-200 text-rose-700 px-2.5 py-1 hover:bg-rose-50">{r}</button>)}</div>}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Knowledge (approved Q&A) + Ask Lara test box
// ---------------------------------------------------------------------------------------------
const EMPTY = { id: '', topic: 'General', q_ar: '', q_en: '', phrasings: '', a_ar: '', a_en: '' };
const TOPICS = ['General', 'Prices', 'Payment plans', 'Utilities', 'Land & building', 'Licences & incentives', 'Reservation & contract', 'Location & access', 'Visits'];
const Knowledge: React.FC<{ reload: () => void }> = ({ reload }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [arch, setArch] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback(async () => { setRows(null); try { setRows((await api(`/lara/kb?status=${arch ? 'archived' : 'active'}`)).rows); } catch (e: any) { toast.error(e.message); setRows([]); } }, [arch]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    try { await post('/lara/kb', edit); toast.success('Saved'); setEdit(null); void load(); reload(); } catch (e: any) { toast.error(e.message); }
  };
  const setStatus = async (id: string, status: string) => { try { await post(`/lara/kb/${id}/status`, { status }); void load(); reload(); } catch (e: any) { toast.error(e.message); } };
  const shown = (rows || []).filter((r) => !q || `${r.topic} ${r.q_ar} ${r.q_en} ${r.a_ar} ${r.a_en}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <Card title={<><BookOpen size={16} className="text-brand-red" />Approved answers</>} className="lg:col-span-2" right={
        <div className="flex gap-2">
          <button onClick={() => setArch((v) => !v)} className="text-xs font-bold text-brand-gray">{arch ? 'Show active' : 'Show archived'}</button>
          <button onClick={() => setEdit({ ...EMPTY })} className="btn-primary rounded-xl px-3 py-1.5 text-xs font-bold flex items-center gap-1"><Plus size={14} />Add</button>
        </div>}>
        <div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-brand-gray" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions and answers…" className="input-field w-full pl-8 text-sm" /></div>
        {edit && <KbForm v={edit} set={setEdit} onSave={save} onCancel={() => setEdit(null)} />}
        {rows === null ? <Loader2 className="animate-spin text-brand-gray" /> : shown.length === 0 ? <p className="text-sm text-brand-gray py-4 text-center">{arch ? 'No archived answers.' : 'No answers yet. Start with Missed questions: 25 common customer questions are waiting for SDM\'s real answers.'}</p> : (
          <ul className="divide-y divide-brand-gray/10">
            {shown.map((r) => (
              <li key={r.id} className="py-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-brand-black" dir={isAr(r.q_ar || r.q_en) ? 'rtl' : 'ltr'}>{r.q_ar || r.q_en}</p>
                  <span className="text-[10px] font-bold bg-brand-gray/10 rounded-full px-2 py-0.5 whitespace-nowrap">{r.topic}</span>
                </div>
                {r.a_ar && <p className="text-xs text-brand-black whitespace-pre-line" dir="rtl">{r.a_ar}</p>}
                {r.a_en && <p className="text-xs text-brand-gray whitespace-pre-line">{r.a_en}</p>}
                <div className="flex gap-3 text-[11px] text-brand-gray"><span>Used {r.uses} times</span><span>by {r.updated_by || r.created_by || '—'}</span>
                  <button onClick={() => setEdit({ ...r })} className="font-bold text-brand-red">Edit</button>
                  {arch ? <button onClick={() => setStatus(r.id, 'active')} className="font-bold flex items-center gap-0.5"><RotateCcw size={11} />Restore</button> : <button onClick={() => setStatus(r.id, 'archived')} className="font-bold flex items-center gap-0.5"><Archive size={11} />Archive</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <AskBox reload={reload} />
    </div>
  );
};
const KbForm: React.FC<{ v: any; set: (v: any) => void; onSave: () => void; onCancel: () => void; fixedQuestion?: string }> = ({ v, set, onSave, onCancel, fixedQuestion }) => {
  const f = (k: string) => (e: any) => set({ ...v, [k]: e.target.value });
  return (
    <div className="border border-brand-red/20 bg-brand-red/[0.03] rounded-2xl p-4 space-y-2">
      <label className="text-[11px] font-bold block">Topic
        <select value={v.topic} onChange={f('topic')} className="input-field w-full text-sm mt-0.5">{TOPICS.map((t) => <option key={t}>{t}</option>)}</select>
      </label>
      {fixedQuestion ? <p className="text-sm font-bold" dir={isAr(fixedQuestion) ? 'rtl' : 'ltr'}>{fixedQuestion}</p> : (
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={v.q_ar} onChange={f('q_ar')} dir="rtl" placeholder="السؤال بالعربي" className="input-field text-sm" />
          <input value={v.q_en} onChange={f('q_en')} placeholder="Question in English" className="input-field text-sm" />
        </div>
      )}
      <textarea value={v.phrasings} onChange={f('phrasings')} rows={2} placeholder="Other ways customers ask it (one per line) — helps Lara recognise the question" className="input-field w-full text-xs" />
      <div className="grid sm:grid-cols-2 gap-2">
        <textarea value={v.a_ar} onChange={f('a_ar')} dir="rtl" rows={4} placeholder="الإجابة المعتمدة بالعربي" className="input-field text-sm" />
        <textarea value={v.a_en} onChange={f('a_en')} rows={4} placeholder="Approved answer in English" className="input-field text-sm" />
      </div>
      <p className="text-[10px] text-brand-gray">Lara repeats this answer word for word to customers. Write only facts SDM stands behind.</p>
      <div className="flex gap-2 justify-end"><button onClick={onCancel} className="btn-secondary rounded-xl px-3 py-1.5 text-xs font-bold">Cancel</button><button onClick={onSave} className="btn-primary rounded-xl px-3 py-1.5 text-xs font-bold">Save answer</button></div>
    </div>
  );
};
const AskBox: React.FC<{ reload: () => void }> = ({ reload }) => {
  const [q, setQ] = useState('');
  const [r, setR] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const ask = async (record = false) => {
    if (q.trim().length < 3) return;
    setBusy(true);
    try { setR(await post('/lara/ask', { question: q, record })); if (record) { toast.success('Added to Missed questions'); reload(); } } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Card title={<><HelpCircle size={16} className="text-brand-red" />Ask Lara (test)</>}>
      <p className="text-xs text-brand-gray">Type a question the way a customer would (Arabic or English). See what Lara would answer.</p>
      <textarea value={q} onChange={(e) => setQ(e.target.value)} dir={isAr(q) ? 'rtl' : 'ltr'} rows={3} placeholder="مثال: فيه أرض متاحة في أكتوبر حوالي 3000 متر؟" className="input-field w-full text-sm" />
      <button onClick={() => ask(false)} disabled={busy} className="btn-primary w-full rounded-xl py-2 text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Ask</button>
      {r && (
        <div className="space-y-2 text-sm">
          {r.data && <div className="bg-sky-50 border border-sky-200 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-sky-800 flex items-center gap-1"><Database size={11} />From the Land Bank list</p><p dir="rtl">{r.data.ar}</p><p className="text-xs text-brand-gray">{r.data.en}</p></div>}
          {r.matches.map((m: any, i: number) => (
            <div key={m.id} className={`rounded-xl p-3 border ${i === 0 && m.score >= r.threshold ? 'border-emerald-200 bg-emerald-50' : 'border-brand-gray/15'}`}>
              <p className="text-[10px] uppercase font-bold text-brand-gray">{i === 0 && m.score >= r.threshold ? 'Lara answers with' : 'Close, not sure enough'} · match {Math.round(m.score * 100)}%</p>
              <p className="text-xs font-bold" dir={isAr(m.q) ? 'rtl' : 'ltr'}>{m.q}</p>
              <p className="text-xs whitespace-pre-line" dir="rtl">{m.a_ar}</p>
            </div>
          ))}
          {!r.answered && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs space-y-2">
              <p className="text-amber-900">Lara has no approved answer for this. With a customer she would not guess: she would tell them a specialist will answer and put the question in Missed questions.</p>
              {!r.missedId && <button onClick={() => ask(true)} className="font-bold text-amber-900 underline">Add it to Missed questions</button>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------------------------
// Missed questions
// ---------------------------------------------------------------------------------------------
const Missed: React.FC<{ reload: () => void }> = ({ reload }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [st, setSt] = useState<'open' | 'answered' | 'dismissed'>('open');
  const [open, setOpen] = useState<string | null>(null);
  const [v, setV] = useState<any>({ ...EMPTY });
  const load = useCallback(async () => { setRows(null); try { setRows((await api(`/lara/missed?status=${st}`)).rows); } catch (e: any) { toast.error(e.message); setRows([]); } }, [st]);
  useEffect(() => { void load(); }, [load]);
  const answer = async (id: string) => { try { await post(`/lara/missed/${id}/answer`, v); toast.success('Answer saved. Lara will use it from now on.'); setOpen(null); void load(); reload(); } catch (e: any) { toast.error(e.message); } };
  const dismiss = async (id: string) => { try { await post(`/lara/missed/${id}/dismiss`, {}); void load(); reload(); } catch (e: any) { toast.error(e.message); } };
  return (
    <Card title={<><HelpCircle size={16} className="text-brand-red" />Missed questions</>} right={
      <div className="flex rounded-xl border border-brand-gray/20 overflow-hidden text-xs font-bold">{(['open', 'answered', 'dismissed'] as const).map((s) => <button key={s} onClick={() => setSt(s)} className={`px-3 py-1.5 ${st === s ? 'bg-brand-red text-white' : ''}`}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>}>
      <p className="text-xs text-brand-gray">Questions Lara could not answer from the approved Q&A. Answer each once with SDM's real facts: it becomes an approved answer and Lara uses it from then on. The first 25 are the questions customers ask most (prepared by the Sales Director role); they have no answers on purpose.</p>
      {rows === null ? <Loader2 className="animate-spin text-brand-gray" /> : rows.length === 0 ? <p className="text-sm text-brand-gray py-4 text-center">Nothing here.</p> : (
        <ul className="divide-y divide-brand-gray/10">
          {rows.map((m) => (
            <li key={m.id} className="py-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-brand-black" dir={isAr(m.question) ? 'rtl' : 'ltr'}>{m.question}</p>
                <span className="text-[10px] text-brand-gray whitespace-nowrap">{m.source === 'seed' ? 'Common question' : m.source === 'customer' ? 'From a customer' : 'From a test'}{m.asked > 1 ? ` · asked ${m.asked}×` : ''}</span>
              </div>
              {st === 'open' && open !== m.id && (
                <div className="flex gap-3 text-xs font-bold"><button onClick={() => { setOpen(m.id); setV({ ...EMPTY }); }} className="text-brand-red">Answer</button><button onClick={() => dismiss(m.id)} className="text-brand-gray">Dismiss</button></div>
              )}
              {open === m.id && <KbForm v={v} set={setV} fixedQuestion={m.question} onSave={() => answer(m.id)} onCancel={() => setOpen(null)} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------------------------
// Settings & channels
// ---------------------------------------------------------------------------------------------
const SettingsTab: React.FC<{ ov: any; reload: () => void }> = ({ ov, reload }) => {
  const [c, setC] = useState<any>(null);
  useEffect(() => { if (ov?.config && !c) setC({ ...ov.config }); }, [ov, c]);
  if (!c) return <Loader2 className="animate-spin text-brand-gray" />;
  const n = (k: string, label: string, hint: string, unit: string) => (
    <label className="text-xs block"><span className="font-bold">{label}</span>
      <div className="flex items-center gap-2 mt-0.5"><input type="number" value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} className="input-field w-24 text-sm" /><span className="text-brand-gray">{unit}</span></div>
      <span className="text-[10px] text-brand-gray">{hint}</span>
    </label>
  );
  const save = async (patch: any = {}) => {
    const next = { ...c, ...patch };
    if (patch.sendEnabled === true && !window.confirm('Switch sending ON?\n\nLara will e-mail customers ONLY after a person approves each message, only in working hours and within the limits. You can switch it off at any time.')) return;
    try { const r = await post('/lara/config', next, 'PUT'); setC(r.config); toast.success('Saved'); reload(); } catch (e: any) { toast.error(e.message); }
  };
  const mailOk = !!ov?.channels?.email;
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <Card title={<><Settings size={16} className="text-brand-red" />Lara's rules</>}>
        <label className="text-xs block"><span className="font-bold">Mode</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
            {[['off', 'Off', true, 'Nothing runs'], ['shadow', 'Shadow', true, 'Drafts only'], ['approve', 'Approve first', true, 'You approve each mail'], ['auto', 'Autopilot', true, 'Your workflows send alone']].map(([k, l, ok, h]: any) => (
              <button key={k} disabled={!ok} onClick={() => setC({ ...c, mode: k })} className={`rounded-xl border px-2 py-2 text-xs font-bold ${c.mode === k ? 'bg-brand-red text-white border-brand-red' : 'border-brand-gray/20'} disabled:opacity-40`}>{l}<span className="block text-[9px] font-normal">{h}</span></button>
            ))}
          </div>
        </label>
        <p className="text-xs bg-sky-50 text-sky-900 rounded-xl px-3 py-2">When Lara starts on a lead (hours, days, statuses) is now set in each <b>Workflow</b>.</p>
        {c.mode === 'auto' && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 space-y-1"><p className="font-bold">Autopilot</p><p>Messages from workflows marked "Autopilot" go out without a person (offers always need approval). Everything else still waits in Drafts. While the test lock is on, only staff e-mails and test numbers can receive anything.</p><label className="flex items-center gap-2"><input type="checkbox" checked={!!c.autoReplies} onChange={(e) => setC({ ...c, autoReplies: e.target.checked })} />Also answer customer replies without a person (approved answers and polite holding replies)</label></div>}
        {n('maxPerRun', 'Drafts per run, at most', 'Keeps the list reviewable', 'drafts')}
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs block"><span className="font-bold">Name in English messages</span><input value={c.nameEn} onChange={(e) => setC({ ...c, nameEn: e.target.value })} className="input-field w-full text-sm mt-0.5" /></label>
          <label className="text-xs block"><span className="font-bold">Name in Arabic messages</span><input value={c.nameAr} dir="rtl" onChange={(e) => setC({ ...c, nameAr: e.target.value })} className="input-field w-full text-sm mt-0.5" /></label>
        </div>
        <p className="text-[10px] font-bold uppercase text-brand-gray pt-2">E-mail limits (approve-first)</p>
        {n('maxSendPerDay', 'E-mails per day, at most', 'All customers together', 'mails')}
        {n('minDaysBetween', 'Days between two follow-ups to one customer', 'Replies to a customer are not limited by this', 'days')}
        {n('maxUnanswered', 'Stop after this many mails without a reply', 'The lead goes back to the salesperson', 'mails')}
        <div className="flex gap-3">{n('sendStart', 'Send from', 'Cairo time, Sun–Thu', ':00')}{n('sendEnd', 'until', '', ':00')}</div>
        <button onClick={() => save()} className="btn-primary rounded-xl px-4 py-2 text-sm font-bold">Save settings</button>
      </Card>
      <div className="space-y-5">
        <Mailbox ov={ov} reload={reload} />
        <Card title={<><Send size={16} className={c.sendEnabled ? 'text-emerald-600' : 'text-brand-gray'} />Sending switch</>}>
          <p className="text-xs text-brand-gray">Even in Approve-first mode Lara sends nothing until this is on. Only drafts a person approved are sent; replies from customers are read every 10 minutes.</p>
          <div className="flex items-center justify-between gap-2 bg-brand-gray/5 rounded-xl p-3">
            <span className="text-sm font-bold">{c.sendEnabled ? 'Sending is ON' : 'Sending is OFF'}</span>
            <button disabled={!c.sendEnabled && (!mailOk || (c.mode !== 'approve' && c.mode !== 'auto'))} onClick={() => save({ sendEnabled: !c.sendEnabled })} className={`rounded-xl px-3 py-1.5 text-xs font-extrabold disabled:opacity-40 ${c.sendEnabled ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>{c.sendEnabled ? 'Switch off' : 'Switch on'}</button>
          </div>
          {!c.sendEnabled && (!mailOk || (c.mode !== 'approve' && c.mode !== 'auto')) && <p className="text-[11px] text-amber-800">To switch on: {!mailOk ? 'connect the mailbox' : ''}{!mailOk && c.mode !== 'approve' && c.mode !== 'auto' ? ' and ' : ''}{c.mode !== 'approve' && c.mode !== 'auto' ? 'save mode "Approve first" or "Autopilot"' : ''}.</p>}
        </Card>

      </div>
      <LaraWhatsApp reload={reload} />
      <LaraChannels />
    </div>
  );
};

const Mailbox: React.FC<{ ov: any; reload: () => void }> = ({ ov, reload }) => {
  const mb = ov?.mailbox || {};
  const [v, setV] = useState({ address: mb.address || '', user: mb.user || '', host: mb.host || '', password: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV((x) => ({ ...x, address: mb.address || x.address, user: mb.user || x.user, host: mb.host || x.host })); }, [mb.address, mb.user, mb.host]);
  const save = async () => {
    setBusy(true);
    try { const r = await post('/lara/mailbox', v); setV((x) => ({ ...x, password: '' })); r.mailbox.status.ok ? toast.success('Mailbox connected') : toast.error(`Not connected: ${r.mailbox.status.error}`); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const useShared = async () => {
    setBusy(true);
    try { const r = await post('/lara/mailbox', { shared: true }); r.mailbox.status.ok ? toast.success(`Lara now uses ${r.mailbox.address}`) : toast.error(`Not connected: ${r.mailbox.status.error}`); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const check = async () => { setBusy(true); try { const r = await post('/lara/mailbox/check', {}); toast.success(r.laraMail || r.pollSkipped || `Read ${r.polled ?? 0} new mails, ${r.replies ?? 0} customer replies`); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const st = mb.status;
  return (
    <Card title={<><Mail size={16} className="text-sky-600" />Lara's mailbox</>}>
      <p className="text-xs text-brand-gray">A mailbox only for Lara on the company Exchange (ask IT). Every mail she sends carries a code in the subject such as <code>[SDM-LD-1234-7F3K]</code>, so replies join the right conversation and never create a duplicate lead. Type the password yourself: it goes straight to the server's safe store and is never shown again.</p>
      {mb.shared && <p className="text-xs bg-sky-50 text-sky-900 rounded-xl px-3 py-2">Lara uses the <b>leads mailbox</b> ({mb.address}), the same one mail intake reads. She takes only replies to her own mails (subject code or a customer she is talking to); every other mail stays with the intake.</p>}
      {!mb.shared && <button onClick={useShared} disabled={busy} className="w-full rounded-xl px-3 py-2 text-xs font-bold border border-sky-300 text-sky-800 hover:bg-sky-50 disabled:opacity-50">Use the leads mailbox (same as mail intake) — nothing to type</button>}
      <div className={`text-xs rounded-xl px-3 py-2 ${st?.ok ? 'bg-emerald-50 text-emerald-800' : st ? 'bg-rose-50 text-rose-800' : 'bg-brand-gray/5 text-brand-gray'}`}>{st?.ok ? `Connected · checked ${when(st.at)}` : st ? `Not connected: ${st.error}` : 'Not set up yet'}</div>
      <input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} placeholder="Lara's address, e.g. lara@company.com" className="input-field w-full text-sm" />
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={v.user} onChange={(e) => setV({ ...v, user: e.target.value })} placeholder="Sign-in name (if not the address)" className="input-field text-sm" />
        <input value={v.host} onChange={(e) => setV({ ...v, host: e.target.value })} placeholder="Mail server (same as the main mailbox)" className="input-field text-sm" />
      </div>
      <input type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} placeholder={st ? 'Password (leave empty to keep the saved one)' : 'Password'} className="input-field w-full text-sm" />
      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={busy} className="btn-primary rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-50">{busy ? 'Working…' : 'Save & test'}</button>
        {st?.ok && <button onClick={check} disabled={busy} className="btn-secondary rounded-xl px-3 py-1.5 text-xs font-bold">Check mail now</button>}
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------------------------
// Conversations: one per lead (Lara's mails and the customer's replies), unknown senders, do-not-contact list
// ---------------------------------------------------------------------------------------------
// mails from unknown senders + the do-not-contact list (shown inside Interactions for admins)
const MailLists: React.FC = () => {
  const [um, setUm] = useState<any[] | null>(null);
  const [opt, setOpt] = useState<any[]>([]);
  const load = useCallback(async () => {
    try { const [b, c] = await Promise.all([api('/lara/unmatched'), api('/lara/optout')]); setUm(b.rows); setOpt(c.rows); } catch (e: any) { toast.error(e.message); setUm([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const link = async (id: string) => {
    const leadId = window.prompt('Lead number to link this mail to (e.g. LD-10182):');
    if (!leadId) return;
    try { await post(`/lara/unmatched/${id}`, { leadId }); toast.success('Linked to the lead'); void load(); } catch (e: any) { toast.error(e.message); }
  };
  const ignore = async (id: string) => { try { await post(`/lara/unmatched/${id}`, { action: 'ignore' }); void load(); } catch (e: any) { toast.error(e.message); } };
  return (
    <div className="grid lg:grid-cols-5 gap-3">
      <Card title={<><HelpCircle size={16} className="text-brand-red" />Mails from unknown senders</>} className="lg:col-span-3">
        <p className="text-xs text-brand-gray">Mails to Lara's box that match no conversation. Link one to a lead (it becomes that customer's reply) or ignore it. They never become new leads here.</p>
        {um === null ? <Loader2 className="animate-spin text-brand-gray" /> : um.length === 0 ? <p className="text-sm text-brand-gray">None.</p> : <ul className="divide-y divide-brand-gray/10 max-h-80 overflow-y-auto">{um.map((m) => (
          <li key={m.id} className="py-2 text-xs space-y-1"><p className="font-bold">{m.from_addr} · {when(m.at)}</p><p className="text-brand-gray">{m.subject}</p><p dir={isAr(m.body) ? 'rtl' : 'ltr'} className="line-clamp-3">{m.body}</p>
            <div className="flex gap-3 font-bold"><button onClick={() => link(m.id)} className="text-brand-red">Link to a lead</button><button onClick={() => ignore(m.id)} className="text-brand-gray">Ignore</button></div></li>
        ))}</ul>}
      </Card>
      <Card title={<><ShieldCheck size={16} className="text-rose-600" />Do-not-contact list</>} className="lg:col-span-2">
        <p className="text-xs text-brand-gray">Customers who replied "stop" / "مش مهتم". Lara never writes to them again.</p>
        {opt.length === 0 ? <p className="text-sm text-brand-gray">Empty.</p> : <ul className="text-xs divide-y divide-brand-gray/10 max-h-80 overflow-y-auto">{opt.map((o) => <li key={o.contact} className="py-1.5 flex items-center gap-2"><span className="flex-1"><b>{o.contact}</b> · {o.lead_id || '—'} · {when(o.at)}{o.reason ? <span className="text-brand-gray" dir="auto"> · "{String(o.reason).slice(0, 60)}"</span> : null}</span><button onClick={async () => { if (!window.confirm(`Take ${o.contact} off the do-not-contact list? Only do this when the customer asked to hear from us again.`)) return; try { await post('/lara/optout/remove', { contact: o.contact }); toast.success('Taken off the list'); void load(); } catch (e: any) { toast.error(e.message); } }} className="text-[11px] font-bold text-brand-red underline shrink-0">Remove</button></li>)}</ul>}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------------------------
const KIND: Record<string, string> = { run: 'Run', decision: 'Decision', kb: 'Q&A', missed: 'Missed', config: 'Settings', mail: 'Messages', ai: 'AI' };
const LogTab: React.FC = () => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [size, setSize] = useState(25);
  const [kind, setKind] = useState(''); const [qRaw, setQRaw] = useState(''); const q = useDebounced(qRaw.trim(), 400);
  useEffect(() => { setPage(1); }, [kind, q, size]);
  useEffect(() => {
    const p = new URLSearchParams({ page: String(page), size: String(size) }); if (kind) p.set('kind', kind); if (q) p.set('q', q);
    void api(`/lara/log?${p}`).then((r) => { setRows(r.rows); setTotal(r.total); }).catch((e) => { toast.error(e.message); setRows([]); });
  }, [page, size, kind, q]);
  return (
    <Card title={<><ScrollText size={16} className="text-brand-red" />Everything Lara did</>} right={
      <div className="flex gap-2"><input value={qRaw} onChange={(e) => setQRaw(e.target.value)} placeholder="Search…" className="input-field text-xs py-1 w-36" /><select value={kind} onChange={(e) => setKind(e.target.value)} className="input-field text-xs py-1"><option value="">Everything</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>}>
      {rows === null ? <Loader2 className="animate-spin text-brand-gray" /> : rows.length === 0 ? <p className="text-sm text-brand-gray">Nothing yet.</p> : (
        <ul className="divide-y divide-brand-gray/10">{rows.map((r) => (
          <li key={r.id} className="py-2 text-xs flex gap-3"><span className="text-brand-gray w-28 shrink-0">{when(r.at)}</span><span className="font-bold w-20 shrink-0">{KIND[r.kind] || r.kind}</span><span className="flex-1">{r.text}{r.actor ? <span className="text-brand-gray"> · {r.actor}</span> : null}</span></li>
        ))}</ul>
      )}
      <Pager page={page} size={size} total={total} onPage={setPage} onSize={setSize} />
    </Card>
  );
};
