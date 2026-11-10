// Lara workflow GRAPH (boxes + arrows), shared by the screen and the server (supabase/functions/api/lara_flow.ts imports this file).
// Pure TypeScript, no imports, so both the browser bundle and the edge function can use it.
// A workflow is a graph: exactly one trigger box, then boxes connected by arrows. Branch boxes have two exits
// (condition: yes / no; wait for reply: replied / no_reply). A box with no exit ends the workflow for that lead.

export type NodeType = 'trigger' | 'wait' | 'condition' | 'wait_reply' | 'message' | 'offer' | 'notify_owner' | 'notify_director' | 'handover' | 'end';
export interface GNode { id: string; type: NodeType; x: number; y: number; data: any }
export interface GEdge { id: string; source: string; target: string; handle?: string }
export interface Graph { nodes: GNode[]; edges: GEdge[] }

export const MAX_NODES = 40;
export const BRANCHES: Partial<Record<NodeType, [string, string]>> = { condition: ['yes', 'no'], wait_reply: ['replied', 'no_reply'] };
export const BRANCH_LABEL: Record<string, string> = { yes: 'Yes', no: 'No', replied: 'Replied', no_reply: 'No reply' };
/** what each box is, in plain English (the screen adds icons and colours) */
export const NODE_LABEL: Record<NodeType, string> = {
  trigger: 'Start (when)', wait: 'Wait', condition: 'If / else', wait_reply: 'Wait for a reply', message: 'Write to the customer', offer: 'Prepare an initial offer',
  notify_owner: 'Tell the salesperson', notify_director: 'Tell the Sales Director', handover: 'Hand back to the salesperson', end: 'End',
};
/** condition fields: the lead filters (same as the trigger's filters) plus "replied" */
export const COND_FIELDS = ['park', 'source', 'channel', 'priority', 'status', 'owner', 'hasEmail', 'hasPhone', 'leadAgeDays', 'dealValue', 'replied'] as const;

/** the old linear workflow (steps with waits) as a graph. Ids are fixed (t, w0, s0, w1, s1, … end) so running leads keep their place. */
export function stepsToGraph(steps: any[], trigger: any, conditions: any[]): Graph {
  const nodes: GNode[] = [{ id: 't', type: 'trigger', x: 0, y: 0, data: { trigger: trigger || { type: 'followup_overdue', value: 3 }, conditions: conditions || [] } }];
  const edges: GEdge[] = [];
  let prev = 't'; let y = 0;
  (steps || []).forEach((s: any, i: number) => {
    if (Number(s.waitDays) > 0) {
      y += 120; nodes.push({ id: `w${i}`, type: 'wait', x: 0, y, data: { days: Number(s.waitDays) } });
      edges.push({ id: `e-${prev}-w${i}`, source: prev, target: `w${i}` }); prev = `w${i}`;
    }
    y += 120;
    const type = (['message', 'offer', 'notify_owner', 'notify_director', 'handover'].includes(s.action) ? s.action : 'message') as NodeType;
    nodes.push({ id: `s${i}`, type, x: 0, y, data: type === 'message' ? { channel: s.channel || 'auto', situation: s.situation || 'auto' } : {} });
    edges.push({ id: `e-${prev}-s${i}`, source: prev, target: `s${i}` }); prev = `s${i}`;
  });
  y += 120; nodes.push({ id: 'end', type: 'end', x: 0, y, data: {} });
  edges.push({ id: `e-${prev}-end`, source: prev, target: 'end' });
  return { nodes, edges };
}

/** the graph of a stored workflow (new ones have `graph`; the first six only have steps) */
export function graphOf(w: any): Graph {
  const g = w?.graph;
  if (g && Array.isArray(g.nodes) && g.nodes.length) return { nodes: g.nodes, edges: Array.isArray(g.edges) ? g.edges : [] };
  return stepsToGraph(w?.steps || [], w?.trigger, w?.conditions);
}

/** where an arrow from this box (and branch) goes; null = the workflow ends here */
export function nextOf(g: Graph, id: string, handle?: string): string | null {
  const e = g.edges.find((x) => x.source === id && (handle ? x.handle === handle : !x.handle || x.handle === 'out'));
  return e ? e.target : null;
}

/** checks the drawing; returns a list of problems (empty = fine) and the box each one is about */
export function validateGraph(g: Graph): { nodeId?: string; text: string }[] {
  const out: { nodeId?: string; text: string }[] = [];
  if (!g || !Array.isArray(g.nodes)) return [{ text: 'Nothing to save' }];
  if (g.nodes.length > MAX_NODES) out.push({ text: `At most ${MAX_NODES} boxes` });
  const ids = new Set<string>();
  for (const n of g.nodes) { if (ids.has(n.id)) out.push({ nodeId: n.id, text: 'Two boxes have the same id' }); ids.add(n.id); }
  const trig = g.nodes.filter((n) => n.type === 'trigger');
  if (trig.length !== 1) out.push({ text: 'A workflow needs exactly one Start box' });
  for (const e of g.edges) if (!ids.has(e.source) || !ids.has(e.target)) out.push({ text: 'An arrow points to a missing box' });
  if (trig[0] && g.edges.some((e) => e.target === trig[0].id)) out.push({ nodeId: trig[0].id, text: 'Nothing can point back to Start' });
  for (const n of g.nodes) {
    const outs = g.edges.filter((e) => e.source === n.id);
    const br = BRANCHES[n.type];
    if (br) { for (const h of new Set(outs.map((e) => e.handle))) if (!br.includes(String(h))) out.push({ nodeId: n.id, text: 'An arrow leaves from the wrong side' }); }
    else if (outs.length > 1) out.push({ nodeId: n.id, text: 'Only one arrow can leave this box' });
    if (n.type === 'end' && outs.length) out.push({ nodeId: n.id, text: 'Nothing can follow End' });
    if (n.type === 'wait' && !(Number(n.data?.days) >= 1 && Number(n.data?.days) <= 60)) out.push({ nodeId: n.id, text: 'Wait 1–60 days' });
    if (n.type === 'wait_reply' && !(Number(n.data?.days) >= 1 && Number(n.data?.days) <= 30)) out.push({ nodeId: n.id, text: 'Wait for a reply 1–30 days' });
    if (n.type === 'condition' && !COND_FIELDS.includes(n.data?.field)) out.push({ nodeId: n.id, text: 'Choose what to check' });
    if (n.type === 'trigger' && !n.data?.trigger?.type) out.push({ nodeId: n.id, text: 'Choose when the workflow starts' });
  }
  // every box reachable from Start
  if (trig.length === 1) {
    const seen = new Set<string>([trig[0].id]); const q = [trig[0].id];
    while (q.length) { const id = q.shift()!; for (const e of g.edges) if (e.source === id && !seen.has(e.target)) { seen.add(e.target); q.push(e.target); } }
    for (const n of g.nodes) if (!seen.has(n.id)) out.push({ nodeId: n.id, text: 'Not connected to Start' });
    // a loop must contain a wait, otherwise Lara would go round in one run
    const pause = (id: string) => { const t = g.nodes.find((n) => n.id === id)?.type; return t === 'wait' || t === 'wait_reply'; };
    const color: Record<string, number> = {};
    const dfs = (id: string): boolean => {
      color[id] = 1;
      for (const e of g.edges.filter((x) => x.source === id)) {
        if (pause(e.target)) continue;
        if (color[e.target] === 1) return true;
        if (!color[e.target] && dfs(e.target)) return true;
      }
      color[id] = 2; return false;
    };
    for (const n of g.nodes) if (!color[n.id] && dfs(n.id)) { out.push({ nodeId: n.id, text: 'A loop without a Wait box' }); break; }
    if (!g.nodes.some((n) => ['message', 'offer', 'notify_owner', 'notify_director', 'handover'].includes(n.type))) out.push({ text: 'Add at least one action box' });
  }
  return out;
}

/** a readable list of the main path (for the workflow cards); branches show as "If …" */
export function outline(g: Graph): { id: string; type: NodeType; data: any }[] {
  const t = g.nodes.find((n) => n.type === 'trigger'); if (!t) return [];
  const seen = new Set<string>(); const out: { id: string; type: NodeType; data: any }[] = []; const q = [t.id];
  while (q.length && out.length < 14) {
    const id = q.shift()!; if (seen.has(id)) continue; seen.add(id);
    const n = g.nodes.find((x) => x.id === id); if (!n) continue;
    if (n.type !== 'trigger') out.push({ id: n.id, type: n.type, data: n.data });
    for (const e of g.edges.filter((x) => x.source === id)) q.push(e.target);
  }
  return out;
}

/** tidy layout top-to-bottom: each box one row below its parent; branches side by side */
export function autoLayout(g: Graph): Graph {
  const t = g.nodes.find((n) => n.type === 'trigger'); if (!t) return g;
  const depth: Record<string, number> = { [t.id]: 0 }; const q = [t.id];
  while (q.length) { const id = q.shift()!; for (const e of g.edges.filter((x) => x.source === id)) if (depth[e.target] == null) { depth[e.target] = depth[id] + 1; q.push(e.target); } }
  const rows: Record<number, string[]> = {};
  for (const n of g.nodes) { const d = depth[n.id] ?? (Math.max(0, ...Object.values(depth)) + 1); (rows[d] ||= []).push(n.id); }
  const pos: Record<string, { x: number; y: number }> = {};
  for (const [d, ids] of Object.entries(rows)) ids.forEach((id, i) => { pos[id] = { x: (i - (ids.length - 1) / 2) * 280, y: Number(d) * 130 }; });
  return { ...g, nodes: g.nodes.map((n) => ({ ...n, ...pos[n.id] })) };
}
