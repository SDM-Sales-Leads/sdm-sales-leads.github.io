import React, { useState } from 'react';
import { STEP_ROLES } from './departments';
import { WorkflowStep } from '../../types';
import { 
  Plus, 
  Trash2, 
  GripVertical, 
  Clock, 
  User, 
  ChevronDown, 
  ChevronUp,
  GitBranch,
  Check,
  X,
  Layout,
  MousePointer2,
  AlertCircle
} from 'lucide-react';
import { motion, Reorder } from 'motion/react';
import { toast } from 'sonner';
import { WorkflowCanvas } from './WorkflowCanvas';

interface WorkflowBuilderProps {
  steps: WorkflowStep[];
  onChange: (steps: WorkflowStep[]) => void;
}

// True when `from` already depends (directly or through other steps) on `target`.
// Used so a new prerequisite can never close a loop (a loop would make the steps wait on each other forever).
const dependsOn = (steps: WorkflowStep[], from: string, target: string): boolean => {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const st = steps.find(x => x.id === id);
    (st?.prerequisiteStepIds || []).forEach(p => stack.push(p));
  }
  return false;
};

export const WorkflowBuilder: React.FC<WorkflowBuilderProps> = ({ steps, onChange }) => {
  const [mode, setMode] = useState<'list' | 'draw'>('list');
  const [newStep, setNewStep] = useState<Partial<WorkflowStep>>({
    name: '',
    description: '',
    responsibleRole: 'Development',
    isExternal: false,
    sla: 5,
    slaUnit: 'Days',
    isDecision: false,
    decisionQuestion: '',
    yesNextStepId: '',
    noNextStepId: '',
    hasRequirements: false,
    requirements: ''
  });

  const addStep = () => {
    if (!newStep.name?.trim()) return;
    if (newStep.sla == null || !Number.isFinite(newStep.sla) || newStep.sla <= 0) {
      toast.error('Enter an SLA duration greater than 0 for the step.');
      return;
    }
    
    const step: WorkflowStep = {
      id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 11),
      name: newStep.name.trim(),
      description: newStep.description || '',
      responsibleRole: newStep.responsibleRole || 'Development',
      isExternal: newStep.isExternal || false,
      sla: newStep.sla,
      slaUnit: (newStep.slaUnit as 'Hours' | 'Days') || 'Days',
      order: steps.length + 1,
      isDecision: newStep.isDecision || false,
      decisionQuestion: newStep.decisionQuestion || '',
      yesNextStepId: newStep.yesNextStepId || '',
      noNextStepId: newStep.noNextStepId || '',
      hasRequirements: newStep.hasRequirements || false,
      requirements: newStep.requirements || ''
    };
    
    onChange([...steps, step]);
    setNewStep({
      name: '',
      description: '',
      responsibleRole: 'Development',
      isExternal: false,
      sla: 5,
      slaUnit: 'Days',
      isDecision: false,
      decisionQuestion: '',
      yesNextStepId: '',
      noNextStepId: '',
      hasRequirements: false,
      requirements: ''
    });
  };

  const removeStep = (id: string) => {
    const target = steps.find(s => s.id === id);
    if (!window.confirm(`Remove step "${target?.name || 'this step'}"? Links to it from other steps will be cleared.`)) return;
    // Re-order and drop every reference to the removed step (no dangling next / branch / prerequisite ids)
    const reordered = steps.filter(s => s.id !== id).map((s, i) => ({
      ...s,
      order: i + 1,
      nextStepId: s.nextStepId === id ? undefined : s.nextStepId,
      yesNextStepId: s.yesNextStepId === id ? '' : s.yesNextStepId,
      noNextStepId: s.noNextStepId === id ? '' : s.noNextStepId,
      prerequisiteStepIds: (s.prerequisiteStepIds || []).filter(p => p !== id)
    }));
    onChange(reordered);
  };

  const updateStep = (id: string, updates: Partial<WorkflowStep>) => {
    const updated = steps.map(s => s.id === id ? { ...s, ...updates } : s);
    onChange(updated);
  };

  return (
    <div className="space-y-6">
      {/* Mode Toggle */}
      <div className="flex items-center justify-between bg-white p-2 rounded-2xl border border-brand-gray/20 shadow-sm">
        <div className="flex p-1 bg-brand-gray/5 rounded-xl">
          <button
            onClick={() => setMode('list')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              mode === 'list' 
                ? 'bg-white text-brand-black shadow-sm' 
                : 'text-brand-gray hover:text-brand-black'
            }`}
          >
            <Layout size={14} />
            List Mode
          </button>
          <button
            onClick={() => setMode('draw')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              mode === 'draw' 
                ? 'bg-white text-brand-black shadow-sm' 
                : 'text-brand-gray hover:text-brand-black'
            }`}
          >
            <MousePointer2 size={14} />
            Draw Mode
          </button>
        </div>
        <div className="px-4 text-[10px] font-bold text-brand-gray uppercase tracking-widest">
          {mode === 'list' ? 'Sequential View' : 'Visual Canvas View'}
        </div>
      </div>

      {mode === 'draw' ? (
        <div className="h-[700px]">
          <WorkflowCanvas steps={steps} onChange={onChange} />
        </div>
      ) : (
        <>
          {/* Add Step Form */}
      <div className="bg-brand-gray/5 p-6 rounded-2xl border border-brand-gray/20 border-dashed">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1 lg:col-span-1">
            <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Step Name</label>
            <input
              type="text"
              value={newStep.name}
              onChange={(e) => setNewStep({ ...newStep, name: e.target.value })}
              placeholder="e.g. Initial Review"
              className="w-full px-3 py-2 bg-white border border-brand-gray/20 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-red/20"
            />
          </div>
          <div className="space-y-1 lg:col-span-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Responsible Role</label>
              <div className="flex items-center gap-1 bg-brand-gray/10 p-0.5 rounded-md">
                <button 
                  type="button"
                  onClick={() => setNewStep({ ...newStep, isExternal: false, responsibleRole: 'Development' })}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-all font-bold ${!newStep.isExternal ? 'bg-white text-brand-black shadow-sm' : 'text-brand-gray'}`}
                >
                  INT
                </button>
                <button 
                  type="button"
                  onClick={() => setNewStep({ ...newStep, isExternal: true, responsibleRole: '' })}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-all font-bold ${newStep.isExternal ? 'bg-white text-brand-black shadow-sm' : 'text-brand-gray'}`}
                >
                  EXT
                </button>
              </div>
            </div>
            {newStep.isExternal ? (
              <input
                type="text"
                value={newStep.responsibleRole}
                onChange={(e) => setNewStep({ ...newStep, responsibleRole: e.target.value })}
                placeholder="External Dept Name"
                className="w-full px-3 py-2 bg-white border border-brand-gray/20 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-red/20"
              />
            ) : (
              <select
                value={newStep.responsibleRole}
                onChange={(e) => setNewStep({ ...newStep, responsibleRole: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-brand-gray/20 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-red/20"
              >
                {STEP_ROLES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
          </div>
          <div className="space-y-1 lg:col-span-1">
            <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">SLA Unit</label>
            <select
              value={newStep.slaUnit}
              onChange={(e) => setNewStep({ ...newStep, slaUnit: e.target.value as 'Hours' | 'Days' })}
              className="w-full px-3 py-2 bg-white border border-brand-gray/20 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-red/20"
            >
              <option value="Hours">Hours</option>
              <option value="Days">Days</option>
            </select>
          </div>
          <div className="flex items-end lg:col-span-1">
            <button
              type="button"
              onClick={addStep}
              disabled={!newStep.name?.trim()}
              className="w-full flex items-center justify-center gap-2 bg-brand-black text-white px-4 py-2 rounded-lg font-bold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100"
            >
              <Plus size={16} /> Add Step
            </button>
          </div>
        </div>

        {/* SLA and Description Inputs in Add Form */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-white/50 p-4 rounded-xl border border-brand-gray/10">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-green-600 uppercase tracking-widest">SLA Duration ({newStep.slaUnit})</label>
            <input
              type="number"
              value={newStep.sla ?? ''}
              onChange={(e) => setNewStep({ ...newStep, sla: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
              className="w-full px-3 py-2 bg-white border border-brand-gray/20 rounded-lg text-sm focus:ring-2 focus:ring-green-500/20"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Step Description</label>
            <input
              type="text"
              value={newStep.description || ''}
              onChange={(e) => setNewStep({ ...newStep, description: e.target.value })}
              placeholder="e.g. Verify request details and completeness"
              className="w-full px-3 py-2 bg-white border border-brand-gray/20 rounded-lg text-sm focus:ring-2 focus:ring-brand-red/20"
            />
          </div>
        </div>

        {/* Decision Point Options and Step Requirements in Add Form */}
        <div className="mt-4 pt-4 border-t border-brand-gray/10 flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer group">
            <div className={`w-10 h-5 rounded-full transition-all relative ${newStep.isDecision ? 'bg-brand-red' : 'bg-brand-gray/20'}`}>
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${newStep.isDecision ? 'left-6' : 'left-1'}`} />
              <input 
                type="checkbox" 
                className="hidden" 
                checked={newStep.isDecision}
                onChange={(e) => setNewStep({ ...newStep, isDecision: e.target.checked })}
              />
            </div>
            <span className="text-xs font-bold text-brand-black uppercase tracking-wider group-hover:text-brand-red transition-colors">Decision Point?</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer group">
            <div className={`w-10 h-5 rounded-full transition-all relative ${newStep.hasRequirements ? 'bg-brand-red' : 'bg-brand-gray/20'}`}>
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${newStep.hasRequirements ? 'left-6' : 'left-1'}`} />
              <input 
                type="checkbox" 
                className="hidden" 
                checked={newStep.hasRequirements}
                onChange={(e) => setNewStep({ ...newStep, hasRequirements: e.target.checked, requirements: e.target.checked ? (newStep.requirements || '') : '' })}
              />
            </div>
            <span className="text-xs font-bold text-brand-black uppercase tracking-wider group-hover:text-brand-red transition-colors">Has Requirements / Inputs?</span>
          </label>

          {newStep.hasRequirements && (
            <motion.div 
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full mt-2"
            >
              <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest block mb-1">Required Inputs/Requirements</label>
              <textarea
                value={newStep.requirements || ''}
                onChange={(e) => setNewStep({ ...newStep, requirements: e.target.value })}
                placeholder="e.g. Customer Name, Contract copy, ID scan..."
                rows={2}
                className="w-full text-xs bg-white border border-brand-gray/20 rounded-lg p-2 focus:ring-2 focus:ring-brand-red/20"
              />
            </motion.div>
          )}

          {newStep.isDecision && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4"
            >
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Question</label>
                <input
                  type="text"
                  value={newStep.decisionQuestion}
                  onChange={(e) => setNewStep({ ...newStep, decisionQuestion: e.target.value })}
                  placeholder="e.g. Is approval granted?"
                  className="w-full px-3 py-1.5 bg-white border border-brand-gray/20 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-red/20"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">If Yes (Next Step)</label>
                <select
                  value={newStep.yesNextStepId}
                  onChange={(e) => setNewStep({ ...newStep, yesNextStepId: e.target.value })}
                  className="w-full px-3 py-1.5 bg-white border border-brand-gray/20 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-red/20"
                >
                  <option value="">Next in Sequence</option>
                  {steps.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">If No (Next Step)</label>
                <select
                  value={newStep.noNextStepId}
                  onChange={(e) => setNewStep({ ...newStep, noNextStepId: e.target.value })}
                  className="w-full px-3 py-1.5 bg-white border border-brand-gray/20 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-red/20"
                >
                  <option value="">End Workflow</option>
                  {steps.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Steps List */}
      <div className="relative">
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-brand-gray/10 z-0" />
        
        <Reorder.Group axis="y" values={steps} onReorder={(next: WorkflowStep[]) => onChange(next.map((s, i) => ({ ...s, order: i + 1 })))} className="space-y-4">
          {steps.map((step, index) => (
            <Reorder.Item 
              key={step.id} 
              value={step}
              className="relative z-10 flex items-start gap-4 bg-white p-4 rounded-xl border border-brand-gray/20 shadow-sm group hover:border-brand-red/30 transition-all"
            >
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-brand-red/10 border-2 border-white flex items-center justify-center font-bold text-brand-red shadow-sm">
                {index + 1}
              </div>
              
              <div className="flex-1 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <GripVertical className="text-brand-gray cursor-grab active:cursor-grabbing" size={18} />
                    <input
                      type="text"
                      value={step.name || ''}
                      aria-label={`Name of step ${index + 1}`}
                      onChange={(e) => updateStep(step.id, { name: e.target.value })}
                      className="font-bold text-brand-black bg-transparent border-none focus:outline-none focus:ring-0 p-0 w-full"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeStep(step.id)}
                    aria-label={`Remove step ${step.name || index + 1}`}
                    className="p-2 text-brand-gray hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2 text-xs text-brand-gray">
                    <User size={14} />
                    <span className="font-medium">Responsible:</span>
                    <div className="flex items-center gap-1 bg-brand-gray/10 p-0.5 rounded-md mr-1">
                      <button 
                        type="button"
                        onClick={() => updateStep(step.id, { isExternal: false, responsibleRole: 'Development' })}
                        className={`text-[10px] px-1 py-0.5 rounded transition-all font-bold ${!step.isExternal ? 'bg-white text-brand-black shadow-sm' : 'text-brand-gray'}`}
                      >
                        INT
                      </button>
                      <button 
                        type="button"
                        onClick={() => updateStep(step.id, { isExternal: true, responsibleRole: '' })}
                        className={`text-[10px] px-1 py-0.5 rounded transition-all font-bold ${step.isExternal ? 'bg-white text-brand-black shadow-sm' : 'text-brand-gray'}`}
                      >
                        EXT
                      </button>
                    </div>
                    {step.isExternal ? (
                      <input
                        type="text"
                        value={step.responsibleRole || ''}
                        onChange={(e) => updateStep(step.id, { responsibleRole: e.target.value })}
                        placeholder="External Dept"
                        className="bg-brand-gray/5 border-none p-0 text-xs font-bold text-brand-black focus:ring-0 w-24"
                      />
                    ) : (
                      <select
                        value={step.responsibleRole || 'Development'}
                        onChange={(e) => updateStep(step.id, { responsibleRole: e.target.value })}
                        className="bg-brand-gray/5 border-none p-0 text-xs font-bold text-brand-black focus:ring-0"
                      >
                {STEP_ROLES.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-brand-gray">
                    <Clock size={14} />
                    <span className="font-medium">Unit:</span>
                    <select
                      value={step.slaUnit || 'Days'}
                      onChange={(e) => updateStep(step.id, { slaUnit: e.target.value as 'Hours' | 'Days' })}
                      className="bg-brand-gray/5 border-none p-0 text-xs font-bold text-brand-black focus:ring-0"
                    >
                      <option value="Hours">Hours</option>
                      <option value="Days">Days</option>
                    </select>
                  </div>
                </div>

                {/* SLA and Step Requirements Input */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-brand-gray/10">
                  <div className="space-y-1">
                    <label className="text-[10.5px] font-bold text-green-600 uppercase tracking-widest">SLA Duration ({step.slaUnit})</label>
                    <input
                      type="number"
                      value={step.sla ?? ''}
                      onChange={(e) => updateStep(step.id, { sla: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                      className="w-full bg-green-50/50 border border-green-100 rounded-md px-2 py-1 text-xs font-bold text-green-700 focus:ring-1 focus:ring-green-500/20"
                    />
                  </div>
                  
                  <div className="flex items-center">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div className={`w-8 h-4 rounded-full transition-all relative ${step.hasRequirements ? 'bg-brand-red' : 'bg-brand-gray/20'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${step.hasRequirements ? 'left-4.5' : 'left-0.5'}`} />
                        <input 
                          type="checkbox" 
                          className="hidden" 
                          checked={!!step.hasRequirements}
                          onChange={(e) => updateStep(step.id, { hasRequirements: e.target.checked, requirements: e.target.checked ? (step.requirements || '') : '' })}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Has Requirements/Inputs</span>
                    </label>
                  </div>
                </div>

                {step.hasRequirements && (
                  <div className="pt-2">
                    <label className="text-[10.5px] font-bold text-brand-gray uppercase tracking-widest block mb-1">Required Inputs/Requirements</label>
                    <textarea
                      value={step.requirements || ''}
                      onChange={(e) => updateStep(step.id, { requirements: e.target.value })}
                      placeholder="Specify required inputs or step requirements..."
                      rows={2}
                      className="w-full text-xs bg-brand-gray/5 border border-brand-gray/15 rounded-md p-2 focus:ring-1 focus:ring-brand-red/20 resize-none"
                    />
                  </div>
                )}

                {/* Prerequisites */}
                <div className="pt-3 border-t border-brand-gray/10 space-y-2">
                  <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Prerequisites (Must finish before this step)</label>
                  <div className="flex flex-wrap gap-2">
                    {steps.filter(s => s.id !== step.id).map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          const currentPrereqs = step.prerequisiteStepIds || [];
                          if (!currentPrereqs.includes(s.id) && dependsOn(steps, s.id, step.id)) {
                            toast.error(`"${s.name}" already depends on "${step.name}": that would create a loop.`);
                            return;
                          }
                          const newPrereqs = currentPrereqs.includes(s.id)
                            ? currentPrereqs.filter(id => id !== s.id)
                            : [...currentPrereqs, s.id];
                          updateStep(step.id, { prerequisiteStepIds: newPrereqs });
                        }}
                        className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all border ${
                          (step.prerequisiteStepIds || []).includes(s.id)
                            ? 'bg-brand-red text-white border-brand-red'
                            : 'bg-brand-gray/5 text-brand-gray border-transparent hover:border-brand-gray/20'
                        }`}
                      >
                        {s.name}
                      </button>
                    ))}
                    {steps.filter(s => s.id !== step.id).length === 0 && (
                      <span className="text-[10px] text-brand-gray italic">No other steps available</span>
                    )}
                  </div>
                </div>

                {/* Decision Logic in List */}
                <div className="pt-3 border-t border-brand-gray/10 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className={`w-8 h-4 rounded-full transition-all relative ${step.isDecision ? 'bg-brand-red' : 'bg-brand-gray/20'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${step.isDecision ? 'left-4.5' : 'left-0.5'}`} />
                      <input 
                        type="checkbox" 
                        className="hidden" 
                        checked={!!step.isDecision}
                        onChange={(e) => updateStep(step.id, e.target.checked ? { isDecision: true } : { isDecision: false, yesNextStepId: '', noNextStepId: '' })}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Decision Point</span>
                  </label>

                  {step.isDecision && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-brand-gray/5 p-3 rounded-xl border border-brand-gray/10">
                      <div className="space-y-1">
                        <label className="text-[10.5px] font-bold text-brand-gray uppercase tracking-widest">Question</label>
                        <input
                          type="text"
                          value={step.decisionQuestion || ''}
                          onChange={(e) => updateStep(step.id, { decisionQuestion: e.target.value })}
                          className="w-full bg-white border border-brand-gray/20 rounded-md px-2 py-1 text-xs focus:ring-1 focus:ring-brand-red/20"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10.5px] font-bold text-brand-gray uppercase tracking-widest">If Yes</label>
                        <select
                          value={step.yesNextStepId || ''}
                          onChange={(e) => updateStep(step.id, { yesNextStepId: e.target.value })}
                          className="w-full bg-white border border-brand-gray/20 rounded-md px-2 py-1 text-xs focus:ring-1 focus:ring-brand-red/20"
                        >
                          <option value="">Next in Sequence</option>
                          {steps.filter(s => s.id !== step.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10.5px] font-bold text-brand-gray uppercase tracking-widest">If No</label>
                        <select
                          value={step.noNextStepId || ''}
                          onChange={(e) => updateStep(step.id, { noNextStepId: e.target.value })}
                          className="w-full bg-white border border-brand-gray/20 rounded-md px-2 py-1 text-xs focus:ring-1 focus:ring-brand-red/20"
                        >
                          <option value="">End Workflow</option>
                          {steps.filter(s => s.id !== step.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <textarea
                  value={step.description || ''}
                  onChange={(e) => updateStep(step.id, { description: e.target.value })}
                  placeholder="Add step description..."
                  rows={2}
                  className="w-full text-sm text-brand-gray bg-brand-gray/5 border-none rounded-lg p-2 focus:ring-0 resize-none"
                />
              </div>
            </Reorder.Item>
          ))}
        </Reorder.Group>

        {steps.length === 0 && (
          <div className="text-center py-12 bg-brand-gray/5 rounded-2xl border border-brand-gray/20 border-dashed">
            <AlertCircle size={32} className="mx-auto text-brand-gray/30 mb-2" />
            <p className="text-brand-gray font-medium">No steps defined yet. Use the form above to add your first workflow step.</p>
          </div>
        )}
      </div>
    </>
  )}
</div>
);
};
