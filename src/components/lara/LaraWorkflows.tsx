// Lara — workflows. The list shows each workflow as a small chain of boxes; "Edit" opens the canvas (boxes + arrows, n8n-style),
// which is loaded only then (React.lazy) to keep this page light. No AI.
import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GitBranch, Plus, Pencil, Archive, Loader2, ChevronDown, ChevronUp, Bot } from 'lucide-react';
import { graphOf, outline, stepsToGraph } from './flow/graph';
import { BOX, boxSummary, triggerText, condText } from './flow/meta';

const FlowEditor = lazy(() => import('./flow/FlowEditor'));

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api${path}`, init ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const post = (path: string, b: any) => api(path, { method: 'POST', body: JSON.stringify(b) });

/** a new workflow starts with Start → Write to the customer → Wait for a reply (replied: hand back / no reply: tell the salesperson) */
const newWorkflow = () => {
  const g = stepsToGraph([{ waitDays: 0, action: 'message', channel: 'auto', situation: 'auto' }], { type: 'followup_overdue', value: 3 }, []);
  const end = g.nodes.find((n) => n.type === 'end')!;
  g.edges = g.edges.filter((e) => e.target !== 'end');
  g.nodes = g.nodes.filter((n) => n !== end).concat(
    { id: 'wr', type: 'wait_reply', x: 0, y: 260, data: { days: 3 } },
    { id: 'ho', type: 'handover', x: -140, y: 400, data: {} },
    { id: 'no', type: 'notify_owner', x: 140, y: 400, data: {} },
  );
  g.edges.push({ id: 'e-s0-wr', source: 's0', target: 'wr' }, { id: 'e-wr-ho', source: 'wr', target: 'ho', handle: 'replied' }, { id: 'e-wr-no', source: 'wr', target: 'no', handle: 'no_reply' });
  return { name: '', description: '', enabled: false, priority: 100, stop: { onActivity: true, onReply: true, onMeeting: true }, autopilot: false, graph: g, trigger: { type: 'followup_overdue', value: 3 }, conditions: [], steps: [] };
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
          <p className="text-xs text-brand-gray max-w-2xl">Draw what Lara does, box by box: <b>Start</b> (when, which leads) → messages, waits, <b>If / else</b>, <b>Wait for a reply</b>, offers, hand-backs. A lead is in one workflow at a time; the lowest priority number goes first. Test on live leads before you switch one on.</p>
        </div>
        <button onClick={() => setEdit(newWorkflow())} className="btn-primary rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-1"><Plus size={14} />New workflow</button>
      </section>
      {data.rows.map((w: any) => <WfCard key={w.id} w={w} st={data.stats[w.id]} onToggle={() => toggle(w)} onEdit={() => setEdit(JSON.parse(JSON.stringify(w)))} onArchive={() => archive(w)} />)}
      {edit && (
        <Suspense fallback={<div className="fixed inset-0 z-[120] bg-white/80 flex items-center justify-center"><Loader2 className="animate-spin text-brand-red" /></div>}>
          <FlowEditor w={edit} here={edit.id ? data.stats[edit.id]?.atNode : undefined} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); reload(); }} />
        </Suspense>
      )}
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
          <p className="font-extrabold text-sm text-brand-black flex items-center gap-2"><span className="text-[10px] font-bold bg-brand-gray/10 rounded-full px-2 py-0.5">#{w.priority}</span>{w.name}{w.autopilot && <span className="text-[10px] font-bold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 flex items-center gap-0.5"><Bot size={10} />Autopilot</span>}</p>
          {w.description && <p className="text-xs text-brand-gray mt-0.5">{w.description}</p>}
        </div>
        <button onClick={onToggle} className={`relative w-12 h-6 rounded-full transition ${w.enabled ? 'bg-emerald-500' : 'bg-brand-gray/30'}`} title={w.enabled ? 'On' : 'Off'}><span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition ${w.enabled ? 'left-6' : 'left-0.5'}`} /></button>
      </div>
      <Chain w={w} full={open} here={st?.atNode || {}} />
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        {st ? <span className="text-brand-gray">30 days: <b className="text-brand-black">{st.active}</b> running · <b className="text-brand-black">{st.done}</b> finished · <b className="text-brand-black">{st.stopped}</b> stopped{reasons.length ? ` (${reasons.map(([r, n]: any) => `${r}: ${n}`).join('; ')})` : ''}</span> : <span className="text-brand-gray">No leads yet.</span>}
        <span className="ml-auto flex gap-3 font-bold">
          <button onClick={() => setOpen((v) => !v)} className="text-brand-gray flex items-center">{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{open ? 'Less' : 'Details'}</button>
          <button onClick={onEdit} className="text-brand-red flex items-center gap-0.5"><Pencil size={12} />Open canvas</button>
          <button onClick={onArchive} className="text-brand-gray flex items-center gap-0.5"><Archive size={12} />Archive</button>
        </span>
      </div>
    </section>
  );
};

/** the workflow as a small chain of coloured boxes (the canvas shows the full drawing) */
const Chain: React.FC<{ w: any; full: boolean; here: Record<string, number> }> = ({ w, full, here }) => {
  const g = graphOf(w); const items = outline(g);
  const start = (
    <span className="bg-brand-red text-white rounded-full px-2 py-0.5 font-bold" title={(w.conditions || []).map(condText).join(' · ')}>{triggerText(w.trigger)}{(w.conditions || []).length ? ` · ${(w.conditions || []).length} filter${(w.conditions || []).length > 1 ? 's' : ''}` : ''}</span>
  );
  if (!full) return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      {start}
      {items.map((n) => { const m = BOX[n.type]; return <React.Fragment key={n.id}><span className="text-brand-gray">→</span><span className={`rounded-full px-2 py-0.5 border ${m.ring} ${n.type === 'end' ? 'bg-brand-black text-white' : `${m.bg} ${m.text}`}`}>{n.data?.label || m.title}{n.type === 'wait' || n.type === 'wait_reply' ? ` ${n.data?.days}d` : ''}{here[n.id] ? ` · ${here[n.id]} here` : ''}</span></React.Fragment>; })}
    </div>
  );
  return (
    <ol className="space-y-1.5 text-xs">
      <li className="flex gap-2">{start}</li>
      {items.map((n) => {
        const m = BOX[n.type]; const I = m.icon;
        const outs = g.edges.filter((e) => e.source === n.id && e.handle);
        return (
          <li key={n.id} className="flex gap-2 items-start">
            <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 border ${m.ring} ${n.type === 'end' ? 'bg-brand-black text-white' : `${m.bg} ${m.text}`}`}><I size={12} /></span>
            <span><b>{n.data?.label || m.title}</b> <span className="text-brand-gray">{n.type !== 'end' ? boxSummary(n.type, n.data) : ''}{outs.length ? ` · ${outs.map((e) => `${e.handle === 'yes' || e.handle === 'replied' ? '✓' : '✗'} → ${BOX[g.nodes.find((x) => x.id === e.target)?.type || 'end']?.title}`).join(', ')}` : ''}</span>{here[n.id] ? <span className="ml-1 text-emerald-700 font-bold">{here[n.id]} leads here</span> : null}</span>
          </li>
        );
      })}
    </ol>
  );
};
