import React, { useState, useRef } from 'react';
import { WorkflowRequest, Role, Department } from '../../types';
import jsPDF from 'jspdf';
import { domToCanvas } from 'modern-screenshot';
import { WorkflowExportTemplate } from './WorkflowExportTemplate';
import { 
  ArrowLeft, 
  Clock, 
  Calendar, 
  User, 
  Building2, 
  AlertTriangle, 
  CheckCircle2, 
  MessageSquare, 
  ChevronRight,
  FileText,
  Download,
  Share2,
  Trash2,
  Edit,
  TrendingUp,
  BarChart3,
  Layers,
  Loader2,
  GitBranch,
  Check,
  X,
  Layout,
  MousePointer2,
  AlertCircle
} from 'lucide-react';
import { motion } from 'motion/react';
import { useWorkflowAccess } from './access';
import { settleRender } from './settleRender';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WORKING_HOURS_PER_DAY } from '../../constants';
import { toast } from 'sonner';

// SLA helpers: hours are summed from the steps themselves (never from a stored total that can be stale);
// days are rounded UP so a workflow is never shown as shorter than it is. No SLA entered -> "—".
const stepsHours = (steps?: { sla?: number; slaUnit?: string }[]) =>
  (steps || []).reduce((sum, s) => sum + (Number.isFinite(s.sla as number) ? (s.sla as number) * (s.slaUnit === 'Days' ? WORKING_HOURS_PER_DAY : 1) : 0), 0);
const hoursToDays = (h: number) => Math.ceil(h / WORKING_HOURS_PER_DAY);

interface WorkflowDetailProps {
  request: WorkflowRequest;
  onBack: () => void;
  onEdit?: (request: WorkflowRequest) => void;
  onDelete?: (id: string) => void;
  onUpdate?: (request: WorkflowRequest) => void;
  onStatusChange?: (id: string, status: WorkflowRequest['status']) => void;
  onAddFeedback?: (id: string, feedback: { recommendedSLA: number; businessJustification: string }) => void;
}

export const WorkflowDetail: React.FC<WorkflowDetailProps> = ({ 
  request, 
  onBack, 
  onEdit, 
  onDelete, 
  onUpdate,
  onStatusChange,
  onAddFeedback 
}) => {
  const { canEditFor, canApproveFor, canComment, canDelete: canDeleteFn } = useWorkflowAccess();
  const workflowRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'list' | 'visual'>('list');
  const [isExporting, setIsExporting] = useState(false);
  const [feedback, setFeedback] = useState({
    recommendedSLA: 0,
    businessJustification: ''
  });

  const canEdit = canEditFor(request.department);
  const canDelete = canDeleteFn(request);
  const canChangeStatus = canApproveFor(request.department);
  const canAddFeedback = canComment;

  const totalSLA = stepsHours(request.steps);
  const totalDays = hoursToDays(totalSLA);

  const handleFeedbackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!(feedback.recommendedSLA > 0) || !feedback.businessJustification.trim()) {
      toast.error('Enter a recommended SLA greater than 0 days and a justification.');
      return;
    }
    if (onAddFeedback) {
      onAddFeedback(request.id, { ...feedback, businessJustification: feedback.businessJustification.trim() });
    }
  };

  const handleExportPDF = async () => {
    if (!workflowRef.current) {
      console.error('Workflow ref not found');
      return;
    }

    setIsExporting(true);

    try {
      // wait until the off-screen template is painted, fonts and images are ready (no fixed delay)
      await settleRender('#workflow-export-container');

      const containerElement = document.getElementById('workflow-export-container');

      if (!containerElement) {
        throw new Error('Export container not found');
      }

      // Capture the entire container
      const canvas = await domToCanvas(containerElement, {
        scale: 1.5, // Better resolution
        backgroundColor: '#ffffff',
      });

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const imgProps = pdf.getImageProperties(imgData);
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      // Since container has fixed A4 aspect ratio (1200x1697), it fits perfectly on exactly 1 page
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');

      pdf.save(`${(request.title || 'Workflow').replace(/[^\w.-]+/g, '_').slice(0, 80)}_Workflow_Details.pdf`);

    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast.error('Failed to export PDF. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-brand-gray hover:text-brand-black transition-colors font-bold text-sm"
        >
          <ArrowLeft size={18} /> Back to List
        </button>
        
        <div className="flex items-center gap-3">
          {canEdit && (
            <button 
              onClick={() => onEdit?.(request)}
              className="flex items-center gap-2 bg-white border border-brand-gray/20 text-brand-black px-4 py-2 rounded-lg font-bold text-sm hover:bg-brand-gray/5 transition-all"
            >
              <Edit size={16} /> Edit
            </button>
          )}
          {canDelete && (
            <button 
              onClick={() => onDelete?.(request.id)}
              className="flex items-center gap-2 bg-white border border-red-200 text-red-600 px-4 py-2 rounded-lg font-bold text-sm hover:bg-red-50 transition-all"
            >
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button 
            onClick={handleExportPDF}
            disabled={isExporting}
            className="flex items-center gap-2 bg-brand-black text-white px-4 py-2 rounded-lg font-bold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
            {isExporting ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Hidden Export Template - Rendered off-screen for PDF generation */}
          <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
            <WorkflowExportTemplate 
              request={request} 
            />
          </div>

          {/* Basic Info Card */}
          <div className="bg-white p-8 rounded-3xl border border-brand-gray/10 shadow-sm">
            <div className="flex items-start justify-between mb-6">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    request.status === 'Finalized' ? 'bg-green-100 text-green-700' :
                    request.status === 'Aligned' ? 'bg-blue-100 text-blue-700' :
                    'bg-brand-gray/10 text-brand-gray'
                  }`}>
                    {request.status}
                  </span>
                  <span className="text-brand-gray/40">•</span>
                  <span className="text-xs text-brand-gray font-medium">
                    Created by {request.createdByName || 'Unknown'} on {request.createdAt && !isNaN(new Date(request.createdAt).getTime()) ? new Date(request.createdAt).toLocaleString() : '—'}
                  </span>
                </div>
                <h1 
                  className="text-3xl font-bold text-brand-black tracking-tight cursor-help select-all break-words hover:text-brand-red transition-colors duration-200" 
                  title={request.title}
                >
                  {request.title}
                </h1>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold text-brand-gray uppercase tracking-widest mb-1">Department</div>
                <div className="flex items-center gap-2 text-brand-black font-bold">
                  <Building2 size={18} className="text-brand-red" />
                  {request.department}
                </div>
              </div>
            </div>

            <p className="text-brand-gray leading-relaxed mb-6">{request.description}</p>

            {request.requiredData && request.requiredData.length > 0 && (
              <div className="mb-8">
                <div className="text-[10px] font-bold text-brand-gray uppercase tracking-widest mb-3 flex items-center gap-2">
                  <CheckCircle2 size={12} className="text-brand-red" />
                  Required Data (Pre-requisites)
                </div>
                <div className="flex flex-wrap gap-2">
                  {request.requiredData.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-red/5 text-brand-red border border-brand-red/10 rounded-full text-xs font-bold">
                      <div className="w-1.5 h-1.5 bg-brand-red rounded-full" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-6 bg-brand-gray/5 rounded-2xl">
              <div>
                <div className="text-[10px] font-bold text-brand-gray uppercase tracking-widest mb-1">Category</div>
                <div className="text-sm font-bold text-brand-black">{request.category}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-brand-gray uppercase tracking-widest mb-1">Complexity</div>
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${
                    request.complexity === 'Simple' ? 'bg-green-500' :
                    request.complexity === 'Medium' ? 'bg-yellow-500' :
                    'bg-red-500'
                  }`} />
                  <span className="text-sm font-bold text-brand-black">{request.complexity}</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-brand-gray uppercase tracking-widest mb-1">Frequency</div>
                <div className="text-sm font-bold text-brand-black">{request.frequency}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-brand-gray uppercase tracking-widest mb-1">Total Steps</div>
                <div className="text-sm font-bold text-brand-black">{(request.steps || []).length} Steps</div>
              </div>
            </div>
          </div>

          {/* Workflow Visualization */}
          <div className="bg-white p-8 rounded-3xl border border-brand-gray/10 shadow-sm" ref={workflowRef}>
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold text-brand-black flex items-center gap-2">
                <Layers size={20} className="text-brand-red" />
                Workflow Process
              </h2>
              <div className="flex p-1 bg-brand-gray/5 rounded-xl">
                <button
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                    viewMode === 'list' 
                      ? 'bg-white text-brand-black shadow-sm' 
                      : 'text-brand-gray hover:text-brand-black'
                  }`}
                >
                  <Layout size={14} />
                  List View
                </button>
                <button
                  onClick={() => setViewMode('visual')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                    viewMode === 'visual' 
                      ? 'bg-white text-brand-black shadow-sm' 
                      : 'text-brand-gray hover:text-brand-black'
                  }`}
                >
                  <MousePointer2 size={14} />
                  Visual Flow
                </button>
              </div>
            </div>

            {viewMode === 'visual' ? (
              <div className="h-[700px]">
                <WorkflowCanvas 
                  steps={request.steps || []} 
                  onChange={(newSteps) => onUpdate && onUpdate({ ...request, steps: newSteps })} 
                  readOnly={!canEdit}
                />
              </div>
            ) : (
              <div className="space-y-4 relative">
              <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-brand-gray/10" />
              
              {(request.steps || []).map((step, index) => (
                <div key={step.id} className="relative z-10 flex items-start gap-4 group">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-white border-2 border-brand-gray/20 flex items-center justify-center font-bold text-brand-gray group-hover:border-brand-red group-hover:text-brand-red transition-all shadow-sm">
                    {index + 1}
                  </div>
                  <div className="flex-1 bg-brand-gray/5 p-4 rounded-2xl group-hover:bg-brand-red/5 transition-all">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-bold text-brand-black">{step.name}</h3>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 text-[10px] font-bold text-brand-gray uppercase tracking-wider">
                          <User size={12} />
                          {step.responsibleRole} {step.isExternal && <span className="text-brand-red ml-1">(Ext)</span>}
                        </div>
                      </div>
                    </div>
                    
                    {/* SLA per step */}
                    <div className="flex flex-col gap-2 mb-2">
                      <div className="text-[10px] font-bold text-green-600">SLA Duration: {step.sla != null ? `${step.sla} ${step.slaUnit}` : '—'}</div>
                      {step.hasRequirements && step.requirements && (
                        <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg text-xs">
                          <span className="font-bold text-brand-black text-[10.5px] uppercase tracking-widest block mb-1">Required Step Inputs:</span>
                          <p className="text-brand-gray font-medium leading-relaxed">{step.requirements}</p>
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-brand-gray">{step.description}</p>

                    {step.isDecision && (
                      <div className="mt-4 space-y-3">
                        <div className="flex items-center gap-2 text-xs font-bold text-brand-red uppercase tracking-wider">
                          <GitBranch size={14} />
                          Decision: {step.decisionQuestion || 'Proceed?'}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-3 bg-green-50 border border-green-100 rounded-xl">
                            <div className="flex items-center gap-2 text-[10px] font-bold text-green-700 uppercase tracking-widest mb-1">
                              <Check size={12} /> Yes Path
                            </div>
                            <div className="text-xs font-bold text-brand-black">
                              {step.yesNextStepId 
                                ? (request.steps.find(s => s.id === step.yesNextStepId)?.name || '(step removed)')
                                : 'Next Step'}
                            </div>
                          </div>
                          <div className="p-3 bg-red-50 border border-red-100 rounded-xl">
                            <div className="flex items-center gap-2 text-[10px] font-bold text-red-700 uppercase tracking-widest mb-1">
                              <X size={12} /> No Path
                            </div>
                            <div className="text-xs font-bold text-brand-black">
                              {step.noNextStepId 
                                ? (request.steps.find(s => s.id === step.noNextStepId)?.name || '(step removed)')
                                : 'End Workflow'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>

          {/* Dependencies */}
          {(request.dependencies || []).length > 0 && (
            <div className="bg-white p-8 rounded-3xl border border-brand-gray/10 shadow-sm">
              <h2 className="text-xl font-bold text-brand-black mb-6 flex items-center gap-2">
                <Share2 size={20} className="text-brand-red" />
                Inter-Department Dependencies
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(request.dependencies || []).map((dep, idx) => (
                  <div key={idx} className="flex items-center gap-4 p-4 bg-brand-gray/5 rounded-2xl border border-brand-gray/10">
                    <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm">
                      <Building2 size={20} className="text-brand-gray" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-brand-black uppercase tracking-wider">{dep.department}</div>
                      <div className="text-[10px] text-brand-gray font-medium">{dep.type} Dependency</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          {/* SLA Summary Card */}
          <div className="bg-brand-black text-white p-8 rounded-3xl shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-brand-red/20 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
            
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <BarChart3 size={20} className="text-brand-red" />
              SLA Analysis
            </h2>

            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3 mb-4">
                <div className="p-5 bg-green-500/10 rounded-2xl border border-green-500/20 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold text-green-400 uppercase tracking-widest">Calculated SLA</div>
                    <div className="text-3xl font-black text-green-500">{totalSLA > 0 ? `${totalDays} Days` : '—'}</div>
                  </div>
                  <div className="text-xs font-bold text-green-500/60">{totalSLA > 0 ? `${totalSLA} Working Hours` : 'No step SLA entered'}</div>
                </div>
                
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-between text-xs">
                  <span className="text-brand-gray font-medium">Total Workflow Steps:</span>
                  <span className="font-bold text-white">{(request.steps || []).length} steps</span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                  <div className="text-[10px] font-bold text-brand-gray uppercase tracking-widest mb-2">Justification</div>
                  <p className="text-xs text-white/80 leading-relaxed italic">{request.slaJustification ? `"${request.slaJustification}"` : '—'}</p>
                </div>

                {(request.maxBufferHours ?? 0) > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-brand-gray">Included Buffer:</span>
                    <span className="font-bold text-brand-red">+{request.maxBufferHours} Hours</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sales Feedback Card */}
          <div className="bg-white p-8 rounded-3xl border border-brand-gray/10 shadow-sm">
            <h2 className="text-lg font-bold text-brand-black mb-6 flex items-center gap-2">
              <MessageSquare size={20} className="text-brand-red" />
              Sales Feedback
            </h2>

            {request.salesFeedback ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-brand-gray/5 rounded-2xl">
                  <div className="text-xs font-bold text-brand-gray uppercase tracking-wider">Recommended SLA</div>
                  <div className="text-xl font-bold text-brand-black">{request.salesFeedback.recommendedSLA} Days</div>
                </div>
                <div className="p-4 border border-brand-gray/10 rounded-2xl">
                  <div className="text-[10px] font-bold text-brand-gray uppercase tracking-widest mb-2">Business Justification</div>
                  <p className="text-xs text-brand-gray leading-relaxed">"{request.salesFeedback.businessJustification}"</p>
                </div>
                
                {/* SLA Gap Alert */}
                {totalSLA > 0 && Math.abs(totalDays - request.salesFeedback.recommendedSLA) > 2 && (
                  <div className="flex items-start gap-3 p-4 bg-red-50 rounded-2xl border border-red-100">
                    <AlertTriangle size={18} className="text-red-500 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-red-700">Significant SLA Gap</div>
                      <p className="text-[10px] text-red-600">There is a {Math.abs(totalDays - request.salesFeedback.recommendedSLA)} day difference between workflow design and Sales recommendation.</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {canAddFeedback ? (
                  <form onSubmit={handleFeedbackSubmit} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Recommended SLA (Days)</label>
                      <input
                        type="number"
                        required
                        min={1}
                        value={feedback.recommendedSLA || ''}
                        onChange={(e) => setFeedback({ ...feedback, recommendedSLA: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                        className="w-full px-3 py-2 bg-brand-gray/5 border border-brand-gray/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-red/20"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-brand-gray uppercase tracking-widest">Business Justification</label>
                      <textarea
                        required
                        rows={3}
                        value={feedback.businessJustification}
                        onChange={(e) => setFeedback({ ...feedback, businessJustification: e.target.value })}
                        className="w-full px-3 py-2 bg-brand-gray/5 border border-brand-gray/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-red/20 resize-none"
                      />
                    </div>
                    <button 
                      type="submit"
                      className="w-full bg-brand-black text-white py-2 rounded-lg font-bold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                      Submit Feedback
                    </button>
                  </form>
                ) : (
                  <div className="text-center py-8 bg-brand-gray/5 rounded-2xl border border-brand-gray/10 border-dashed">
                    <MessageSquare size={24} className="mx-auto text-brand-gray/30 mb-2" />
                    <p className="text-xs text-brand-gray">No feedback from Sales yet.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Finalization */}
          {canChangeStatus && request.status !== 'Finalized' && (
            <div className="bg-green-50 p-6 rounded-3xl border border-green-100 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={20} className="text-green-600" />
                <h3 className="font-bold text-green-900">Finalization</h3>
              </div>
              <p className="text-xs text-green-700">You can finalize this workflow once all departments are aligned. Finalized workflows become available as templates when a ticket is created.</p>
              <button 
                onClick={() => onStatusChange?.(request.id, 'Finalized')}
                className="w-full bg-green-600 text-white py-2 rounded-lg font-bold text-sm hover:bg-green-700 transition-all"
              >
                Finalize Workflow
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
