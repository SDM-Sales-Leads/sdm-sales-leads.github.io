// Memoised pieces of the leads list / kanban / pager. A row only re-renders when its lead object, its selection or the
// visible columns change (rows keep the same lead object between refreshes, see crmService.loadAll / pullDelta).
import React from 'react';
import { AlertTriangle, CheckSquare, ChevronLeft, ChevronRight, Clock, Info, Square, UserCheck, UserPlus } from 'lucide-react';
import type { Contact, Lead } from './types';
import { NO_CHANNEL, channelOf, isTouchedLead, phoneIntl } from './leadConfig';
import { ccState } from './leadMetrics';
import { fmtSize, formatLeadDateTime, getSlaStatus } from './leadView';
import { priorityClass, prioKey, statusClass } from './leadRules';
import { LeadScoreChip } from './LeadScoreChip';

export const PAGE_SIZES = [25, 50, 100, 0] as const; // 0 = All
export type PageSize = (typeof PAGE_SIZES)[number];

interface RowProps {
  lead: Lead;
  selected: boolean;
  cols: string;           // visible columns joined by ","
  tick: number;           // minute counter: SLA texts depend on the clock
  canAssign: boolean;
  winRate: number;
  onSelect: (id: string) => void;
  onOpen: (l: Lead) => void;
  onAssign: (l: Lead) => void;
  contact?: Contact;      // customer record of this lead (only passed when the Customer ID column is shown)
  onContact?: (c: Contact) => void;
}

export const LeadRow = React.memo(({ lead: l, selected, cols, canAssign, winRate, onSelect, onOpen, onAssign, contact, onContact }: RowProps) => {
  const has = (k: string) => cols.includes(k);
  const sla = l.slaDeadline ? getSlaStatus(l) : null;
  const cc = ccState(l, Date.now());
  return (
    <tr
      className={`hover:bg-brand-gray/5 transition-all cursor-pointer ${cc ? 'bg-brand-red/5 shadow-[inset_4px_0_0_#A6192E]' : selected ? 'bg-brand-red/5' : ''}`}
      onClick={(e) => { if ((e.target as HTMLElement).closest('button,a,input,select,textarea,label')) return; onOpen(l); }}
    >
      <td className="py-3.5 pl-2 pr-2">
        <button onClick={() => onSelect(l.id)} aria-label={`Select lead ${l.id}`} className="focus:outline-none">
          {selected ? <CheckSquare size={16} className="text-brand-red" /> : <Square size={16} className="text-brand-gray/60" />}
        </button>
      </td>
      {has('id') && (
        <td className="py-3.5 pl-2 pr-2">
          <span className="font-mono font-bold text-[11px] text-brand-black hover:underline cursor-pointer whitespace-nowrap" onClick={() => onOpen(l)}>{l.id}</span>{cc && <span className={`block w-max mt-0.5 text-[10px] font-extrabold rounded px-1 py-0.5 text-white whitespace-nowrap ${cc.overdue ? 'bg-brand-red' : 'bg-brand-red/75'}`} title="Call center lead: first contact within 24 hours">CC {cc.overdue ? 'LATE' : '24h'}</span>}
        </td>
      )}
      {has('date') && <td className="py-3.5 pl-2 pr-2 text-brand-gray font-mono text-[10.5px] whitespace-nowrap">{formatLeadDateTime(l.date)}</td>}
      {has('customer') && (
        <td className="py-3.5 pl-2 pr-2">
          <div>
            <p className="font-bold text-brand-black break-words">{l.customerName}</p>
            <p className="text-[10px] text-brand-gray/80 font-mono mt-0.5">{phoneIntl(l.phoneNumber) || l.phoneNumber}</p>
          </div>
        </td>
      )}
      {has('project') && <td className="py-3.5 pl-2 pr-2 text-brand-gray break-words">{l.project}</td>}
      {has('size') && <td className="py-3.5 pl-2 pr-2 text-right font-mono">{fmtSize(l.requiredSize)}</td>}
      {has('slaStatus') && (
        <td className="py-3.5 pl-2 pr-2">
          {sla ? (
            <span className={`inline-block px-2 py-0.5 rounded-lg text-center leading-snug text-[10px] font-bold ${sla.isViolated ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}`}>
              {sla.isViolated ? `Violated (${sla.remainingText})` : sla.remainingText}
            </span>
          ) : (
            <span className="text-brand-gray/50 text-[10px]">No SLA Set</span>
          )}
        </td>
      )}
      {has('priority') && (
        <td className="py-3.5 pl-2 pr-2">
          <span className={`inline-block px-2 py-0.5 rounded-lg text-center leading-snug text-[10px] font-semibold ${priorityClass(l.priority)}`}>{prioKey(l.priority) || '—'}</span>
        </td>
      )}
      {has('score') && <td className="py-3.5 pl-2 pr-2"><LeadScoreChip lead={l} winRate={winRate} /></td>}
      {has('touch') && (
        <td className="py-3.5 pl-2 pr-2">
          <span className={`inline-block px-2 py-0.5 rounded-lg text-center leading-snug text-[10px] font-bold ${isTouchedLead(l) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{isTouchedLead(l) ? 'Touched' : 'Untouched'}</span>
        </td>
      )}
      {has('status') && (
        <td className="py-3.5 pl-2 pr-2">
          <span className={`inline-block px-2 py-0.5 rounded-lg text-center leading-snug text-[10px] font-bold ${statusClass(l.status)}`}>{l.status}</span>
        </td>
      )}
      {has('assigned') && (
        <td className="py-3.5 pl-2 pr-2 text-brand-gray break-words">
          {l.assignedSalespersonName ? (
            <span className="flex items-center gap-1"><UserCheck size={12} className="text-indigo-600 shrink-0" /><span>{l.assignedSalespersonName}</span></span>
          ) : (
            <span className="text-rose-500 font-bold flex items-center gap-1 text-[10px] bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full w-max">
              <AlertTriangle size={10} /><span>UNROUTED QUEUE</span>
            </span>
          )}
        </td>
      )}
      {has('channel') && <td className="py-3.5 pl-2 pr-2 text-brand-gray break-words">{channelOf(l) === NO_CHANNEL ? '—' : channelOf(l)}</td>}
      {has('leadSource') && <td className="py-3.5 pl-2 pr-2 text-brand-gray break-words">{l.source || '—'}</td>}
      {has('customerId') && (
        <td className="py-3.5 pl-2 pr-2 whitespace-nowrap">
          {contact && onContact
            ? <button onClick={() => onContact(contact)} className="font-mono font-bold text-brand-red hover:underline" title="Open customer in Contacts">{contact.serialNumber || contact.id}</button>
            : <span className="text-brand-gray/60">—</span>}
        </td>
      )}
      <td className="py-3.5 px-2 text-right">
        <div className="flex justify-end gap-1.5">
          <button onClick={() => onOpen(l)} className="p-1.5 hover:bg-brand-gray/15 rounded-lg text-brand-black" title="View Lead Details"><Info size={14} /></button>
          {canAssign && (
            <button onClick={() => onAssign(l)} className="p-1.5 hover:bg-indigo-50 rounded-lg text-indigo-600" title="Route to Salesperson"><UserPlus size={14} /></button>
          )}
        </div>
      </td>
    </tr>
  );
});
LeadRow.displayName = 'LeadRow';

interface CardProps { lead: Lead; tick: number; tone: 'amber' | 'indigo' | 'blue' | 'closed'; winRate: number; canRoute: boolean; onOpen: (l: Lead) => void; onAssign: (l: Lead) => void }

export const KanbanCard = React.memo(({ lead: l, tone, winRate, canRoute, onOpen, onAssign }: CardProps) => {
  const sla = getSlaStatus(l);
  const closed = tone === 'closed';
  const isWon = l.status === 'Won';
  const cardClass = closed
    ? `p-3.5 rounded-xl border cursor-pointer shadow-sm hover:shadow-md transition-all space-y-2.5 ${isWon ? 'bg-emerald-50/50 border-emerald-200 hover:border-emerald-400' : 'bg-rose-50/50 border-rose-200 hover:border-rose-400'}`
    : sla.isViolated
      ? 'bg-red-50 border-red-300 p-3.5 rounded-xl border hover:border-red-400 cursor-pointer shadow-sm hover:shadow-md transition-all space-y-2.5 relative text-red-950'
      : `bg-white p-3.5 rounded-xl border border-brand-gray/15 cursor-pointer shadow-sm hover:shadow-md transition-all space-y-2.5 relative ${tone === 'amber' ? 'hover:border-brand-red/30' : tone === 'indigo' ? 'hover:border-indigo-400/35' : 'hover:border-blue-400/35'}`;
  return (
    <div onClick={() => onOpen(l)} className={cardClass}>
      <div className="flex justify-between items-start gap-2">
        <span className="font-mono text-[10px] font-bold text-brand-red">{l.id}</span>
        <span className={`text-[10.5px] px-1.5 py-0.5 rounded font-bold ${statusClass(l.status)}`}>{l.status}</span>
      </div>
      <div>
        <h5 className="font-bold text-brand-black text-xs leading-snug">{l.customerName}</h5>
        {l.assignedSalespersonName ? (
          <p className="text-[10px] text-indigo-600 font-bold flex items-center gap-1 mt-0.5"><UserCheck size={10} /><span>{l.assignedSalespersonName}</span></p>
        ) : (
          <p className="text-[10px] text-brand-gray/80 font-semibold">{l.companyName || 'Private Person'}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`px-1.5 py-0.5 rounded-full text-[10.5px] font-bold ${priorityClass(l.priority)}`}>{prioKey(l.priority) || '—'}</span>
        <LeadScoreChip lead={l} winRate={winRate} />
      </div>
      {l.slaDeadline && (
        closed ? (
          <div className={`flex items-center gap-1.5 text-[10px] font-bold py-1 px-2 rounded-lg border w-fit ${sla.status === 'missed' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
            <Clock size={11} /><span>{sla.status === 'missed' ? 'SLA Missed' : 'SLA Met'}</span>
          </div>
        ) : (
          <div className={`flex items-center gap-1.5 text-[10px] font-bold py-1 px-2 rounded-lg border w-fit ${sla.isViolated ? 'bg-red-100/50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
            <Clock size={11} className={sla.isViolated ? 'text-red-600 animate-pulse' : 'text-amber-600'} />
            <span>{sla.isViolated ? `Violated: ${sla.remainingText}` : sla.remainingText}</span>
          </div>
        )
      )}
      <div className="flex justify-between items-center text-[10px] pt-2 border-t border-brand-gray/10 text-brand-gray font-mono whitespace-nowrap">
        <span>{fmtSize(l.requiredSize)}</span>
        <span className={`font-bold ${sla.isViolated || sla.status === 'missed' ? 'text-rose-600' : 'text-emerald-700'}`}>{l.slaDeadline ? sla.text : ''}</span>
      </div>
      {canRoute && !l.assignedSalespersonName && (
        <div className="flex justify-end gap-1 pt-1">
          <button onClick={(e) => { e.stopPropagation(); onAssign(l); }} className="text-[10.5px] bg-brand-black text-white px-2 py-1 rounded font-bold hover:scale-105 transition-all">Route Agent</button>
        </div>
      )}
    </div>
  );
});
KanbanCard.displayName = 'KanbanCard';

export const ALL_CHUNK = 250; // rows drawn per step when the page size is "All"
interface PagerProps {
  total: number; page: number; pageSize: PageSize;
  onPage: (p: number) => void; onSize: (s: PageSize) => void;
  /** "All" is drawn in chunks (fast): how many rows are drawn now, and how to draw the next chunk */
  shown?: number; onMore?: () => void;
}
/** "showing x-y of N" + size selector + page navigator */
export const PagerBar: React.FC<PagerProps> = ({ total, page, pageSize, onPage, onSize, shown, onMore }) => {
  const size = pageSize === 0 ? Math.max(total, 1) : pageSize;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(page, pages - 1);
  const from = total === 0 ? 0 : p * size + 1;
  const to = pageSize === 0 && shown ? Math.min(total, shown) : Math.min(total, (p + 1) * size);
  const nums: (number | '…')[] = [];
  for (let i = 0; i < pages; i++) {
    if (i === 0 || i === pages - 1 || Math.abs(i - p) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-brand-gray/10 bg-brand-gray/5 text-[11px] text-brand-gray">
      <div className="flex items-center gap-3">
        <span>Showing <strong className="text-brand-black">{from.toLocaleString('en-US')}–{to.toLocaleString('en-US')}</strong> of <strong className="text-brand-black">{total.toLocaleString('en-US')}</strong></span>
        <label className="flex items-center gap-1.5">
          <span>Rows</span>
          <select value={pageSize} onChange={(e) => onSize(Number(e.target.value) as PageSize)} className="bg-white border border-brand-gray/25 rounded-lg px-2 py-1 text-[11px] font-semibold text-brand-black focus:outline-none">
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s === 0 ? 'All' : s}</option>)}
          </select>
        </label>
      </div>
      {pageSize === 0 && onMore && shown !== undefined && shown < total && (
        <button onClick={onMore} className="px-3 py-1.5 rounded-lg bg-brand-red text-white text-[11px] font-bold">Show {Math.min(ALL_CHUNK, total - shown).toLocaleString('en-US')} more ({(total - shown).toLocaleString('en-US')} left)</button>
      )}
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => onPage(p - 1)} disabled={p === 0} aria-label="Previous page" className="p-1.5 rounded-lg border border-brand-gray/20 bg-white disabled:opacity-40"><ChevronLeft size={14} /></button>
          {nums.map((n, i) => n === '…'
            ? <span key={`e${i}`} className="px-1">…</span>
            : <button key={n} onClick={() => onPage(n)} className={`min-w-[28px] px-2 py-1 rounded-lg border text-[11px] font-bold ${n === p ? 'bg-brand-red border-brand-red text-white' : 'bg-white border-brand-gray/20 text-brand-black hover:bg-brand-gray/10'}`}>{n + 1}</button>)}
          <button onClick={() => onPage(p + 1)} disabled={p >= pages - 1} aria-label="Next page" className="p-1.5 rounded-lg border border-brand-gray/20 bg-white disabled:opacity-40"><ChevronRight size={14} /></button>
        </div>
      )}
    </div>
  );
};
