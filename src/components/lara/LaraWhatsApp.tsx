// Lara — phase 6: WhatsApp setup wizard (Meta WhatsApp Cloud API, direct). The token and app secret are typed by the admin and go
// straight to the server's safe store; they are never shown again. Meta's rules are enforced by the server, not by this screen.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MessageSquare, CheckCircle2, Circle, Copy, RefreshCw, Send, Loader2, ShieldCheck } from 'lucide-react';
import { SITUATION_LABEL } from '../crm/smartWriter';

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api${path}`, init ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const post = (p: string, b: any) => api(p, { method: 'POST', body: JSON.stringify(b) });
const SIT: Record<string, string> = { any: 'Any message', ...(SITUATION_LABEL as any), reply_answer: 'Reply with an approved answer', reply_holding: 'Holding reply' };

export const LaraWhatsApp: React.FC<{ reload: () => void }> = ({ reload }) => {
  const [d, setD] = useState<any>(null);
  const [v, setV] = useState<any>({ phoneNumberId: '', wabaId: '', apiVersion: 'v21.0', token: '', appSecret: '', testNumbers: '', consentFromEnquiry: true });
  const [busy, setBusy] = useState('');
  const [testTo, setTestTo] = useState('');
  const load = useCallback(async () => {
    try { const r = await api('/lara/wa'); setD(r); setV((x: any) => ({ ...x, phoneNumberId: r.wa.phoneNumberId || '', wabaId: r.wa.wabaId || '', apiVersion: r.wa.apiVersion || 'v21.0', testNumbers: (r.wa.testNumbers || []).join(', '), consentFromEnquiry: r.wa.consentFromEnquiry !== false })); }
    catch (e: any) { toast.error(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Loader2 className="animate-spin text-brand-gray" />;
  const w = d.wa, st = w.status;
  const steps = [
    ['Meta business verified and a WhatsApp Business Account created (Meta Business Suite)', !!w.wabaId],
    ['A phone number only for Lara added in WhatsApp Manager (not used on the WhatsApp app)', !!w.phoneNumberId],
    ['A permanent access token (System user with whatsapp_business_messaging + management)', !!w.hasToken],
    ['App secret saved (to check that webhook messages really come from Meta)', !!w.hasAppSecret],
    ['Webhook set in the Meta app: the address and check word below, field "messages"', !!w.verifyToken],
    ['Connected and tested (green below)', !!st?.ok],
  ];
  const save = async () => {
    setBusy('save');
    try { const r = await post('/lara/wa', { ...v, testNumbers: String(v.testNumbers).split(/[,\s]+/).filter(Boolean) }); setV((x: any) => ({ ...x, token: '', appSecret: '' })); r.wa.status?.ok ? toast.success(`Connected: ${r.wa.status.display}`) : toast.error(`Not connected: ${r.wa.status?.error || 'check the fields'}`); void load(); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  };
  const sync = async () => { setBusy('sync'); try { const r = await post('/lara/wa/templates/sync', {}); toast.success(`${r.count} templates read, ${r.approved} approved by Meta`); void load(); } catch (e: any) { toast.error(e.message); } finally { setBusy(''); } };
  const link = async (t: any, situation: string) => { try { await post('/lara/wa/templates/link', { name: t.name, lang: t.lang, situation }); void load(); } catch (e: any) { toast.error(e.message); } };
  const test = async () => { setBusy('test'); try { await post('/lara/wa/test', { to: testTo }); toast.success('Test sent (Meta template "hello_world")'); } catch (e: any) { toast.error(e.message); } finally { setBusy(''); } };
  const copy = (t: string) => { void navigator.clipboard?.writeText(t).then(() => toast.success('Copied')); };
  return (
    <section className="bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-4 lg:col-span-2">
      <h3 className="font-extrabold text-sm flex items-center gap-2"><MessageSquare size={16} className="text-green-600" />WhatsApp (Meta Cloud API)</h3>
      <div className={`text-xs rounded-xl px-3 py-2 ${st?.ok ? 'bg-emerald-50 text-emerald-800' : st ? 'bg-rose-50 text-rose-800' : 'bg-brand-gray/5 text-brand-gray'}`}>
        {st?.ok ? `Connected: ${st.display} (${st.name || '—'}) · Meta quality ${st.quality || '—'}${String(st.quality).toUpperCase() === 'RED' ? ' — Lara pauses WhatsApp' : ''}` : st ? `Not connected: ${st.error}` : 'Not set up yet. Lara keeps writing WhatsApp drafts for the salesperson to send by hand.'}
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="space-y-2">
          <p className="text-[11px] font-extrabold text-brand-gray">SET-UP STEPS</p>
          <ol className="space-y-1.5">{steps.map(([t, ok], i) => <li key={i} className="text-xs flex gap-2">{ok ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0" /> : <Circle size={15} className="text-brand-gray shrink-0" />}<span><b>{i + 1}.</b> {t as string}</span></li>)}</ol>
          <div className="bg-brand-gray/5 rounded-xl p-3 text-xs space-y-1.5">
            <p className="font-bold">Webhook for the Meta app</p>
            <p className="flex items-center gap-2 break-all"><code className="text-[11px]">{w.webhookUrl}</code><button onClick={() => copy(w.webhookUrl)}><Copy size={12} /></button></p>
            <p className="flex items-center gap-2">Check word: <code className="text-[11px]">{w.verifyToken || 'shown after the first save'}</code>{w.verifyToken && <button onClick={() => copy(w.verifyToken)}><Copy size={12} /></button>}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-900 space-y-1">
            <p className="font-bold flex items-center gap-1"><ShieldCheck size={12} />Meta's rules (enforced by the server)</p>
            <p>• First message only to customers who enquired with us or wrote first · • Free text only within 24 h of the customer's last message, otherwise an approved template · • "Stop / إيقاف / مش مهتم" = no more messages on any channel · • "Call me / visit" hands the lead to the salesperson · • Lara pauses when Meta's quality turns red · • Lara only talks about SDM (no general chatbot).</p>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] font-extrabold text-brand-gray">SETTINGS</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">Phone number ID<input value={v.phoneNumberId} onChange={(e) => setV({ ...v, phoneNumberId: e.target.value })} className="input-field w-full text-sm mt-0.5" /></label>
            <label className="text-xs">WhatsApp Business Account ID<input value={v.wabaId} onChange={(e) => setV({ ...v, wabaId: e.target.value })} className="input-field w-full text-sm mt-0.5" /></label>
          </div>
          <input type="password" autoComplete="new-password" value={v.token} onChange={(e) => setV({ ...v, token: e.target.value })} placeholder={w.hasToken ? 'Access token (saved; leave empty to keep)' : 'Permanent access token'} className="input-field w-full text-sm" />
          <input type="password" autoComplete="new-password" value={v.appSecret} onChange={(e) => setV({ ...v, appSecret: e.target.value })} placeholder={w.hasAppSecret ? 'App secret (saved; leave empty to keep)' : 'App secret (Meta app > Settings > Basic)'} className="input-field w-full text-sm" />
          <label className="text-xs block">Test numbers (while the test lock is on, only these receive anything)<input value={v.testNumbers} onChange={(e) => setV({ ...v, testNumbers: e.target.value })} placeholder="e.g. 01001234567, 201112223334" className="input-field w-full text-sm mt-0.5" /></label>
          <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={v.consentFromEnquiry} onChange={(e) => setV({ ...v, consentFromEnquiry: e.target.checked })} />A customer's enquiry (form, call, e-mail) counts as consent for a first template message</label>
          <div className="flex flex-wrap gap-2">
            <button onClick={save} disabled={!!busy} className="btn-primary rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-50">{busy === 'save' ? 'Working…' : 'Save & test connection'}</button>
            {st?.ok && <button onClick={sync} disabled={!!busy} className="btn-secondary rounded-xl px-3 py-1.5 text-xs font-bold flex items-center gap-1"><RefreshCw size={12} />Read templates from Meta</button>}
          </div>
          {st?.ok && (
            <div className="flex gap-2 items-center"><input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="A test number" className="input-field text-xs flex-1" /><button onClick={test} disabled={!!busy || !testTo} className="btn-secondary rounded-xl px-3 py-1.5 text-xs font-bold flex items-center gap-1 disabled:opacity-50"><Send size={12} />Send test</button></div>
          )}
        </div>
      </div>
      {d.templates.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-extrabold text-brand-gray">TEMPLATES FROM META — link each to the kind of message Lara uses it for outside the 24-hour window ({'{{1}}'} customer name, {'{{2}}'} park, {'{{3}}'} salesperson)</p>
          <ul className="divide-y divide-brand-gray/10 border border-brand-gray/10 rounded-xl">
            {d.templates.map((t: any) => (
              <li key={t.name + t.lang} className="p-2 text-xs flex flex-wrap items-center gap-2">
                <b>{t.name}</b><span className="text-brand-gray">{t.lang} · {t.category}</span>
                <span className={`rounded-full px-2 py-0.5 font-bold ${t.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{t.status}</span>
                <span className="flex-1 text-brand-gray truncate" dir="auto">{t.body}</span>
                <select value={t.situation || ''} onChange={(e) => link(t, e.target.value)} disabled={t.status !== 'APPROVED'} className="input-field text-xs"><option value="">Not used</option>{Object.entries(SIT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
