import React, { useState, useMemo } from 'react';
import { MultiSelect } from './ui/MultiSelect';
import { Ticket, TicketStatus } from '../types';
import { STATUS_COLORS, PRIORITY_COLORS } from '../constants';
import { 
  Search, 
  Filter, 
  ChevronRight, 
  Clock, 
  AlertTriangle,
  CheckCircle2,
  GitBranch
} from 'lucide-react';
import { motion } from 'motion/react';

interface TicketListProps {
  tickets: Ticket[];
  onSelect: (ticket: Ticket) => void;
}

export const TicketList: React.FC<TicketListProps> = ({ tickets, onSelect }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      const searchStr = search.toLowerCase();
      const ticketId = String(t.id).toLowerCase();
      const matchesSearch = (t.title?.toLowerCase() || '').includes(searchStr) || ticketId.includes(searchStr);
      const matchesStatus = !statusFilter.length || statusFilter.includes(t.status);
      return matchesSearch && matchesStatus;
    });
  }, [tickets, search, statusFilter]);

  const getSLABadge = (ticket: Ticket) => {
    if (['Resolved', 'Closed'].includes(ticket.status)) return null;

    // SLA clock is stopped while waiting on user / vendor: never report that as overdue
    if (ticket.slaPausedAt) {
      return (
        <span className="flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-bold border border-slate-200">
          <Clock size={12} /> PAUSED
        </span>
      );
    }

    const now = new Date();
    const deadline = new Date(ticket.slaDeadline);
    const diff = deadline.getTime() - now.getTime();
    if (!ticket.slaDeadline || Number.isNaN(diff)) {
      return <span className="text-[10px] text-brand-gray font-bold">n/a</span>;
    }
    const hoursRemaining = diff / (1000 * 60 * 60);

    if (hoursRemaining < 0) {
      return (
        <span className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-lg text-[10px] font-bold border border-red-200">
          <AlertTriangle size={12} /> OVERDUE
        </span>
      );
    } else if (hoursRemaining < 4) {
      return (
        <span className="flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-bold border border-amber-200">
          <Clock size={12} /> AT RISK
        </span>
      );
    } else {
      return (
        <span className="flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-[10px] font-bold border border-emerald-200">
          <CheckCircle2 size={12} /> ON TRACK
        </span>
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-brand-black">Tickets</h2>
          <p className="text-brand-gray text-sm">Manage and track service requests</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-2.5 text-brand-gray" size={18} />
            <input 
              className="input-field pl-10" 
              placeholder="Search ID or Title..." 
              aria-label="Search tickets"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <MultiSelect options={[{ value: 'New', label: 'New' }, { value: 'In Progress', label: 'In Progress' }, { value: 'Waiting on User', label: 'Waiting on User' }, { value: 'Waiting on Vendor', label: 'Waiting on Vendor' }, { value: 'Resolved', label: 'Resolved' }, { value: 'Closed', label: 'Closed' }, { value: 'Reopened', label: 'Reopened' }]} value={statusFilter} onChange={setStatusFilter} allLabel="All Statuses" name="statuses" className="w-full sm:w-auto sm:min-w-[170px]" buttonClassName={`input-field w-full flex items-center justify-between gap-2 text-left ${statusFilter.length ? 'border-brand-red/50 text-brand-red' : ''}`} />
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-4">
        {filteredTickets.length === 0 ? (
          <div className="bento-card text-center py-12 text-brand-gray italic">
            No tickets found.
          </div>
        ) : (
          filteredTickets.map((t) => (
            <motion.div 
              key={t.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => onSelect(t)}
              onKeyDown={e => { if (e.key === 'Enter') onSelect(t); }}
              tabIndex={0}
              role="button"
              className="bento-card active:scale-[0.98] transition-transform"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="text-[10px] font-bold text-brand-red uppercase">{t.id}</p>
                  <h3 className="font-bold text-brand-black line-clamp-1">{t.title}</h3>
                </div>
                <ChevronRight size={18} className="text-brand-gray" />
              </div>
              
              <div className="flex flex-wrap gap-2 mb-4">
                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${PRIORITY_COLORS[t.priority]}`}>
                  {(t.priority || '').toUpperCase()}
                </span>
                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${STATUS_COLORS[t.status]}`}>
                  {(t.status || '').toUpperCase()}
                </span>
                {t.workflowId && (
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold border border-brand-red/20 bg-brand-red/5 text-brand-red flex items-center gap-1">
                    <GitBranch size={10} /> WORKFLOW
                  </span>
                )}
                {t.department && (
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold border border-black/10 bg-black/5 text-brand-black">
                    {t.department}
                  </span>
                )}
                {getSLABadge(t)}
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-black/5 text-[10px] text-brand-gray">
                <div>
                  <p>{t.type} › {t.subtype}</p>
                  {t.crmContactName && (
                    <p className="text-brand-red font-bold mt-1">CRM Contact: {t.crmContactName}</p>
                  )}
                </div>
                <p>{new Date(t.createdAt).toLocaleDateString()}</p>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block bento-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left bg-brand-light border-b border-black/5">
                <th className="px-6 py-4 font-bold text-brand-gray uppercase text-[11px] tracking-wider">Ticket Info</th>
                <th className="px-6 py-4 font-bold text-brand-gray uppercase text-[11px] tracking-wider">Category</th>
                <th className="px-6 py-4 font-bold text-brand-gray uppercase text-[11px] tracking-wider">Priority</th>
                <th className="px-6 py-4 font-bold text-brand-gray uppercase text-[11px] tracking-wider">Status</th>
                <th className="px-6 py-4 font-bold text-brand-gray uppercase text-[11px] tracking-wider">SLA Status</th>
                <th className="px-6 py-4 font-bold text-brand-gray uppercase text-[11px] tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-brand-gray italic">
                    No tickets found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredTickets.map((t, idx) => (
                  <motion.tr 
                    key={t.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(idx, 10) * 0.05 }}
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter') onSelect(t); }}
                    className="hover:bg-brand-light/50 transition-colors cursor-pointer group"
                    onClick={() => onSelect(t)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-bold text-brand-red text-xs">{t.id}</p>
                        {t.workflowId && (
                          <span className="px-1.5 py-0.5 rounded bg-brand-red/5 text-brand-red text-[9px] font-bold border border-brand-red/10 flex items-center gap-1">
                            <GitBranch size={8} /> WORKFLOW
                          </span>
                        )}
                        {t.department && (
                          <span className="px-1.5 py-0.5 rounded bg-brand-black/5 text-brand-black text-[9px] font-bold border border-black/10">
                            {t.department}
                          </span>
                        )}
                        {t.crmContactName && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[9px] font-bold border border-amber-200">
                            CRM: {t.crmContactName}
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-brand-black line-clamp-1">{t.title}</p>
                      <p className="text-[10px] text-brand-gray mt-1">Created: {new Date(t.createdAt).toLocaleDateString()}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium">{t.type}</p>
                      <p className="text-xs text-brand-gray">{t.subtype}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${PRIORITY_COLORS[t.priority]}`}>
                        {(t.priority || '').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${STATUS_COLORS[t.status]}`}>
                        {(t.status || '').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {getSLABadge(t)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button aria-label="Open ticket" className="p-2 rounded-lg bg-white border border-black/5 text-brand-gray group-hover:text-brand-red group-hover:border-brand-red transition-all">
                        <ChevronRight size={18} />
                      </button>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
