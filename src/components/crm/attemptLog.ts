import type { Lead } from './types';
import { crmService } from './crmService';

const TITLE = { call: 'Tried to call from phone', whatsapp: 'Tried to send WhatsApp from phone', email: 'Tried to send e-mail from phone' } as const;

/** the phone buttons (dialer, WhatsApp, mail app) were pressed: write it to the lead timeline and the activity list. No status change:
 *  whether the call or message really happened is logged by the salesperson afterwards. */
export function logAttempt(l: Lead, kind: keyof typeof TITLE, user: { id?: string | number; name?: string } | null | undefined, text = '') {
  try {
    const now = new Date().toISOString();
    const fresh = (crmService.getLeads() as Lead[]).find((x) => x.id === l.id) || l;
    const ev: any = { id: Math.random().toString(36).slice(2, 11), timestamp: now, type: kind === 'call' ? 'Call' : kind === 'whatsapp' ? 'WhatsApp' : 'Email', user: user?.name || 'Agent', title: TITLE[kind], description: text || 'Opened from the phone.' };
    crmService.updateLead(l.id, { timeline: [...(fresh.timeline || []), ev], lastUpdated: now }, user?.name || 'Agent', { userId: user?.id ? String(user.id) : undefined });
    const acts = crmService.getActivities();
    acts.unshift({ id: 'act_' + Math.random().toString(36).slice(2, 11), salespersonId: String(user?.id || l.assignedSalespersonId || ''), salespersonName: user?.name || l.assignedSalespersonName || '—', type: (kind === 'call' ? 'Call' : kind === 'whatsapp' ? 'WhatsApp' : 'Email') as any, leadId: l.id, leadName: l.customerName, timestamp: now, notes: `[${TITLE[kind]}] ${text}`.trim() });
    crmService.saveActivities(acts);
  } catch { /* the app was opened; a log failure must not stop it */ }
}
