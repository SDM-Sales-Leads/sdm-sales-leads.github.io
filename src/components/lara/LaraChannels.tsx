// Lara settings: the customer web chat (buttons in her e-mails, website chat) and the AI for hard questions (off by default, capped).
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MessageCircle, Sparkles, Copy, Loader2, ShieldCheck, Globe } from 'lucide-react';

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api${path}`, init ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const post = (p: string, b: any) => api(p, { method: 'POST', body: JSON.stringify(b) });
const card = 'bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-3';

export const LaraChannels: React.FC = () => {
  const [d, setD] = useState<any>(null);
  const [chat, setChat] = useState<any>({}); const [ai, setAi] = useState<any>({}); const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => { try { const r = await api('/lara/channels'); setD(r); setChat(r.chat); setAi(r.ai); } catch (e: any) { toast.error(e.message); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Loader2 className="animate-spin text-brand-gray" />;
  const saveChat = async () => { setBusy('chat'); try { await post('/lara/chat-settings', chat); toast.success('Saved'); void load(); } catch (e: any) { toast.error(e.message); } finally { setBusy(''); } };
  const saveAi = async () => { setBusy('ai'); try { await post('/lara/ai', { ...ai, key }); setKey(''); toast.success('Saved'); void load(); } catch (e: any) { toast.error(e.message); } finally { setBusy(''); } };
  const embed = `<a href="${d.chatPage}" target="_blank" rel="noopener" style="position:fixed;bottom:20px;right:20px;background:#B3263D;color:#fff;padding:12px 18px;border-radius:999px;font-family:sans-serif;font-weight:600;text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.2)">💬 Chat with Lara</a>`;
  return (
    <>
      <section className={card}>
        <h3 className="font-extrabold text-sm flex items-center gap-2"><MessageCircle size={16} className="text-violet-700" />Web chat with Lara</h3>
        <p className="text-xs text-brand-gray">Every Lara e-mail has buttons: <b>Chat with Lara</b> (opens a chat page, Lara answers at once in the customer's language), <b>Call us</b> and <b>WhatsApp</b>. Lara answers from rules, the Land Bank list and approved answers; anything else goes to the salesperson, who answers in Interactions.</p>
        {d.testLock && <p className="text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-1.5"><ShieldCheck size={13} />On hold: the chat works only for staff test conversations. Website chat opens after the test lock is lifted.</p>}
        <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={!!chat.enabled} disabled={d.testLock} onChange={(e) => setChat({ ...chat, enabled: e.target.checked })} />Open the chat to customers and website visitors</label>
        <label className="text-xs block">Number for the "Call us" button (leave empty to hide it)<input value={chat.callNumber || ''} onChange={(e) => setChat({ ...chat, callNumber: e.target.value })} placeholder="e.g. +20 2 1234 5678 or 16xxx" className="input-field w-full text-sm mt-0.5" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">Welcome (Arabic, optional)<textarea dir="rtl" rows={2} value={chat.welcomeAr || ''} onChange={(e) => setChat({ ...chat, welcomeAr: e.target.value })} className="input-field w-full text-sm mt-0.5" /></label>
          <label className="text-xs">Welcome (English, optional)<textarea rows={2} value={chat.welcomeEn || ''} onChange={(e) => setChat({ ...chat, welcomeEn: e.target.value })} className="input-field w-full text-sm mt-0.5" /></label>
        </div>
        <div className="border-t border-brand-gray/10 pt-3 space-y-2">
          <p className="text-[11px] font-extrabold text-brand-gray">VOICE CALL WITH LARA (same chat page: the customer sees Lara and talks to her)</p>
          <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={chat.voice !== false} onChange={(e) => setChat({ ...chat, voice: e.target.checked })} />Show "Talk to me" in the chat (languages: Arabic, English, French, Turkish, Chinese)</label>
          <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={chat.record !== false} onChange={(e) => setChat({ ...chat, record: e.target.checked })} />Record calls (the customer is asked to agree first; recordings are private and played in Interactions)</label>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs">Voice engine<select value={chat.provider || 'browser'} onChange={(e) => setChat({ ...chat, provider: e.target.value })} className="input-field w-full text-sm mt-0.5"><option value="browser">Browser speech (free, works now)</option><option value="gemini-live">Gemini Live (when connected)</option></select></label>
            <label className="text-xs">Gemini Live model<input value={chat.liveModel || ''} onChange={(e) => setChat({ ...chat, liveModel: e.target.value })} placeholder="lowest-cost live model id" className="input-field w-full text-sm mt-0.5" /></label>
            <label className="text-xs">Gemini voice name<input value={chat.liveVoice || ''} onChange={(e) => setChat({ ...chat, liveVoice: e.target.value })} placeholder="e.g. a female voice" className="input-field w-full text-sm mt-0.5" /></label>
          </div>
          <p className="text-[11px] text-brand-gray">Today calls use the browser's own speech (no cost): Lara's answers are the same rule-based answers as the chat. Gemini Live is not connected yet: these fields only store your choice, and the key is the one in "AI for hard questions" below. Copy the model id from Google AI Studio (pick the cheapest live model).</p>
        </div>
        <button onClick={saveChat} disabled={!!busy} className="btn-primary rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-50">{busy === 'chat' ? 'Saving…' : 'Save'}</button>
        <details className="text-xs"><summary className="font-bold cursor-pointer">Chat button for the company website</summary>
          <p className="text-brand-gray my-1">Paste before &lt;/body&gt; on the website. Visitors give their name and mobile first; a known number joins that lead's conversation.</p>
          <div className="flex gap-2 items-start"><code className="text-[10px] bg-brand-gray/5 rounded-lg p-2 break-all flex-1">{embed}</code><button onClick={() => void navigator.clipboard?.writeText(embed).then(() => toast.success('Copied'))}><Copy size={13} /></button></div>
        </details>
      </section>
      <section className={card}>
        <h3 className="font-extrabold text-sm flex items-center gap-2"><Sparkles size={16} className="text-fuchsia-700" />AI for hard questions only</h3>
        <p className="text-xs text-brand-gray">Off by default. Lara first tries rules, the Land Bank list and your approved answers (free). Only a question none of these answers goes to the AI, which may use only your approved answers as facts, and says nothing when they don't cover it. Every AI answer is in the Log, the question still lands in Missed questions (approve an answer once and the AI is never needed for it again), and in e-mail/WhatsApp an AI answer always waits for a person.</p>
        <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={!!ai.enabled} onChange={(e) => setAi({ ...ai, enabled: e.target.checked })} />Use AI for hard questions</label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">Most AI answers per day<input type="number" min={0} max={500} value={ai.dailyCap ?? 20} onChange={(e) => setAi({ ...ai, dailyCap: Number(e.target.value) })} className="input-field w-full text-sm mt-0.5" /></label>
          <label className="text-xs">Model<input value={ai.model || ''} onChange={(e) => setAi({ ...ai, model: e.target.value })} className="input-field w-full text-sm mt-0.5" /></label>
        </div>
        <input type="password" autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={ai.hasKey ? 'Google AI key (saved; leave empty to keep)' : 'Google AI Studio key'} className="input-field w-full text-sm" />
        <p className="text-[11px] text-brand-gray">Used today: {ai.usedToday ?? 0} of {ai.dailyCap ?? 20}. {ai.hasKey ? 'Key saved in the server safe.' : 'No key saved: the AI cannot run.'}</p>
        <button onClick={saveAi} disabled={!!busy} className="btn-primary rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-50">{busy === 'ai' ? 'Saving…' : 'Save'}</button>
      </section>
      <SiteKb />
    </>
  );
};

/** the company website as Lara's knowledge base: status, "prepare meaning search" (one batch per call, repeated), suggestions */
const SiteKb: React.FC = () => {
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => { try { setSt(await api('/lara/site')); } catch (e: any) { toast.error(e.message); } }, []);
  useEffect(() => { void load(); }, [load]);
  const prepare = async () => {
    setBusy('embed');
    try {
      // 20 passages per call, one call every 16 s (the free tier allows ~80 a minute); "wait" from Google = pause 65 s and go on
      for (let i = 0; i < 200; i++) {
        const r = await post('/lara/site/embed', {});
        setSt((x: any) => ({ ...x, withMeaning: (x?.passages || 0) - r.left }));
        if (!r.left) { toast.success('Meaning search ready'); break; }
        if (r.wait) toast.message('Google free limit: waiting a minute, then going on…');
        await new Promise((res) => setTimeout(res, r.wait ? 65000 : 16000));
      }
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); void load(); }
  };
  const suggest = async () => {
    setBusy('suggest');
    try { const r = await post('/lara/site/suggest', { all: true }); toast.success(`Website suggestions: ${r.suggested} of ${r.checked} open questions`); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  };
  if (!st) return <section className={card}><Loader2 className="animate-spin text-brand-gray" /></section>;
  const ready = st.passages > 0 && st.withMeaning >= st.passages;
  return (
    <section className={card}>
      <h3 className="font-extrabold text-sm flex items-center gap-2"><Globe size={16} className="text-sky-700" />Website knowledge base</h3>
      <p className="text-xs text-brand-gray">elsewedydevelopment.com (English + Arabic) stored as a tree: park › page › heading › passage. For each missed question Lara looks only inside the matching park and topic and suggests the best website passage with its link. Your team checks it and saves it as the approved answer; Lara never sends a website passage to a customer by herself.</p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-brand-gray/5 p-2"><div className="text-lg font-extrabold">{st.passages || '—'}</div><div className="text-[10px] text-brand-gray">passages</div></div>
        <div className="rounded-xl bg-brand-gray/5 p-2"><div className="text-lg font-extrabold">{st.passages ? `${Math.round((st.withMeaning / st.passages) * 100)}%` : '—'}</div><div className="text-[10px] text-brand-gray">meaning search</div></div>
        <div className="rounded-xl bg-brand-gray/5 p-2"><div className="text-sm font-extrabold">{st.loadedAt ? new Date(st.loadedAt).toLocaleDateString('en-GB') : '—'}</div><div className="text-[10px] text-brand-gray">site read on</div></div>
      </div>
      <p className="text-[11px] text-brand-gray">{!st.keySaved ? 'No Google key saved: suggestions use word search only. Save a free Google AI Studio key in the card above (you can leave "Use AI for hard questions" off) to switch on meaning search.' : ready ? 'Meaning search is on: questions are matched by meaning (Arabic and English), at most 300 questions a day.' : 'Key saved. Press "Prepare meaning search" once and keep this page open (about 15 minutes on the free tier) to read every passage.'}</p>
      <div className="flex flex-wrap gap-2">
        {st.keySaved && !ready && <button onClick={prepare} disabled={!!busy} className="btn-primary rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-50">{busy === 'embed' ? `Preparing… ${st.withMeaning}/${st.passages}` : 'Prepare meaning search'}</button>}
        <button onClick={suggest} disabled={!!busy} className="rounded-xl border border-brand-gray/30 px-3 py-1.5 text-xs font-bold disabled:opacity-50">{busy === 'suggest' ? 'Looking…' : 'Suggest answers for missed questions'}</button>
      </div>
      <p className="text-[10px] text-brand-gray">To read the website again after it changes: scripts/site-kb/run.sh (then "Prepare meaning search" for the new passages).</p>
    </section>
  );
};
