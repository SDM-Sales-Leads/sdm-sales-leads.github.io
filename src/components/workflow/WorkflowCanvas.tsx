import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { STEP_ROLES } from './departments';
import { 
  ReactFlow, 
  Background, 
  Controls, 
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  MarkerType,
  Handle,
  Position,
  NodeProps,
  EdgeProps,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
  reconnectEdge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { WorkflowStep } from '../../types';
import { 
  Clock, 
  User, 
  GitBranch,
  Plus,
  Trash2,
  Settings2,
  X
} from 'lucide-react';

const fmtSla = (step: WorkflowStep) =>
  step.sla != null && Number.isFinite(step.sla) ? `SLA: ${step.sla}${step.slaUnit === 'Days' ? 'd' : 'h'}` : 'SLA: —';

// True when `from` already depends (through prerequisites) on `target`: adding target -> from... see callers.
const prereqReaches = (steps: WorkflowStep[], from: string, target: string): boolean => {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    (steps.find(x => x.id === id)?.prerequisiteStepIds || []).forEach(p => stack.push(p));
  }
  return false;
};

// Remove steps and every reference to them (next / yes / no / prerequisites), then renumber.
const withoutSteps = (steps: WorkflowStep[], ids: Set<string>): WorkflowStep[] =>
  steps.filter(s => !ids.has(s.id)).map((s, i) => ({
    ...s,
    order: i + 1,
    nextStepId: s.nextStepId && ids.has(s.nextStepId) ? undefined : s.nextStepId,
    yesNextStepId: s.yesNextStepId && ids.has(s.yesNextStepId) ? undefined : s.yesNextStepId,
    noNextStepId: s.noNextStepId && ids.has(s.noNextStepId) ? undefined : s.noNextStepId,
    prerequisiteStepIds: (s.prerequisiteStepIds || []).filter(id => !ids.has(id)),
  }));

// Custom Node Component
const WorkflowNode = ({ data, id }: NodeProps) => {
  const step = data.step as WorkflowStep;
  const onRemove = data.onRemove as (id: string) => void;
  const onEdit = data.onEdit as (id: string) => void;
  const slaLabel = fmtSla(step);

  return (
    <div className={`p-4 rounded-2xl border-2 bg-white shadow-xl min-w-[300px] max-w-[500px] group transition-all ${step.isDecision ? 'border-brand-red' : 'border-brand-gray/20'}`}>
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-brand-gray/40 border-2 border-white" />
      
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${step.isDecision ? 'bg-brand-red text-white' : 'bg-brand-gray/10 text-brand-gray'}`}>
              {step.order}
            </div>
            <h4 className="font-bold text-sm text-brand-black whitespace-normal break-words max-w-none">{step.name}</h4>
          </div>
          {!data.readOnly && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => onEdit(id)} aria-label={`Edit step ${step.name}`} className="p-1 text-brand-gray hover:text-brand-black"><Settings2 size={14} /></button>
              <button onClick={() => onRemove(id)} aria-label={`Remove step ${step.name}`} className="p-1 text-brand-gray hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          )}
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] font-bold text-brand-red uppercase tracking-wider">
            <User size={10} />
            {step.responsibleRole}
          </div>
          <div className="flex items-center gap-1 text-[10px] font-bold text-brand-gray uppercase">
            <Clock size={8} />
            {slaLabel}
          </div>
        </div>

        {step.hasRequirements && step.requirements && (
          <div className="pt-2 border-t border-brand-gray/10 text-[10px] text-brand-gray">
            <span className="font-bold text-brand-black uppercase block text-[10px] tracking-wider mb-0.5">Required Inputs:</span>
            <p className="line-clamp-2 bg-brand-gray/5 p-1.5 rounded border border-brand-gray/10 text-xs text-brand-gray/80 font-medium leading-normal">{step.requirements}</p>
          </div>
        )}

        {step.isDecision && (
          <div className="pt-2 border-t border-brand-gray/10 text-[10px] font-bold text-brand-red flex items-center gap-1 italic">
            <GitBranch size={10} />
            {step.decisionQuestion || 'Decision Point'}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-brand-red border-2 border-white" />
      
      {step.isDecision && (
        <>
          <Handle 
            type="source" 
            position={Position.Right} 
            id="yes"
            className="w-3 h-3 bg-green-500 border-2 border-white" 
          />
          <Handle 
            type="source" 
            position={Position.Left} 
            id="no"
            className="w-3 h-3 bg-red-500 border-2 border-white" 
          />
        </>
      )}
    </div>
  );
};

// Custom Edge with SLA Label
const WorkflowEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
  data,
  selected
}: EdgeProps) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const slaLabel = data?.slaLabel as string;
  const onEdit = data?.onEdit as (id: string) => void;
  const onDelete = data?.onDelete as (id: string) => void;
  const sourceId = data?.sourceId as string;

  return (
    <>
      <BaseEdge 
        path={edgePath} 
        markerEnd={markerEnd} 
        style={{
          ...style,
          stroke: selected ? '#A6192E' : style.stroke,
          strokeWidth: selected ? 4 : style.strokeWidth,
          transition: 'all 0.2s'
        }} 
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <div className="flex flex-col items-center gap-1">
            {label && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest text-white ${label === 'Yes' ? 'bg-green-500' : 'bg-brand-red'}`}>
                {label}
              </span>
            )}
            {slaLabel && (
              <div className="flex items-center gap-1">
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!data?.readOnly && onEdit && sourceId) onEdit(sourceId);
                  }}
                  className={`bg-white border border-brand-gray/20 px-2 py-1 rounded-lg shadow-sm flex items-center gap-1 transition-all ${!data?.readOnly ? 'hover:border-brand-red hover:bg-brand-red/5 cursor-pointer' : ''}`}
                >
                  <Clock size={8} className="text-brand-gray" />
                  <span className="text-[10.5px] font-bold text-brand-black whitespace-nowrap">{slaLabel}</span>
                </div>
                {!data?.readOnly && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // Manually trigger deletion logic
                      if (onDelete) onDelete(id);
                    }}
                    aria-label="Remove link"
                    className="w-5 h-5 bg-white border border-brand-gray/20 rounded-full flex items-center justify-center text-brand-gray hover:text-brand-red hover:border-brand-red shadow-sm transition-all"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

const nodeTypes = {
  workflowStep: WorkflowNode,
};

const edgeTypes = {
  workflowEdge: WorkflowEdge,
};

interface WorkflowCanvasProps {
  steps: WorkflowStep[];
  onChange: (steps: WorkflowStep[]) => void;
  readOnly?: boolean;
}

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = (props) => (
  <ReactFlowProvider>
    <WorkflowCanvasContent {...props} />
  </ReactFlowProvider>
);

const WorkflowCanvasContent: React.FC<WorkflowCanvasProps> = ({ steps, onChange, readOnly = false }) => {
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const { screenToFlowPosition, getViewport } = useReactFlow();

  // Node / edge data is only rebuilt when the structure changes, so callbacks stored in it must never
  // close over `steps` / `onChange` directly (they would act on a stale list): read the latest via refs.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Several handlers can fire in the same tick (React Flow calls onNodesDelete and onEdgesDelete together):
  // keep the ref current immediately so the second one builds on the first one's result.
  const commit = useCallback((next: WorkflowStep[]) => {
    stepsRef.current = next;
    onChangeRef.current(next);
  }, []);

  const removeStep = useCallback((id: string) => {
    const target = stepsRef.current.find(s => s.id === id);
    if (!window.confirm(`Remove step "${target?.name || 'this step'}"? Links to it will be cleared.`)) return;
    commit(withoutSteps(stepsRef.current, new Set([id])));
  }, []);

  const updateStep = useCallback((id: string, updates: Partial<WorkflowStep>) => {
    commit(stepsRef.current.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const onNodesDelete = useCallback((deletedNodes: Node[]) => {
    const deletedIds = new Set(deletedNodes.map(n => n.id));
    // Optimistic local state update
    setNodes(nds => nds.filter(n => !deletedIds.has(n.id)));
    setEdges(eds => eds.filter(e => !deletedIds.has(e.source) && !deletedIds.has(e.target)));
    commit(withoutSteps(stepsRef.current, deletedIds));
  }, [setNodes, setEdges]);

  const onEdgesDelete = useCallback((deletedEdges: Edge[]) => {
    const updatedSteps = stepsRef.current.map(s => {
      const updated = { ...s };
      deletedEdges.forEach(edge => {
        if (edge.source === s.id) {
          if (edge.sourceHandle === 'yes') updated.yesNextStepId = undefined;
          else if (edge.sourceHandle === 'no') updated.noNextStepId = undefined;
          else updated.nextStepId = undefined;
        }
        // Remove from prerequisiteStepIds of the target
        if (edge.target === s.id) {
          updated.prerequisiteStepIds = (updated.prerequisiteStepIds || []).filter(id => id !== edge.source);
        }
      });
      return updated;
    });

    // Update internal edges state immediately to prevent flicker
    setEdges(eds => eds.filter(e => !deletedEdges.some(de => de.id === e.id)));
    commit(updatedSteps);
  }, [setEdges]);

  // Map steps to nodes
  const initialNodes: Node[] = useMemo(() => {
    return steps.map((step, index) => ({
      id: step.id,
      type: 'workflowStep',
      position: step.position || { x: 100, y: index * 200 },
      data: { 
        step,
        onRemove: removeStep,
        onEdit: (id: string) => setEditingStepId(id),
        readOnly
      },
    }));
  }, [steps, removeStep, readOnly]);

  // Map steps to edges
  const initialEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];
    steps.forEach((step) => {
      const slaLabel = fmtSla(step);
      
      if (step.isDecision) {
        if (step.yesNextStepId) {
          edges.push({
            id: `e-${step.id}-yes-${step.yesNextStepId}`,
            source: step.id,
            target: step.yesNextStepId,
            sourceHandle: 'yes',
            type: 'workflowEdge',
            label: 'Yes',
            data: { 
              slaLabel, 
              onEdit: (id: string) => setEditingStepId(id),
              onDelete: (edgeId: string) => onEdgesDelete([{ id: edgeId, source: step.id, target: step.yesNextStepId, sourceHandle: 'yes' } as Edge]),
              sourceId: step.id,
              readOnly
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e' },
            style: { stroke: '#22c55e', strokeWidth: 2 },
            reconnectable: true
          });
        }
        if (step.noNextStepId) {
          edges.push({
            id: `e-${step.id}-no-${step.noNextStepId}`,
            source: step.id,
            target: step.noNextStepId,
            sourceHandle: 'no',
            type: 'workflowEdge',
            label: 'No',
            data: { 
              slaLabel, 
              onEdit: (id: string) => setEditingStepId(id),
              onDelete: (edgeId: string) => onEdgesDelete([{ id: edgeId, source: step.id, target: step.noNextStepId, sourceHandle: 'no' } as Edge]),
              sourceId: step.id,
              readOnly
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#A6192E' },
            style: { stroke: '#A6192E', strokeWidth: 2 },
            reconnectable: true
          });
        }
      } else {
        // ONLY use explicit links in visual mode to allow deletion
        const targetId = step.nextStepId;
        if (targetId) {
          edges.push({
            id: `e-${step.id}-${targetId}`,
            source: step.id,
            target: targetId,
            type: 'workflowEdge',
            data: { 
              slaLabel, 
              onEdit: (id: string) => setEditingStepId(id),
              onDelete: (edgeId: string) => onEdgesDelete([{ id: edgeId, source: step.id, target: targetId } as Edge]),
              sourceId: step.id,
              readOnly
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#2D2926' },
            style: { stroke: '#2D2926', strokeWidth: 1.5 },
            reconnectable: true
          });
        }
      }
    });
    return edges;
  }, [steps, onEdgesDelete, readOnly]);

  // Sync internal state with props
  useEffect(() => {
    setNodes((nds) => {
      // Only update if structure changed, preserve selection/dragging
      const hasChanged = nds.length !== initialNodes.length || 
        initialNodes.some((n, i) => {
          const currentNode = nds[i];
          if (!currentNode) return true;
          const initialStep = n.data?.step as WorkflowStep | undefined;
          const currentStep = currentNode.data?.step as WorkflowStep | undefined;
          return n.id !== currentNode.id || 
            initialStep?.name !== currentStep?.name ||
            initialStep?.sla !== currentStep?.sla ||
            initialStep?.hasRequirements !== currentStep?.hasRequirements ||
            initialStep?.requirements !== currentStep?.requirements ||
            initialStep?.slaUnit !== currentStep?.slaUnit ||
            initialStep?.responsibleRole !== currentStep?.responsibleRole ||
            initialStep?.isDecision !== currentStep?.isDecision ||
            initialStep?.decisionQuestion !== currentStep?.decisionQuestion;
        });
      
      if (hasChanged) return initialNodes;
      return nds;
    });
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges((eds) => {
      // Only update if structure changed, preserve selection
      const hasChanged = eds.length !== initialEdges.length || 
        initialEdges.some((e, i) => {
          const currentEdge = eds[i];
          return e.id !== currentEdge?.id || 
            e.source !== currentEdge?.source || 
            e.target !== currentEdge?.target ||
            e.sourceHandle !== currentEdge?.sourceHandle ||
            e.data?.slaLabel !== currentEdge?.data?.slaLabel;
        });
      
      if (hasChanged) {
        console.log('Edges changed, updating state');
        return initialEdges;
      }
      return eds;
    });
  }, [initialEdges, setEdges]);

  // Applies one link change (optionally replacing `oldEdge`). Returns the new steps, or null (with a toast)
  // when the link is not allowed. Also reports whether the link is kept as a prerequisite.
  const applyLink = (cur: WorkflowStep[], oldEdge: Edge | null, c: Connection): { steps: WorkflowStep[]; loopBack: boolean } | null => {
    if (!c.source || !c.target) return null;
    if (c.source === c.target) { toast.error('A step cannot lead to itself.'); return null; }
    const orig = cur.find(x => x.id === c.source);
    if (!orig) return null;
    if (orig.isDecision && c.sourceHandle !== 'yes' && c.sourceHandle !== 'no') {
      toast.error('A decision step must be linked from its green (Yes) or red (No) handle.');
      return null;
    }
    const out = cur.map(s => ({ ...s, prerequisiteStepIds: [...(s.prerequisiteStepIds || [])] }));
    const get = (id: string) => out.find(x => x.id === id);
    const dropPrereq = (targetId: string | undefined, sourceId: string) => {
      const t = targetId ? get(targetId) : undefined;
      const src = get(sourceId);
      if (!t || !src) return;
      // keep it when the source still links to that target through another slot
      if ([src.nextStepId, src.yesNextStepId, src.noNextStepId].includes(targetId)) return;
      t.prerequisiteStepIds = (t.prerequisiteStepIds || []).filter(id => id !== sourceId);
    };
    const setLink = (s: WorkflowStep, handle: string | null | undefined, value: string | undefined) => {
      if (handle === 'yes') s.yesNextStepId = value;
      else if (handle === 'no') s.noNextStepId = value;
      else s.nextStepId = value;
    };

    if (oldEdge) {
      const os = get(oldEdge.source);
      if (os) { setLink(os, oldEdge.sourceHandle, undefined); dropPrereq(oldEdge.target, oldEdge.source); }
    }
    const src = get(c.source)!;
    // The link this one replaces (same slot of the source) no longer makes its old target wait for the source
    const slotOld = src.isDecision ? (c.sourceHandle === 'yes' ? src.yesNextStepId : src.noNextStepId) : src.nextStepId;
    setLink(src, c.sourceHandle, c.target);
    if (slotOld && slotOld !== c.target) dropPrereq(slotOld, c.source);

    // source -> target as a prerequisite closes a loop when the source already depends on the target
    const closesLoop = prereqReaches(out, c.source, c.target);
    if (closesLoop && !orig.isDecision) {
      toast.error('That link would create a loop (the steps would wait on each other forever).');
      return null;
    }
    if (!closesLoop) {
      const t = get(c.target)!;
      if (!t.prerequisiteStepIds!.includes(c.source)) t.prerequisiteStepIds!.push(c.source);
    }
    return { steps: out, loopBack: closesLoop };
  };

  const onConnect = useCallback((params: Connection) => {
    const res = applyLink(stepsRef.current, null, params);
    if (!res) return;
    if (res.loopBack) toast.info('Loop-back link added. It does not block the step (it is not a prerequisite).');
    commit(res.steps);
  }, []);

  const onNodeDragStop = useCallback((event: any, node: Node) => {
    commit(stepsRef.current.map(s =>
      s.id === node.id ? { ...s, position: node.position } : s
    ));
  }, []);

  const autoLink = () => {
    // by position in the list (not by the `order` field, which can be stale)
    const updatedSteps = steps.map((s, i) => {
      if (s.isDecision) return s;
      const next = steps[i + 1];
      const prev = steps[i - 1];
      return { 
        ...s, 
        nextStepId: next?.id,
        prerequisiteStepIds: prev ? [prev.id] : []
      };
    });
    onChange(updatedSteps);
  };

  const onReconnect = useCallback((oldEdge: Edge, newConnection: Connection) => {
    const res = applyLink(stepsRef.current, oldEdge, newConnection);
    if (!res) return; // not allowed: keep the old link
    if (res.loopBack) toast.info('Loop-back link added. It does not block the step (it is not a prerequisite).');
    commit(res.steps);
  }, []);

  const addNewStep = () => {
    const { x, y, zoom } = getViewport();
    // Calculate center of the container (roughly)
    const centerX = -x / zoom + 400 / zoom; // 400 is half of typical width
    const centerY = -y / zoom + 350 / zoom; // 350 is half of 700px height
    
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 11);
    const step: WorkflowStep = {
      id,
      name: 'New Step',
      description: '',
      responsibleRole: 'Development',
      isExternal: false,
      sla: undefined, // no invented duration: the owner of the step sets it in the editor that opens next
      slaUnit: 'Days',
      order: steps.length + 1,
      position: { x: centerX - 110, y: centerY - 50 }
    };
    onChange([...steps, step]);
    setEditingStepId(id);
  };

  const editingStep = steps.find(s => s.id === editingStepId);

  useEffect(() => {
    if (!editingStepId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditingStepId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingStepId]);

  const clearLinks = () => {
    if (!window.confirm('Remove all links between steps?')) return;
    const updatedSteps = steps.map(s => ({
      ...s,
      nextStepId: undefined,
      yesNextStepId: undefined,
      noNextStepId: undefined,
      prerequisiteStepIds: []
    }));
    onChange(updatedSteps);
  };

  return (
    <div className="h-full w-full bg-brand-gray/5 rounded-3xl border border-brand-gray/20 overflow-hidden relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={!readOnly ? onNodesChange : undefined}
        onEdgesChange={!readOnly ? onEdgesChange : undefined}
        onConnect={!readOnly ? onConnect : undefined}
        onReconnect={!readOnly ? onReconnect : undefined}
        onNodesDelete={!readOnly ? onNodesDelete : undefined}
        onEdgesDelete={!readOnly ? onEdgesDelete : undefined}
        onNodeDragStop={!readOnly ? onNodeDragStop : undefined}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        fitView
      >
        <Background color="#ccc" variant={BackgroundVariant.Dots} />
        <Controls />
        {!readOnly && (
          <Panel position="top-right" className="flex gap-2">
            <button
              onClick={autoLink}
              className="flex items-center gap-2 bg-white text-brand-gray px-4 py-2 rounded-xl font-bold text-sm shadow-lg hover:text-brand-black transition-all"
            >
              <GitBranch size={16} /> Auto-Link
            </button>
            <button
              onClick={clearLinks}
              className="flex items-center gap-2 bg-white text-brand-gray px-4 py-2 rounded-xl font-bold text-sm shadow-lg hover:text-brand-red transition-all"
            >
              <Trash2 size={16} /> Clear Links
            </button>
            <button
              onClick={addNewStep}
              className="flex items-center gap-2 bg-brand-black text-white px-4 py-2 rounded-xl font-bold text-sm shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              <Plus size={16} /> Add Item
            </button>
          </Panel>
        )}
      </ReactFlow>

      {/* Edit Modal Overlay */}
      {editingStep && (
        <div role="dialog" aria-modal="true" aria-label="Edit step" className="absolute inset-0 z-50 bg-brand-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-brand-black">Edit Step</h3>
              <button onClick={() => setEditingStepId(null)} aria-label="Close editor" className="p-2 hover:bg-brand-gray/10 rounded-full transition-all">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Step Name</label>
                <input
                  type="text"
                  value={editingStep.name || ''}
                  onChange={(e) => updateStep(editingStep.id, { name: e.target.value })}
                  className="w-full px-4 py-2 bg-brand-gray/5 border border-brand-gray/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-red/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Responsible Role</label>
                    <div className="flex items-center gap-1 bg-brand-gray/10 p-0.5 rounded-md">
                      <button 
                        type="button"
                        onClick={() => updateStep(editingStep.id, { isExternal: false, responsibleRole: 'Development' })}
                        className={`text-[10px] px-1.5 py-0.5 rounded transition-all font-bold ${!editingStep.isExternal ? 'bg-white text-brand-black shadow-sm' : 'text-brand-gray'}`}
                      >
                        INT
                      </button>
                      <button 
                        type="button"
                        onClick={() => updateStep(editingStep.id, { isExternal: true, responsibleRole: '' })}
                        className={`text-[10px] px-1.5 py-0.5 rounded transition-all font-bold ${editingStep.isExternal ? 'bg-white text-brand-black shadow-sm' : 'text-brand-gray'}`}
                      >
                        EXT
                      </button>
                    </div>
                  </div>
                  {editingStep.isExternal ? (
                    <input
                      type="text"
                      value={editingStep.responsibleRole || ''}
                      onChange={(e) => updateStep(editingStep.id, { responsibleRole: e.target.value })}
                      placeholder="External Dept"
                      className="w-full px-4 py-2 bg-brand-gray/5 border border-brand-gray/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-red/20"
                    />
                  ) : (
                    <select
                      value={editingStep.responsibleRole || 'Development'}
                      onChange={(e) => updateStep(editingStep.id, { responsibleRole: e.target.value })}
                      className="w-full px-4 py-2 bg-brand-gray/5 border border-brand-gray/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-red/20"
                    >
                {STEP_ROLES.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">SLA Configuration</label>
                    <select
                      value={editingStep.slaUnit || 'Days'}
                      onChange={(e) => updateStep(editingStep.id, { slaUnit: e.target.value as 'Hours' | 'Days' })}
                      className="text-[10px] px-2 py-1 bg-brand-gray/10 border border-brand-gray/20 rounded-md font-bold focus:outline-none"
                    >
                      <option value="Hours">Hours</option>
                      <option value="Days">Days</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">SLA Duration</label>
                      <input
                        type="number"
                        value={editingStep.sla ?? ''}
                        onChange={(e) => updateStep(editingStep.id, { sla: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        className="w-full px-3 py-1.5 bg-slate-50 border border-brand-gray/15 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-brand-red/25"
                      />
                    </div>
                    
                    <div className="flex items-center pt-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <div className={`w-8 h-4 rounded-full transition-all relative ${editingStep.hasRequirements ? 'bg-brand-red' : 'bg-brand-gray/20'}`}>
                          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${editingStep.hasRequirements ? 'left-4.5' : 'left-0.5'}`} />
                          <input 
                            type="checkbox" 
                            className="hidden" 
                            checked={!!editingStep.hasRequirements}
                            onChange={(e) => updateStep(editingStep.id, { hasRequirements: e.target.checked, requirements: e.target.checked ? (editingStep.requirements || '') : '' })}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Has Inputs</span>
                      </label>
                    </div>
                  </div>
                  
                  {editingStep.hasRequirements && (
                    <div className="space-y-1 mt-2">
                      <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Required Inputs/Requirements</label>
                      <textarea
                        value={editingStep.requirements || ''}
                        onChange={(e) => updateStep(editingStep.id, { requirements: e.target.value })}
                        placeholder="e.g. Contract scan, Department ID..."
                        rows={2}
                        className="w-full px-3 py-1 bg-slate-50 border border-brand-gray/15 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-brand-red/25 resize-none"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Description</label>
                <textarea
                  value={editingStep.description || ''}
                  onChange={(e) => updateStep(editingStep.id, { description: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 bg-brand-gray/5 border border-brand-gray/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-red/20 resize-none"
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer group p-3 bg-brand-gray/5 rounded-xl border border-brand-gray/10">
                <div className={`w-10 h-5 rounded-full transition-all relative ${editingStep.isDecision ? 'bg-brand-red' : 'bg-brand-gray/20'}`}>
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${editingStep.isDecision ? 'left-6' : 'left-1'}`} />
                  <input 
                    type="checkbox" 
                    className="hidden" 
                    checked={!!editingStep.isDecision}
                    onChange={(e) => updateStep(editingStep.id, e.target.checked
                      ? { isDecision: true, yesNextStepId: editingStep.nextStepId, nextStepId: undefined } // existing link becomes the Yes branch
                      : { isDecision: false, yesNextStepId: undefined, noNextStepId: undefined })}
                  />
                </div>
                <span className="text-xs font-bold text-brand-black uppercase tracking-wider">Decision Point?</span>
              </label>

              {editingStep.isDecision && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Decision Question</label>
                  <input
                    type="text"
                    value={editingStep.decisionQuestion || ''}
                    onChange={(e) => updateStep(editingStep.id, { decisionQuestion: e.target.value })}
                    placeholder="e.g. Is approval granted?"
                    className="w-full px-4 py-2 bg-brand-gray/5 border border-brand-gray/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-red/20"
                  />
                </div>
              )}
            </div>

            <button
              onClick={() => setEditingStepId(null)}
              className="w-full bg-brand-black text-white py-3 rounded-xl font-bold hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
            >
              Done
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
};
