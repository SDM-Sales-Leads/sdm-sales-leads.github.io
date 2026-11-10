// Lara — workflow canvas (n8n-style): boxes and arrows, drawn step by step. Loaded on demand (React.lazy) so the canvas library
// is only downloaded when someone opens a workflow. NO AI. The server re-checks everything on save.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, Handle, Position, addEdge, useNodesState, useEdgesState, useReactFlow,
  MarkerType, type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from 'sonner';
import { X, Play, Loader2, Save, LayoutGrid, Trash2, Plus, AlertTriangle, Settings2, GitBranch } from 'lucide-react';
import { STATUSES } from '../../crm/leadConfig';
import { crmNav } from '../../crm/crmNav';
import { autoLayout, BRANCHES, BRANCH_LABEL, graphOf, validateGraph, type Graph, type NodeType } from './graph';
import { BOX, FIELDS, IF_FIELDS, SIT_OPTIONS, TRIGGER, boxSummary } from './meta';

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api${path}`, init ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const post = (path: string, b: any) => api(path, { method: 'POST', body: JSON.stringify(b) });
const isAr = (t: string) => /[؀-ۿ]/.test(t || '');
const PALETTE: NodeType[] = ['message', 'wait', 'wait_reply', 'condition', 'offer', 'notify_owner', 'notify_director', 'handover', 'end'];
const DEFAULT_DATA: Record<string, any> = { wait: { days: 3 }, wait_reply: { days: 3 }, condition: { field: 'replied', op: 'is', value: true }, message: { channel: 'auto', situation: 'auto' } };
const uid = (t: string) => `${t.slice(0, 2)}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

type BoxData = { kind: NodeType; d: any; errors?: string[]; here?: number; hit?: boolean };

// ---- one box on the canvas ---------------------------------------------------------------------
const LaraBox: React.FC<NodeProps<Node<BoxData>>> = ({ data, selected }) => {
  const m = BOX[data.kind]; const I = m.icon;
  const br = BRANCHES[data.kind];
  const dark = data.kind === 'trigger' || data.kind === 'end';
  return (
    <div className={`rounded-2xl border-2 shadow-sm w-[230px] ${m.ring} ${dark ? m.bg : 'bg-white'} ${selected ? 'ring-4 ring-brand-red/25' : ''} ${data.hit ? 'outline outline-2 outline-offset-2 outline-emerald-500' : ''}`}>
      {data.kind !== 'trigger' && <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-brand-gray !border-2 !border-white" />}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-t-[14px] ${dark ? '' : m.bg}`}>
        <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${dark ? 'bg-white/20 text-white' : `bg-white ${m.text}`}`}><I size={14} /></span>
        <p className={`text-xs font-extrabold flex-1 truncate ${dark ? 'text-white' : m.text}`}>{data.d?.label || m.title}</p>
        {!!data.here && <span className="text-[10px] font-bold bg-emerald-500 text-white rounded-full px-1.5" title="Leads waiting here now">{data.here}</span>}
        {!!data.errors?.length && <span title={data.errors.join('\n')}><AlertTriangle size={14} className={dark ? 'text-amber-300' : 'text-rose-600'} /></span>}
      </div>
      {data.kind !== 'end' && <p className={`px-3 py-2 text-[11px] leading-snug ${dark ? 'text-white/85' : 'text-brand-gray'}`}>{boxSummary(data.kind, data.d)}</p>}
      {!!data.errors?.length && <p className={`px-3 pb-2 text-[10px] font-bold ${dark ? 'text-amber-200' : 'text-rose-600'}`}>{data.errors[0]}</p>}
      {br ? (
        <>
          <Handle id={br[0]} type="source" position={Position.Bottom} style={{ left: '25%' }} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-white" />
          <Handle id={br[1]} type="source" position={Position.Bottom} style={{ left: '75%' }} className="!w-3 !h-3 !bg-rose-500 !border-2 !border-white" />
          <div className="flex justify-between px-4 pb-1 text-[9px] font-extrabold"><span className="text-emerald-700">{BRANCH_LABEL[br[0]]}</span><span className="text-rose-700">{BRANCH_LABEL[br[1]]}</span></div>
        </>
      ) : data.kind !== 'end' && <Handle id="out" type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-brand-red !border-2 !border-white" />}
    </div>
  );
};
const nodeTypes = { lara: LaraBox };

const edgeStyle = (handle?: string): Partial<Edge> => ({
  type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  style: { strokeWidth: 2, stroke: handle === 'yes' || handle === 'replied' ? '#10b981' : handle === 'no' || handle === 'no_reply' ? '#f43f5e' : '#94a3b8' },
  ...(handle && handle !== 'out' ? { label: BRANCH_LABEL[handle], labelStyle: { fontSize: 10, fontWeight: 800 }, labelBgPadding: [4, 2] as [number, number], labelBgBorderRadius: 6 } : {}),
});
const toRf = (g: Graph, here: Record<string, number>) => ({
  nodes: g.nodes.map<Node<BoxData>>((n) => ({ id: n.id, type: 'lara', position: { x: n.x, y: n.y }, deletable: n.type !== 'trigger', data: { kind: n.type, d: n.data || {}, here: here[n.id] || 0 } })),
  edges: g.edges.map<Edge>((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.handle || 'out', ...edgeStyle(e.handle) })),
});
const fromRf = (nodes: Node<BoxData>[], edges: Edge[]): Graph => ({
  nodes: nodes.map((n) => ({ id: n.id, type: n.data.kind, x: Math.round(n.position.x), y: Math.round(n.position.y), data: n.data.d })),
  edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle && e.sourceHandle !== 'out' ? { handle: e.sourceHandle } : {}) })),
});

// ---- the editor ---------------------------------------------------------------------------------
export interface FlowEditorProps { w: any; here?: Record<string, number>; onClose: () => void; onSaved: () => void }
const FlowEditor: React.FC<FlowEditorProps> = (p) => <ReactFlowProvider><Editor {...p} /></ReactFlowProvider>;
export default FlowEditor;

const Editor: React.FC<FlowEditorProps> = ({ w: w0, here = {}, onClose, onSaved }) => {
  const start = useMemo(() => { const g = graphOf(w0); return toRf(g.nodes.every((n) => n.x === 0) && g.nodes.length > 2 ? autoLayout(g) : g, here); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BoxData>>(start.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(start.edges);
  const [meta, setMeta] = useState<any>(() => ({ id: w0.id, name: w0.name || '', description: w0.description || '', priority: w0.priority ?? 100, enabled: !!w0.enabled, stop: w0.stop || { onActivity: true, onReply: true, onMeeting: true }, autopilot: !!w0.autopilot }));
  const [sel, setSel] = useState<string | null>(null);
  const [test, setTest] = useState<any>(null);
  const [hitPath, setHitPath] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();

  const graph = useMemo(() => fromRf(nodes, edges), [nodes, edges]);
  const problems = useMemo(() => validateGraph(graph), [graph]);
  const errBy = useMemo(() => { const m: Record<string, string[]> = {}; for (const p of problems) if (p.nodeId) (m[p.nodeId] ||= []).push(p.text); return m; }, [problems]);
  // show problems / test path on the boxes without touching what the user drew
  const shown = useMemo(() => nodes.map((n) => ({ ...n, data: { ...n.data, errors: errBy[n.id], hit: hitPath.includes(n.id) } })), [nodes, errBy, hitPath]);
  const selNode = nodes.find((n) => n.id === sel) || null;
  const touch = () => { setDirty(true); setTest(null); setHitPath([]); };

  const setData = (id: string, patch: any) => { setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, d: { ...n.data.d, ...patch } } } : n))); touch(); };
  const onConnect = useCallback((c: Connection) => {
    setEdges((es) => {
      // one arrow per exit: a new arrow from the same exit replaces the old one
      const rest = es.filter((e) => !(e.source === c.source && (e.sourceHandle || 'out') === (c.sourceHandle || 'out')));
      return addEdge({ ...c, id: `e-${c.source}-${c.sourceHandle || 'out'}-${c.target}`, ...edgeStyle(c.sourceHandle || undefined) }, rest);
    });
    touch();
  }, [setEdges]); // eslint-disable-line react-hooks/exhaustive-deps

  /** add a box: below the selected one (connected to its free exit), or at a dropped position */
  const addBox = (kind: NodeType, at?: { x: number; y: number }) => {
    const id = uid(kind);
    const from = !at && selNode ? selNode : null;
    let pos = at || { x: 0, y: 0 };
    let link: Edge | null = null;
    if (from) {
      const exits: string[] = BRANCHES[from.data.kind] || (from.data.kind === 'end' ? [] : ['out']);
      const free = exits.find((h) => !edges.some((e) => e.source === from.id && (e.sourceHandle || 'out') === h));
      const k = exits.indexOf(free || '');
      pos = { x: from.position.x + (exits.length > 1 ? (k === 0 ? -140 : 140) : 0), y: from.position.y + 150 };
      if (free) link = { id: `e-${from.id}-${free}-${id}`, source: from.id, target: id, sourceHandle: free, ...edgeStyle(free) };
    } else if (!at) {
      const maxY = Math.max(0, ...nodes.map((n) => n.position.y));
      pos = { x: 0, y: maxY + 150 };
    }
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: 'lara', position: pos, selected: true, data: { kind, d: { ...(DEFAULT_DATA[kind] || {}) } } }]);
    if (link) setEdges((es) => [...es, link!]);
    setSel(id); touch();
  };
  const onDrop = (ev: React.DragEvent) => {
    ev.preventDefault();
    const kind = ev.dataTransfer.getData('application/lara-box') as NodeType;
    if (!kind) return;
    const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    addBox(kind, { x: p.x - 115, y: p.y - 30 });
  };
  const removeSel = () => { if (!selNode || selNode.data.kind === 'trigger') return; setNodes((ns) => ns.filter((n) => n.id !== selNode.id)); setEdges((es) => es.filter((e) => e.source !== selNode.id && e.target !== selNode.id)); setSel(null); touch(); };
  const tidy = () => { const g = autoLayout(fromRf(nodes, edges)); const pos = new Map(g.nodes.map((n) => [n.id, { x: n.x, y: n.y }])); setNodes((ns) => ns.map((n) => ({ ...n, position: pos.get(n.id) || n.position }))); setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50); setDirty(true); };

  const payload = () => {
    const t = nodes.find((n) => n.data.kind === 'trigger');
    return { ...meta, trigger: t?.data.d?.trigger, conditions: t?.data.d?.conditions || [], steps: [], graph };
  };
  const runTest = async () => { setBusy(true); try { setTest(await post('/lara/workflows/test', { ...payload(), name: meta.name || 'Test' })); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const save = async () => {
    if (problems.length) { toast.error(problems[0].text); return; }
    setBusy(true);
    try { await post('/lara/workflows', payload()); toast.success('Workflow saved'); setDirty(false); onSaved(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const close = useCallback(() => { if (dirty && !window.confirm('Close without saving your changes?')) return; onClose(); }, [dirty, onClose]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('input,textarea,select')) close(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [close]);

  return (
    <div className="fixed inset-0 z-[120] bg-white flex flex-col">
      {/* top bar */}
      <div className="border-b border-brand-gray/15 px-4 py-2.5 flex flex-wrap items-center gap-2">
        <GitBranch size={18} className="text-brand-red" />
        <input value={meta.name} onChange={(e) => { setMeta({ ...meta, name: e.target.value }); setDirty(true); }} placeholder="Workflow name" className="input-field text-sm font-bold w-64" />
        <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${problems.length ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'}`} title={problems.map((p) => p.text).join('\n')}>{problems.length ? `${problems.length} thing${problems.length > 1 ? 's' : ''} to fix: ${problems[0].text}` : 'Ready'}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={tidy} className="btn-secondary rounded-xl px-3 py-1.5 text-xs font-bold flex items-center gap-1"><LayoutGrid size={13} />Tidy up</button>
          <button onClick={() => setSel(null)} className="btn-secondary rounded-xl px-3 py-1.5 text-xs font-bold flex items-center gap-1"><Settings2 size={13} />Workflow settings</button>
          <button onClick={runTest} disabled={busy} className="btn-secondary rounded-xl px-3 py-1.5 text-xs font-bold flex items-center gap-1">{busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}Test on live leads</button>
          <button onClick={save} disabled={busy} className="btn-primary rounded-xl px-3 py-1.5 text-xs font-bold flex items-center gap-1"><Save size={13} />Save</button>
          <button onClick={close} className="p-1.5 rounded-lg hover:bg-brand-gray/10" title="Close"><X size={18} /></button>
        </div>
      </div>
      <div className="flex-1 flex min-h-0">
        {/* palette */}
        <aside className="w-52 border-r border-brand-gray/15 p-3 space-y-1.5 overflow-y-auto hidden md:block">
          <p className="text-[10px] font-extrabold text-brand-gray">BOXES — drag onto the canvas, or click to add below the selected box</p>
          {PALETTE.map((k) => {
            const m = BOX[k]; const I = m.icon;
            return (
              <button key={k} draggable onDragStart={(e) => { e.dataTransfer.setData('application/lara-box', k); e.dataTransfer.effectAllowed = 'move'; }} onClick={() => addBox(k)}
                className={`w-full text-left rounded-xl border px-2.5 py-2 flex gap-2 items-start hover:shadow-sm cursor-grab ${m.ring} ${k === 'end' ? 'bg-white' : m.bg}`}>
                <I size={14} className={`mt-0.5 shrink-0 ${k === 'end' ? 'text-brand-black' : m.text}`} />
                <span><span className={`block text-xs font-bold ${k === 'end' ? 'text-brand-black' : m.text}`}>{m.title}</span><span className="block text-[10px] text-brand-gray leading-tight">{m.hint}</span></span>
              </button>
            );
          })}
          <div className="text-[10px] text-brand-gray pt-2 space-y-1 border-t border-brand-gray/10">
            <p>• Drag from a dot at the bottom of a box to the top of the next box to connect them.</p>
            <p>• If / else and Wait for a reply have two exits (green / red).</p>
            <p>• Select a box and press Delete to remove it. A box with no arrow out ends the workflow.</p>
          </div>
        </aside>
        {/* canvas */}
        <div ref={wrap} className="flex-1 min-w-0" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
          <ReactFlow
            nodes={shown} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={(c) => { onNodesChange(c as any); if (c.some((x) => x.type === 'remove' || (x.type === 'position' && !x.dragging))) setDirty(true); }}
            onEdgesChange={(c) => { onEdgesChange(c); if (c.some((x) => x.type === 'remove')) touch(); }}
            onConnect={onConnect} onSelectionChange={({ nodes: s }) => setSel(s[0]?.id || null)}
            deleteKeyCode={['Delete', 'Backspace']} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.3} maxZoom={1.6}
            defaultEdgeOptions={{ type: 'smoothstep' }} proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeStrokeWidth={3} nodeColor={(n: any) => ({ trigger: '#b91c1c', end: '#111827', condition: '#f59e0b', wait_reply: '#14b8a6', message: '#0ea5e9', offer: '#8b5cf6', notify_owner: '#06b6d4', notify_director: '#6366f1', handover: '#f43f5e', wait: '#94a3b8' } as any)[n.data?.kind] || '#94a3b8'} />
          </ReactFlow>
        </div>
        {/* settings / test panel */}
        <aside className="w-[340px] border-l border-brand-gray/15 overflow-y-auto p-4 space-y-4">
          {selNode ? <BoxSettings n={selNode} set={(patch) => setData(selNode.id, patch)} onDelete={removeSel} onAddBelow={(k) => addBox(k)} />
            : <WorkflowSettings meta={meta} set={(patch) => { setMeta({ ...meta, ...patch }); setDirty(true); }} />}
          <TestPanel test={test} onPick={setHitPath} picked={hitPath} />
        </aside>
      </div>
    </div>
  );
};

// ---- right panel: the selected box ---------------------------------------------------------------
const BoxSettings: React.FC<{ n: Node<BoxData>; set: (p: any) => void; onDelete: () => void; onAddBelow: (k: NodeType) => void }> = ({ n, set, onDelete, onAddBelow }) => {
  const k = n.data.kind; const d = n.data.d || {}; const m = BOX[k];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className={`text-sm font-extrabold flex items-center gap-2 ${k === 'trigger' || k === 'end' ? 'text-brand-black' : m.text}`}><m.icon size={15} />{m.title}</p>
        {k !== 'trigger' && <button onClick={onDelete} className="text-xs font-bold text-rose-600 flex items-center gap-1"><Trash2 size={12} />Remove</button>}
      </div>
      <p className="text-[11px] text-brand-gray">{m.hint}</p>
      {k !== 'trigger' && k !== 'end' && <label className="text-xs font-bold block">Name on the box (optional)<input value={d.label || ''} onChange={(e) => set({ label: e.target.value })} placeholder={m.title} className="input-field w-full text-sm mt-0.5" /></label>}
      {k === 'trigger' && <TriggerSettings d={d} set={set} />}
      {(k === 'wait' || k === 'wait_reply') && (
        <label className="text-xs font-bold block">{k === 'wait' ? 'Wait (days)' : 'Wait up to (days) for the customer to reply'}
          <input type="number" min={1} max={k === 'wait' ? 60 : 30} value={d.days ?? ''} onChange={(e) => set({ days: Number(e.target.value) })} className="input-field w-full text-sm mt-0.5" />
          {k === 'wait_reply' && <span className="block font-normal text-[11px] text-brand-gray mt-1">A reply moves the lead to the green exit straight away (checked every run); otherwise the red exit after the days above.</span>}
        </label>
      )}
      {k === 'condition' && <CondEditor c={d} fields={IF_FIELDS} onChange={(c) => set(c)} />}
      {k === 'message' && (
        <div className="space-y-2">
          <label className="text-xs font-bold block">Channel<select value={d.channel || 'auto'} onChange={(e) => set({ channel: e.target.value })} className="input-field w-full text-sm mt-0.5"><option value="auto">WhatsApp if connected, else e-mail</option><option value="email">E-mail only</option><option value="whatsapp">WhatsApp only</option></select></label>
          <label className="text-xs font-bold block">Message<select value={d.situation || 'auto'} onChange={(e) => set({ situation: e.target.value })} className="input-field w-full text-sm mt-0.5">{SIT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <p className="text-[11px] text-brand-gray">Lara writes it from the lead's data and the Land Bank (Arabic or English, as the customer). It waits in Drafts for approval unless the workflow is on Autopilot.</p>
        </div>
      )}
      {k === 'offer' && <p className="text-[11px] text-brand-gray">Lara picks fitting available plots and prepares the Initial financial offer. Offers always wait for a person to approve.</p>}
      {k !== 'end' && (
        <div className="pt-2 border-t border-brand-gray/10">
          <p className="text-[10px] font-extrabold text-brand-gray mb-1">ADD THE NEXT BOX</p>
          <div className="flex flex-wrap gap-1">{PALETTE.map((t) => <button key={t} onClick={() => onAddBelow(t)} className="text-[10px] font-bold rounded-full border border-brand-gray/25 px-2 py-0.5 hover:bg-brand-gray/5 flex items-center gap-0.5"><Plus size={10} />{BOX[t].title}</button>)}</div>
        </div>
      )}
    </div>
  );
};

const TriggerSettings: React.FC<{ d: any; set: (p: any) => void }> = ({ d, set }) => {
  const t = d.trigger || { type: 'followup_overdue', value: 3 };
  const conds: any[] = d.conditions || [];
  const st = new Set(t.statuses || []);
  return (
    <div className="space-y-3">
      <label className="text-xs font-bold block">Start when<select value={t.type} onChange={(e) => set({ trigger: { ...t, type: e.target.value } })} className="input-field w-full text-sm mt-0.5">{Object.entries(TRIGGER).map(([k, v]) => <option key={k} value={k}>{v.label}…</option>)}</select></label>
      <div className="flex items-center gap-2"><input type="number" min={0} value={t.value ?? ''} onChange={(e) => set({ trigger: { ...t, value: Number(e.target.value) } })} className="input-field w-24 text-sm" /><span className="text-xs text-brand-gray">{TRIGGER[t.type]?.unit}</span></div>
      {t.type === 'status_stuck' && <div className="flex flex-wrap gap-1">{STATUSES.map((s) => <button key={s} onClick={() => set({ trigger: { ...t, statuses: st.has(s) ? (t.statuses || []).filter((x: string) => x !== s) : [...(t.statuses || []), s] } })} className={`text-[10px] rounded-full px-2 py-0.5 border ${st.has(s) ? 'bg-brand-red text-white border-brand-red' : 'border-brand-gray/25'}`}>{s}</button>)}</div>}
      <div className="space-y-2">
        <p className="text-[10px] font-extrabold text-brand-gray">ONLY LEADS WHERE {conds.length === 0 && <span className="font-normal">(all leads)</span>}</p>
        {conds.map((c, i) => (
          <div key={i} className="flex gap-1 items-start">
            <div className="flex-1"><CondEditor c={c} fields={FIELDS} onChange={(p) => set({ conditions: conds.map((x, j) => (j === i ? { ...x, ...p } : x)) })} /></div>
            <button onClick={() => set({ conditions: conds.filter((_, j) => j !== i) })} className="text-brand-gray hover:text-rose-600 mt-1.5"><Trash2 size={13} /></button>
          </div>
        ))}
        {conds.length < 10 && <button onClick={() => set({ conditions: [...conds, { field: 'park', op: 'in', value: '' }] })} className="text-xs font-bold text-brand-red flex items-center gap-1"><Plus size={12} />Add filter</button>}
      </div>
    </div>
  );
};

const CondEditor: React.FC<{ c: any; fields: typeof FIELDS; onChange: (p: any) => void }> = ({ c, fields, onChange }) => {
  const f = fields[c.field] || Object.values(fields)[0];
  return (
    <div className="flex flex-wrap gap-1.5">
      <select value={c.field || ''} onChange={(e) => { const nf = fields[e.target.value]; onChange({ field: e.target.value, op: nf.kind === 'num' ? 'gte' : nf.kind === 'bool' ? 'is' : 'in', value: nf.kind === 'bool' ? true : '' }); }} className="input-field text-xs w-full">{Object.entries(fields).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
      {f.kind === 'list' && <select value={c.op || 'in'} onChange={(e) => onChange({ op: e.target.value })} className="input-field text-xs"><option value="in">is</option><option value="notin">is not</option></select>}
      {f.kind === 'num' && c.field === 'leadAgeDays' && <select value={c.op || 'gte'} onChange={(e) => onChange({ op: e.target.value })} className="input-field text-xs"><option value="gte">at least</option><option value="lte">at most</option></select>}
      {f.kind === 'bool' ? <select value={String(c.value !== false && c.value !== 'false')} onChange={(e) => onChange({ value: e.target.value === 'true' })} className="input-field text-xs"><option value="true">yes</option><option value="false">no</option></select>
        : f.options ? <select value={Array.isArray(c.value) ? c.value[0] || '' : c.value || ''} onChange={(e) => onChange({ value: e.target.value })} className="input-field text-xs flex-1 min-w-[120px]"><option value="">Choose…</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
          : <input value={Array.isArray(c.value) ? c.value.join(', ') : c.value ?? ''} onChange={(e) => onChange({ value: e.target.value })} className="input-field text-xs flex-1 min-w-[100px]" />}
    </div>
  );
};

// ---- right panel: workflow settings ---------------------------------------------------------------
const WorkflowSettings: React.FC<{ meta: any; set: (p: any) => void }> = ({ meta, set }) => (
  <div className="space-y-3">
    <p className="text-sm font-extrabold flex items-center gap-2"><Settings2 size={15} className="text-brand-red" />Workflow settings</p>
    <label className="text-xs font-bold block">What it is for<textarea value={meta.description} onChange={(e) => set({ description: e.target.value })} rows={2} className="input-field w-full text-xs mt-0.5" /></label>
    <label className="text-xs font-bold block">Priority (lower goes first; a lead is in one workflow at a time)<input type="number" value={meta.priority} onChange={(e) => set({ priority: Number(e.target.value) })} className="input-field w-24 text-sm mt-0.5" /></label>
    <div className="rounded-xl border border-rose-200 p-3 space-y-1.5">
      <p className="text-[10px] font-extrabold text-rose-700">STOP WHEN</p>
      {[['onActivity', 'The salesperson works on the lead (call, WhatsApp, note, status…)'], ['onReply', 'The customer replies (ignored when the drawing uses "Wait for a reply" or "If: the customer replied")'], ['onMeeting', 'A meeting or site visit is planned']].map(([k, l]) => (
        <label key={k} className="text-xs flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={meta.stop?.[k] !== false} onChange={(e) => set({ stop: { ...meta.stop, [k]: e.target.checked } })} />{l}</label>
      ))}
      <p className="text-[10px] text-brand-gray">Always: the customer says stop, the lead is closed, or a draft is rejected with "Do not contact".</p>
    </div>
    <label className="text-xs flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={!!meta.autopilot} onChange={(e) => set({ autopilot: e.target.checked })} /><span><b>Autopilot</b>: when Lara is in Autopilot mode, this workflow's messages go out without approval (offers never).</span></label>
    <p className="text-[11px] text-brand-gray">Click a box to change it. Switch the workflow on or off from the list.</p>
  </div>
);

// ---- test results -------------------------------------------------------------------------------
const TestPanel: React.FC<{ test: any; onPick: (ids: string[]) => void; picked: string[] }> = ({ test, onPick, picked }) => (
  <div className="rounded-xl border border-brand-gray/15 p-3 space-y-2">
    <p className="text-[10px] font-extrabold text-brand-gray flex items-center gap-1"><Play size={11} />TEST ON LIVE LEADS</p>
    {!test ? <p className="text-[11px] text-brand-gray">Shows which leads this workflow would start on right now and the path each one takes through your boxes. Nothing is written or sent.</p> : (
      <div className="space-y-2 text-xs">
        <p><b>{test.matched}</b> leads match now{test.alreadyInAWorkflow ? ` (${test.alreadyInAWorkflow} already in another workflow)` : ''}. At most <b>{test.perRunLimit}</b> drafts per run, most urgent first.</p>
        {(test.paths || []).map((p: any) => {
          const ids = p.steps.map((s: any) => s.id).filter(Boolean); const on = picked.join() === ids.join() && ids.length > 0;
          return (
            <button key={p.id} onClick={() => onPick(on ? [] : ids)} className={`w-full text-left rounded-xl border p-2 ${on ? 'border-emerald-400 bg-emerald-50' : 'border-brand-gray/15 hover:bg-brand-gray/5'}`}>
              <p className="font-bold flex justify-between gap-2"><span className="truncate" dir="auto">{p.customer}</span><span onClick={(e) => { e.stopPropagation(); crmNav.lead(p.id); }} className="text-brand-red text-[10px] shrink-0">Open lead</span></p>
              <ol className="mt-1 space-y-0.5">{p.steps.map((s: any, i: number) => <li key={i} className="text-[11px] text-brand-gray">{i + 1}. {s.text}</li>)}</ol>
            </button>
          );
        })}
        {(test.samples || []).map((s: any, i: number) => (
          <div key={i} className="bg-brand-gray/5 rounded-xl p-2"><p className="text-[10px] text-brand-gray">{s.customer} · {s.channel === 'email' ? 'E-mail' : 'WhatsApp'} draft</p><p dir={isAr(s.body) ? 'rtl' : 'ltr'} className="whitespace-pre-line text-xs mt-1">{s.body}</p></div>
        ))}
      </div>
    )}
  </div>
);
