import React, { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { useAuth } from '../../services/AuthContext';
import { Lead, TimelineEvent } from './types';
import { crmService } from './crmService';
import { 
  Phone, 
  Mail, 
  MessageSquare, 
  Video, 
  Clock, 
  Plus, 
  Search,
  Sparkles,
  Bookmark,
  MapPin,
  UserCheck,
  X
} from 'lucide-react';
import { motion } from 'motion/react';

interface CrmActivitiesProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string;
}

export const CrmActivities: React.FC<CrmActivitiesProps> = ({ leads, onLeadsUpdated, currentRole }) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'All' | 'Call' | 'WhatsApp' | 'Meeting' | 'Visit' | 'Email' | 'Comment' | 'Status Change'>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearch = useDeferredValue(searchTerm);   // typing stays smooth with tens of thousands of entries
  const [limit, setLimit] = useState(100);                // only the newest entries are drawn; more on request
  useEffect(() => { setLimit(100); }, [activeTab, deferredSearch]);
  const [showAddModal, setShowAddModal] = useState(false);

  // Form states
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [activityType, setActivityType] = useState<'Call' | 'Meeting' | 'Email' | 'Comment'>('Call');
  const [activityTitle, setActivityTitle] = useState('');
  const [activityDesc, setActivityDesc] = useState('');
  const [formError, setFormError] = useState('');

  // Escape closes the modal
  useEffect(() => {
    if (!showAddModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowAddModal(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAddModal]);

  const tsOf = (t: string) => { const n = new Date(t).getTime(); return Number.isFinite(n) ? n : 0; };
  const fmtTs = (t: string) => { const d = new Date(t); return Number.isFinite(d.getTime()) ? d.toLocaleString() : '—'; };

  // Extract all activity logs with their associated lead metadata
  const allActivities = useMemo(() => {
    const list: { activity: TimelineEvent; leadId: string; leadName: string; project: string; ts: number }[] = [];
    leads.forEach(l => {
      if (l.timeline) {
        l.timeline.forEach(act => {
          list.push({
            activity: act,
            leadId: l.id,
            leadName: l.customerName,
            project: l.project,
            ts: tsOf(act.timestamp),
          });
        });
      }
    });

    // Sort by timestamp descending
    return list.sort((a, b) => b.ts - a.ts);
  }, [leads]);

  // Filter activities
  const filteredActivities = useMemo(() => {
    return allActivities.filter(item => {
      const matchesTab = activeTab === 'All' || item.activity.type === activeTab;
      const q = deferredSearch.toLowerCase();
      const has = (v?: string) => (v || '').toLowerCase().includes(q);
      const matchesSearch = 
        has(item.leadName) || has(item.activity.title) || has(item.activity.description) ||
        has(item.project) || has(item.leadId);
      
      return matchesTab && matchesSearch;
    });
  }, [allActivities, activeTab, deferredSearch]);

  const handleAddActivity = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentRole === 'Read Only') { setFormError('You do not have permission to record activities.'); return; }
    if (!selectedLeadId || !activityTitle.trim()) return;

    // Re-read the stored leads so only this lead's timeline changes (props may be stale)
    const freshLeads = crmService.getLeads();
    const targetLead = freshLeads.find(l => l.id === selectedLeadId);
    if (!targetLead) {
      setFormError('Selected lead record was not found (it may have been deleted or merged).');
      return;
    }

    const newAct: TimelineEvent = {
      id: 'act_' + Math.random().toString(36).substr(2, 9),
      type: activityType,
      title: activityTitle.trim(),
      description: activityDesc.trim(),
      timestamp: new Date().toISOString(),
      user: user?.name || 'Unknown',
    };

    const updatedLeads = freshLeads.map(l => {
      if (l.id === selectedLeadId) {
        return {
          ...l,
          timeline: [newAct, ...(l.timeline || [])]
        };
      }
      return l;
    });

    crmService.saveLeads(updatedLeads);
    
    // Clear state
    setShowAddModal(false);
    setSelectedLeadId('');
    setActivityTitle('');
    setActivityDesc('');
    setFormError('');
    onLeadsUpdated();
  };

  return (
    <div className="space-y-6" id="crm-activities-root">
      
      {/* Header and Add Button */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-xl font-bold text-brand-black flex items-center gap-2">
            <span>Corporate Communications and Lead Activities</span>
            <span className="text-xs bg-brand-red/10 text-brand-red font-bold px-2.5 py-0.5 rounded-full">
              {filteredActivities.length} Logged
            </span>
          </h3>
          <p className="text-xs text-brand-gray/80 mt-1">
            Global operational ledger recording customer calls, site visits, reservation proposals, emails, and notes.
          </p>
        </div>
        
        {currentRole !== 'Read Only' && (
          <button
            onClick={() => { setFormError(''); setShowAddModal(true); }}
            className="bg-brand-red hover:bg-brand-red-dark text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow"
          >
            <Plus size={14} />
            <span>Record Activity</span>
          </button>
        )}
      </div>

      {/* Tabs and Search Bar Layout */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-xs font-bold">
        
        {/* Type filters */}
        <div className="flex flex-wrap bg-brand-gray/10 p-1.5 rounded-2xl gap-1">
          {(['All', 'Call', 'WhatsApp', 'Meeting', 'Visit', 'Email', 'Comment', 'Status Change'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3.5 py-1.5 rounded-xl transition-all ${activeTab === tab ? 'bg-white text-brand-black shadow-xs' : 'text-brand-gray hover:text-brand-black'}`}
            >
              {tab === 'Comment' ? 'Notes' : tab}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-gray" size={14} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search communications, notes, leads..."
            className="w-full pl-9 pr-4 py-2 bg-white border border-brand-gray/20 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-red text-xs"
          />
        </div>
      </div>

      {/* Activity Timeline List */}
      <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-6">
        <div className="relative border-l border-brand-gray/20 pl-6 space-y-6">
          {filteredActivities.length > 0 ? (
            filteredActivities.slice(0, limit).map((item) => {
              let IconComponent = Bookmark;
              let iconColor = 'bg-brand-gray/10 text-brand-gray';

              if (item.activity.type === 'Call') {
                IconComponent = Phone;
                iconColor = 'bg-blue-100 text-blue-700';
              } else if (item.activity.type === 'Meeting') {
                IconComponent = Video;
                iconColor = 'bg-emerald-100 text-emerald-800';
              } else if (item.activity.type === 'Email') {
                IconComponent = Mail;
                iconColor = 'bg-indigo-100 text-indigo-800';
              } else if (item.activity.type === 'Comment') {
                IconComponent = MessageSquare;
                iconColor = 'bg-purple-100 text-purple-800';
              } else if (item.activity.type === 'WhatsApp') {
                IconComponent = MessageSquare;
                iconColor = 'bg-green-100 text-green-700';
              } else if (item.activity.type === 'Visit') {
                IconComponent = MapPin;
                iconColor = 'bg-amber-100 text-amber-700';
              } else if (item.activity.type === 'Assignment' || item.activity.type === 'Status Change') {
                IconComponent = UserCheck;
                iconColor = 'bg-sky-100 text-sky-700';
              } else if (item.activity.type === 'Creation' || item.activity.type === 'Import') {
                IconComponent = Sparkles;
                iconColor = 'bg-brand-red/10 text-brand-red';
              }

              return (
                <div key={item.activity.id} className="relative group text-xs">
                  {/* Circle dot left */}
                  <span className="absolute -left-[31px] top-1.5 w-2.5 h-2.5 rounded-full bg-brand-red border border-white group-hover:scale-125 transition-transform" />

                  {/* Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`w-6 h-6 rounded-lg ${iconColor} flex items-center justify-center`}>
                        <IconComponent size={12} />
                      </span>
                      <h4 className="font-extrabold text-brand-black text-xs">{item.activity.title}</h4>
                      <span className="text-[10px] text-brand-gray font-bold">• Associated with</span>
                      <span className="font-bold text-brand-red">{item.leadName}</span>
                      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('app-open-lead', { detail: { id: item.leadId } }))} title="Open the lead card" className="font-mono text-[10.5px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded underline decoration-dotted underline-offset-2 hover:opacity-70">
                        {item.leadId}
                      </button>
                    </div>

                    <div className="flex items-center gap-2.5 text-[10px] text-brand-gray font-bold">
                      <span className="flex items-center gap-1 font-mono">
                        <Clock size={11} />
                        {fmtTs(item.activity.timestamp)}
                      </span>
                      <span>By {item.activity.user}</span>
                    </div>
                  </div>

                  {/* Body description */}
                  <div className="p-3 bg-brand-gray/5 border border-brand-gray/10 rounded-xl max-w-4xl text-[11px] leading-relaxed font-semibold text-brand-gray/90">
                    {item.activity.description || '—'}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-center text-brand-gray py-8 text-xs font-semibold">No historical communication logs found for your filtered criteria.</p>
          )}
          {filteredActivities.length > limit && (
            <button onClick={() => setLimit((n) => n + 200)} className="text-xs font-bold text-brand-red hover:underline">
              Show more ({filteredActivities.length - limit} older entries)
            </button>
          )}
        </div>
      </div>

      {/* -------------------- RECORD ACTIVITY MODAL -------------------- */}
      {showAddModal && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col text-xs"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-brand-black text-white">
              <h4 className="font-bold text-xs uppercase tracking-wide">Record Interactive Action</h4>
              <button aria-label="Close" onClick={() => setShowAddModal(false)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddActivity} className="p-6 space-y-4 font-medium">
              {formError && <p role="alert" className="text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold">{formError}</p>}
              
              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Select Inbound Lead Inquiry *</label>
                <select
                  required
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2.5 focus:outline-none font-semibold text-brand-black"
                >
                  <option value="">-- Choose active lead pipeline --</option>
                  {leads.map(l => (
                    <option key={l.id} value={l.id}>
                      [{l.id}] {l.customerName} - {l.project} ({l.companyName || 'Private'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Activity Classification</label>
                  <select
                    value={activityType}
                    onChange={(e) => setActivityType(e.target.value as any)}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none font-bold text-brand-black"
                  >
                    <option value="Call">Phone Call</option>
                    <option value="Meeting">Meeting / Site Visit</option>
                    <option value="Email">Inbound/Outbound Email</option>
                    <option value="Comment">Internal Sales Note</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Communication Topic *</label>
                  <input
                    type="text"
                    required
                    value={activityTitle}
                    onChange={(e) => setActivityTitle(e.target.value)}
                    placeholder="e.g., Pricing Negotiation Call"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Execution Log & Memo Details</label>
                <textarea
                  required
                  value={activityDesc}
                  onChange={(e) => setActivityDesc(e.target.value)}
                  rows={4}
                  placeholder="Detail meeting consensus, client reservations, next follow-up dates, or pricing items agreed on."
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl p-3 focus:outline-none font-semibold leading-relaxed"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-4 border-t border-brand-gray/10">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-brand-red hover:bg-brand-red-dark text-white px-5 py-2 rounded-xl font-bold shadow"
                >
                  Log Action
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

    </div>
  );
};
