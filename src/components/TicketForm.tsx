import React, { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { WORKING_HOURS_PER_DAY } from '../constants';
import { useAuth } from '../services/AuthContext';
import { ticketService, MAX_ATTACHMENTS, MAX_ATTACHMENT_CHARS, dataUrlLength, formatMB } from '../services/ticketService';
import { refData, useRefStore } from '../services/refData';
import { Priority, WorkflowRequest } from '../types';
import { motion } from 'motion/react';
import { Send, Paperclip, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { crmService } from './crm/crmService';

// Only raster images are previewed inline (SVG excluded: it can carry script).
const isSafeImage = (at: string) => typeof at === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(at);
const PRIORITIES: Priority[] = ['Critical', 'High', 'Medium', 'Low'];
const CONTACT_LIST_LIMIT = 50;

interface TicketFormProps {
  onSuccess: () => void;
}

interface Attached { name: string; data: string }

/** hours a workflow ticket is given: the server uses total SLA + buffer, counted from the moment of submission */
const workflowHours = (w?: WorkflowRequest) => (w ? (Number(w.totalSLA) || 0) + (Number(w.maxBufferHours) || 0) : 0);

export const TicketForm: React.FC<TicketFormProps> = ({ onSuccess }) => {
  const { user } = useAuth();
  // The form renders at once. These lists come from the shared cache (instant when warm) and fill the selectors in.
  const cats = useRefStore(refData.categories);
  const slas = useRefStore(refData.sla);
  const wfs = useRefStore(refData.workflows);
  const categories = cats.data ?? [];
  const slaConfigs = slas.data ?? [];
  const workflows = useMemo(() => (wfs.data ?? []).filter(wf => wf.status === 'Finalized'), [wfs.data]);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: '',
    subtype: '',
    priority: 'Medium' as Priority,
    workflowId: '',
    department: undefined as string | undefined,
    crmContactId: '',
    crmContactName: ''
  });
  // what the chosen workflow filled in, so that un-choosing it removes exactly that and nothing the user typed
  const wfFilled = useRef<{ title: string; description: string } | null>(null);

  const [attachments, setAttachments] = useState<Attached[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // Searchable CRM contact dropdown (the contact list is read only when it is opened)
  const [isContactDropdownOpen, setIsContactDropdownOpen] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState('');
  const contactBox = useRef<HTMLDivElement>(null);
  const contacts = useMemo(() => {
    if (!isContactDropdownOpen && !formData.crmContactId) return [];
    try { return crmService.getContacts() || []; } catch (err) { console.error('Failed to read CRM contacts:', err); return []; }
  }, [isContactDropdownOpen, formData.crmContactId]);
  const filteredContacts = useMemo(() => {
    if (!isContactDropdownOpen) return [];
    const q = contactSearchQuery.trim().toLowerCase();
    const out = [];
    for (const c of contacts) {
      if (!q || (c.name || '').toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q)) {
        out.push(c);
        if (out.length >= CONTACT_LIST_LIMIT) break;
      }
    }
    return out;
  }, [contacts, contactSearchQuery, isContactDropdownOpen]);

  // close the contact list on an outside click or Escape
  useEffect(() => {
    if (!isContactDropdownOpen) return;
    const onDown = (e: MouseEvent) => { if (contactBox.current && !contactBox.current.contains(e.target as Node)) setIsContactDropdownOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsContactDropdownOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [isContactDropdownOpen]);

  // Pre-select the first category as soon as the list arrives (never over a choice the user or a workflow made)
  useEffect(() => {
    if (categories.length === 0) return;
    setFormData(prev => (prev.type || prev.workflowId ? prev : { ...prev, type: categories[0].type, subtype: categories[0].subtype }));
  }, [categories]);

  const selectedWorkflow = useMemo(() => workflows.find(w => w.id === formData.workflowId), [workflows, formData.workflowId]);

  const handleWorkflowSelect = (workflowId: string) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (workflow) {
      wfFilled.current = { title: workflow.title, description: workflow.description };
      setFormData(prev => ({
        ...prev,
        workflowId,
        title: workflow.title,
        description: workflow.description,
        type: workflow.department, // department is the type of a workflow ticket
        subtype: 'Workflow Process',
        department: workflow.department
      }));
    } else {
      const filled = wfFilled.current;
      wfFilled.current = null;
      setFormData(prev => ({
        ...prev,
        workflowId: '',
        department: undefined,
        // back to a standard ticket: first category again, and drop the text only if the user did not change it
        type: categories[0]?.type || '',
        subtype: categories[0]?.subtype || '',
        title: filled && prev.title === filled.title ? '' : prev.title,
        description: filled && prev.description === filled.description ? '' : prev.description,
      }));
    }
  };

  const attachedChars = attachments.reduce((n, a) => n + a.data.length, 0);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-picking the same file
    let count = attachments.length;
    let chars = attachedChars;
    const accepted: File[] = [];
    for (const file of files) {
      if (count >= MAX_ATTACHMENTS) { toast.error(`At most ${MAX_ATTACHMENTS} attachments per ticket.`); break; }
      const len = dataUrlLength(file.size, file.type);
      if (chars + len > MAX_ATTACHMENT_CHARS) {
        toast.error(`"${file.name}" does not fit: attachments may total about ${formatMB(MAX_ATTACHMENT_CHARS)} (this ticket already has ${formatMB(chars)}).`);
        continue;
      }
      count++; chars += len;
      accepted.push(file);
    }
    const read = (file: File) => new Promise<Attached | null>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? { name: file.name, data: reader.result } : null);
      reader.onerror = () => { toast.error(`Could not read "${file.name}".`); resolve(null); };
      reader.readAsDataURL(file);
    });
    const done = (await Promise.all(accepted.map(read))).filter((x): x is Attached => !!x);
    if (done.length) setAttachments(prev => [...prev, ...done]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isSubmitting) return;
    if (!formData.workflowId && categories.length > 0 && (!formData.type || !formData.subtype)) {
      setStatus({ type: 'error', message: 'Choose a type and a sub-type.' });
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    try {
      // department from the category when no workflow decides it (a workflow ticket's department is set by the server)
      let finalDepartment = formData.department;
      if (!formData.workflowId) {
        const category = categories.find(c => c.type === formData.type && c.subtype === formData.subtype);
        if (category?.department) finalDepartment = category.department;
      }

      await ticketService.createTicket({
        title: formData.title.trim(),
        description: formData.description.trim(),
        type: formData.type,
        subtype: formData.subtype,
        priority: formData.priority,
        workflowId: formData.workflowId,
        department: finalDepartment,
        crmContactId: formData.crmContactId,
        crmContactName: formData.crmContactName,
        attachments: attachments.map(a => a.data),
      });

      toast.success('Ticket created');
      onSuccess();
    } catch (err: any) {
      console.error('Failed to create ticket:', err);
      setStatus({ type: 'error', message: `Failed to create ticket: ${err.message || 'Unknown error'}` });
      setIsSubmitting(false);
    }
  };

  const types = Array.from(new Set(categories.map(c => c.type)));
  const subtypes = categories.filter(c => c.type === formData.type).map(c => c.subtype);
  const slaHours = (p: string) => slaConfigs.find(s => s.priority === p)?.hours;
  // "…" while the SLA table is still arriving, "n/a" only when it arrived and has no value for this priority
  const slaLabel = (p: string) => {
    const h = slaHours(p);
    if (h && h > 0) return `${h}h`;
    return slas.data ? 'n/a' : '…';
  };
  const wfH = workflowHours(selectedWorkflow);
  const catsLoading = !cats.data && !cats.error;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-brand-black">Create New Ticket</h2>
        <p className="text-brand-gray text-sm">Send a request to the service desk. Choose a workflow template if your request follows a defined process.</p>
      </div>

      <motion.form 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={handleSubmit} 
        className="bento-card space-y-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {(cats.error && !cats.data) && (
            <div className="col-span-2 p-4 rounded-xl border bg-amber-50 border-amber-200 text-amber-800 flex items-center gap-3" role="alert">
              <AlertCircle size={20} />
              <p className="text-sm font-medium flex-1">Could not load the categories: {cats.error}</p>
              <button type="button" onClick={() => { refData.categories.load({ force: true }).catch(() => {}); refData.sla.load({ force: true }).catch(() => {}); }}
                className="flex items-center gap-1 text-xs font-bold text-amber-900 hover:underline"><RefreshCw size={14} /> Retry</button>
            </div>
          )}
          {status && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className={`col-span-2 p-4 rounded-xl border flex items-center gap-3 ${
                status.type === 'success' 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {status.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
              <p className="text-sm font-medium">{status.message}</p>
            </motion.div>
          )}
          <div className="col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold mb-2">Workflow Template (Optional)</label>
              <select 
                className="input-field bg-brand-red/5 border-brand-red/20"
                value={formData.workflowId}
                onChange={e => handleWorkflowSelect(e.target.value)}
              >
                <option value="">None - Standard Ticket</option>
                {workflows.map(w => {
                  const h = workflowHours(w);
                  return <option key={w.id} value={w.id}>{w.title} (SLA: {h > 0 ? `${h}h` : 'n/a'})</option>;
                })}
              </select>
              {!wfs.data && !wfs.error && <p className="text-[11px] text-brand-gray mt-1">Loading templates…</p>}
              {selectedWorkflow && (
                <p className="text-[11px] text-brand-gray mt-1">
                  {wfH > 0
                    ? `The deadline is set by the workflow: ${wfH} h after you submit (about ${Math.ceil(wfH / WORKING_HOURS_PER_DAY)} working days of ${WORKING_HOURS_PER_DAY} h, including the buffer).`
                    : 'This workflow has no total SLA, so the ticket gets no workflow deadline.'}
                </p>
              )}
            </div>

            <div className="relative" ref={contactBox}>
              <label className="block text-sm font-bold mb-2">CRM Contact Association (Optional)</label>
              <div 
                className="input-field bg-brand-black/5 border-brand-black/10 flex items-center justify-between cursor-pointer min-h-[44px]"
                onClick={() => setIsContactDropdownOpen(!isContactDropdownOpen)}
              >
                <span className="truncate">
                  {formData.crmContactName ? `${formData.crmContactName} (${contacts.find(c => c.id === formData.crmContactId)?.company || 'Private'})` : 'Select CRM Contact...'}
                </span>
                <span className="text-brand-gray text-xs">▼</span>
              </div>
              
              {isContactDropdownOpen && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-brand-gray/20 rounded-xl shadow-xl p-3 space-y-2">
                  <input
                    type="text"
                    placeholder="Search contacts..."
                    value={contactSearchQuery}
                    onChange={e => setContactSearchQuery(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-lg px-3 py-1.5 text-xs focus:outline-none"
                    autoFocus
                  />
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    <div
                      onClick={() => {
                        setFormData(prev => ({
                          ...prev,
                          crmContactId: '',
                          crmContactName: ''
                        }));
                        setIsContactDropdownOpen(false);
                        setContactSearchQuery('');
                      }}
                      className="px-2 py-1.5 hover:bg-brand-gray/10 rounded cursor-pointer text-xs font-semibold text-brand-gray"
                    >
                      None - No CRM Contact
                    </div>
                    {filteredContacts.map(c => (
                        <div
                          key={c.id}
                          onClick={() => {
                            setFormData(prev => ({
                              ...prev,
                              crmContactId: c.id,
                              crmContactName: c.name
                            }));
                            setIsContactDropdownOpen(false);
                            setContactSearchQuery('');
                          }}
                          className="px-2 py-1.5 hover:bg-brand-red/5 hover:text-brand-red rounded cursor-pointer text-xs flex justify-between"
                        >
                          <span className="font-bold">{c.name}</span>
                          <span className="text-[10px] text-brand-gray">{c.company || 'Private'}</span>
                        </div>
                      ))}
                    {filteredContacts.length === 0 && <p className="px-2 py-1.5 text-xs text-brand-gray">No contact found.</p>}
                    {filteredContacts.length >= CONTACT_LIST_LIMIT && <p className="px-2 py-1.5 text-[10px] text-brand-gray">Showing the first {CONTACT_LIST_LIMIT}: type to narrow the list.</p>}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="col-span-2">

            {formData.workflowId && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-4 overflow-hidden"
              >
                <div className="bg-white border border-brand-red/20 rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-brand-red/5 px-4 py-2 border-b border-brand-red/10">
                    <h5 className="text-[10px] font-bold text-brand-red uppercase tracking-wider">Workflow Steps Preview</h5>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-brand-light/50 border-b border-black/5">
                          <th className="px-4 py-2 font-bold text-brand-black">Step</th>
                          <th className="px-4 py-2 font-bold text-brand-black">Description</th>
                          <th className="px-4 py-2 font-bold text-brand-black">Department</th>
                          <th className="px-4 py-2 font-bold text-brand-black">SLA</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5">
                        {(workflows.find(w => w.id === formData.workflowId)?.steps || []).map((step, idx) => (
                          <tr key={step.id} className="hover:bg-brand-light/30 transition-colors">
                            <td className="px-4 py-3 font-medium text-brand-black">
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-red/10 text-brand-red text-[10px] font-bold mr-2">
                                {idx + 1}
                              </span>
                              {step.name}
                            </td>
                            <td className="px-4 py-3 text-brand-gray">{step.description}</td>
                            <td className="px-4 py-3">
                              <span className="bg-brand-black/5 px-2 py-0.5 rounded text-[10px] font-bold text-brand-black">
                                {step.responsibleRole}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-bold text-brand-red">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-xs">{step.sla != null ? `${step.sla} ${step.slaUnit === 'Days' ? 'd' : 'h'}` : 'n/a'}</span>
                                {step.hasRequirements && step.requirements && (
                                  <span className="text-[10.5px] text-[#A6192E] font-medium block truncate max-w-[120px]" title={step.requirements}>
                                    Req: {step.requirements}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-bold mb-2">Subject</label>
            <input 
              className="input-field" 
              placeholder="Brief summary of the issue"
              maxLength={200}
              value={formData.title || ''}
              onChange={e => setFormData({...formData, title: e.target.value})}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-bold mb-2">Type</label>
            {formData.workflowId ? (
              <input className="input-field" value={formData.type} disabled readOnly aria-label="Type (set by the workflow)" />
            ) : (
            <select 
              className="input-field"
              value={formData.type || ''}
              disabled={catsLoading}
              onChange={e => {
                const newType = e.target.value;
                const firstSubtype = categories.find(c => c.type === newType)?.subtype || '';
                setFormData({...formData, type: newType, subtype: firstSubtype});
              }}
            >
              <option value="" disabled>{catsLoading ? 'Loading…' : 'Select Type'}</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold mb-2">Sub-Type</label>
            {formData.workflowId ? (
              <input className="input-field" value={formData.subtype} disabled readOnly aria-label="Sub-type (set by the workflow)" />
            ) : (
            <select 
              className="input-field"
              value={formData.subtype || ''}
              onChange={e => setFormData({...formData, subtype: e.target.value})}
              disabled={!formData.type}
            >
              <option value="" disabled>{catsLoading ? 'Loading…' : 'Select Sub-Type'}</option>
              {subtypes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold mb-2">Priority</label>
            <select 
              className="input-field"
              value={formData.priority || 'Medium'}
              onChange={e => setFormData({...formData, priority: e.target.value as Priority})}
            >
              {PRIORITIES.map(p => (
                <option key={p} value={p}>{formData.workflowId ? p : `${p} (SLA: ${slaLabel(p)})`}</option>
              ))}
            </select>
            <p className="text-[11px] text-brand-gray mt-1">
              {formData.workflowId
                ? 'With a workflow the deadline comes from the workflow, not from the priority.'
                : 'The SLA clock stops while the ticket is "Waiting on User" or "Waiting on Vendor".'}
            </p>
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-bold mb-2">Description</label>
            <textarea 
              className="input-field min-h-[150px] py-3" 
              placeholder="Please provide as much detail as possible..."
              maxLength={10000}
              value={formData.description || ''}
              onChange={e => setFormData({...formData, description: e.target.value})}
              required
            />
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-bold mb-2">
              Attachments <span className="font-normal text-brand-gray text-xs">(up to {MAX_ATTACHMENTS} files, about {formatMB(MAX_ATTACHMENT_CHARS)} in total{attachments.length > 0 ? `; used ${formatMB(attachedChars)}` : ''})</span>
            </label>
            <div className="flex flex-wrap gap-4">
              {attachments.length < MAX_ATTACHMENTS && (
                <label className="w-24 h-24 border-2 border-dashed border-brand-black/10 rounded-xl flex flex-col items-center justify-center text-brand-gray hover:border-brand-red hover:text-brand-red transition-all cursor-pointer">
                  <Paperclip size={24} />
                  <span className="text-[10px] mt-1 font-bold">ADD FILE</span>
                  <input type="file" multiple className="hidden" onChange={handleFileChange} />
                </label>
              )}
              {attachments.map((at, i) => (
                <div key={i} className="w-24 h-24 rounded-xl border border-black/5 overflow-hidden relative group" title={at.name}>
                  {isSafeImage(at.data) ? (
                    <img src={at.data} alt={at.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-brand-light text-brand-gray px-1">
                      <Paperclip size={20} />
                      <span className="text-[10.5px] font-medium break-all line-clamp-2 text-center">{at.name}</span>
                    </div>
                  )}
                  <button 
                    type="button"
                    onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                    aria-label={`Remove attachment ${at.name}`}
                    className="absolute inset-0 bg-brand-red/80 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all flex items-center justify-center font-bold text-xs"
                  >
                    REMOVE
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-black/5 flex justify-end">
          <button 
            type="submit" 
            disabled={isSubmitting || (catsLoading && !formData.workflowId)}
            className="btn-primary flex items-center gap-2 px-8 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            {isSubmitting ? 'Submitting...' : 'Submit Ticket'}
          </button>
        </div>
      </motion.form>
    </div>
  );
};
