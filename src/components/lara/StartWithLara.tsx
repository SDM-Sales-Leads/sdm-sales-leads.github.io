// "Start with Lara": a person hands a customer to Lara — from the lead (lead page / lead drawer) or from Interactions (pick any lead they may
// see). Either Lara writes the first message now (the person reads/edits it and sends it, so it is approved by them) or the lead enters a
// workflow from its first box. The message is written in the browser by the rule-based writer (no AI, no server cost).
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Bot, Mail, MessageSquare, Search, Loader2, X, RefreshCw, Workflow, Send, ShieldCheck } from 'lucide-react';
import type { Lead } from '../crm/types';
import { crmService } from '../crm/crmService';
import { SITUATION_LABEL, Situation, preferredLang, situationsFor, writeFor } from '../crm/smartWriter';
import { availableByPark, plotFit } from '../crm/smartEngine';
import { loadPlots, Plot } from '../../lib/plotsService';
import { useDebounced } from './Pager';

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api${path}`, init ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const LARA = { en: 'Lara, digital sales assistant', ar: 'لارا، المساعدة الرقمية للمبيعات' };
const okMail = (e?: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
const okPhone = (p?: string) => String(p || '').replace(/\D/g, '').length >= 10;

export const StartWithLara: React.FC<{ lead?: Lead | null; onClose: () => void; onDone?: (threadId?: string) => void }> = ({ lead: lead0, onClose, onDone }) => {
  const [lead, setLead] = useState<Lead | null>(lead0 || null);
  const [qRaw, setQRaw] = useState(''); const q = useDebounced(qRaw.trim(), 350);
  const [found, setFound] = useState<any[] | null>(null);
  const [mode, setMode] = useState<'send' | 'workflow'>('send');
  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email');
  const [plots, setPlots] = useState<Plot[]>([]);
  const [wfs, setWfs] = useState<any[]>([]); const [wf, setWf] = useState('');
  const [sit, setSit] = useState<Situation | null>(null); const [ver, setVer] = useState(0);
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [text, setText] = useState(''); const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  useEffect(() => { void loadPlots().then((s) => setPlots(s.plots)).catch(() => {}); void api('/lara/workflows').then((r) => setWfs((r.rows || []).filter((w: any) => w.status !== 'archived'))).catch(() => {}); }, []);
  useEffect(() => {
    if (lead || q.length < 2) { setFound(null); return; }
    let off = false;
    void api(`/lara/lead-search?q=${encodeURIComponent(q)}`).then((r) => { if (!off) setFound(r.rows); }).catch((e) => toast.error(e.message));
    return () => { off = true; };
  }, [q, lead]);
  // the lead picked: channel and language that fit it
  useEffect(() => {
    if (!lead) return;
    setChannel(okMail(lead.email) ? 'email' : 'whatsapp');
    setLang(preferredLang(lead));
    setSit(null); setVer(0);
  }, [lead]);

  const ctx = useMemo(() => {
    const byPark = availableByPark(plots); const byKey = new Map(plots.map((p) => [p.key, p]));
    return lead ? { rep: LARA.en, repAr: LARA.ar, fit: plotFit(lead, byPark), byKey, owner: lead.assignedSalespersonName || '' } : null;
  }, [lead, plots]);
  const options = useMemo(() => (lead && ctx ? situationsFor(lead, ctx) : []), [lead, ctx]);
  const s = sit || options[0];
  const drafts = useMemo(() => (lead && ctx && s ? writeFor(lead, ctx, s) : []), [lead, ctx, s]);
  useEffect(() => {
    const d = drafts[ver % (drafts.length || 1)]; if (!d) return;
    setText(lang === 'ar' ? d.ar : d.en); setSubject(lang === 'ar' ? d.subjectAr : d.subjectEn);
  }, [drafts, ver, lang]);

  const pick = (r: any) => {
    const full = crmService.getLeads().find((l) => l.id === r.id);
    setLead(full || ({ id: r.id, customerName: r.name, email: r.email, phoneNumber: r.phone, status: r.status, project: r.project, assignedSalespersonName: r.owner } as any));
  };
  const start = async () => {
    if (!lead) return;
    setBusy(true);
    try {
      const r = await api('/lara/start', { method: 'POST', body: JSON.stringify(mode === 'workflow' ? { leadId: lead.id, mode, workflowId: wf } : { leadId: lead.id, mode, channel, text, subject, situation: s }) });
      if (r.started === 'workflow' || r.sent) toast.success(r.note); else toast.error(`Handed to Lara, but not sent yet: ${r.note}`);
      onDone?.(r.threadId); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const canSend = !!lead && (mode === 'workflow' ? !!wf : !!text.trim() && (channel === 'email' ? okMail(lead.email) : okPhone(lead.phoneNumber)));

  return (
    <div className="fixed inset-0 z-[80] bg-brand-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-brand-gray/10 sticky top-0 bg-white rounded-t-3xl z-10">
          <Bot size={18} className="text-brand-red" /><h3 className="font-extrabold">Start with Lara</h3>
          <button onClick={onClose} className="ml-auto text-brand-gray"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          {!lead ? (
            <div className="space-y-2">
              <p className="text-xs text-brand-gray">Find the customer by lead number, name, mobile or e-mail (only leads you may see).</p>
              <div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-brand-gray" /><input autoFocus value={qRaw} onChange={(e) => setQRaw(e.target.value)} placeholder="LD-…, name, 010…, name@company.com" className="input-field w-full pl-8" /></div>
              {found && (found.length === 0 ? <p className="text-xs text-brand-gray">No lead found.</p> : (
                <ul className="divide-y divide-brand-gray/10 border border-brand-gray/15 rounded-xl">{found.map((r) => (
                  <li key={r.id}><button onClick={() => pick(r)} className="w-full text-left px-3 py-2 hover:bg-brand-gray/5">
                    <p className="font-bold text-sm" dir="auto">{r.name || '—'} <span className="text-[11px] text-brand-red font-mono">{r.id}</span></p>
                    <p className="text-[11px] text-brand-gray">{r.status} · {r.owner || 'no owner'} · {r.phone || 'no mobile'} · {r.email || 'no e-mail'}{r.lara ? ` · Lara: ${r.lara.status}` : ''}</p>
                  </button></li>
                ))}</ul>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 bg-brand-gray/5 rounded-2xl px-3 py-2">
              <div className="min-w-0 flex-1"><p className="font-bold" dir="auto">{lead.customerName}</p><p className="text-[11px] text-brand-gray">{lead.id} · {lead.status} · {lead.assignedSalespersonName || 'no owner'} · {lead.project || 'no park'}</p></div>
              {!lead0 && <button onClick={() => setLead(null)} className="text-xs font-bold text-brand-gray underline">Change</button>}
            </div>
          )}
          {lead && (
            <>
              <div className="flex rounded-xl border border-brand-gray/20 overflow-hidden text-xs font-bold w-fit">
                <button onClick={() => setMode('send')} className={`px-3 py-1.5 flex items-center gap-1 ${mode === 'send' ? 'bg-brand-red text-white' : ''}`}><Send size={12} />Lara writes now</button>
                <button onClick={() => setMode('workflow')} className={`px-3 py-1.5 flex items-center gap-1 ${mode === 'workflow' ? 'bg-brand-red text-white' : ''}`}><Workflow size={12} />Put in a workflow</button>
              </div>
              {mode === 'workflow' ? (
                <div className="space-y-2">
                  <select value={wf} onChange={(e) => setWf(e.target.value)} className="input-field w-full"><option value="">Choose a workflow…</option>{wfs.map((w) => <option key={w.id} value={w.id}>{w.name}{w.enabled ? '' : ' (switched off)'}</option>)}</select>
                  <p className="text-[11px] text-brand-gray">The lead leaves any other workflow and starts at the first box. Lara takes that step at her next run (09:00 Sun–Thu); her messages follow the workflow's rules (approval or Autopilot).</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-brand-gray">Channel</span>
                    <button disabled={!okMail(lead.email)} onClick={() => setChannel('email')} className={`text-[11px] font-bold rounded-full px-2.5 py-1 flex items-center gap-1 border disabled:opacity-40 ${channel === 'email' ? 'bg-brand-black text-white border-brand-black' : 'border-brand-gray/20'}`}><Mail size={12} />E-mail{!okMail(lead.email) && ' (no address)'}</button>
                    <button disabled={!okPhone(lead.phoneNumber)} onClick={() => setChannel('whatsapp')} className={`text-[11px] font-bold rounded-full px-2.5 py-1 flex items-center gap-1 border disabled:opacity-40 ${channel === 'whatsapp' ? 'bg-brand-black text-white border-brand-black' : 'border-brand-gray/20'}`}><MessageSquare size={12} />WhatsApp{!okPhone(lead.phoneNumber) && ' (no mobile)'}</button>
                    <span className="ml-auto flex rounded-lg border border-brand-gray/20 overflow-hidden text-[11px] font-bold">{(['ar', 'en'] as const).map((l) => <button key={l} onClick={() => setLang(l)} className={`px-2 py-0.5 ${lang === l ? 'bg-brand-red text-white' : ''}`}>{l === 'ar' ? 'عربي' : 'EN'}</button>)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">{options.map((o) => <button key={o} onClick={() => { setSit(o); setVer(0); }} className={`text-[11px] font-bold rounded-full px-2.5 py-1 border ${s === o ? 'bg-brand-red text-white border-brand-red' : 'border-brand-gray/25'}`}>{(SITUATION_LABEL as any)[o] || o}</button>)}</div>
                  {channel === 'email' && <input value={subject} onChange={(e) => setSubject(e.target.value)} className="input-field w-full" placeholder="Subject" />}
                  <textarea value={text} onChange={(e) => setText(e.target.value)} dir={lang === 'ar' ? 'rtl' : 'ltr'} rows={8} className="input-field w-full leading-relaxed" />
                  <div className="flex items-center gap-2 text-[11px] text-brand-gray">
                    {drafts.length > 1 && <button onClick={() => setVer((v) => v + 1)} className="font-bold text-brand-red flex items-center gap-1"><RefreshCw size={12} />Another version ({(ver % drafts.length) + 1}/{drafts.length})</button>}
                    <span className="ml-auto">{channel === 'whatsapp' ? 'Outside 24 h WhatsApp uses your approved Meta template.' : 'The e-mail carries Chat / Call / WhatsApp buttons.'}</span>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-1.5"><ShieldCheck size={13} />While Lara is on hold, only staff test addresses and test numbers receive anything; for real customers it waits and says why.</p>
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="btn-secondary rounded-xl px-4 py-2 text-xs font-bold">Cancel</button>
                <button onClick={start} disabled={!canSend || busy} className="btn-primary rounded-xl px-4 py-2 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}{mode === 'workflow' ? 'Start the workflow' : 'Send & hand to Lara'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
