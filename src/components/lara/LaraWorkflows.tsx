// Lara — phase 4: workflow builder. WHEN (trigger) → IF (conditions) → THEN (steps with waits) → STOP. Test run before switching on. No AI.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileText, GitBranch, Plus, Play, Pencil, Archive, X, Loader2, Clock, MessageSquare, Bell, UserCheck, Crown, Filter, Zap, OctagonX, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { SITUATION_LABEL } from '../crm/smartWriter';
import { PRIORITIES, SOURCES, CHANNELS, STATUSES } from '../crm/leadConfig';
import { PARKS } from '../../lib/parkAliases';
import { crmNav } from '../crm/crmNav';

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api${path}`, init ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const post = (path: string, b: any) => api(path, { method: 'POST', body: JSON.stringify(b) });
const isAr = (t: string) => /[؀-ۿ]/.test(t || '');

const TRIGGER: Record<string, { label: string; unit: string }> = {
  no_first_contact: { label: 'New lead has no first contact after', unit: 'hours' },
  followup_overdue: { label: 'Follow-up date passed by', unit: 'days' },
  offer_silent: { label: 'Offer sent and nothing logged for', unit: 'days' },
  no_answer: { label: '"No answer / Sent WhatsApp" and no new try for', unit: 'days' },
  status_stuck: { label: 'Status unchanged for', unit: 'days' },
  old_lead: { label: 'Old imported lead, no contact for', unit: 'days' },
};
const ACTION: Record<string, { label: string; icon: any; tone: string }> = {
  message: { label: 'Lara writes to the customer', icon: MessageSquare, tone: 'bg-brand-red/10 text-brand-red' },
  offer: { label: 'Lara prepares an initial offer (PDF)', icon: FileText, tone: 'bg-sky-100 text-sky-800' },
  notify_owner: { label: 'Tell the salesperson', icon: Bell, tone: 'bg-amber-100 text-amber-800' },
  notify_director: { label: 'Tell the Sales Director', icon: Crown, tone: 'bg-violet-100 text-violet-800' },
  handover: { label: 'Hand the lead back to the salesperson', icon: UserCheck, tone: 'bg-emerald-100 text-emerald-800' },
};
const FIELDS: Record<string, { label: string; kind: 'list' | 'bool' | 'num'; options?: readonly string[] }> = {
  park: { label: 'Park', kind: 'list', options: PARKS }, source: { label: 'Source', kind: 'list', options: SOURCES }, channel: { label: 'Channel', kind: 'list', options: CHANNELS },
  priority: { label: 'Priority', kind: 'list', options: PRIORITIES }, status: { label: 'Status', kind: 'list', options: STATUSES }, owner: { label: 'Salesperson (names, comma)', kind: 'list' },
  hasEmail: { label: 'Has an e-mail address', kind: 'bool' }, hasPhone: { label: 'Has a phone number', kind: 'bool' },
  leadAgeDays: { label: 'Lead age (days)', kind: 'num' }, dealValue: { label: 'Deal value at least (EGP)', kind: 'num' },
};
const SIT_OPTIONS: [string, string][] = [['auto', 'Lara picks (where the lead stands)'], ...Object.entries(SITUATION_LABEL).filter(([k]) => !['won', 'meeting', 'visit'].includes(k))];
const EMPTY = { name: '', description: '', enabled: false, priority: 100, trigger: { type: 'followup_overdue', value: 3, statuses: [] as string[] }, conditions: [] as any[], steps: [{ waitDays: 0, action: 'message', channel: 'auto', situation: 'auto' }], stop: { onActivity: true, onReply: true, onMeeting: true } };

const condText = (c: any) => {
  const f = FIELDS[c.field]; if (!f) return '';
  if (f.kind === 'bool') return `${f.label}: ${c.value === true || c.value === 'true' ? 'yes' : 'no'}`;
  if (f.kind === 'num') return c.field === 'leadAgeDays' ? `Lead age ${c.op === 'lte' ? '≤' : '≥'} ${c.value} days` : `Deal value ≥ EGP ${Number(c.value).toLocaleString('en-US')}`;
  const v = Array.isArray(c.value) ? c.value.join(', ') : c.value;
  return `${f.label} ${c.op === 'notin' ? 'is not' : 'is'} ${v}`;
};

export const LaraWorkflows: React.FC<{ reload: () => void }> = ({ reload }) => {
  const [data, setData] = useState<any>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const load = useCallback(async () => { try { setData(await api('/lara/workflows')); } catch (e: any) { toast.error(e.message); } }, []);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (w: any) => {
    if (!w.enabled && !window.confirm(`Switch on "${w.name}"?\n\nLara starts using it at her next run. Messages stay drafts until a person approves them.`)) return;
    try { await post(`/lara/workflows/${w.id}/toggle`, { enabled: !w.enabled }); toast.success(w.enabled ? 'Switched off' : 'Switched on'); void load(); reload(); } catch (e: any) { toast.error(e.message); }
  };
  const archive = async (w: any) => { if (!window.confirm(`Archive "${w.name}"? Leads running in it stop. It is kept, not deleted.`)) return; try { await post(`/lara/workflows/${w.id}/archive`, {}); void load(); } catch (e: any) { toast.error(e.message); } };
  if (!data) return <Loader2 className="animate-spin text-brand-gray" />;
  return (
    <div className="space-y-4">
      <section className="bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-sm flex items-center gap-2"><GitBranch size={16} className="text-brand-red" />Workflows</h3>
          <p className="text-xs text-brand-gray max-w-2xl">Each workflow says <b>when</b> Lara starts on a lead, <b>which</b> leads, <b>what</b> she does step by step, and <b>when she stops</b>. A lead is in one workflow at a time; the lowest priority number goes first. Test a workflow before you switch it on.</p>
        </div>
        <button onClick={() => setEdit(JSON.parse(JSON.stringify(EMPTY)))} className="btn-primary rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-1"><Plus size={14} />New workflow</button>
      </section>
      {data.rows.map((w: any) => <WfCard key={w.id} w={w} st={data.stats[w.id]} onToggle={() => toggle(w)} onEdit={() => setEdit(JSON.parse(JSON.stringify(w)))} onArchive={() => archive(w)} />)}
      {edit && <Editor w={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); reload(); }} />}
    </div>
  );
};

const WfCard: React.FC<{ w: any; st?: any; onToggle: () => void; onEdit: () => void; onArchive: () => void }> = ({ w, st, onToggle, onEdit, onArchive }) => {
  const [open, setOpen] = useState(false);
  const reasons = st ? Object.entries(st.reasons || {}).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3) : [];
  return (
    <section className={`bento-card bg-white border rounded-2xl p-4 shadow-sm space-y-3 ${w.enabled ? 'border-emerald-200' : 'border-brand-gray/20 opacity-90'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-extrabold text-sm text-brand-black flex items-center gap-2"><span className="text-[10px] font-bold bg-brand-gray/10 rounded-full px-2 py-0.5">#{w.priority}</span>{w.name}</p>
          {w.description && <p className="text-xs text-brand-gray mt-0.5">{w.description}</p>}
        </div>
        <button onClick={onToggle} className={`relative w-12 h-6 rounded-full transition ${w.enabled ? 'bg-emerald-500' : 'bg-brand-gray/30'}`} title={w.enabled ? 'On' : 'Off'}><span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition ${w.enabled ? 'left-6' : 'left-0.5'}`} /></button>
      </div>
      <Flow w={w} compact={!open} />
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        {st ? <span className="text-brand-gray">30 days: <b className="text-brand-black">{st.active}</b> running · <b className="text-brand-black">{st.done}</b> finished · <b className="text-brand-black">{st.stopped}</b> stopped{reasons.length ? ` (${reasons.map(([r, n]: any) => `${r}: ${n}`).join('; ')})` : ''}</span> : <span className="text-brand-gray">No leads yet.</span>}
        <span className="ml-auto flex gap-3 font-bold">
          <button onClick={() => setOpen((v) => !v)} className="text-brand-gray flex items-center">{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{open ? 'Less' : 'Steps'}</button>
          <button onClick={onEdit} className="text-brand-red flex items-center gap-0.5"><Pencil size={12} />Edit & test</button>
          <button onClick={onArchive} className="text-brand-gray flex items-center gap-0.5"><Archive size={12} />Archive</button>
        </span>
      </div>
    </section>
  );
};

/** the workflow drawn as a vertical flow: When → If → steps (with waits) → Stop */
const Flow: React.FC<{ w: any; compact?: boolean }> = ({ w, compact }) => {
  const t = TRIGGER[w.trigger?.type] || { label: w.trigger?.type, unit: '' };
  const when = `${t.label} ${w.trigger?.value} ${t.unit}${w.trigger?.type === 'status_stuck' && w.trigger?.statuses?.length ? ` (${w.trigger.statuses.join(', ')})` : ''}`;
  const Node: React.FC<{ icon: any; tone: string; title: string; sub?: string; last?: boolean }> = ({ icon: I, tone, title, sub, last }) => (
    <div className="flex gap-3">
      <div className="flex flex-col items-center"><span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${tone}`}><I size={14} /></span>{!last && <span className="w-px flex-1 bg-brand-gray/20 my-1" />}</div>
      <div className="pb-3 min-w-0"><p className="text-xs font-bold text-brand-black">{title}</p>{sub && <p className="text-[11px] text-brand-gray">{sub}</p>}</div>
    </div>
  );
  if (compact) return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="bg-sky-100 text-sky-800 rounded-full px-2 py-0.5 font-bold flex items-center gap-1"><Zap size={11} />{when}</span>
      {(w.conditions || []).map((c: any, i: number) => <span key={i} className="bg-brand-gray/10 rounded-full px-2 py-0.5">{condText(c)}</span>)}
      {(w.steps || []).map((s: any, i: number) => { const A = ACTION[s.action] || ACTION.message; return <span key={i} className={`rounded-full px-2 py-0.5 ${A.tone}`}>{s.waitDays ? `+${s.waitDays}d ` : ''}{A.label}</span>; })}
    </div>
  );
  return (
    <div className="pt-1">
      <Node icon={Zap} tone="bg-sky-100 text-sky-800" title={`When: ${when}`} />
      <Node icon={Filter} tone="bg-brand-gray/10 text-brand-gray" title={(w.conditions || []).length ? 'Only leads where' : 'All leads (no extra conditions)'} sub={(w.conditions || []).map(condText).join(' · ')} />
      {(w.steps || []).map((s: any, i: number) => {
        const A = ACTION[s.action] || ACTION.message;
        const sub = s.action === 'message' ? `${s.channel === 'auto' || !s.channel ? 'E-mail if possible, else WhatsApp draft' : s.channel === 'email' ? 'E-mail only' : 'WhatsApp draft only'} · ${(SITUATION_LABEL as any)[s.situation] || 'Lara picks the message'}` : undefined;
        return <Node key={i} icon={A.icon} tone={A.tone} title={`${s.waitDays ? `After ${s.waitDays} day${s.waitDays > 1 ? 's' : ''}: ` : 'Right away: '}${A.label}`} sub={sub} />;
      })}
      <Node icon={OctagonX} tone="bg-rose-100 text-rose-700" title="Stops when" sub={[w.stop?.onActivity !== false && 'the salesperson works on the lead', w.stop?.onReply !== false && 'the customer replies', w.stop?.onMeeting !== false && 'a meeting is planned', 'the customer says stop', 'the lead is closed'].filter(Boolean).join(' · ')} last />
    </div>
  );
};

const Editor: React.FC<{ w: any; onClose: () => void; onSaved: () => void }> = ({ w: w0, onClose, onSaved }) => {
  const [w, setW] = useState<any>(w0);
  const [test, setTest] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: any) => { setW((x: any) => ({ ...x, ...patch })); setTest(null); };
  const setStep = (i: number, patch: any) => set({ steps: w.steps.map((s: any, k: number) => (k === i ? { ...s, ...patch } : s)) });
  const setCond = (i: number, patch: any) => set({ conditions: w.conditions.map((c: any, k: number) => (k === i ? { ...c, ...patch } : c)) });
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const runTest = async () => { setBusy(true); try { setTest(await post('/lara/workflows/test', w)); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const save = async () => { setBusy(true); try { await post('/lara/workflows', w); toast.success('Workflow saved'); onSaved(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const t = TRIGGER[w.trigger.type];
  const statusSet = useMemo(() => new Set(w.trigger.statuses || []), [w.trigger.statuses]);
  return (
    <div className="fixed inset-0 z-[120] bg-black/40 flex justify-end" onClick={onClose}>
      <aside className="bg-white w-full max-w-3xl h-full shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-brand-gray/10 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="font-extrabold text-brand-black flex items-center gap-2"><GitBranch size={16} className="text-brand-red" />{w.id ? 'Edit workflow' : 'New workflow'}</h3>
          <div className="flex gap-2">
            <button onClick={runTest} disabled={busy} className="btn-secondary rounded-xl px-3 py-1.5 text-xs font-bold flex items-center gap-1">{busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}Test run</button>
            <button onClick={save} disabled={busy} className="btn-primary rounded-xl px-3 py-1.5 text-xs font-bold">Save</button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-brand-gray/10"><X size={18} /></button>
          </div>
        </div>
        <div className="p-5 pb-28 lg:pb-5 grid lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <label className="col-span-2 text-xs font-bold">Name<input value={w.name} onChange={(e) => set({ name: e.target.value })} className="input-field w-full text-sm mt-0.5" /></label>
              <label className="text-xs font-bold">Priority<input type="number" value={w.priority} onChange={(e) => set({ priority: e.target.value })} className="input-field w-full text-sm mt-0.5" /></label>
            </div>
            <label className="text-xs font-bold block">What it is for<textarea value={w.description} onChange={(e) => set({ description: e.target.value })} rows={2} className="input-field w-full text-xs mt-0.5" /></label>

            <div className="rounded-2xl border border-sky-200 bg-sky-50/50 p-3 space-y-2">
              <p className="text-[11px] font-extrabold text-sky-900 flex items-center gap-1"><Zap size={13} />WHEN</p>
              <select value={w.trigger.type} onChange={(e) => set({ trigger: { ...w.trigger, type: e.target.value } })} className="input-field w-full text-sm">{Object.entries(TRIGGER).map(([k, v]) => <option key={k} value={k}>{v.label}…</option>)}</select>
              <div className="flex items-center gap-2"><input type="number" value={w.trigger.value} onChange={(e) => set({ trigger: { ...w.trigger, value: e.target.value } })} className="input-field w-24 text-sm" /><span className="text-xs text-brand-gray">{t?.unit}</span></div>
              {w.trigger.type === 'status_stuck' && (
                <div className="flex flex-wrap gap-1">{STATUSES.map((s) => <button key={s} onClick={() => set({ trigger: { ...w.trigger, statuses: statusSet.has(s) ? w.trigger.statuses.filter((x: string) => x !== s) : [...(w.trigger.statuses || []), s] } })} className={`text-[10px] rounded-full px-2 py-0.5 border ${statusSet.has(s) ? 'bg-sky-600 text-white border-sky-600' : 'border-brand-gray/25'}`}>{s}</button>)}</div>
              )}
            </div>

            <div className="rounded-2xl border border-brand-gray/20 p-3 space-y-2">
              <p className="text-[11px] font-extrabold text-brand-gray flex items-center gap-1"><Filter size={13} />ONLY LEADS WHERE</p>
              {w.conditions.length === 0 && <p className="text-xs text-brand-gray">All leads that match WHEN.</p>}
              {w.conditions.map((c: any, i: number) => {
                const f = FIELDS[c.field] || FIELDS.park;
                return (
                  <div key={i} className="flex flex-wrap gap-1.5 items-center">
                    <select value={c.field} onChange={(e) => { const nf = FIELDS[e.target.value]; setCond(i, { field: e.target.value, op: nf.kind === 'num' ? 'gte' : nf.kind === 'bool' ? 'is' : 'in', value: nf.kind === 'bool' ? true : '' }); }} className="input-field text-xs">{Object.entries(FIELDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                    {f.kind === 'list' && <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value })} className="input-field text-xs"><option value="in">is</option><option value="notin">is not</option></select>}
                    {f.kind === 'num' && c.field === 'leadAgeDays' && <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value })} className="input-field text-xs"><option value="gte">at least</option><option value="lte">at most</option></select>}
                    {f.kind === 'bool' ? <select value={String(c.value)} onChange={(e) => setCond(i, { value: e.target.value === 'true' })} className="input-field text-xs"><option value="true">yes</option><option value="false">no</option></select>
                      : f.options ? <select value={Array.isArray(c.value) ? c.value[0] || '' : c.value} onChange={(e) => setCond(i, { value: e.target.value })} className="input-field text-xs flex-1 min-w-[120px]"><option value="">Choose…</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
                        : <input value={Array.isArray(c.value) ? c.value.join(', ') : c.value} onChange={(e) => setCond(i, { value: e.target.value })} className="input-field text-xs flex-1 min-w-[100px]" />}
                    <button onClick={() => set({ conditions: w.conditions.filter((_: any, k: number) => k !== i) })} className="text-brand-gray hover:text-rose-600"><Trash2 size={13} /></button>
                  </div>
                );
              })}
              {w.conditions.length < 10 && <button onClick={() => set({ conditions: [...w.conditions, { field: 'park', op: 'in', value: '' }] })} className="text-xs font-bold text-brand-red flex items-center gap-1"><Plus size={12} />Add condition</button>}
            </div>

            <div className="rounded-2xl border border-brand-red/20 p-3 space-y-2">
              <p className="text-[11px] font-extrabold text-brand-red flex items-center gap-1"><Clock size={13} />THEN, STEP BY STEP</p>
              {w.steps.map((s: any, i: number) => (
                <div key={i} className="bg-brand-gray/5 rounded-xl p-2 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-extrabold bg-white rounded-full px-2 py-0.5">{i + 1}</span>
                    <span className="text-xs">{i === 0 ? 'Wait' : 'Then wait'}</span>
                    <input type="number" value={s.waitDays} onChange={(e) => setStep(i, { waitDays: e.target.value })} className="input-field w-16 text-xs" /><span className="text-xs">days, then</span>
                    <select value={s.action} onChange={(e) => setStep(i, { action: e.target.value })} className="input-field text-xs flex-1 min-w-[160px]">{Object.entries(ACTION).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                    <button onClick={() => set({ steps: w.steps.filter((_: any, k: number) => k !== i) })} disabled={w.steps.length <= 1} className="text-brand-gray hover:text-rose-600 disabled:opacity-30"><Trash2 size={13} /></button>
                  </div>
                  {s.action === 'message' && (
                    <div className="flex flex-wrap gap-1.5 pl-7">
                      <select value={s.channel || 'auto'} onChange={(e) => setStep(i, { channel: e.target.value })} className="input-field text-xs"><option value="auto">E-mail if possible, else WhatsApp draft</option><option value="email">E-mail only</option><option value="whatsapp">WhatsApp draft only</option></select>
                      <select value={s.situation || 'auto'} onChange={(e) => setStep(i, { situation: e.target.value })} className="input-field text-xs flex-1 min-w-[150px]">{SIT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    </div>
                  )}
                </div>
              ))}
              {w.steps.length < 8 && <button onClick={() => set({ steps: [...w.steps, { waitDays: 3, action: 'notify_owner', channel: 'auto', situation: 'auto' }] })} className="text-xs font-bold text-brand-red flex items-center gap-1"><Plus size={12} />Add step</button>}
            </div>

            <div className="rounded-2xl border border-rose-200 p-3 space-y-1.5">
              <p className="text-[11px] font-extrabold text-rose-700 flex items-center gap-1"><OctagonX size={13} />STOP WHEN</p>
              {[['onActivity', 'The salesperson works on the lead (call, WhatsApp, note, status…)'], ['onReply', 'The customer replies'], ['onMeeting', 'A meeting or site visit is planned']].map(([k, l]) => (
                <label key={k} className="text-xs flex items-center gap-2"><input type="checkbox" checked={w.stop?.[k] !== false} onChange={(e) => set({ stop: { ...w.stop, [k]: e.target.checked } })} />{l}</label>
              ))}
              <p className="text-[10px] text-brand-gray">Always: the customer says stop, the lead is closed, or you reject a draft with "Do not contact".</p>
              <label className="text-xs flex items-center gap-2 pt-1 border-t border-rose-100"><input type="checkbox" checked={!!w.autopilot} onChange={(e) => set({ autopilot: e.target.checked })} /><b>Autopilot</b>: when Lara is in Autopilot mode, this workflow's messages go out without approval (offers never)</label>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-brand-gray/15 p-3"><p className="text-[11px] font-extrabold text-brand-gray mb-2">PREVIEW</p><Flow w={w} /></div>
            <div className="rounded-2xl border border-brand-gray/15 p-3 space-y-2">
              <p className="text-[11px] font-extrabold text-brand-gray flex items-center gap-1"><Play size={12} />TEST RUN</p>
              {!test ? <p className="text-xs text-brand-gray">Press "Test run" to see which leads this workflow would act on right now, and the first messages. Nothing is written or sent.</p> : (
                <div className="space-y-2 text-xs">
                  <p className="text-sm"><b>{test.matched}</b> leads match now{test.alreadyInAWorkflow ? ` (${test.alreadyInAWorkflow} already in another workflow)` : ''}. Lara writes at most <b>{test.perRunLimit}</b> drafts per run, most urgent first.</p>
                  {test.byOwner.length > 0 && <div className="flex flex-wrap gap-1">{test.byOwner.map((o: any) => <span key={o.name} className="bg-brand-gray/10 rounded-full px-2 py-0.5">{o.name}: <b>{o.n}</b></span>)}</div>}
                  <ul className="max-h-56 overflow-y-auto divide-y divide-brand-gray/10 border border-brand-gray/10 rounded-xl">
                    {test.leads.map((l: any) => (
                      <li key={l.id} className="px-2 py-1.5 flex gap-2 items-start">
                        <button onClick={() => crmNav.lead(l.id)} className="font-bold text-brand-black hover:text-brand-red text-left">{l.customer}</button>
                        <span className="text-brand-gray flex-1">{l.owner} · {l.why}{l.busy ? ' · already in a workflow' : ''}{!l.email ? ' · no e-mail' : ''}</span>
                      </li>
                    ))}
                  </ul>
                  {test.samples.map((s: any, i: number) => (
                    <div key={i} className="bg-brand-gray/5 rounded-xl p-2"><p className="text-[10px] text-brand-gray">{s.customer} · {s.channel === 'email' ? 'E-mail' : 'WhatsApp draft'}</p><p dir={isAr(s.body) ? 'rtl' : 'ltr'} className="whitespace-pre-line text-xs mt-1">{s.body}</p></div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};
