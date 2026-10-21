import React from 'react';
import { WorkflowRequest } from '../../types';
import { 
  Clock, 
  User, 
  Building2, 
  CheckCircle2, 
  MessageSquare, 
  Layers,
  BarChart3,
  Calendar,
  ShieldCheck,
  GitBranch,
  Check,
  X,
  ArrowRight
} from 'lucide-react';
import { WORKING_HOURS_PER_DAY } from '../../constants';
import { LOGO_BASE64 } from './logoBase64';

// SLA helpers: hours are summed from the steps themselves (never from a stored total that can be stale);
// days are rounded UP so a workflow is never shown as shorter than it is. No SLA entered -> "—".
const stepsHours = (steps?: { sla?: number; slaUnit?: string }[]) =>
  (steps || []).reduce((sum, s) => sum + (Number.isFinite(s.sla as number) ? (s.sla as number) * (s.slaUnit === 'Days' ? WORKING_HOURS_PER_DAY : 1) : 0), 0);
const hoursToDays = (h: number) => Math.ceil(h / WORKING_HOURS_PER_DAY);

interface WorkflowExportTemplateProps {
  request: WorkflowRequest;
}

export const WorkflowExportTemplate: React.FC<WorkflowExportTemplateProps> = ({ 
  request
}) => {
  const getHeaderClass = (title: string) => {
    const len = title ? title.length : 0;
    if (len > 80) return "text-2xl font-black tracking-tight mb-2 uppercase leading-snug break-words text-[#1A1A1A]";
    if (len > 50) return "text-3xl font-black tracking-tight mb-2 uppercase leading-snug break-words text-[#1A1A1A]";
    if (len > 30) return "text-4xl font-black tracking-tight mb-2 uppercase leading-tight break-words text-[#1A1A1A]";
    return "text-5xl font-black tracking-tight mb-2 uppercase leading-tight break-words text-[#1A1A1A]";
  };

  const totalSLA = stepsHours(request.steps);
  const stepNo = (id?: string) => {
    const i = id ? (request.steps || []).findIndex(s => s.id === id) : -1;
    return i >= 0 ? String(i + 1) : '?';
  };

  return (
    <div id="workflow-export-container" className="w-[1200px] h-[1697px] bg-white text-[#1A1A1A] font-sans flex flex-col justify-between p-14 overflow-hidden">
      <div className="flex-grow flex flex-col justify-between">
        <div>
          {/* Minimalist Pro Header */}
          <div className="mb-8 border-l-8 border-[#A6192E] pl-6">
            <h1 className={getHeaderClass(request.title || '')} title={request.title}>{request.title}</h1>
            <div className="flex items-center gap-3 text-[#555555] font-extrabold tracking-widest uppercase text-xs">
              <span>Detailed Step Analysis</span>
              <span className="w-1.5 h-1.5 bg-[#A6192E] rounded-full"></span>
              <span>{request.department}</span>
              <span className="w-1.5 h-1.5 bg-[#A6192E] rounded-full"></span>
              <span>SLA: {totalSLA > 0 ? `${hoursToDays(totalSLA)} Days (${totalSLA}h)` : '—'}</span>
            </div>
          </div>

          {/* Description Section */}
          {request.description && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-0.5 bg-[#A6192E]"></div>
                <h2 className="text-xs font-black uppercase tracking-widest text-[#767676]">Description</h2>
              </div>
              <div className="bg-[#F8F9FA] border border-[#E5E5E5] rounded-2xl p-5">
                 <p className="text-sm text-[#444444] font-medium leading-relaxed">
                   {request.description}
                 </p>
              </div>
            </div>
          )}

          {/* Required Data Section */}
          {request.requiredData && request.requiredData.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-0.5 bg-[#A6192E]"></div>
                <h2 className="text-xs font-black uppercase tracking-widest text-[#767676]">Required Input Data</h2>
              </div>
              <div className="bg-[#F8F9FA] border border-[#E5E5E5] rounded-2xl p-4">
                <div className="grid grid-cols-4 gap-4">
                  {request.requiredData.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2.5 bg-white px-4 py-2 rounded-xl border border-[#F2F2F2] shadow-sm">
                      <div className="w-5 h-5 bg-[#A6192E]/10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check size={11} className="text-[#A6192E] stroke-[3]" />
                      </div>
                      <span className="text-xs font-bold text-[#1A1A1A] break-words whitespace-normal leading-normal flex-grow">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-0.5 bg-[#A6192E]"></div>
            <h2 className="text-xs font-black uppercase tracking-widest text-[#767676]">Workflow Steps</h2>
          </div>

          {/* Steps Grid - Added top and left padding so absolute-positioned indicators do not get clipped at grid boundary */}
          <div className="relative pt-4 pl-4 pr-1">
            <div className="grid grid-cols-3 gap-x-6 gap-y-7">
              {(request.steps || []).map((step, index) => {
                                return (
                  <div key={step.id} className="relative bg-[#F8F9FA] border border-[#E5E5E5] rounded-[20px] p-5 flex flex-col shadow-sm min-h-[195px] max-h-[240px]">
                    {/* Step Indicator Badge - increased size & no overflow-hidden on container to ensure it renders completely */}
                    <div className="absolute -top-3.5 -left-3.5 z-10 w-9 h-9 bg-white border-2 border-[#A6192E] rounded-full flex items-center justify-center shadow-md">
                      <span className="text-sm font-black text-[#A6192E]">{index + 1}</span>
                    </div>

                    {/* Step Details */}
                    <div className="flex-grow flex flex-col justify-between h-full">
                      <div className="flex justify-between items-start mb-3 border-b border-[#E5E5E5] pb-2.5 gap-2">
                        <h3 className="text-sm font-black tracking-tight text-[#1A1A1A] leading-snug line-clamp-2 flex-grow">{step.name}</h3>
                        <div className="flex flex-col items-end text-right flex-shrink-0 ml-1">
                          <span className="text-[10px] font-black text-[#A6192E] uppercase leading-none mb-1.5 tracking-wider">
                            {step.responsibleRole || 'Unassigned'}
                          </span>
                          <div className="flex items-center gap-1 bg-white px-2 py-0.5 rounded-md border border-[#E5E5E5] text-[10.5px] font-bold shadow-sm">
                            <Clock size={10} className="text-[#A6192E] flex-shrink-0" />
                            <span className="text-[#2D2926] uppercase leading-none">{step.sla != null ? `${step.sla} ${step.slaUnit === 'Days' ? 'Days' : 'Hrs'}` : '—'}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex-grow flex flex-col justify-between space-y-2">
                        <p className="text-[11px] text-[#444444] font-semibold leading-relaxed line-clamp-3">
                          {step.description || 'No description provided.'}
                        </p>

                        {/* Step Requirements */}
                        {step.hasRequirements && step.requirements && (
                          <div className="p-2 bg-amber-50/90 border border-amber-200/60 rounded-xl">
                            <span className="text-[10px] font-black text-amber-800 uppercase tracking-widest block mb-1">Required Inputs</span>
                            <p className="text-[10px] font-bold text-amber-950 leading-snug line-clamp-2">
                              {step.requirements}
                            </p>
                          </div>
                        )}

                        {/* Prerequisites */}
                        {(step.prerequisiteStepIds || []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            <span className="text-[10px] font-bold text-[#767676] uppercase tracking-widest w-full">Prerequisites</span>
                            {step.prerequisiteStepIds?.slice(0, 2).map(preId => {
                              return (
                                <div key={preId} className="flex items-center gap-1 bg-white px-2 py-0.5 rounded text-[10.5px] font-bold text-[#2D2926] border border-[#E5E5E5]">
                                  Step {stepNo(preId)}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {step.isDecision ? (
                          <div className="space-y-1 bg-[#A6192E]/5 p-2 rounded-xl border border-[#A6192E]/10">
                            <div className="flex items-center gap-1 text-[#A6192E] font-bold italic text-[10.5px]">
                              <GitBranch size={10} className="flex-shrink-0" />
                              <span className="truncate leading-none">{step.decisionQuestion || 'Decision Point'}</span>
                            </div>
                            <div className="flex gap-1.5 text-[10.5px] font-black uppercase text-white">
                              <span className="bg-[#22c55e] px-1.5 py-0.5 rounded">Yes: Step {step.yesNextStepId ? stepNo(step.yesNextStepId) : 'Next'}</span>
                              <span className="bg-[#A6192E] px-1.5 py-0.5 rounded">No: Step {step.noNextStepId ? stepNo(step.noNextStepId) : 'End'}</span>
                            </div>
                          </div>
                        ) : (
                          step.nextStepId && (
                            <div className="pt-2 border-t border-[#E5E5E5]/50 flex items-center gap-1 text-[#A6192E] font-bold text-[10.5px] uppercase tracking-wider">
                              <ArrowRight size={10} />
                              Next: Step {stepNo(step.nextStepId)}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Professional Footer */}
      <div className="pt-4 border-t-2 border-[#E5E5E5] flex justify-between items-center mt-6">
        <div className="flex flex-col gap-0.5">
          <div className="text-[10px] font-bold text-[#767676] uppercase tracking-[0.2em]">
            SDM Service Desk • Standard Operating Procedure • {new Date().getFullYear()}
          </div>
          <div className="text-[10.5px] font-medium text-[#999999] uppercase tracking-widest">
            Detailed Step Analysis
          </div>
        </div>
        <div className="flex items-center">
          <img 
            src={LOGO_BASE64} 
            alt="Elsewedy Development" 
            className="h-10 w-auto object-contain" 
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    </div>
  );
};
