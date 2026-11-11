// Labels, icons and colours for Lara's workflow boxes (shared by the workflow list and the canvas editor; no React Flow here,
// so the list page stays light and the canvas library loads only when someone opens the editor).
import { Zap, Clock, GitBranch, MessageCircleReply, MessageSquare, FileText, Bell, Crown, UserCheck, CircleStop } from 'lucide-react';
import { SITUATION_LABEL } from '../../crm/smartWriter';
import { PRIORITIES, SOURCES, CHANNELS, STATUSES } from '../../crm/leadConfig';
import { PARKS } from '../../../lib/parkAliases';
import type { NodeType } from './graph';

export const TRIGGER: Record<string, { label: string; unit: string }> = {
  no_first_contact: { label: 'New lead has no first contact after', unit: 'hours' },
  followup_overdue: { label: 'Follow-up date passed by', unit: 'days' },
  offer_silent: { label: 'Offer sent and nothing logged for', unit: 'days' },
  no_answer: { label: '"No answer / Sent WhatsApp" and no new try for', unit: 'days' },
  status_stuck: { label: 'Status unchanged for', unit: 'days' },
  old_lead: { label: 'Old imported lead, no contact for', unit: 'days' },
};
export const FIELDS: Record<string, { label: string; kind: 'list' | 'bool' | 'num'; options?: readonly string[] }> = {
  park: { label: 'Park', kind: 'list', options: PARKS }, source: { label: 'Source', kind: 'list', options: SOURCES }, channel: { label: 'Channel', kind: 'list', options: CHANNELS },
  priority: { label: 'Priority', kind: 'list', options: PRIORITIES }, status: { label: 'Status', kind: 'list', options: STATUSES }, owner: { label: 'Salesperson (names, comma)', kind: 'list' },
  hasEmail: { label: 'Has an e-mail address', kind: 'bool' }, hasPhone: { label: 'Has a phone number', kind: 'bool' },
  leadAgeDays: { label: 'Lead age (days)', kind: 'num' }, dealValue: { label: 'Deal value at least (EGP)', kind: 'num' },
};
/** fields an If box can check: the lead filters plus "the customer replied" */
export const IF_FIELDS: typeof FIELDS = { replied: { label: 'The customer replied', kind: 'bool' }, ...FIELDS };
export const SIT_OPTIONS: [string, string][] = [['auto', 'Lara picks (where the lead stands)'], ...Object.entries(SITUATION_LABEL).filter(([k]) => !['won', 'meeting', 'visit'].includes(k))];

export const condText = (c: any) => {
  const f = IF_FIELDS[c?.field]; if (!f) return 'Choose what to check';
  if (f.kind === 'bool') return c.field === 'replied' ? (c.value === false || c.value === 'false' ? 'The customer did NOT reply' : 'The customer replied') : `${f.label}: ${c.value === true || c.value === 'true' ? 'yes' : 'no'}`;
  if (f.kind === 'num') return c.field === 'leadAgeDays' ? `Lead age ${c.op === 'lte' ? '≤' : '≥'} ${c.value || '—'} days` : `Deal value ≥ EGP ${Number(c.value || 0).toLocaleString('en-US')}`;
  const v = Array.isArray(c.value) ? c.value.join(', ') : c.value;
  return `${f.label} ${c.op === 'notin' ? 'is not' : 'is'} ${v || '—'}`;
};
export const triggerText = (t: any) => {
  const m = TRIGGER[t?.type] || { label: t?.type || '—', unit: '' };
  return `${m.label} ${t?.value ?? '—'} ${m.unit}${t?.type === 'status_stuck' && t?.statuses?.length ? ` (${t.statuses.join(', ')})` : ''}`;
};

/** look of each box: icon, title, colours (ring/background/text) */
export const BOX: Record<NodeType, { title: string; icon: any; ring: string; bg: string; text: string; hint: string }> = {
  trigger: { title: 'Start', icon: Zap, ring: 'border-brand-red', bg: 'bg-brand-red', text: 'text-white', hint: 'When Lara starts on a lead, and which leads' },
  wait: { title: 'Wait', icon: Clock, ring: 'border-brand-gray/40', bg: 'bg-brand-gray/10', text: 'text-brand-black', hint: 'Pause for some days' },
  condition: { title: 'If / else', icon: GitBranch, ring: 'border-amber-400', bg: 'bg-amber-50', text: 'text-amber-900', hint: 'Two ways: yes or no' },
  wait_reply: { title: 'Wait for a reply', icon: MessageCircleReply, ring: 'border-teal-400', bg: 'bg-teal-50', text: 'text-teal-900', hint: 'Replied, or no reply in time' },
  message: { title: 'Write to the customer', icon: MessageSquare, ring: 'border-sky-400', bg: 'bg-sky-50', text: 'text-sky-900', hint: 'E-mail or WhatsApp draft' },
  offer: { title: 'Initial offer', icon: FileText, ring: 'border-violet-400', bg: 'bg-violet-50', text: 'text-violet-900', hint: 'Offer PDF, always approved by a person' },
  notify_owner: { title: 'Tell the salesperson', icon: Bell, ring: 'border-cyan-400', bg: 'bg-cyan-50', text: 'text-cyan-900', hint: 'A bell for the lead owner' },
  notify_director: { title: 'Tell the Sales Director', icon: Crown, ring: 'border-indigo-400', bg: 'bg-indigo-50', text: 'text-indigo-900', hint: 'A bell for the director' },
  handover: { title: 'Hand back', icon: UserCheck, ring: 'border-rose-400', bg: 'bg-rose-50', text: 'text-rose-900', hint: 'Lara stops; the salesperson takes over' },
  end: { title: 'End', icon: CircleStop, ring: 'border-brand-black', bg: 'bg-brand-black', text: 'text-white', hint: 'The workflow ends for this lead' },
};

/** one line describing a box's settings */
export function boxSummary(type: NodeType, d: any): string {
  switch (type) {
    case 'trigger': return triggerText(d?.trigger) + ((d?.conditions || []).length ? ` · only: ${(d.conditions || []).map(condText).join(' · ')}` : '');
    case 'wait': return `${d?.days || '—'} day${Number(d?.days) === 1 ? '' : 's'}`;
    case 'wait_reply': return `up to ${d?.days || '—'} day${Number(d?.days) === 1 ? '' : 's'}`;
    case 'condition': return condText(d);
    case 'message': {
      const ch = d?.channel === 'email' ? 'E-mail only' : d?.channel === 'whatsapp' ? 'WhatsApp only' : 'Best channel (WhatsApp when connected, else e-mail; while Lara cannot send: a WhatsApp draft for the salesperson)';
      return `${ch} · ${(SITUATION_LABEL as any)[d?.situation] || 'Lara picks the message'}`;
    }
    default: return BOX[type]?.hint || '';
  }
}
