import React, { useState, useEffect } from 'react';
import { Ticket, TicketStatus, User, Category, SLAConfig } from '../types';
import { adminService } from '../services/adminService';
import { STATUS_COLORS, PRIORITY_COLORS } from '../constants';
import { ticketService, isAttachmentStub, isTicketStripped } from '../services/ticketService';
import { useAuth } from '../services/AuthContext';
import { 
  ArrowLeft, 
  Clock, 
  User as UserIcon, 
  MapPin, 
  MessageSquare, 
  History,
  CheckCircle2,
  Lock,
  ExternalLink,
  Star,
  Plus,
  Paperclip,
  Edit2,
  Trash2,
  Loader2,
  Circle,
  PlayCircle,
  ChevronDown,
  ChevronUp,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { crmService } from './crm/crmService';
import { Contact } from './crm/types';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
// Only these image types are ever rendered inline / opened in a tab (no SVG: it can carry script).
const SAFE_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i;
const SAFE_PDF_RE = /^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/i;
const isSafeImage = (at: string) => typeof at === 'string' && SAFE_IMAGE_RE.test(at);

// Opens an attachment without ever writing user data into a document: images / PDFs open as a blob
// in a new tab (noopener), anything else is downloaded as an opaque binary file.
const openAttachment = (at: string, index: number) => {
  try {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(at || '');
    if (!m || !m[2]) {
      toast.error('This attachment cannot be opened.');
      return;
    }
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const viewable = isSafeImage(at) || SAFE_PDF_RE.test(at);
    const blob = new Blob([bytes], { type: viewable ? m[1] : 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    if (viewable) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = `attachment-${index + 1}`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    toast.error('This attachment could not be opened.');
  }
};

interface TicketDetailProps {
  ticket: Ticket;
  onBack: () => void;
  onUpdate: () => void;
}

export const TicketDetail: React.FC<TicketDetailProps> = ({ ticket, onBack, onUpdate }) => {
  const { user } = useAuth();
  const [localTicket, setLocalTicket] = useState<Ticket>(ticket);
  const [selectedCrmContact, setSelectedCrmContact] = useState<Contact | null>(null);
  const [crmContactLeads, setCrmContactLeads] = useState<any[]>([]);
  const [note, setNote] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [rating, setRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [updateAttachments, setUpdateAttachments] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [showWorkflowSteps, setShowWorkflowSteps] = useState(true);
  const [stepNote, setStepNote] = useState('');
  const [completingStepId, setCompletingStepId] = useState<string | null>(null);
  const [editHeaderData, setEditHeaderData] = useState({ type: ticket.type, subtype: ticket.subtype });
  const [categories, setCategories] = useState<Category[]>([]);
  const [slaConfigs, setSlaConfigs] = useState<SLAConfig[]>([]);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<TicketStatus | null>(null);
  const [statusReason, setStatusReason] = useState('');

  // the list sends tickets without file data: load the full ticket (attachments included) for this view
  useEffect(() => {
    setLocalTicket(ticket);
    if (!isTicketStripped(ticket)) return;
    let cancelled = false;
    ticketService.getTicket(ticket.id)
      .then(full => { if (!cancelled) setLocalTicket(full); })
      .catch(err => console.warn('Could not load the full ticket', err));
    return () => { cancelled = true; };
  }, [ticket]);

  // opens an attachment; if it is still a list stub, fetch the full ticket first and open the real file
  const openAtt = async (at: string, index: number, entryId?: string) => {
    if (!isAttachmentStub(at)) return openAttachment(at, index);
    try {
      const full = await ticketService.getTicket(localTicket.id);
      setLocalTicket(full);
      const list = entryId ? full.history?.find(h => h.id === entryId)?.attachments : full.attachments;
      const real = list?.[index];
      if (!real || isAttachmentStub(real)) { toast.error('This attachment could not be opened.'); return; }
      openAttachment(real, index);
    } catch (err: any) {
      toast.error(err?.message || 'This attachment could not be opened.');
    }
  };

  React.useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    let cancelled = false;
    const loadData = async () => {
      try {
        const [cats, slas] = await Promise.all([
          adminService.getCategories(),
          adminService.getSLA()
        ]);
        if (cancelled) return;
        setCategories(cats);
        setSlaConfigs(slas);
      } catch (err) {
        if (!cancelled) toast.error('Could not load categories / SLA settings. Category and priority changes may be unavailable.');
      }
    };
    loadData();
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Escape closes whichever modal / side panel is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showReasonModal) { setShowReasonModal(false); setStatusReason(''); }
      else if (showDeleteModal && !isUpdating) setShowDeleteModal(false);
      else if (selectedCrmContact) setSelectedCrmContact(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showReasonModal, showDeleteModal, selectedCrmContact, isUpdating]);

  const slaStats = React.useMemo(() => {
    const deadline = new Date(localTicket.slaDeadline).getTime();
    const created = new Date(localTicket.createdAt).getTime();
    
    let now: number;
    if (localTicket.status === 'Resolved' || localTicket.status === 'Closed') {
      now = new Date(localTicket.resolvedAt || localTicket.updatedAt).getTime();
    } else if (localTicket.slaPausedAt) {
      now = new Date(localTicket.slaPausedAt).getTime();
    } else {
      now = currentTime.getTime();
    }
    
    const total = deadline - created;
    const remaining = deadline - now;
    // total <= 0 (missing / invalid dates) -> no bar rather than NaN
    const progress = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
    
    const absRemaining = Number.isFinite(remaining) ? Math.abs(remaining) : 0;
    const hours = Math.floor(absRemaining / (1000 * 60 * 60));
    const minutes = Math.floor((absRemaining % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((absRemaining % (1000 * 60)) / 1000);
    
    let color = 'bg-emerald-500';
    let textColor = 'text-emerald-600';
    
    if (!Number.isFinite(remaining) || remaining <= 0) {
      color = 'bg-brand-red';
      textColor = 'text-brand-red';
    } else if (remaining <= 1000 * 60 * 60) { // 1 hour left
      color = 'bg-brand-red';
      textColor = 'text-brand-red';
    } else if (remaining <= total / 2) { // Half time left
      color = 'bg-amber-400';
      textColor = 'text-amber-600';
    }
    
    return { progress, hours, minutes, seconds, color, textColor, remaining, isOverdue: Number.isFinite(remaining) && remaining <= 0, valid: Number.isFinite(remaining) };
  }, [localTicket.slaDeadline, localTicket.createdAt, localTicket.status, localTicket.resolvedAt, localTicket.updatedAt, currentTime]);

  const handleStatusChange = async (newStatus: TicketStatus, reason?: string) => {
    if (!user) return;
    
    // If changing to Waiting on User, prompt for reason if not provided
    if (newStatus === 'Waiting on User' && !reason) {
      setPendingStatus(newStatus);
      setShowReasonModal(true);
      return;
    }

    const previousStatus = localTicket.status;
    setLocalTicket(prev => ({ ...prev, status: newStatus }));
    
    setIsUpdating(true);
    try {
      const noteToUse = reason ? `Reason for Wait: ${reason}` : note;
      const result = await ticketService.updateTicket(localTicket.id, { 
        status: newStatus,
        history: [{
          id: '',
          action: `Status changed to ${newStatus}`,
          actor: user.email,
          date: new Date().toISOString(),
          note: noteToUse || undefined,
          isInternal: isInternal
        }]
      }, user.email, localTicket, slaConfigs);
      setLocalTicket(result);
      setNote('');
      setStatusReason('');
      setShowReasonModal(false);
      onUpdate();
    } catch (err: any) {
      setLocalTicket(prev => ({ ...prev, status: previousStatus }));
      toast.error(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handlePriorityChange = async (newPriority: any) => {
    if (!user) return;
    setIsUpdating(true);
    try {
      const result = await ticketService.updateTicket(localTicket.id, {
        priority: newPriority,
        history: [{
          id: '',
          action: 'Priority Updated',
          actor: user.email,
          date: new Date().toISOString(),
          note: `Priority changed from ${localTicket.priority} to ${newPriority}`
        }]
      }, user.email, localTicket, slaConfigs);
      setLocalTicket(result);
      setIsEditingPriority(false);
      onUpdate();
    } catch (err: any) {
      toast.error(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleFeedbackSubmit = async () => {
    if (!user || rating === 0) return;
    setIsUpdating(true);
    try {
      await ticketService.updateTicket(localTicket.id, {
        feedback: {
          rating,
          comment: feedbackComment,
          date: new Date().toISOString()
        }
      }, user.email);
      toast.success('Thank you for your feedback.');
      onUpdate();
    } catch (err: any) {
      toast.error(err?.message || 'Could not submit feedback.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleClaim = async () => {
    if (!user) return;
    
    setLocalTicket(prev => ({ ...prev, assignedTo: user.id, assignedToName: user.name, status: 'In Progress' }));
    
    setIsUpdating(true);
    try {
      const result = await ticketService.updateTicket(localTicket.id, { 
        assignedTo: user.id,
        assignedToName: user.name,
        status: 'In Progress'
      }, user.email, localTicket, slaConfigs);
      setLocalTicket(result);
      onUpdate();
    } catch (err: any) {
      onUpdate(); // Revert by re-fetching
      toast.error(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!user || user.role !== 'Admin') return;
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!user || user.role !== 'Admin') return;
    
    setIsUpdating(true);
    try {
      await ticketService.deleteTicket(localTicket.id, user.id.toString(), user.name);
      onUpdate();
      onBack();
    } catch (err: any) {
      toast.error(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsUpdating(false);
      setShowDeleteModal(false);
    }
  };

  const handleAddNote = async () => {
    if (!user || (!note && updateAttachments.length === 0)) return;
    setIsUpdating(true);
    try {
      await ticketService.updateTicket(localTicket.id, {
        attachments: [...localTicket.attachments, ...updateAttachments],
        history: [{
          id: '',
          action: isInternal ? 'Internal Note Added' : 'Public Note Added',
          actor: user.email,
          date: new Date().toISOString(),
          note: note,
          isInternal: isInternal,
          attachments: updateAttachments
        }]
      }, user.email);
      setNote('');
      setUpdateAttachments([]);
      onUpdate();
    } catch (err: any) {
      toast.error(err?.message || 'Could not post the update.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleHeaderUpdate = async () => {
    if (!user) return;
    setIsUpdating(true);
    try {
      const result = await ticketService.updateTicket(localTicket.id, {
        type: editHeaderData.type,
        subtype: editHeaderData.subtype,
        history: [{
          id: '',
          action: 'Ticket Category Updated',
          actor: user.email,
          date: new Date().toISOString(),
          note: `Changed to ${editHeaderData.type} / ${editHeaderData.subtype}`
        }]
      }, user.email, localTicket, slaConfigs);
      setLocalTicket(result);
      setIsEditingHeader(false);
      onUpdate();
    } catch (err: any) {
      toast.error(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCompleteStep = async (stepId: string) => {
    if (!user) return;
    setIsUpdating(true);
    try {
      const updated = await ticketService.completeStep(localTicket.id, stepId, user.email, user.name, stepNote);
      setLocalTicket(updated);
      setStepNote('');
      setCompletingStepId(null);
      onUpdate();
    } catch (err: any) {
      toast.error(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleViewCrmContact = (contactId?: string) => {
    if (!contactId) return;
    const allContacts = crmService.getContacts();
    const foundContact = allContacts.find(c => c.id === contactId);
    if (foundContact) {
      setSelectedCrmContact(foundContact);
      const allLeads = crmService.getLeads();
      const associatedLeads = allLeads.filter(l => l.phoneNumber === foundContact.phoneNumber);
      setCrmContactLeads(associatedLeads);
    } else {
      toast.error("CRM Contact not found or may have been deleted.");
    }
  };
  const handleUpdateFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error('File size must be less than 5 MB');
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const data = ev.target?.result;
        if (typeof data === 'string') setUpdateAttachments(prev => [...prev, data]);
      };
      reader.onerror = () => toast.error('Could not read the file.');
      reader.readAsDataURL(file);
    }
    e.target.value = ''; // allow re-picking the same file
  };

  const currentStepDepartments = localTicket.workflowSteps
    ?.filter(s => s.status === 'Current')
    .map(s => s.responsibleRole) || [];

  const canManage = user?.role === 'Admin' || 
    (user?.role === 'Technician' && (
      (!localTicket.department || localTicket.department === user.department) ||
      currentStepDepartments.includes(user.department)
    ));
  const isAssignedToMe = localTicket.assignedTo != null && user?.id != null && String(localTicket.assignedTo) === String(user.id);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-brand-gray hover:text-brand-black transition-colors font-medium">
        <ArrowLeft size={18} /> Back to List
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6 order-2 lg:order-1">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bento-card">
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <p className="text-[10px] font-bold text-brand-red">{localTicket.id}</p>
                  {user?.role === 'Admin' && (
                    <button 
                      onClick={handleDelete}
                      disabled={isUpdating}
                      className="p-1 text-brand-gray hover:text-brand-red transition-colors"
                      title="Delete Ticket"
                      aria-label="Delete ticket"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-brand-black">{localTicket.title}</h2>
                <div className="mt-2 flex items-center gap-2">
                  {isEditingHeader ? (
                    <div className="flex gap-2 items-center">
                      <select 
                        className="text-xs p-1 border rounded"
                        value={editHeaderData.type}
                        onChange={e => {
                          const newType = e.target.value;
                          const firstSub = categories.find(c => c.type === newType)?.subtype || '';
                          setEditHeaderData({ type: newType, subtype: firstSub });
                        }}
                      >
                        {Array.from(new Set(categories.map(c => c.type))).map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <select 
                        className="text-xs p-1 border rounded"
                        value={editHeaderData.subtype}
                        onChange={e => setEditHeaderData({ ...editHeaderData, subtype: e.target.value })}
                      >
                        {categories.filter(c => c.type === editHeaderData.type).map(c => <option key={c.subtype} value={c.subtype}>{c.subtype}</option>)}
                      </select>
                      <button onClick={handleHeaderUpdate} className="text-[10px] font-bold text-emerald-600">SAVE</button>
                      <button onClick={() => setIsEditingHeader(false)} className="text-[10px] font-bold text-brand-gray">CANCEL</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-brand-gray font-medium">{localTicket.type} / {localTicket.subtype}</p>
                      <button onClick={() => setIsEditingHeader(true)} className="p-1 text-brand-gray hover:text-brand-black transition-all">
                        <Edit2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
                <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 w-full sm:w-auto">
                  <span className={`flex-1 sm:flex-none text-center px-3 py-1 rounded-xl text-[10px] font-bold border ${STATUS_COLORS[localTicket.status]}`}>
                    {localTicket.status.toUpperCase()}
                  </span>
                  {isEditingPriority ? (
                    <div className="flex items-center gap-1">
                      <select 
                        className="text-[10px] font-bold p-1 border rounded bg-white"
                        value={localTicket.priority}
                        onChange={(e) => handlePriorityChange(e.target.value)}
                      >
                        <option value="Low">LOW</option>
                        <option value="Medium">MEDIUM</option>
                        <option value="High">HIGH</option>
                        <option value="Critical">CRITICAL</option>
                      </select>
                      <button onClick={() => setIsEditingPriority(false)} className="text-[10px] text-brand-gray font-bold">X</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className={`flex-1 sm:flex-none text-center px-3 py-1 rounded-xl text-[10px] font-bold border ${PRIORITY_COLORS[localTicket.priority]}`}>
                        {localTicket.priority.toUpperCase()}
                      </span>
                      {canManage && (
                        <button onClick={() => setIsEditingPriority(true)} className="p-1 text-brand-gray hover:text-brand-black transition-all">
                          <Edit2 size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-8 p-4 bg-brand-light rounded-2xl border border-black/5">
              <div className="flex items-center gap-2 min-w-0">
                <UserIcon size={16} className="text-brand-gray shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-brand-gray font-bold uppercase">Requester</p>
                  <p className="text-xs font-medium truncate" title={localTicket.requesterEmail}>{localTicket.requesterEmail}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-brand-gray" />
                <div>
                  <p className="text-[10px] text-brand-gray font-bold uppercase">Created</p>
                  <p className="text-xs font-medium">{localTicket.createdAt && !isNaN(new Date(localTicket.createdAt).getTime()) ? new Date(localTicket.createdAt).toLocaleDateString() : '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <History size={16} className="text-brand-gray" />
                <div>
                  <p className="text-[10px] text-brand-gray font-bold uppercase">Last Update</p>
                  <p className="text-xs font-medium">{localTicket.updatedAt && !isNaN(new Date(localTicket.updatedAt).getTime()) ? new Date(localTicket.updatedAt).toLocaleDateString() : '—'}</p>
                </div>
              </div>
              {localTicket.crmContactName && (
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 font-bold text-[10.5px] shrink-0">
                    CRM
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-brand-gray font-bold uppercase">CRM Contact</p>
                    <button 
                      onClick={() => handleViewCrmContact(localTicket.crmContactId)} 
                      className="text-xs font-bold text-brand-red hover:underline hover:text-brand-red-dark truncate text-left block" 
                      title="View Contact Details"
                    >
                      {localTicket.crmContactName}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="prose prose-sm max-w-none mb-8">
              <h4 className="text-sm font-bold text-brand-black mb-2 uppercase tracking-wider">Description</h4>
              <p className="text-brand-gray whitespace-pre-wrap leading-relaxed">{localTicket.description}</p>
            </div>

            {/* Workflow Progress */}
            {localTicket.workflowSteps && localTicket.workflowSteps.length > 0 && (
              <div className="mb-8 p-6 bg-brand-red/5 rounded-2xl border border-brand-red/10">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-brand-red text-white flex items-center justify-center">
                      <History size={18} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-brand-black uppercase tracking-wider">Workflow Progress</h4>
                      <p className="text-[10px] text-brand-gray font-bold">
                        {localTicket.workflowSteps.filter(s => s.status === 'Completed').length} of {localTicket.workflowSteps.length} steps completed
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowWorkflowSteps(!showWorkflowSteps)}
                    aria-label={showWorkflowSteps ? 'Collapse workflow steps' : 'Expand workflow steps'}
                    aria-expanded={showWorkflowSteps}
                    className="p-2 hover:bg-brand-red/10 rounded-full transition-colors"
                  >
                    {showWorkflowSteps ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </button>
                </div>

                {/* Overall Progress Bar */}
                <div className="mb-8">
                  <div className="h-2 w-full bg-brand-red/10 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${(localTicket.workflowSteps.filter(s => s.status === 'Completed').length / localTicket.workflowSteps.length) * 100}%` }}
                      className="h-full bg-brand-red"
                    />
                  </div>
                </div>

                {showWorkflowSteps && (
                  <div className="space-y-4">
                    {localTicket.workflowSteps.map((step, idx) => (
                      <div key={step.id} className="flex gap-4 relative">
                        {idx !== localTicket.workflowSteps!.length - 1 && (
                          <div className={`absolute left-3 top-8 bottom-0 w-0.5 ${step.status === 'Completed' ? 'bg-emerald-500' : 'bg-brand-gray/20'}`} />
                        )}
                        <div className="shrink-0 mt-1">
                          {step.status === 'Completed' ? (
                            <CheckCircle2 size={24} className="text-emerald-500" />
                          ) : step.status === 'Current' ? (
                            <PlayCircle size={24} className="text-brand-red animate-pulse" />
                          ) : (
                            <Circle size={24} className="text-brand-gray/30" />
                          )}
                        </div>
                        <div className={`flex-1 p-4 rounded-xl border transition-all ${
                          step.status === 'Current' 
                            ? 'bg-white border-brand-red shadow-md' 
                            : step.status === 'Completed'
                            ? 'bg-emerald-50/50 border-emerald-100'
                            : 'bg-brand-light/50 border-transparent opacity-60'
                        }`}>
                          <div className="flex justify-between items-start mb-1">
                            <h5 className={`font-bold text-sm ${step.status === 'Current' ? 'text-brand-red' : 'text-brand-black'}`}>
                              {step.name}
                            </h5>
                            <div className="flex items-center gap-2">
                              {step.status === 'Completed' ? (
                                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full uppercase">Completed</span>
                              ) : step.status === 'Current' ? (
                                <span className="text-[10px] font-bold text-brand-red bg-brand-red/10 px-2 py-0.5 rounded-full uppercase animate-pulse">In Progress</span>
                              ) : (
                                <span className="text-[10px] font-bold text-brand-gray bg-brand-gray/10 px-2 py-0.5 rounded-full uppercase">Pending</span>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-brand-gray mb-3">{step.description}</p>
                          
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-brand-gray uppercase">Responsible:</span>
                              <span className="text-[10px] font-bold text-brand-black bg-black/5 px-2 py-0.5 rounded">{step.responsibleRole}</span>
                            </div>
                            
                            {step.status === 'Current' && canManage && (
                              <div className="mt-4 space-y-3">
                                <textarea 
                                  className="input-field text-xs min-h-[60px] py-2"
                                  placeholder="Add a completion note (optional)..."
                                  value={stepNote}
                                  onChange={e => setStepNote(e.target.value)}
                                />
                                <button 
                                  onClick={() => handleCompleteStep(step.id)}
                                  disabled={isUpdating}
                                  className="w-full px-3 py-2 bg-brand-red text-white text-[10px] font-bold rounded-lg hover:bg-brand-red/90 transition-all active:scale-95 flex items-center justify-center gap-2"
                                >
                                  {isUpdating ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                  Complete Step
                                </button>
                              </div>
                            )}
                          </div>
                          
                          {step.completedAt && (
                            <div className="mt-2 pt-2 border-t border-emerald-100">
                              <div className="flex justify-between text-[10.5px] text-emerald-600 font-bold uppercase tracking-wider mb-1">
                                <span>Completed by {step.completedBy}</span>
                                <span>{new Date(step.completedAt).toLocaleString()}</span>
                              </div>
                              {step.note && (
                                <div className="bg-emerald-500/5 p-2 rounded-lg border border-emerald-500/10">
                                  <p className="text-[10px] text-emerald-700 italic leading-relaxed">"{step.note}"</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(localTicket.attachments?.length ?? 0) > 0 && (
              <div className="mb-8">
                <h4 className="text-sm font-bold text-brand-black mb-3 uppercase tracking-wider">Attachments</h4>
                <div className="flex flex-wrap gap-3">
                  {(localTicket.attachments || []).map((at, i) => (
                    <button 
                      key={i} 
                      onClick={() => openAtt(at, i)}
                      aria-label={`Open attachment ${i + 1}`}
                      className="w-20 h-20 rounded-lg border border-black/5 overflow-hidden hover:border-brand-red transition-all block relative group"
                    >
                      {isSafeImage(at) ? (
                        <img src={at} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-brand-light text-brand-gray">
                          <Paperclip size={24} />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white">
                        <ExternalLink size={16} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Actions for Tech/Admin */}
            {canManage && (
              <div className="pt-6 border-t border-black/5">
                <div className="p-4 bg-brand-light rounded-2xl border border-black/5 space-y-4">
                  <h4 className="text-[10px] font-bold text-brand-gray uppercase tracking-wider">Ticket Actions</h4>
                  <div className="flex flex-wrap gap-3">
                    {!localTicket.assignedTo && (
                      <button onClick={handleClaim} disabled={isUpdating} className="btn-primary">Claim Ticket</button>
                    )}
                    {isAssignedToMe && (
                      <>
                        <button 
                          onClick={() => handleStatusChange('In Progress')} 
                          disabled={isUpdating || localTicket.status === 'In Progress'} 
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition-all active:scale-95 border-2 ${
                            localTicket.status === 'In Progress' 
                              ? 'bg-brand-red/10 border-brand-red text-brand-red shadow-inner' 
                              : 'bg-white border-brand-red/20 text-brand-red/70 hover:bg-brand-red/5 hover:border-brand-red/50 hover:text-brand-red'
                          }`}
                        >
                          {isUpdating && localTicket.status !== 'In Progress' && <Loader2 size={14} className="animate-spin" />}
                          Start Work
                        </button>
                        <button 
                          onClick={() => handleStatusChange('Waiting on User')} 
                          disabled={isUpdating || localTicket.status === 'Waiting on User'} 
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition-all active:scale-95 border-2 ${
                            localTicket.status === 'Waiting on User' 
                              ? 'bg-amber-100 border-amber-500 text-amber-800 shadow-inner' 
                              : 'bg-white border-amber-500/20 text-amber-600/70 hover:bg-amber-50 hover:border-amber-500/50 hover:text-amber-700'
                          }`}
                        >
                          {isUpdating && localTicket.status !== 'Waiting on User' && <Loader2 size={14} className="animate-spin" />}
                          Wait for User
                        </button>
                        <button 
                          onClick={() => handleStatusChange('Resolved')} 
                          disabled={isUpdating || localTicket.status === 'Resolved'} 
                          className="btn-primary bg-emerald-600 hover:bg-emerald-700 flex items-center gap-2"
                        >
                          {isUpdating && localTicket.status !== 'Resolved' && <Loader2 size={14} className="animate-spin" />}
                          Resolve
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Feedback for Requester */}
            {user?.role === 'Requester' && (localTicket.status === 'Resolved' || localTicket.status === 'Closed') && !localTicket.feedback && (
              <div className="pt-6 border-t border-black/5">
                <h4 className="text-sm font-bold text-brand-black mb-4 uppercase tracking-wider">Rate our service</h4>
                <div className="flex gap-2 mb-4">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button 
                      key={star} 
                      onClick={() => setRating(star)}
                      aria-label={`${star} star${star > 1 ? 's' : ''}`}
                      className={`transition-all ${rating >= star ? 'text-amber-400' : 'text-brand-gray/30'}`}
                    >
                      <Star size={32} fill={rating >= star ? 'currentColor' : 'none'} />
                    </button>
                  ))}
                </div>
                <textarea 
                  className="input-field mb-3" 
                  placeholder="Any additional comments?"
                  value={feedbackComment}
                  onChange={e => setFeedbackComment(e.target.value)}
                />
                <button 
                  onClick={handleFeedbackSubmit} 
                  disabled={rating === 0 || isUpdating}
                  className="btn-primary"
                >
                  Submit Feedback
                </button>
              </div>
            )}

            {localTicket.feedback && (
              <div className="pt-6 border-t border-black/5">
                <h4 className="text-sm font-bold text-brand-black mb-2 uppercase tracking-wider">User Feedback</h4>
                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl">
                  <div className="flex gap-1 mb-2">
                    {[1, 2, 3, 4, 5].map(star => (
                      <Star key={star} size={16} className={localTicket.feedback!.rating >= star ? 'text-amber-400' : 'text-brand-gray/20'} fill={localTicket.feedback!.rating >= star ? 'currentColor' : 'none'} />
                    ))}
                  </div>
                  {localTicket.feedback.comment && <p className="text-sm text-emerald-900 italic">"{localTicket.feedback.comment}"</p>}
                  <p className="text-[10px] text-emerald-600 mt-2 font-bold uppercase">Submitted on {new Date(localTicket.feedback.date).toLocaleDateString()}</p>
                </div>
              </div>
            )}
          </motion.div>

          {/* Timeline / History */}
          <div className="bento-card">
            <h3 className="font-bold text-xl mb-6 flex items-center gap-2">
              <History className="text-brand-red" /> Activity Timeline
            </h3>
            <div className="space-y-6 relative before:absolute before:left-4 before:top-2 before:bottom-2 before:w-0.5 before:bg-black/5">
              {(localTicket.history || []).map((entry, i) => (
                <div key={i} className="relative pl-10">
                  <div className={`absolute left-2.5 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm ${
                    entry.action.includes('Created') ? 'bg-blue-500' : 
                    entry.action.includes('Resolved') ? 'bg-emerald-500' : 'bg-brand-gray'
                  }`} />
                  <div className="bg-brand-light p-4 rounded-xl border border-black/5">
                    <div className="flex justify-between items-start mb-1">
                      <p className="font-bold text-sm">{entry.action}</p>
                      <p className="text-[10px] text-brand-gray font-medium">{new Date(entry.date).toLocaleString()}</p>
                    </div>
                    <p className="text-xs text-brand-gray mb-2">by <span className="font-bold text-brand-black">{entry.actor}</span></p>
                    {entry.note && (
                      <div className={`p-3 rounded-lg text-sm ${entry.isInternal ? 'bg-amber-50 border border-amber-100 text-amber-800' : 'bg-white border border-black/5'}`}>
                        {entry.isInternal && <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 mb-1"><Lock size={10} /> INTERNAL NOTE</span>}
                        {entry.note}
                      </div>
                    )}
                    {entry.attachments && entry.attachments.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entry.attachments.map((at, idx) => (
                          <button 
                            key={idx} 
                            onClick={() => openAtt(at, idx, entry.id)}
                            aria-label={`Open attachment ${idx + 1}`}
                            className="w-12 h-12 rounded-lg border border-black/5 overflow-hidden hover:border-brand-red transition-all relative group"
                          >
                            {isSafeImage(at) ? (
                              <img src={at} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-white text-brand-gray">
                                <Paperclip size={16} />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white">
                              <ExternalLink size={12} />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Note Section */}
            <div className="mt-8 pt-6 border-t border-black/5">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare size={18} className="text-brand-gray" />
                <h4 className="font-bold text-sm uppercase tracking-wider">Add Update</h4>
              </div>
              <textarea 
                className="input-field min-h-[100px] mb-3" 
                placeholder="Type your update or internal note here..."
                value={note}
                onChange={e => setNote(e.target.value)}
              />
              
              {updateAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {updateAttachments.map((at, i) => (
                    <div key={i} className="w-12 h-12 rounded-lg border border-black/5 overflow-hidden relative group">
                      {isSafeImage(at) ? (
                        <img src={at} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-brand-light text-brand-gray">
                          <ExternalLink size={14} />
                        </div>
                      )}
                      <button 
                        onClick={() => setUpdateAttachments(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute inset-0 bg-brand-red/80 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] font-bold"
                      >
                        REMOVE
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  {canManage && (
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} className="rounded border-black/10 text-brand-red focus:ring-brand-red" />
                      Internal Note (Tech Only)
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-sm font-medium cursor-pointer text-brand-gray hover:text-brand-red transition-colors">
                    <Plus size={16} />
                    <span>Attach File</span>
                    <input type="file" className="hidden" onChange={handleUpdateFileChange} />
                  </label>
                </div>
                <button 
                  onClick={handleAddNote} 
                  disabled={(!note && updateAttachments.length === 0) || isUpdating}
                  className="btn-primary"
                >
                  Post Update
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6 order-1 lg:order-2">
          <div className="bento-card">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <Clock className="text-brand-red" size={18} /> SLA Tracking
            </h3>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] text-brand-gray font-bold uppercase mb-1">Target Deadline</p>
                <p className="font-bold">{localTicket.slaDeadline && !isNaN(new Date(localTicket.slaDeadline).getTime()) ? new Date(localTicket.slaDeadline).toLocaleString() : '—'}</p>
              </div>
              
              {localTicket.slaPausedAt && (
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
                  <p className="text-[10px] text-amber-700 font-bold uppercase mb-1 flex items-center gap-1">
                    <Clock size={12} /> Timer Paused
                  </p>
                  <p className="text-xs text-amber-800">SLA is currently paused because the ticket is in <b>{localTicket.status}</b> status.</p>
                </div>
              )}

              <div className="pt-4 border-t border-black/5">
                <div className="flex justify-between items-end text-xs mb-2">
                  <div>
                    <span className="font-bold block">SLA Progress</span>
                    <span className={`font-mono font-bold text-lg ${slaStats.textColor}`}>
                      {!slaStats.valid ? '—' : <>{slaStats.isOverdue ? '-' : ''}{String(slaStats.hours).padStart(2, '0')}:{String(slaStats.minutes).padStart(2, '0')}:{String(slaStats.seconds).padStart(2, '0')}</>}
                    </span>
                  </div>
                  <span className="text-brand-gray font-medium">
                    {!slaStats.valid ? 'n/a' : slaStats.isOverdue ? 'Breached' : 'Remaining'}
                  </span>
                </div>
                <div className="h-2 bg-brand-light rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-1000 ${slaStats.color}`}
                    style={{ width: `${slaStats.progress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bento-card">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <UserIcon className="text-brand-red" size={18} /> Assignment
            </h3>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] text-brand-gray font-bold uppercase mb-1">Assigned Technician</p>
                {localTicket.assignedTo ? (
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-brand-black text-white flex items-center justify-center text-xs font-bold">
                      {localTicket.assignedToName?.[0] || 'T'}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{localTicket.assignedToName || `Tech ID: ${localTicket.assignedTo}`}</p>
                      <p className="text-[10px] text-brand-gray">Technician</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-brand-gray italic">Unassigned</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Reason Modal */}
      {showReasonModal && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl"
          >
            <h3 className="text-lg font-bold mb-4">Reason for Waiting</h3>
            <p className="text-sm text-brand-gray mb-4">Please provide a reason why this ticket is being put on hold for the user.</p>
            <textarea 
              className="input-field min-h-[100px] mb-4"
              placeholder="Enter reason here..."
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
            />
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => {
                  setShowReasonModal(false);
                  setStatusReason('');
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button 
                onClick={() => handleStatusChange(pendingStatus!, statusReason)}
                disabled={!statusReason.trim() || isUpdating}
                className="btn-primary"
              >
                Confirm & Pause SLA
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl"
          >
            <div className="flex items-center gap-3 text-brand-red mb-4">
              <Trash2 size={24} />
              <h3 className="text-lg font-bold">Delete Ticket</h3>
            </div>
            <p className="text-sm text-brand-gray mb-6">
              Are you sure you want to delete ticket <span className="font-bold text-brand-black">#{localTicket.id}</span>? 
              This action cannot be undone and all history will be lost.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowDeleteModal(false)}
                disabled={isUpdating}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button 
                onClick={confirmDelete}
                disabled={isUpdating}
                className="btn-primary bg-brand-red hover:bg-red-700"
              >
                {isUpdating ? <Loader2 size={18} className="animate-spin" /> : 'Delete Permanently'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Side Pop Window for CRM Contact details */}
      <AnimatePresence>
        {selectedCrmContact && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedCrmContact(null)}
              className="fixed inset-0 bg-black z-50"
            />
            
            {/* Slide-out Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl z-50 p-6 flex flex-col overflow-y-auto"
            >
              <div className="flex justify-between items-center border-b border-brand-gray/10 pb-4 mb-6">
                <div>
                  <h3 className="text-lg font-black text-brand-black">CRM Contact File</h3>
                  <p className="text-xs text-brand-gray">Centralized Sales Information System</p>
                </div>
                <button
                  onClick={() => setSelectedCrmContact(null)}
                  aria-label="Close contact panel"
                  className="p-1.5 hover:bg-brand-gray/10 rounded-full text-brand-gray hover:text-brand-black transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6 flex-1 text-xs">
                {/* Header profile */}
                <div className="flex items-center gap-4 bg-brand-light p-4 rounded-2xl border border-black/5">
                  <div className="w-12 h-12 rounded-full bg-brand-red text-white flex items-center justify-center font-black text-xl">
                    {selectedCrmContact.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-bold text-brand-black text-sm">{selectedCrmContact.name}</h4>
                    <p className="text-[10px] uppercase font-bold text-brand-gray tracking-wider mt-0.5">
                      {selectedCrmContact.jobTitle || 'Customer'}
                    </p>
                  </div>
                </div>

                {/* Details grid */}
                <div className="space-y-3 bg-white p-4 rounded-2xl border border-brand-gray/10">
                  <h5 className="text-[10px] uppercase font-bold text-brand-gray tracking-widest border-b border-brand-gray/5 pb-1">
                    Profile Details
                  </h5>
                  
                  <div className="flex justify-between">
                    <span className="text-brand-gray font-semibold">Mobile Number:</span>
                    <span className="font-mono text-brand-black font-bold">{selectedCrmContact.phoneNumber}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-brand-gray font-semibold">Email:</span>
                    <span className="text-brand-black font-semibold">{selectedCrmContact.email || 'N/A'}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-brand-gray font-semibold">Company:</span>
                    <span className="text-brand-black font-bold">{selectedCrmContact.company || 'Private Person'}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-brand-gray font-semibold">Department:</span>
                    <span className="text-brand-black font-bold">{selectedCrmContact.department || 'N/A'}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-brand-gray font-semibold">Preferred Inbound:</span>
                    <span className="text-brand-black font-bold">{selectedCrmContact.preferredCommunication}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-brand-gray font-semibold">Preferred Language:</span>
                    <span className="text-brand-black font-semibold">{selectedCrmContact.preferredLanguage}</span>
                  </div>
                </div>

                {/* Interests (Associated Lead inquiries) */}
                <div className="space-y-3 bg-white p-4 rounded-2xl border border-brand-gray/10">
                  <h5 className="text-[10px] uppercase font-bold text-brand-gray tracking-widest border-b border-brand-gray/5 pb-1">
                    Customer Interests ({crmContactLeads.length})
                  </h5>
                  
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {crmContactLeads.map(l => {
                      let sColor = 'bg-brand-gray/10 text-brand-gray';
                      if (l.status === 'Won') sColor = 'bg-emerald-100 text-emerald-800';
                      else if (l.status === 'Lost') sColor = 'bg-rose-100 text-rose-800';
                      else if (l.status === 'New') sColor = 'bg-yellow-100 text-yellow-800';

                      return (
                        <div key={l.id} className="p-2.5 bg-brand-gray/5 border border-brand-gray/15 rounded-xl flex justify-between items-center">
                          <div>
                            <span className="font-mono font-bold text-brand-red">{l.id}</span>
                            <span className="text-brand-gray ml-2 text-[10px]">{l.project}</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold ${sColor}`}>{l.status}</span>
                        </div>
                      );
                    })}
                    {crmContactLeads.length === 0 && (
                      <p className="text-center py-2 text-brand-gray">No active sales inquiries or interests recorded.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-auto pt-4 border-t border-brand-gray/10">
                <button
                  onClick={() => setSelectedCrmContact(null)}
                  className="w-full bg-brand-black hover:bg-brand-red text-white py-3 rounded-xl font-bold transition-all text-xs shadow-md"
                >
                  Close Window
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
