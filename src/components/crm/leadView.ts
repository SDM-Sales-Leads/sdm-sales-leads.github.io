import { cairoDateISO, cairoParts } from '../../lib/cairoTime';
// Display helpers of the leads screens (kept out of the big component so the memoised rows can use them).
import type { Lead } from './types';
import { isOpenStatus } from './leadConfig';

const pad2 = (n: number) => String(n).padStart(2, '0');
export const localISO = (d: Date) => cairoDateISO(d);
export const fmtSize = (v: string | number | undefined) => (Number(v) > 0 ? `${Number(v).toLocaleString('en-US')} sqm` : '—');

// SLA risk = still active and inside the last 25% of its window (registration/assignment -> deadline)
export const isSlaAtRisk = (l: Lead, sla: { status: string }) => {
  if (sla.status !== 'active' || !l.slaDeadline) return false;
  const start = new Date(l.assignedDate || l.date).getTime();
  const end = new Date(l.slaDeadline).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return false;
  return (end - Date.now()) / (end - start) <= 0.25;
};

// Helper to format date and time beautifully
export function formatLeadDateTime(dateStr: string): string {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const c = cairoParts(d);
    const yyyy = c.y;
    const mm = String(c.mo).padStart(2, '0');
    const dd = String(c.d).padStart(2, '0');
    const hh = String(c.h).padStart(2, '0');
    const min = String(c.mi).padStart(2, '0');
    
    // Check if the original string was just a YYYY-MM-DD string without time
    if (dateStr.length <= 10) {
      return `${yyyy}-${mm}-${dd}`;
    }
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  } catch (e) {
    return dateStr;
  }
}

// Helper to calculate SLA status
export interface SlaStatus {
  status: 'none' | 'active' | 'violated' | 'met' | 'missed';
  text: string;
  isViolated: boolean;
  remainingText: string;
}

export function getSlaStatus(lead: Lead): SlaStatus {
  if (!lead.slaDeadline) {
    return { status: 'none', text: 'No SLA Set', isViolated: false, remainingText: 'N/A' };
  }
  
  const now = new Date();
  const deadline = new Date(lead.slaDeadline);
  if (isNaN(deadline.getTime())) {
    return { status: 'none', text: 'No SLA Set', isViolated: false, remainingText: 'N/A' };
  }
  const diffMs = deadline.getTime() - now.getTime();
  const isClosed = !isOpenStatus(lead.status);
  
  if (isClosed) {
    const lastUpdatedDate = new Date(lead.lastUpdated || lead.date);
    const met = lastUpdatedDate.getTime() <= deadline.getTime();
    if (met) {
      return { 
        status: 'met', 
        text: 'SLA Met', 
        isViolated: false, 
        remainingText: 'SLA Met' 
      };
    } else {
      return { 
        status: 'missed', 
        text: 'SLA Missed', 
        isViolated: true, 
        remainingText: 'SLA Missed' 
      };
    }
  }

  if (diffMs < 0) {
    const absDiff = Math.abs(diffMs);
    const hours = Math.floor(absDiff / (3600 * 1000));
    const mins = Math.floor((absDiff % (3600 * 1000)) / (60 * 1000));
    let overdueText = '';
    if (hours > 24) {
      overdueText = `${Math.floor(hours / 24)}d overdue`;
    } else if (hours > 0) {
      overdueText = `${hours}h ${mins}m overdue`;
    } else {
      overdueText = `${mins}m overdue`;
    }
    return { 
      status: 'violated', 
      text: 'SLA Violated', 
      isViolated: true, 
      remainingText: overdueText 
    };
  } else {
    const hours = Math.floor(diffMs / (3600 * 1000));
    const mins = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));
    let remainingText = '';
    if (hours > 24) {
      remainingText = `${Math.floor(hours / 24)}d ${hours % 24}h remaining`;
    } else if (hours > 0) {
      remainingText = `${hours}h ${mins}m remaining`;
    } else {
      remainingText = `${mins}m remaining`;
    }
    return { 
      status: 'active', 
      text: 'SLA Active', 
      isViolated: false, 
      remainingText: remainingText 
    };
  }
}

