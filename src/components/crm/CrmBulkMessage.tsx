import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Copy, Mail, MessageCircle, Send, X } from 'lucide-react';
import type { Lead } from './types';
import { crmService } from './crmService';
import { statusAfterAction, phoneIntl } from './leadConfig';
import { addDaysISO } from './leadRules';
import { todayISO } from './leadMetrics';
import { useAuth } from '../../services/AuthContext';
import { repNameFromEmail, signOff } from '../../lib/repName';
import { WA_TEMPLATES, WA_LANGS, WaLang, getWaLang, setWaLang, suggestTemplate, waCompose, waFill } from './waTemplates';

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const digits = (raw?: string) => (phoneIntl(raw) || raw || '').replace(/\D/g, '');
const validWa = (l: Lead) => digits(l.phoneNumber).length >= 8;
const validMail = (l: Lead) => EMAIL_RE.test((l.email || '').trim());
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Bulk WhatsApp (one personal chat per customer, one tap each) and bulk e-mail (system mail or your own mailbox in BCC batches). */
export const CrmBulkMessage: React.FC<{ leads: Lead[]; mode: 'whatsapp' | 'email'; userName: string; userId?: string; onClose: () => void }> = ({ leads, mode, userName, userId, onClose }) => {
  const { user: authUser } = useAuth();
  const myName = repNameFromEmail(authUser?.email, userName);
  const [done, setDone] = useState<Set<string>>(new Set());
  const mark = (l: Lead, kind: 'whatsapp' | 'email', text: string) => {
    try {
      const fresh = (crmService.getLeads() as Lead[]).find((x) => x.id === l.id) || l;
      const moved = statusAfterAction(fresh.status, kind);
      const ev: any = { id: Math.random().toString(36).slice(2, 11), timestamp: new Date().toISOString(), type: kind === 'whatsapp' ? 'WhatsApp' : 'Email', user: userName, title: kind === 'whatsapp' ? 'WhatsApp message (bulk)' : 'E-mail (bulk)', description: text.slice(0, 400) };
      crmService.updateLead(l.id, { timeline: [...(fresh.timeline || []), ev], lastContactDate: todayISO(), ...(moved ? { status: moved as any, nextFollowUpDate: fresh.nextFollowUpDate || addDaysISO(2) } : {}) }, userName, { userId });
    } catch { /* the message went out; a log failure must not stop the rest */ }
    setDone((s) => new Set(s).add(l.id));
  };

  // ---------------- WhatsApp ----------------
  const [tpl, setTpl] = useState('auto');
  const [lang, setLang] = useState<WaLang>(getWaLang());
  const msgFor = (l: Lead) => signOff(waFill(waCompose(tpl === 'auto' ? suggestTemplate(l) : tpl, lang), l, myName, { date: l.meetingDate || l.nextFollowUpDate || '', time: l.meetingTime || l.nextFollowUpTime || '' }), myName);
  // How the chat opens. "app": the WhatsApp app on this computer / phone — the chat opens at once with the message written, no page
  // reload, no new tab (fastest). "web": WhatsApp Web, always in the SAME tab (a new tab per chat makes WhatsApp Web log the others out).
  const isPhone = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const [via, setVia] = useState<'app' | 'web'>(() => { try { const v = localStorage.getItem('sdm.waVia'); if (v === 'app' || v === 'web') return v; } catch { /* none */ } return isPhone ? 'app' : 'web'; });
  const pickVia = (v: 'app' | 'web') => { setVia(v); try { localStorage.setItem('sdm.waVia', v); } catch { /* ignore */ } };
  const openWa = (l: Lead) => {
    const m = msgFor(l), ph = digits(l.phoneNumber);
    if (via === 'app') window.location.href = `whatsapp://send?phone=${ph}&text=${encodeURIComponent(m)}`;
    else { const w = window.open(`https://web.whatsapp.com/send?phone=${ph}&text=${encodeURIComponent(m)}`, 'sdm-whatsapp'); try { if (w) w.opener = null; } catch { /* ignore */ } }
    mark(l, 'whatsapp', m);
  };
  const ready = useMemo(() => leads.filter(validWa), [leads]);
  const nextWa = ready.find((l) => !done.has(l.id));
  // the batch: the next 10 not yet opened, numbered, so the person works through them quickly (press N for the next one)
  const batch = useMemo(() => ready.filter((l) => !done.has(l.id)).slice(0, 10), [ready, done]);
  const nextRef = useRef<Lead | undefined>(undefined); nextRef.current = nextWa;
  useEffect(() => {
    if (mode !== 'whatsapp') return;
    const k = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && nextRef.current) { e.preventDefault(); openWa(nextRef.current); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  const copyMsg = async (l: Lead) => { try { await navigator.clipboard.writeText(msgFor(l)); toast.success('Message copied'); } catch { toast.error('Copy failed'); } };

  // ---------------- e-mail ----------------
  const [subject, setSubject] = useState('Elsewedy Industrial Development');
  const [text, setText] = useState('Dear {name},\n\nThank you for your interest in {project}.\n\n\n\nBest regards,\n{rep}');
  const withMail = useMemo(() => leads.filter(validMail), [leads]);
  const addresses = useMemo(() => [...new Set(withMail.map((l) => l.email!.trim().toLowerCase()))], [withMail]);
  const generic = (t: string) => t.replace(/\{name\}/g, 'Sir / Madam').replace(/\{company\}/g, 'your company').replace(/\{project\}/g, 'our industrial cities').replace(/\{rep\}/g, myName);

  const openBcc = (part: Lead[]) => {
    const href = `mailto:?bcc=${encodeURIComponent(part.map((l) => l.email!.trim()).join(','))}&subject=${encodeURIComponent(generic(subject))}&body=${encodeURIComponent(generic(text))}`;
    window.location.href = href;
    for (const l of part) mark(l, 'email', `${subject} (BCC batch)`);
  };
  const copyAll = async () => { try { await navigator.clipboard.writeText(addresses.join('; ')); toast.success(`${addresses.length} addresses copied`); } catch { toast.error('Copy failed: select the addresses by hand.'); } };

  const wa = mode === 'whatsapp';
  const total = wa ? leads.filter(validWa).length : withMail.length;
  return (
    <div className="fixed inset-0 z-[9995] bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-3xl max-h-[92vh] sm:rounded-2xl rounded-t-3xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 bg-brand-black text-white flex items-center gap-3">
          {wa ? <MessageCircle size={20} /> : <Mail size={20} />}
          <div className="flex-1 min-w-0"><div className="font-extrabold">{wa ? 'Bulk WhatsApp' : 'Bulk e-mail'}: {leads.length.toLocaleString('en-US')} customers</div>
            <div className="text-[11px] text-white/60">{wa ? `${total} have a usable phone number. Each customer gets a personal message.` : `${withMail.length} have a valid e-mail (${leads.length - withMail.length} without).`}</div></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
          {wa ? (
            <>
              <div className="flex flex-wrap gap-2">
                <select value={tpl} onChange={(e) => setTpl(e.target.value)} className="border border-brand-gray/25 rounded-xl px-3 py-2 font-semibold flex-1 min-w-[180px]">
                  <option value="auto">Best template for each lead (automatic)</option>
                  {Object.keys(WA_TEMPLATES).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <select value={lang} onChange={(e) => { const v = e.target.value as WaLang; setLang(v); setWaLang(v); }} className="border border-brand-gray/25 rounded-xl px-3 py-2 font-semibold">
                  {(Object.keys(WA_LANGS) as WaLang[]).map((k) => <option key={k} value={k}>{WA_LANGS[k]}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-brand-gray">Open chats in</span>
                {([['app', 'WhatsApp app (fastest)'], ['web', 'WhatsApp Web']] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => pickVia(v)} className={`px-3 py-1.5 rounded-xl font-bold border ${via === v ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-brand-gray/30 text-brand-black hover:border-emerald-600'}`}>{l}</button>
                ))}
              </div>
              <p className="text-[11px] text-brand-gray">{via === 'app'
                ? <>The chat opens straight in the WhatsApp app with the message written: press <b>Enter</b> in WhatsApp, come back and press <b>N</b> for the next one. Needs the free WhatsApp app on this computer (whatsapp.com/download) and signed in once.</>
                : <>Every chat opens in the same WhatsApp Web tab (a new tab per chat would sign the others out). Press Send there, come back and press <b>N</b> for the next one.</>}</p>
              <div className="flex items-center gap-3">
                <button type="button" disabled={!nextWa} onClick={() => nextWa && openWa(nextWa)} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-extrabold px-5 py-3 rounded-xl inline-flex items-center gap-2 text-sm"><Send size={16} />{nextWa ? `Open next (N): ${nextWa.customerName}` : 'All done'}</button>
                <span className="font-bold text-brand-gray">{[...done].length} of {total} opened</span>
              </div>
              {batch.length > 0 && (
                <div className="rounded-xl border-2 border-emerald-600/40 bg-emerald-50/40">
                  <div className="px-3 py-2 font-extrabold text-emerald-800 text-[12px]">Next {batch.length} ready to send</div>
                  {batch.map((l, i) => (
                    <div key={l.id} className="flex items-center gap-3 px-3 py-2 border-t border-emerald-600/15">
                      <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-[11px] font-extrabold flex items-center justify-center shrink-0">{i + 1}</span>
                      <div className="min-w-0 flex-1"><div className="font-bold text-brand-black truncate">{l.customerName || l.id} <span className="font-mono font-normal text-brand-gray">· {l.phoneNumber}</span></div>
                        <div className="text-[11px] text-brand-gray line-clamp-1" dir="auto">{msgFor(l)}</div></div>
                      <button type="button" onClick={() => copyMsg(l)} aria-label="Copy the message" title="Copy the message" className="shrink-0 text-brand-gray hover:text-brand-black p-1.5"><Copy size={14} /></button>
                      <button type="button" onClick={() => openWa(l)} className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg">Send</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-brand-gray">WhatsApp does not allow one message to many people from a normal account, so each customer still needs one press of Send — everything else is ready. Each opened chat is logged on the lead and its status moves to "Sent WhatsApp".</p>
              <div className="divide-y divide-brand-gray/10 border border-brand-gray/15 rounded-xl">
                {leads.map((l) => (
                  <div key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                    {done.has(l.id) ? <CheckCircle2 size={18} className="text-emerald-600 shrink-0" /> : <MessageCircle size={18} className="text-brand-gray/50 shrink-0" />}
                    <div className="min-w-0 flex-1"><div className="font-bold text-brand-black truncate">{l.customerName || l.id} <span className="font-mono font-normal text-brand-gray">· {l.phoneNumber || 'no phone'}</span></div>
                      <div className="text-[11px] text-brand-gray line-clamp-2 whitespace-pre-line" dir="auto">{validWa(l) ? msgFor(l) : 'No usable phone number.'}</div></div>
                    <button type="button" disabled={!validWa(l)} onClick={() => openWa(l)} className="shrink-0 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-30 font-bold px-3 py-1.5 rounded-lg">{done.has(l.id) ? 'Again' : 'Open'}</button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full border border-brand-gray/25 rounded-xl px-3 py-2.5 font-semibold" />
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} dir="auto" className="w-full border border-brand-gray/25 rounded-xl px-3 py-2.5 leading-relaxed" />
              <p className="text-[11px] text-brand-gray">You can use <b>{'{name}'}</b>, <b>{'{company}'}</b>, <b>{'{project}'}</b> and <b>{'{rep}'}</b>: each customer gets their own details.</p>

              <div className="rounded-xl border border-brand-gray/20 p-4 space-y-2.5">
                <div className="font-extrabold text-brand-black text-[13px]">Send from my own mailbox (everyone in BCC)</div>
                <p className="text-[11px] text-brand-gray">Opens your e-mail program with the customers hidden in BCC, in batches of 40 (mail programs refuse longer lists). {'{name}'} becomes "Sir / Madam". Opened leads are logged as e-mailed.</p>
                <div className="flex flex-wrap gap-2">
                  {chunk(withMail, 40).map((part, i) => <button key={i} type="button" onClick={() => openBcc(part)} className="border border-brand-gray/30 hover:border-brand-red hover:text-brand-red font-bold px-3 py-2 rounded-xl">Batch {i + 1} ({part.length})</button>)}
                  <button type="button" onClick={copyAll} className="border border-brand-gray/30 hover:border-brand-red font-bold px-3 py-2 rounded-xl inline-flex items-center gap-1.5"><Copy size={13} /> Copy all {addresses.length} addresses</button>
                </div>
              </div>
              {withMail.length < leads.length && <p className="text-[11px] text-amber-700 font-semibold">{leads.length - withMail.length} selected customers have no valid e-mail and are skipped.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
