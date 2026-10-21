import React, { useState, useEffect } from 'react';
import { WORKFLOW_DEPARTMENTS } from './departments';
import { useAuth } from '../../services/AuthContext';
import { 
  WorkflowRequest, 
  WorkflowStep, 
  Dependency, 
  Department, 
  ComplexityLevel, 
  Frequency,
  DependencyType
} from '../../types';
import { WorkflowBuilder } from './WorkflowBuilder';
import { WORKING_HOURS_PER_DAY } from '../../constants';
import { toast } from 'sonner';

// SLA helpers: hours are summed from the steps themselves (never from a stored total that can be stale);
// days are rounded UP so a workflow is never shown as shorter than it is. No SLA entered -> "—".
const stepsHours = (steps?: { sla?: number; slaUnit?: string }[]) =>
  (steps || []).reduce((sum, s) => sum + (Number.isFinite(s.sla as number) ? (s.sla as number) * (s.slaUnit === 'Days' ? WORKING_HOURS_PER_DAY : 1) : 0), 0);
const hoursToDays = (h: number) => Math.ceil(h / WORKING_HOURS_PER_DAY);
import { 
  Save, 
  Plus, 
  Trash2, 
  AlertCircle, 
  Info,
  GitBranch,
  Clock,
  Calendar,
  ChevronRight,
  ChevronLeft,
  Loader2
} from 'lucide-react';

interface WorkflowFormProps {
  onSubmit: (data: Partial<WorkflowRequest>) => Promise<void> | void;
  onCancel: () => void;
  initialData?: WorkflowRequest;
}

export const WorkflowForm: React.FC<WorkflowFormProps> = ({ onSubmit, onCancel, initialData }) => {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<Partial<WorkflowRequest>>(
    initialData || {
      title: '',
      category: (user?.department as Department) || 'Development',
      description: '',
      requiredData: [],
      complexity: 'Simple',
      frequency: 'Medium',
      department: (user?.department as Department) || 'Development',
      maxBufferHours: 0,
      slaJustification: '',
      steps: [],
      dependencies: [],
      status: 'Draft',
      createdBy: user?.id != null ? String(user.id) : '',
      createdByName: user?.name || ''
    }
  );

  const [newItem, setNewItem] = useState('');

  const addRequiredData = () => {
    if (!newItem.trim()) return;
    setFormData(prev => ({
      ...prev,
      requiredData: [...(prev.requiredData || []), newItem.trim()]
    }));
    setNewItem('');
  };

  const removeRequiredData = (index: number) => {
    setFormData(prev => ({
      ...prev,
      requiredData: (prev.requiredData || []).filter((_, i) => i !== index)
    }));
  };

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Kahn-style check: true when the prerequisite graph contains a cycle
  const hasPrereqCycle = (steps: WorkflowStep[]) => {
    const ids = new Set(steps.map(s => s.id));
    const indeg = new Map<string, number>();
    steps.forEach(s => indeg.set(s.id, (s.prerequisiteStepIds || []).filter(p => ids.has(p)).length));
    const queue = steps.filter(s => indeg.get(s.id) === 0).map(s => s.id);
    let seen = 0;
    while (queue.length) {
      const id = queue.pop()!;
      seen++;
      steps.forEach(s => {
        if ((s.prerequisiteStepIds || []).includes(id)) {
          const d = (indeg.get(s.id) || 0) - 1;
          indeg.set(s.id, d);
          if (d === 0) queue.push(s.id);
        }
      });
    }
    return seen < steps.length;
  };

  const validateStep1 = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.title?.trim()) newErrors.title = 'Title is required';
    if (!formData.description?.trim()) newErrors.description = 'Description is required';
    if (!formData.category) newErrors.category = 'Category is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.steps || formData.steps.length === 0) {
      newErrors.steps = 'At least one workflow step is required';
    } else {
      const bad = formData.steps.findIndex(st => !st.name?.trim());
      const noRole = formData.steps.findIndex(st => !st.responsibleRole?.trim());
      const noSla = formData.steps.findIndex(st => st.sla == null || !Number.isFinite(st.sla) || st.sla <= 0);
      if (bad >= 0) newErrors.steps = `Step ${bad + 1} has no name`;
      else if (noRole >= 0) newErrors.steps = `Step ${noRole + 1} has no responsible department`;
      else if (noSla >= 0) newErrors.steps = `Step ${noSla + 1} needs an SLA duration greater than 0`;
      else if (hasPrereqCycle(formData.steps)) newErrors.steps = 'The prerequisites form a loop: steps would wait on each other forever. Remove one of the prerequisite links.';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep3 = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.slaJustification?.trim()) newErrors.slaJustification = 'SLA justification is mandatory';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) setStep(2);
    else if (step === 2 && validateStep2()) setStep(3);
  };

  const handleBack = () => {
    setStep(prev => prev - 1);
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!validateStep3()) {
      toast.error('Please provide a mandatory SLA Justification before saving the workflow.');
      return;
    }
    try {
      setIsSubmitting(true);
      await onSubmit({ ...formData, totalSLA: stepsHours(formData.steps) });
    } catch (err) {
      console.error('Error submitting workflow:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addDependency = () => {
    const newDep: Dependency = {
      id: Math.random().toString(36).slice(2, 11),
      department: 'Finance',
      type: 'Approval'
    };
    setFormData(prev => ({
      ...prev,
      dependencies: [...(prev.dependencies || []), newDep]
    }));
  };

  const removeDependency = (id: string) => {
    setFormData(prev => ({
      ...prev,
      dependencies: (prev.dependencies || []).filter(d => d.id !== id)
    }));
  };

  const updateDependency = (id: string, updates: Partial<Dependency>) => {
    setFormData(prev => ({
      ...prev,
      dependencies: (prev.dependencies || []).map(d => d.id === id ? { ...d, ...updates } : d)
    }));
  };

  const handleStepsChange = (newSteps: WorkflowStep[]) => {
    setFormData(prev => ({
      ...prev,
      steps: newSteps,
      totalSLA: stepsHours(newSteps)
    }));
  };

  // Always derived from the current steps (initialData.totalSLA can be stale or missing)
  const totalHours = stepsHours(formData.steps);

  return (
    <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm overflow-hidden">
      {/* Progress Bar */}
      <div className="flex border-b border-brand-gray/20">
        {[
          { n: 1, label: 'Basic Info' },
          { n: 2, label: 'Workflow Builder' },
          { n: 3, label: 'SLA & Dependencies' }
        ].map((s) => (
          <div 
            key={s.n}
            className={`flex-1 py-4 px-6 text-center border-r border-brand-gray/20 last:border-r-0 transition-all ${
              step >= s.n ? 'bg-brand-red/5 text-brand-red' : 'text-brand-gray'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                step >= s.n ? 'bg-brand-red text-white' : 'bg-brand-gray/20 text-brand-gray'
              }`}>
                {s.n}
              </span>
              <span className="font-bold text-sm hidden md:inline">{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="p-8">
        {step === 1 && (
          <div className="space-y-6 max-w-3xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-brand-black uppercase tracking-wider">Request Title</label>
                <input
                  type="text"
                  value={formData.title || ''}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g. New Product Setup"
                  className={`w-full px-4 py-3 bg-brand-gray/5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-red/20 focus:border-brand-red transition-all ${
                    errors.title ? 'border-red-500' : 'border-brand-gray/20'
                  }`}
                />
                {errors.title && <p className="text-xs text-red-500 font-medium">{errors.title}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-brand-black uppercase tracking-wider">Category / Department</label>
                                <select
                  value={formData.category || 'Development'}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value as Department, department: e.target.value as Department })}
                  className="w-full px-4 py-3 bg-brand-gray/5 border border-brand-gray/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-red/20 focus:border-brand-red transition-all"
                >
                {WORKFLOW_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-brand-black uppercase tracking-wider">Description</label>
                <textarea
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe the request type and its purpose..."
                  rows={6}
                  className={`w-full px-4 py-3 bg-brand-gray/5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-red/20 focus:border-brand-red transition-all resize-none ${
                    errors.description ? 'border-red-500' : 'border-brand-gray/20'
                  }`}
                />
                {errors.description && <p className="text-xs text-red-500 font-medium">{errors.description}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-brand-black uppercase tracking-wider">Required Data / Checklist</label>
                <div className="bg-brand-gray/5 border border-brand-gray/20 rounded-xl p-4 min-h-[178px] flex flex-col">
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      value={newItem}
                      onChange={(e) => setNewItem(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRequiredData())}
                      placeholder="Add required data item..."
                      className="flex-1 px-3 py-2 bg-white border border-brand-gray/20 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-red/10 focus:border-brand-red"
                    />
                    <button
                      type="button"
                      onClick={addRequiredData}
                      aria-label="Add required data item"
                      className="p-2 bg-brand-red text-white rounded-lg hover:scale-105 active:scale-95 transition-all"
                    >
                      <Plus size={18} />
                    </button>
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto max-h-[150px] pr-1 custom-scrollbar">
                    {formData.requiredData?.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3 bg-white px-3 py-2 rounded-lg border border-brand-gray/10 group animate-in fade-in slide-in-from-left-2 duration-200">
                        <span className="text-xs font-medium text-brand-black truncate">{item}</span>
                        <button
                          type="button"
                          onClick={() => removeRequiredData(idx)}
                          aria-label={`Remove ${item}`}
                          className="text-brand-gray hover:text-brand-red transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    {(!formData.requiredData || formData.requiredData.length === 0) && (
                      <div className="h-full flex flex-col items-center justify-center opacity-40 py-4">
                        <Info size={24} className="mb-2" />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-center">No items added yet</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-brand-black uppercase tracking-wider">Complexity Level</label>
                <div className="grid grid-cols-3 gap-2">
                  {['Simple', 'Medium', 'Complex'].map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setFormData({ ...formData, complexity: level as ComplexityLevel })}
                      className={`py-2 px-4 rounded-xl border font-bold text-xs transition-all ${
                        formData.complexity === level
                          ? 'bg-brand-red text-white border-brand-red shadow-lg shadow-brand-red/20'
                          : 'bg-brand-gray/5 text-brand-gray border-brand-gray/20 hover:bg-brand-gray/10'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-brand-black uppercase tracking-wider">Frequency</label>
                <div className="grid grid-cols-3 gap-2">
                  {['High', 'Medium', 'Low'].map((freq) => (
                    <button
                      key={freq}
                      type="button"
                      onClick={() => setFormData({ ...formData, frequency: freq as Frequency })}
                      className={`py-2 px-4 rounded-xl border font-bold text-xs transition-all ${
                        formData.frequency === freq
                          ? 'bg-brand-black text-white border-brand-black shadow-lg shadow-brand-black/20'
                          : 'bg-brand-gray/5 text-brand-gray border-brand-gray/20 hover:bg-brand-gray/10'
                      }`}
                    >
                      {freq}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-lg font-bold text-brand-black">Workflow Steps</h4>
                <p className="text-sm text-brand-gray">Define the sequence of actions for this request</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center px-4 py-2 bg-green-50 rounded-lg text-green-700 border border-green-100 min-w-[120px]">
                      <span className="text-[10.5px] uppercase tracking-widest font-bold opacity-60">Total SLA</span>
                      <span className="text-sm font-black">{totalHours > 0 ? `${hoursToDays(totalHours)}d / ${totalHours}h` : '—'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <WorkflowBuilder 
              steps={formData.steps || []} 
              onChange={handleStepsChange} 
            />
            {errors.steps && (
              <div className="flex items-center gap-2 p-4 bg-red-50 text-red-600 rounded-xl border border-red-100">
                <AlertCircle size={18} />
                <p className="text-sm font-medium">{errors.steps}</p>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-8 max-w-3xl mx-auto">
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-brand-red">
                <Clock size={20} />
                <h4 className="font-bold uppercase tracking-wider">SLA Summary</h4>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-green-50 p-6 rounded-2xl border border-green-100 flex flex-col justify-center">
                  <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest mb-1">Total Calculated SLA</p>
                  <p className="text-3xl font-black text-green-700">{totalHours > 0 ? `${hoursToDays(totalHours)} Days` : '—'}</p>
                  <p className="text-sm text-green-600/60 mt-1">{totalHours > 0 ? `${totalHours} Working Hours` : 'No step SLA entered'}</p>
                </div>
                
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200/50 flex flex-col justify-center">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Steps</p>
                  <p className="text-3xl font-black text-slate-700">{(formData.steps || []).length} steps</p>
                  <p className="text-sm text-slate-500/60 mt-1">Defined in workflow sequence</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-brand-black uppercase tracking-wider">Maximum SLA Buffer (Optional)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      value={formData.maxBufferHours ?? ''}
                      onChange={(e) => setFormData({ ...formData, maxBufferHours: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                      placeholder="e.g. 120"
                      className="w-full px-4 py-3 bg-brand-gray/5 border border-brand-gray/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-red/20 focus:border-brand-red transition-all"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-gray font-bold text-sm">Hours</span>
                  </div>
                  <p className="text-[10px] text-brand-gray italic">Add extra time for external factors or approvals</p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-brand-black uppercase tracking-wider">SLA Justification <span className="text-brand-red">*</span></label>
                <textarea
                  value={formData.slaJustification || ''}
                  onChange={(e) => setFormData({ ...formData, slaJustification: e.target.value })}
                  placeholder="Explain why this SLA is required (e.g. External authority approval, complex data validation...)"
                  rows={4}
                  className={`w-full px-4 py-3 bg-brand-gray/5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-red/20 focus:border-brand-red transition-all resize-none ${
                    errors.slaJustification ? 'border-red-500' : 'border-brand-gray/20'
                  }`}
                />
                {errors.slaJustification && <p className="text-xs text-red-500 font-medium">{errors.slaJustification}</p>}
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-brand-red">
                  <GitBranch size={20} />
                  <h4 className="font-bold uppercase tracking-wider">External Dependencies</h4>
                </div>
                <button
                  type="button"
                  onClick={addDependency}
                  className="flex items-center gap-2 text-xs font-bold text-brand-red hover:bg-brand-red/10 px-3 py-1.5 rounded-lg transition-all"
                >
                  <Plus size={16} /> Add Dependency
                </button>
              </div>

              <div className="space-y-3">
                {formData.dependencies?.map((dep) => (
                  <div key={dep.id} className="flex items-center gap-4 bg-white p-4 rounded-xl border border-brand-gray/20 shadow-sm group">
                    <div className="flex-1 grid grid-cols-2 gap-4">
                      <select
                        value={dep.department}
                        onChange={(e) => updateDependency(dep.id, { department: e.target.value as Department })}
                        className="bg-brand-gray/5 border border-brand-gray/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red/20"
                      >
                {WORKFLOW_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <select
                        value={dep.type}
                        onChange={(e) => updateDependency(dep.id, { type: e.target.value as DependencyType })}
                        className="bg-brand-gray/5 border border-brand-gray/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red/20"
                      >
                        <option value="Approval">Approval Required</option>
                        <option value="Input">Data Input Required</option>
                        <option value="Execution">Execution Required</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDependency(dep.id)}
                      aria-label="Remove dependency"
                      className="p-2 text-brand-gray hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
                {(!formData.dependencies || formData.dependencies.length === 0) && (
                  <div className="text-center py-6 border-2 border-dashed border-brand-gray/10 rounded-2xl">
                    <p className="text-sm text-brand-gray">No external dependencies defined</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-12 flex items-center justify-between border-t border-brand-gray/20 pt-8">
          <button
            type="button"
            onClick={step === 1 ? onCancel : handleBack}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-3 text-brand-gray font-bold hover:text-brand-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {step === 1 ? 'Cancel' : <><ChevronLeft size={20} /> Back</>}
          </button>
          
          <div className="flex items-center gap-4">
            {step < 3 ? (
              <button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-2 bg-brand-black text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-brand-black/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                Next Step <ChevronRight size={20} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex items-center gap-2 bg-brand-red text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-brand-red/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    {initialData ? 'Updating Workflow...' : 'Saving Workflow...'}
                  </>
                ) : (
                  <>
                    <Save size={20} />
                    {initialData ? 'Update Workflow' : 'Save Workflow Definition'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
