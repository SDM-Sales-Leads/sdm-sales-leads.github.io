import { cairoTimeHM } from '../../lib/cairoTime';
import { repNameFromEmail, signOff } from '../../lib/repName';
import { logAttempt } from './attemptLog';
import { StatusPicker } from './StatusPicker';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../services/AuthContext';
import { Lead, TimelineEvent, LeadStatus } from './types';
import { crmService } from './crmService';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import {
  Calendar, Clock, ChevronLeft, ChevronRight, ExternalLink, Phone, MessageSquare, Mail, MapPin, AlertCircle, Briefcase, Users,
  XCircle, CheckCircle, SkipForward, ArrowLeft, Flame, Hourglass, FileText, Wallet, ChevronDown, ChevronUp, Settings2,
} from 'lucide-react';
import {
  ACTIVE_EXCLUDE, LOST_CATEGORIES, LOST_REASONS_TEAM, PIPELINE_STATUSES, REQ_DATETIME, REQ_FOLLOWUP, STATUS_GROUPS, isOpenStatus, phoneIntl, statusStage,
} from './leadConfig';
import {
  DAY_LEVEL, DayBoard, DayTask, TaskKind, VIP_SLA_HOURS, NEGLECT_HOURS, CONTRACT_REMIND_DAYS, addDays, buildDayBoard, dayOf, fmtDay, fmtEGP, isEngaged,
  localISO, pc, sourceWinRates, todayISO,
} from './leadMetrics';
import { InfoTip } from './CrmMetricsUi';
import { crmNav } from './crmNav';
import { suggestTemplate, waCompose, waFill } from './waTemplates';

interface CrmMyDayProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  setActiveSubTab: (tab: string) => void;
}

const parseLocalDay = (s: string) => new Date(`${s}T00:00:00`);
const BATCH_KEY = 'crm_first_batch';
const readBatch = () => { try { const n = Number(localStorage.getItem(BATCH_KEY)); if (n >= 1 && n <= 20) return Math.round(n); } catch { /* default */ } return 5; };
const WORK_EVENTS = ['Meeting', 'Visit', 'Call', 'WhatsApp', 'Email'];
const SLOW_STATUSES = new Set(STATUS_GROUPS.flatMap((g) => g.statuses));

const LEVEL_STYLE: Record<number, string> = {
  0: 'bg-rose-100 text-rose-800', 1: 'bg-amber-100 text-amber-800', 2: 'bg-sky-100 text-sky-800', 3: 'bg-brand-gray/15 text-brand-gray',
};
const FOLDS: { kind: TaskKind; title: string; tone: string; cap: number }[] = [
  { kind: 'meeting', title: 'Meetings, site visits and call-backs today', tone: 'text-rose-600', cap: 999 },
  { kind: 'offer', title: 'Offers waiting for our follow-up', tone: 'text-rose-600', cap: 40 },
  { kind: 'overdue', title: 'Overdue follow-ups', tone: 'text-rose-600', cap: 40 },
  { kind: 'followup', title: 'Follow-ups due today', tone: 'text-rose-600', cap: 999 },
  { kind: 'owe', title: 'Waiting on me', tone: 'text-amber-600', cap: 40 },
  { kind: 'risk', title: 'At risk', tone: 'text-amber-600', cap: 40 },
  { kind: 'first', title: 'Never contacted (after today\'s batch)', tone: 'text-sky-600', cap: 40 },
  { kind: 'cold', title: 'Going quiet', tone: 'text-sky-600', cap: 40 },
  { kind: 'later', title: 'Scheduled for later', tone: 'text-brand-gray', cap: 40 },
];

type ModalKind = null | 'outcome' | 'log' | 'status' | 'resched';

export const CrmMyDay: React.FC<CrmMyDayProps> = ({ leads, onLeadsUpdated, setActiveSubTab }) => {
  const { user } = useAuth();
  const [tab, setTab] = useState<'priority' | 'schedule'>('priority');
  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [tasks, setTasks] = useState<any[]>([]);
  const [salespeople, setSalespeople] = useState<any[]>([]);
  const [selectedSalespersonId, setSelectedSalespersonId] = useState<string>('');
  const [queueMode, setQueueMode] = useState<'follow' | 'new'>('follow');
  const [cursor, setCursor] = useState(0);
  const [pinned, setPinned] = useState<string | null>(null);   // lead id picked from a fold
  const [batch, setBatch] = useState<number>(readBatch);
  const [open, setOpen] = useState<Record<string, boolean>>({ meeting: true, offer: true, overdue: true, followup: true });
  const [modal, setModal] = useState<ModalKind>(null);
  const [target, setTarget] = useState<Lead | null>(null);

  // modal fields
  const [outcome, setOutcome] = useState<'theirs' | 'mine' | 'send' | 'none'>('theirs');
  const [comeBack, setComeBack] = useState(3);
  const [outTime, setOutTime] = useState('09:00');
  const [notes, setNotes] = useState('');
  const [iType, setIType] = useState<'call' | 'whatsapp' | 'email' | 'meeting' | 'visit'>('call');
  const [iDate, setIDate] = useState('');
  const [iTime, setITime] = useState('');
  const [iPlace, setIPlace] = useState('');
  const [iSchedule, setISchedule] = useState(true);
  const [stStatus, setStStatus] = useState('');
  const [stDate, setStDate] = useState('');
  const [stTime, setStTime] = useState('');
  const [stNext, setStNext] = useState('');
  const [stReason, setStReason] = useState('');
  const [stCat, setStCat] = useState('');
  const [fuDate, setFuDate] = useState('');
  const [fuTime, setFuTime] = useState('');

  useEffect(() => {
    setSalespeople(crmService.getSalesPeople());
    if (user) setSelectedSalespersonId(String(user.id));
    setTasks(crmService.getTasks());
  }, [user]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModal(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  const roleLower = (user?.role || '').toLowerCase();
  const canFilterSalespeople = !!user && ['admin', 'sales manager', 'sales operation', 'operation', 'leader'].some((r) => roleLower.includes(r));
  const salesPersonOptions = useMemo(() => {
    if (!user) return [];
    if (roleLower.includes('leader')) return salespeople.filter((s) => String(s.id) === String(user.id) || String(s.teamLeaderId) === String(user.id));
    return salespeople;
  }, [salespeople, user, roleLower]);
  const activeSalesperson = salespeople.find((s) => String(s.id) === String(selectedSalespersonId)) || { id: user?.id, name: user?.name, role: user?.role };
  const viewingSelf = !!user && String(selectedSalespersonId) === String(user.id);

  // ---- derived data: each is computed once per change of leads / person, never per row ----
  const mine = useMemo(() => leads.filter((l) => String(l.assignedSalespersonId) === String(selectedSalespersonId)), [leads, selectedSalespersonId]);
  const rates = useMemo(() => sourceWinRates(leads), [leads]);
  const today = todayISO();
  const board: DayBoard = useMemo(() => buildDayBoard(mine, todayISO(), Date.now(), rates), [mine, rates]);

  const stats = useMemo(() => {
    let active = 0, won = 0, lost = 0, unworked = 0, working = 0, pipeline = 0, activeValue = 0, sizeSum = 0, sizeN = 0, vip = 0, high = 0;
    const L = { active: [] as Lead[], won: [] as Lead[], lost: [] as Lead[], unworked: [] as Lead[], pipeline: [] as Lead[] };
    const src: Record<string, number> = {}; const lostR: Record<string, number> = {};
    for (const l of mine) {
      const st = statusStage(l.status);
      if (st === 'won') { won++; L.won.push(l); }
      else if (st === 'lost') { lost++; L.lost.push(l); const r = l.lostReason || l.lostCategory; if (r) lostR[r] = (lostR[r] || 0) + 1; }
      if (l.source) src[l.source] = (src[l.source] || 0) + 1;
      if (!isOpenStatus(l.status)) continue;
      active++; L.active.push(l);
      if (!isEngaged(l)) { unworked++; L.unworked.push(l); } else working++;
      if (PIPELINE_STATUSES.includes(l.status)) { pipeline++; L.pipeline.push(l); }
      activeValue += Number(l.dealValue) || 0;
      if (Number(l.requiredSize) > 0) { sizeSum += Number(l.requiredSize); sizeN++; }
      if (l.priority === 'VIP' || l.priority === 'Urgent') vip++;
      else if (l.priority === 'High') high++;
    }
    const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    return { total: mine.length, active, won, lost, unworked, working, pipeline, activeValue, avgSize: sizeN ? Math.round(sizeSum / sizeN) : null, vip, high, topSource: top(src), topLost: top(lostR), win: pc(won, won + lost), L };
  }, [mine]);

  // ---- queues ----
  const followQ = board.callList;
  const newQ = useMemo(() => board.first.slice(0, batch), [board.first, batch]);
  const mode: 'follow' | 'new' = queueMode === 'new' || (!followQ.length && newQ.length) ? 'new' : 'follow';
  const queue = mode === 'new' ? newQ : followQ;
  const idx = Math.min(cursor, Math.max(0, queue.length - 1));
  const pinnedTask = pinned ? board.tasks.find((t) => t.lead.id === pinned) || null : null;
  const hero: DayTask | null = pinnedTask || queue[idx] || null;
  const doneN = board.doneToday;
  const pct = queue.length + doneN === 0 ? 100 : Math.round((doneN / (queue.length + doneN)) * 100);
  useEffect(() => { setCursor(0); setPinned(null); }, [selectedSalespersonId, queueMode]);

  // ---- schedule tab: indexes built once ----
  const tasksByLead = useMemo(() => {
    const m = new Map<string, any[]>();
    tasks.forEach((t) => { if (t.leadId && t.dueDate && String(t.salespersonId) === String(activeSalesperson.id)) { const a = m.get(t.leadId) || []; a.push(t); m.set(t.leadId, a); } });
    return m;
  }, [tasks, activeSalesperson.id]);
  const dayIndex = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const put = (d: string, id: string) => { if (!d) return; let s = m.get(d); if (!s) { s = new Set(); m.set(d, s); } s.add(id); };
    for (const l of mine) {
      put(dayOf(l.nextFollowUpDate), l.id); put(dayOf(l.expectedClosingDate), l.id); put(dayOf(l.meetingDate), l.id); put(dayOf(l.offerDueDate), l.id);
      if (l.timeline) for (const e of l.timeline) if (WORK_EVENTS.includes(e.type)) put(dayOf(e.timestamp), l.id);
      const tl = tasksByLead.get(l.id); if (tl) for (const t of tl) put(dayOf(t.dueDate), l.id);
    }
    return m;
  }, [mine, tasksByLead]);
  const leadById = useMemo(() => { const m = new Map<string, Lead>(); mine.forEach((l) => m.set(l.id, l)); return m; }, [mine]);
  const scheduleLeads = useMemo(() => [...(dayIndex.get(selectedDate) || [])].map((id) => leadById.get(id)).filter((l): l is Lead => !!l), [dayIndex, selectedDate, leadById]);

  const leadTasksForDate = (lead: Lead) => {
    const out: { type: string; title: string; time?: string; details?: string }[] = [];
    (tasksByLead.get(lead.id) || []).filter((t) => dayOf(t.dueDate) === selectedDate).forEach((t) => {
      let time = 'All day'; try { time = new Date(t.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { /* keep */ }
      out.push({ type: 'Task', title: t.title, time, details: t.description });
    });
    if (dayOf(lead.meetingDate) === selectedDate) out.push({ type: 'Meeting', title: `${lead.status}${lead.meetingTime ? ' at ' + lead.meetingTime : ''}`, details: lead.notes ? lead.notes.slice(0, 160) : undefined });
    if (dayOf(lead.nextFollowUpDate) === selectedDate) out.push({ type: 'Follow-Up', title: 'Scheduled next follow-up', time: lead.nextFollowUpTime || undefined, details: 'Contact the lead to discuss open questions' });
    if (dayOf(lead.offerDueDate) === selectedDate) out.push({ type: 'Follow-Up', title: 'Offer follow-up due', details: 'The offer was sent: ask for feedback' });
    if (lead.expectedClosingDate && dayOf(lead.expectedClosingDate) === selectedDate) out.push({ type: 'Deadline', title: 'Expected closing date', details: 'Action needed to move the negotiation to Won' });
    (lead.timeline || []).forEach((e) => {
      if (WORK_EVENTS.includes(e.type) && dayOf(e.timestamp) === selectedDate) {
        let time = 'All day'; try { time = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { /* keep */ }
        out.push({ type: e.type, title: `${e.type} logged: ${e.title}`, time, details: e.description });
      }
    });
    return out;
  };

  const shiftDay = (n: number) => setSelectedDate(addDays(selectedDate || todayISO(), n));

  // ---- writes (always through crmService.updateLead; the server enforces the rules and shows its own reason) ----
  const apply = useCallback((id: string, build: (fresh: Lead) => Partial<Lead>, ev?: TimelineEvent): boolean => {
    const fresh = crmService.getLeads().find((l) => l.id === id);
    if (!fresh) { toast.error('This lead was not found (it may have been merged or removed).'); return false; }
    const upd = build(fresh);
    upd.timeline = [...(fresh.timeline || []), ...(ev ? [ev] : [])];
    try { crmService.updateLead(id, upd, user?.name || 'Agent'); } catch (e: any) { toast.error(e?.message || 'Could not save the change.'); return false; }
    onLeadsUpdated();
    return true;
  }, [user, onLeadsUpdated]);
  const mkEvent = (type: TimelineEvent['type'], title: string, description: string, ts = new Date().toISOString()): TimelineEvent => ({
    id: `${type.toLowerCase()}_${Math.random().toString(36).slice(2, 11)}`, timestamp: ts, type, user: user?.name || 'Agent', title, description,
  });
  const pushActivity = (type: 'Call' | 'Email' | 'WhatsApp' | 'Meeting' | 'Visit', lead: Lead, ts: string, text: string) => {
    if (!user) return;
    const acts = crmService.getActivities();
    acts.unshift({ id: 'act_' + Math.random().toString(36).slice(2, 11), salespersonId: String(user.id), salespersonName: user.name || '—', type, leadId: lead.id, leadName: lead.customerName, timestamp: ts, notes: text });
    crmService.saveActivities(acts);
  };
  const isOwner = (l: Lead) => !!user && String(l.assignedSalespersonId) === String(user.id);
  const touched = (l: Lead): Partial<Lead> => ({ lastContactDate: todayISO(), ...(isOwner(l) && !l.firstContactAt ? { firstContactAt: new Date().toISOString() } : {}) });

  const openLead = (id: string) => { window.dispatchEvent(new CustomEvent('app-open-lead', { detail: { id } })); };
  // every number opens exactly the leads behind it in the Leads list
  const go = (title: string, ls: Lead[]) => crmNav.leads({ title, ids: ls.map((l) => l.id) });
  const Num: React.FC<{ n: number | string; title: string; leads: Lead[]; className?: string }> = ({ n, title, leads: ls, className = '' }) => (
    ls.length ? <button type="button" onClick={() => go(title, ls)} title={`Show these ${ls.length} leads in the Leads list`} className={`${className} underline decoration-dotted underline-offset-2 hover:opacity-70 cursor-pointer`}>{n}</button> : <span className={className}>{n}</span>
  );

  const openModal = (kind: Exclude<ModalKind, null>, l: Lead) => {
    setTarget(l); setNotes(''); setModal(kind);
    const now = new Date();
    if (kind === 'outcome') { setOutcome('theirs'); setComeBack(3); setOutTime('09:00'); }
    if (kind === 'log') { setIType('call'); setIDate(todayISO()); setITime(cairoTimeHM(now)); setIPlace(''); setISchedule(true); }
    if (kind === 'status') { setStStatus(''); setStDate(l.meetingDate || addDays(todayISO(), 1)); setStTime(l.meetingTime || '10:00'); setStNext(l.nextFollowUpDate || addDays(todayISO(), 3)); setStReason(''); setStCat(''); }
    if (kind === 'resched') { setFuDate(dayOf(l.nextFollowUpDate) || addDays(todayISO(), 1)); setFuTime(l.nextFollowUpTime || ''); }
  };

  const saveOutcome = () => {
    if (!target) return;
    const next = addDays(todayISO(), comeBack);
    const label = { theirs: 'Spoke to the client: they will come back to us', mine: 'I need to call again', send: 'I owe the client something', none: 'Contact made, no next step' }[outcome];
    if (outcome === 'mine' && !/^\d{2}:\d{2}$/.test(outTime)) { toast.error('Call Back needs the time of the call.'); return; }
    if (outcome === 'mine' && !notes.trim()) { toast.error('Call Back needs a short note.'); return; }
    const ok = apply(target.id, (l) => ({
      ...touched(l),
      ...(outcome === 'theirs' ? { status: 'Client Will Call Back' as LeadStatus, nextFollowUpDate: next, meetingDate: '', meetingTime: '' } : {}),
      ...(outcome === 'mine' ? { status: 'Call Back' as LeadStatus, nextFollowUpDate: next, meetingDate: next, meetingTime: outTime } : {}),
      ...(outcome === 'send' ? { nextFollowUpDate: next } : {}),
      ...(outcome === 'none' ? { nextFollowUpDate: '' } : {}),
    }), mkEvent('Call', label, `${notes.trim()}${outcome !== 'none' ? `${notes.trim() ? '\n' : ''}Next action: ${fmtDay(next)}` : ''}`));
    if (ok) { pushActivity('Call', target, new Date().toISOString(), `${label}. ${notes.trim()}`.trim()); toast.success(`Logged for ${target.customerName || target.id}`); setModal(null); setPinned(null); }
  };

  const saveInteraction = () => {
    if (!target) return;
    const when = new Date(`${iDate}T${iTime}:00`);
    if (!iDate || !iTime || Number.isNaN(when.getTime())) { toast.error('Enter a valid date and time.'); return; }
    const typeName = { call: 'Call', whatsapp: 'WhatsApp', email: 'Email', meeting: 'Meeting', visit: 'Visit' }[iType] as 'Call' | 'WhatsApp' | 'Email' | 'Meeting' | 'Visit';
    let desc = notes.trim();
    if (iType === 'meeting' && iPlace) desc += `${desc ? '\n' : ''}Location: ${iPlace}`;
    if (iType === 'visit' && iPlace) desc += `${desc ? '\n' : ''}Project: ${iPlace}`;
    const setSlot = (iType === 'meeting' || iType === 'visit') && iSchedule && iDate >= todayISO();
    if (setSlot && !desc) { toast.error('A scheduled meeting needs a short note (agenda or place).'); return; }
    const ok = apply(target.id, (l) => ({
      ...touched(l),
      ...(setSlot ? { status: (iType === 'meeting' ? 'Scheduled Meeting' : 'Site Visit Scheduled') as LeadStatus, meetingDate: iDate, meetingTime: iTime, nextFollowUpDate: l.nextFollowUpDate || iDate } : {}),
    }), mkEvent(typeName, `${typeName} - ${target.customerName}`, desc, when.toISOString()));
    if (ok) { pushActivity(typeName, target, when.toISOString(), desc); toast.success(`${typeName} logged for ${target.id}`); setModal(null); }
  };

  const saveStatus = () => {
    if (!target || !stStatus) { toast.error('Choose a status.'); return; }
    const needsSlot = REQ_DATETIME.includes(stStatus);
    const needsNext = REQ_FOLLOWUP.includes(stStatus);
    if (needsSlot && (!stDate || !stTime || !notes.trim())) { toast.error(`${stStatus} needs a date, a time and a note.`); return; }
    if (needsNext && !stNext) { toast.error(`${stStatus} needs the next follow-up date.`); return; }
    if (stStatus === 'Lost' && !stReason) { toast.error('Lost needs the reason.'); return; }
    const ok = apply(target.id, (l) => ({
      ...touched(l),
      status: stStatus as LeadStatus,
      meetingDate: needsSlot ? stDate : '', meetingTime: needsSlot ? stTime : '',
      ...(needsSlot ? { nextFollowUpDate: l.nextFollowUpDate || stDate } : {}),
      ...(needsNext ? { nextFollowUpDate: stNext } : {}),
      ...(stStatus === 'Lost' ? { lostReason: stReason, lostCategory: stCat || l.lostCategory } : {}),
      ...(ACTIVE_EXCLUDE.includes(stStatus) ? { nextFollowUpDate: '' } : {}),
    }), notes.trim() ? mkEvent('Comment', `Status note: ${stStatus}`, notes.trim()) : undefined);
    if (ok) { toast.success(`Status set to ${stStatus}`); setModal(null); setPinned(null); }
  };

  const saveResched = () => {
    if (!target) return;
    if (fuDate && !/^\d{4}-\d{2}-\d{2}$/.test(fuDate)) { toast.error('Choose a valid follow-up date.'); return; }
    const ok = apply(target.id, () => ({ nextFollowUpDate: fuDate || '', nextFollowUpTime: fuTime || '' }),
      mkEvent('Comment', 'Follow-up rescheduled', fuDate ? `Next action set to ${fuDate}${fuTime ? ' ' + fuTime : ''}` : 'Next action cleared'));
    if (ok) { toast.success(fuDate ? `Follow-up set to ${fmtDay(fuDate)}` : 'Follow-up cleared'); setModal(null); setPinned(null); }
  };

  const setBatchSize = (n: number) => { const v = Math.min(20, Math.max(1, n)); setBatch(v); try { localStorage.setItem(BATCH_KEY, String(v)); } catch { /* ignore */ } };

  // ---- small render helpers ----
  const waHref = (l: Lead) => {
    const num = phoneIntl(l.phoneNumber).replace('+', '');
    if (!num) return '';
    const me = repNameFromEmail(user?.email, user?.name || '');
    const text = signOff(waFill(waCompose(suggestTemplate(l)), l, me, { date: dayOf(l.meetingDate) ? fmtDay(dayOf(l.meetingDate)) : undefined, time: l.meetingTime || undefined }), me);
    return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  };
  const telHref = (l: Lead) => { const n = phoneIntl(l.phoneNumber); return n ? `tel:${n}` : ''; };
  const priorityPill = (p: string) => (p === 'VIP' || p === 'Urgent' ? 'bg-purple-100 text-purple-800' : p === 'High' ? 'bg-orange-100 text-orange-700' : p === 'Low' ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700');
  const sub = (l: Lead) => [l.companyName ? l.customerName : '', l.project, l.source].filter(Boolean).join(' · ');
  const fieldCls = 'w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-brand-red text-brand-black';
  const lbl = 'block text-[10px] uppercase font-bold text-brand-gray mb-1.5';

  const QuickActions: React.FC<{ l: Lead; compact?: boolean }> = ({ l, compact }) => {
    const tel = telHref(l); const wa = waHref(l);
    const b = 'px-2.5 py-1.5 rounded-xl text-[10px] font-extrabold flex items-center justify-center gap-1 transition-all';
    return (
      <div className={`flex ${compact ? 'flex-row flex-wrap' : 'flex-row md:flex-col'} gap-1.5`}>
        {tel ? <a href={tel} className={`${b} bg-emerald-600 text-white hover:opacity-90`}><Phone size={12} />Call</a> : <span className={`${b} bg-brand-gray/10 text-brand-gray`} title="No usable phone number"><Phone size={12} />No phone</span>}
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className={`${b} bg-green-500 text-white hover:opacity-90`}><MessageSquare size={12} />WhatsApp</a>}
        <button onClick={() => openModal('log', l)} className={`${b} bg-brand-red text-white hover:opacity-90`}><Calendar size={12} />Log</button>
        <button onClick={() => openModal('status', l)} className={`${b} bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black`}><CheckCircle size={12} />Status</button>
        <button onClick={() => openModal('resched', l)} className={`${b} bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black`}><Clock size={12} />Reschedule</button>
        <button onClick={() => openLead(l.id)} className={`${b} bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black`}><ExternalLink size={12} />Open</button>
      </div>
    );
  };

  const TaskRow: React.FC<{ t: DayTask }> = ({ t }) => (
    <div className="flex items-center gap-3 py-2 px-3 hover:bg-brand-gray/5 rounded-xl cursor-pointer" onClick={() => { setPinned(t.lead.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
      <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full shrink-0 ${LEVEL_STYLE[t.level]}`}>{DAY_LEVEL[t.level].split(' ')[0]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-brand-black truncate">{t.lead.companyName || t.lead.customerName || t.lead.id} <span className="font-normal text-brand-gray">· {t.lead.status}</span></p>
        <p className="text-[10px] text-brand-gray truncate">{t.why}</p>
      </div>
      {t.sla && <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 shrink-0">{t.sla === 'vip' ? 'VIP SLA' : 'Neglected'}</span>}
      <button type="button" onClick={(e) => { e.stopPropagation(); openLead(t.lead.id); }} title="Open the lead card" className="font-mono text-[10px] text-brand-red shrink-0 underline decoration-dotted underline-offset-2 hover:opacity-70">{t.lead.id}</button>
    </div>
  );

  // =============================================================================================
  return (
    <div className="space-y-6" id="crm-my-day-workspace">
      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bento-card">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-brand-black dark:text-white">My Tasks</h2>
          <p className="text-xs text-brand-gray dark:text-white/60 mt-1">
            {viewingSelf ? 'Your day' : `Day of ${activeSalesperson.name}`}: who to call first, what is due, what is waiting for you. One task per lead, best first.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-brand-gray/10 dark:bg-white/10 rounded-xl p-1">
            {(['priority', 'schedule'] as const).map((k) => (
              <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${tab === k ? 'bg-white dark:bg-brand-black text-brand-black dark:text-white shadow-sm' : 'text-brand-gray dark:text-white/60'}`}>
                {k === 'priority' ? 'Priority list' : 'Schedule & calendar'}
              </button>
            ))}
          </div>
          {canFilterSalespeople && salesPersonOptions.length > 1 && (
            <div className="flex items-center gap-2 bg-brand-gray/5 dark:bg-white/5 px-3 py-1.5 rounded-xl border border-brand-gray/10 dark:border-white/10">
              <Users size={14} className="text-brand-gray dark:text-white/40" />
              <select value={selectedSalespersonId} onChange={(e) => setSelectedSalespersonId(e.target.value)} className="bg-transparent text-brand-black dark:text-white text-xs font-bold focus:outline-none border-none cursor-pointer pr-4">
                {salesPersonOptions.map((p) => <option key={p.id} value={p.id} className="bg-white dark:bg-brand-black text-brand-black dark:text-white">{p.name} ({p.role || 'Sales Rep'})</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bento-card relative overflow-hidden">
          <span className="text-[10px] font-extrabold text-brand-gray dark:text-white/40 uppercase tracking-wider block mb-2">My leads <InfoTip text="Leads assigned to this person. Open = not Won, Lost, Not Interested, Low Budget or Wrong Number. Not yet worked = open leads nobody has contacted." /></span>
          <div className="flex items-baseline gap-2"><Num n={stats.total} title="My leads" leads={mine} className="text-3xl font-black text-brand-black dark:text-white" /><span className="text-xs text-brand-gray">assigned</span></div>
          <div className="mt-3 space-y-1 text-[10px] font-semibold text-brand-gray">
            <div className="flex justify-between"><span>Open</span><Num n={stats.active} title="My open leads" leads={stats.L.active} className="text-brand-red font-bold" /></div>
            <div className="flex justify-between"><span>Not yet worked</span><Num n={stats.unworked} title="Not yet worked" leads={stats.L.unworked} className="font-bold text-sky-600" /></div>
            <div className="flex justify-between"><span>In offer / meeting / negotiation</span><Num n={stats.pipeline} title="In offer / meeting / negotiation" leads={stats.L.pipeline} className="font-bold text-amber-600" /></div>
            <div className="flex justify-between"><span>Won</span><Num n={stats.won} title="Won deals" leads={stats.L.won} className="font-bold text-emerald-600" /></div>
          </div>
        </div>
        <div className="bento-card">
          <span className="text-[10px] font-extrabold text-brand-gray dark:text-white/40 uppercase tracking-wider block mb-2">Open pipeline value <InfoTip text="Sum of the deal value of open leads that carry one. Leads without a value add nothing, so this understates until values are typed." /></span>
          <span className="text-2xl font-black text-emerald-600">{stats.activeValue > 0 ? fmtEGP(stats.activeValue) : '—'}</span>
          <div className="mt-4 pt-3 border-t border-brand-gray/10 space-y-1 text-[10px] font-semibold text-brand-gray">
            <div className="flex justify-between"><span>Top source</span><span className="font-extrabold text-brand-black dark:text-white">{stats.topSource}</span></div>
            <div className="flex justify-between"><span>Average size asked</span><span className="font-extrabold text-brand-black dark:text-white">{stats.avgSize ? `${stats.avgSize.toLocaleString('en-US')} sqm` : '—'}</span></div>
          </div>
        </div>
        <div className="bento-card">
          <span className="text-[10px] font-extrabold text-brand-gray dark:text-white/40 uppercase tracking-wider block mb-2">Win rate <InfoTip text="Won ÷ (Won + Lost) of this person's leads. Not Interested and Low Budget are not counted here." /></span>
          <span className="text-3xl font-black text-indigo-600">{stats.win == null ? '—' : `${Math.round(stats.win)}%`}</span>
          <div className="mt-4 pt-3 border-t border-brand-gray/10 flex justify-between text-center text-[10px] font-extrabold">
            <div className="flex-1"><Num n={stats.won} title="Won deals" leads={stats.L.won} className="text-emerald-500 block text-base mx-auto" /><span className="text-[8px] uppercase text-brand-gray">Won</span></div>
            <div className="flex-1"><Num n={stats.lost} title="Lost deals" leads={stats.L.lost} className="text-rose-500 block text-base mx-auto" /><span className="text-[8px] uppercase text-brand-gray">Lost</span></div>
          </div>
        </div>
        <div className="bento-card">
          <span className="text-[10px] font-extrabold text-brand-gray dark:text-white/40 uppercase tracking-wider block mb-2">Needs attention <InfoTip text={`First-call SLA: a VIP lead with no first contact for more than ${VIP_SLA_HOURS} h, or any lead for more than ${NEGLECT_HOURS} h, counted from the moment it was assigned (or 09:00 on the lead date).`} /></span>
          <div className="flex items-baseline gap-2"><Num n={board.callList.filter((t) => t.level === 0).length} title="Must do today" leads={board.callList.filter((t) => t.level === 0).map((t) => t.lead)} className="text-3xl font-black text-rose-600" /><span className="text-xs text-brand-gray">must do today</span></div>
          <div className="mt-3 pt-3 border-t border-brand-gray/10 space-y-1 text-[10px] font-semibold text-brand-gray">
            <div className="flex justify-between"><span>VIP first call overdue</span><Num n={board.first.filter((t) => t.sla === 'vip').length} title="VIP first call overdue" leads={board.first.filter((t) => t.sla === 'vip').map((t) => t.lead)} className="font-extrabold text-rose-500" /></div>
            <div className="flex justify-between"><span>Neglected (no first call)</span><Num n={board.first.filter((t) => t.sla).length} title="Neglected: no first call" leads={board.first.filter((t) => t.sla).map((t) => t.lead)} className="font-extrabold text-rose-500" /></div>
            <div className="flex justify-between"><span>Main reason for loss</span><span className="font-extrabold text-brand-black dark:text-white">{stats.topLost}</span></div>
          </div>
        </div>
      </div>

      {tab === 'priority' ? (
        <>
          {/* queue switch */}
          <div className="bento-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex bg-brand-gray/10 rounded-xl p-1">
                <button onClick={() => { setQueueMode('follow'); setPinned(null); }} className={`px-4 py-1.5 rounded-lg text-xs font-bold ${mode === 'follow' ? 'bg-white shadow-sm text-brand-black' : 'text-brand-gray'}`}>Follow-ups <span className="font-mono">{followQ.length}</span></button>
                <button onClick={() => { setQueueMode('new'); setPinned(null); }} className={`px-4 py-1.5 rounded-lg text-xs font-bold ${mode === 'new' ? 'bg-white shadow-sm text-brand-black' : 'text-brand-gray'}`}>Call first <span className="font-mono">{board.first.length}</span></button>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-bold text-brand-gray">
                <Settings2 size={12} /> Today's batch of new leads
                <button onClick={() => setBatchSize(batch - 1)} className="w-6 h-6 rounded-lg bg-brand-gray/10 hover:bg-brand-gray/20" aria-label="Smaller batch">−</button>
                <span className="font-mono text-brand-black w-5 text-center">{batch}</span>
                <button onClick={() => setBatchSize(batch + 1)} className="w-6 h-6 rounded-lg bg-brand-gray/10 hover:bg-brand-gray/20" aria-label="Bigger batch">+</button>
                <InfoTip text="Leads nobody has contacted are never 'overdue'. They wait in the Call first queue, and you take them a few at a time (1 to 20, saved on this computer)." />
              </div>
            </div>
            <p className="text-[11px] text-brand-gray">
              {mode === 'follow' ? 'Clients who were spoken to and are waiting to hear back, ranked by urgency. Nothing here is a lead nobody has opened.' : `Nobody has contacted these yet, so none is overdue. Today's batch is ${batch}.`}
            </p>
            <div className="flex items-center justify-between text-xs font-bold text-brand-black">
              <span>{parseLocalDay(today).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
              <span className="text-brand-gray">{doneN} done · <Num n={`${queue.length} to go`} title="Still to do today" leads={queue.map((t) => t.lead)} className="text-brand-red" /></span>
            </div>
            <div className="h-1.5 bg-brand-gray/10 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>

            {/* hero */}
            {hero ? (
              <div className="border-2 border-brand-red/25 rounded-2xl p-5 bg-brand-red/5 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${LEVEL_STYLE[hero.level]}`}>{DAY_LEVEL[hero.level]}</span>
                  {hero.sla === 'vip' && <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-rose-600 text-white flex items-center gap-1"><Flame size={10} />VIP SLA breached</span>}
                  {hero.sla === 'neglect' && <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-rose-600 text-white flex items-center gap-1"><Hourglass size={10} />Neglected</span>}
                  <span className="text-xs font-bold text-brand-red">{hero.why}</span>
                </div>
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button type="button" onClick={() => openLead(hero.lead.id)} title="Open the lead card" className="font-mono text-xs font-extrabold text-brand-red underline decoration-dotted underline-offset-2 hover:opacity-70">{hero.lead.id}</button>
                      <h4 className="font-bold text-base text-brand-black truncate">{hero.lead.companyName || hero.lead.customerName}</h4>
                      <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${priorityPill(hero.lead.priority)}`}>{hero.lead.priority}</span>
                      <span className="bg-brand-black text-white text-[9px] font-extrabold px-2 py-0.5 rounded-full">{hero.lead.status}</span>
                    </div>
                    <p className="text-[11px] text-brand-gray">{sub(hero.lead)}</p>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-brand-gray font-medium">
                      <span className="flex items-center gap-1"><Phone size={12} />{hero.lead.phoneNumber || '—'}</span>
                      <span className="flex items-center gap-1"><Briefcase size={12} />{Number(hero.lead.dealValue) > 0 ? fmtEGP(Number(hero.lead.dealValue)) : Number(hero.lead.requiredSize) > 0 ? `${Number(hero.lead.requiredSize).toLocaleString('en-US')} sqm` : 'size n/a'}</span>
                      <span className="flex items-center gap-1"><Clock size={12} />{hero.gap == null ? 'never contacted' : `${hero.gap} d since contact`}</span>
                      {hero.lead.nextFollowUpDate && <span className="flex items-center gap-1"><Calendar size={12} />next {fmtDay(dayOf(hero.lead.nextFollowUpDate))}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 md:w-56">
                    <div className="flex gap-1.5">
                      {telHref(hero.lead) ? <a href={telHref(hero.lead)} onClick={() => logAttempt(hero.lead, 'call', user, telHref(hero.lead).slice(4))} className="flex-1 bg-emerald-600 text-white rounded-xl py-2 text-xs font-extrabold flex items-center justify-center gap-1 hover:opacity-90"><Phone size={13} />Call</a> : <span className="flex-1 bg-brand-gray/10 text-brand-gray rounded-xl py-2 text-xs font-bold text-center">No phone</span>}
                      {waHref(hero.lead) && <a href={waHref(hero.lead)} target="_blank" rel="noopener noreferrer" onClick={() => logAttempt(hero.lead, 'whatsapp', user, decodeURIComponent(waHref(hero.lead).split('text=')[1] || ''))} className="flex-1 bg-green-500 text-white rounded-xl py-2 text-xs font-extrabold flex items-center justify-center gap-1 hover:opacity-90"><MessageSquare size={13} />WhatsApp</a>}
                    </div>
                    <button onClick={() => openModal('outcome', hero.lead)} className="bg-brand-red text-white rounded-xl py-2 text-xs font-extrabold flex items-center justify-center gap-1 hover:opacity-90"><CheckCircle size={13} />Done — log it</button>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button onClick={() => openModal('status', hero.lead)} className="bg-white border border-brand-gray/20 rounded-xl py-1.5 text-[10px] font-bold hover:bg-brand-gray/5">Status</button>
                      <button onClick={() => openModal('resched', hero.lead)} className="bg-white border border-brand-gray/20 rounded-xl py-1.5 text-[10px] font-bold hover:bg-brand-gray/5">Reschedule</button>
                      <button onClick={() => openLead(hero.lead.id)} className="bg-white border border-brand-gray/20 rounded-xl py-1.5 text-[10px] font-bold hover:bg-brand-gray/5">Open</button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-brand-gray/10 text-[11px] font-bold text-brand-gray">
                  <button disabled={!pinned && idx === 0} onClick={() => { if (pinned) setPinned(null); else setCursor(Math.max(0, idx - 1)); }} className="flex items-center gap-1 disabled:opacity-30"><ArrowLeft size={12} />{pinned ? 'Back to my queue' : 'back'}</button>
                  <span>{pinned ? 'picked from the list' : `${idx + 1} of ${queue.length}`}{!pinned && queue[idx + 1] ? ` · next: ${(queue[idx + 1].lead.companyName || queue[idx + 1].lead.customerName || '').slice(0, 28)}` : ''}</span>
                  <button disabled={!pinned && idx >= queue.length - 1} onClick={() => { if (pinned) setPinned(null); else setCursor(Math.min(queue.length - 1, idx + 1)); }} className="flex items-center gap-1 disabled:opacity-30">Skip<SkipForward size={12} /></button>
                </div>
              </div>
            ) : (
              <div className="py-10 text-center space-y-2">
                <CheckCircle size={32} className="mx-auto text-emerald-500" />
                <h4 className="font-bold text-sm text-brand-black">{mode === 'follow' ? 'No follow-ups waiting' : 'No new leads to start'}</h4>
                <p className="text-xs text-brand-gray">{mode === 'follow' ? 'Nobody is waiting on you right now.' : 'Every lead has been opened.'}</p>
                <div className="flex justify-center gap-2 pt-1">
                  {mode === 'follow' && board.first.length > 0 && <button onClick={() => setQueueMode('new')} className="btn-primary text-xs px-4 py-2">Start on new leads</button>}
                  <button onClick={() => go('My leads', mine)} className="btn-secondary text-xs px-4 py-2">Open my leads</button>
                </div>
              </div>
            )}
          </div>

          {/* folds */}
          <div className="space-y-3">
            {FOLDS.map((f) => {
              const rows = board.by[f.kind];
              if (!rows.length) return null;
              const list = f.kind === 'first' ? rows.slice(batch) : rows;
              if (!list.length) return null;
              const isOpenFold = open[f.kind];
              return (
                <div key={f.kind} className="bento-card !p-0 overflow-hidden">
                  <div className="w-full flex items-center gap-3 px-5 py-3 hover:bg-brand-gray/5">
                    <button onClick={() => setOpen({ ...open, [f.kind]: !isOpenFold })} className="flex-1 text-left"><span className={`text-xs font-extrabold uppercase tracking-wide ${f.tone}`}>{f.title}</span></button>
                    <button onClick={() => go(f.title, list.map((t) => t.lead))} title="Show these leads in the Leads list" className="font-mono text-xs font-bold text-brand-red underline decoration-dotted underline-offset-2 hover:opacity-70">({list.length})</button>
                    <button onClick={() => setOpen({ ...open, [f.kind]: !isOpenFold })} aria-label="Expand or collapse">{isOpenFold ? <ChevronUp size={14} className="text-brand-gray" /> : <ChevronDown size={14} className="text-brand-gray" />}</button>
                  </div>
                  {isOpenFold && (
                    <div className="px-2 pb-3">
                      {list.slice(0, f.cap).map((t) => <TaskRow key={t.lead.id} t={t} />)}
                      {list.length > f.cap && <p className="text-[10px] text-brand-gray px-3 pt-2">+ {list.length - f.cap} more in the leads page.</p>}
                    </div>
                  )}
                </div>
              );
            })}
            {board.wonPendingAR.length > 0 && (
              <div className="bento-card !p-0 overflow-hidden">
                <div className="w-full flex items-center gap-3 px-5 py-3 hover:bg-brand-gray/5">
                  <button onClick={() => setOpen({ ...open, ar: !open.ar })} className="flex-1 text-left"><span className="text-xs font-extrabold uppercase tracking-wide text-amber-600 flex items-center gap-1.5"><Wallet size={13} />Won — cash not yet confirmed by Accounts Receivable </span></button>
                  <button onClick={() => go('Won — cash not yet confirmed', board.wonPendingAR)} title="Show these leads in the Leads list" className="font-mono text-xs font-bold text-brand-red underline decoration-dotted underline-offset-2 hover:opacity-70">({board.wonPendingAR.length})</button>
                  <button onClick={() => setOpen({ ...open, ar: !open.ar })} aria-label="Expand or collapse">{open.ar ? <ChevronUp size={14} className="text-brand-gray" /> : <ChevronDown size={14} className="text-brand-gray" />}</button>
                </div>
                {open.ar && (
                  <div className="px-2 pb-3">
                    {board.wonPendingAR.slice(0, 40).map((l) => (
                      <div key={l.id} className="flex items-center gap-3 py-2 px-3 hover:bg-brand-gray/5 rounded-xl cursor-pointer" onClick={() => openLead(l.id)}>
                        <div className="min-w-0 flex-1"><p className="text-xs font-bold truncate">{l.companyName || l.customerName}</p><p className="text-[10px] text-brand-gray">{l.project} · won {fmtDay(dayOf(l.wonDate))}</p></div>
                        <span className="font-mono text-[11px] font-bold">{Number(l.dealValue) > 0 ? fmtEGP(Number(l.dealValue)) : '—'}</span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); openLead(l.id); }} title="Open the lead card" className="font-mono text-[10px] text-brand-red underline decoration-dotted underline-offset-2 hover:opacity-70">{l.id}</button>
                      </div>
                    ))}
                    <p className="text-[10px] text-brand-gray px-3 pt-2">Only Accounts Receivable confirms the cash. Ask the client to complete payment.</p>
                  </div>
                )}
              </div>
            )}
            {board.contractDue.length > 0 && (
              <div className="bento-card !p-0 overflow-hidden">
                <div className="w-full flex items-center gap-3 px-5 py-3 hover:bg-brand-gray/5">
                  <button onClick={() => setOpen({ ...open, ct: !open.ct })} className="flex-1 text-left"><span className="text-xs font-extrabold uppercase tracking-wide text-indigo-600 flex items-center gap-1.5"><FileText size={13} />Deals awaiting a contract </span></button>
                  <button onClick={() => go('Deals awaiting a contract', board.contractDue.map((c) => c.lead))} title="Show these leads in the Leads list" className="font-mono text-xs font-bold text-brand-red underline decoration-dotted underline-offset-2 hover:opacity-70">({board.contractDue.length})</button>
                  <button onClick={() => setOpen({ ...open, ct: !open.ct })} aria-label="Expand or collapse">{open.ct ? <ChevronUp size={14} className="text-brand-gray" /> : <ChevronDown size={14} className="text-brand-gray" />}</button>
                </div>
                {open.ct && (
                  <div className="px-2 pb-3">
                    {board.contractDue.slice(0, 40).map((c) => (
                      <div key={c.lead.id} className="flex items-center gap-3 py-2 px-3 hover:bg-brand-gray/5 rounded-xl cursor-pointer" onClick={() => openLead(c.lead.id)}>
                        <div className="min-w-0 flex-1"><p className="text-xs font-bold truncate">{c.lead.companyName || c.lead.customerName}</p><p className="text-[10px] text-brand-gray">{c.lead.project} · {c.since ? `since ${fmtDay(c.since)}` : 'date not recorded'}</p></div>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${c.days >= CONTRACT_REMIND_DAYS ? 'bg-rose-100 text-rose-700' : 'bg-brand-gray/10 text-brand-gray'}`}>{c.since ? `${c.days} d` : '—'}</span>
                        <span className="font-mono text-[10px] text-brand-red">{c.lead.id}</span>
                      </div>
                    ))}
                    <p className="text-[10px] text-brand-gray px-3 pt-2">Reservation made (or deal won) with no contract date yet. Reminder after {CONTRACT_REMIND_DAYS} days.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="bento-card" id="crm-my-day-agenda-container">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6 pb-6 border-b border-brand-gray/10 dark:border-white/10">
            <div className="flex items-center gap-3">
              <Calendar className="text-brand-red" size={20} />
              <h3 className="font-extrabold text-sm uppercase text-brand-black dark:text-white tracking-wide">Scheduled workspace</h3>
              <div className="flex bg-brand-gray/10 rounded-xl p-1">
                {(['list', 'calendar'] as const).map((m) => <button key={m} onClick={() => setViewMode(m)} className={`px-3 py-1 rounded-lg text-[10px] font-bold ${viewMode === m ? 'bg-white shadow-sm text-brand-black' : 'text-brand-gray'}`}>{m === 'list' ? 'List' : 'Calendar'}</button>)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => shiftDay(-1)} className="p-2 border border-brand-gray/20 rounded-xl hover:bg-brand-gray/5" title="Previous day"><ChevronLeft size={16} /></button>
              <button onClick={() => setSelectedDate(todayISO())} className="px-3 py-2 text-xs font-bold bg-brand-gray/10 rounded-xl hover:bg-brand-gray/15">Today</button>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="px-3 py-1.5 border border-brand-gray/20 rounded-xl bg-transparent text-xs font-bold focus:outline-none focus:border-brand-red" />
              <button onClick={() => shiftDay(1)} className="p-2 border border-brand-gray/20 rounded-xl hover:bg-brand-gray/5" title="Next day"><ChevronRight size={16} /></button>
            </div>
          </div>

          {viewMode === 'calendar' ? (
            <div className="overflow-x-auto">
              <h3 className="font-bold text-lg text-brand-black mb-4">{parseLocalDay(selectedDate || todayISO()).toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
              <div className="grid grid-cols-7 gap-px bg-brand-gray/20 border border-brand-gray/20 rounded-xl overflow-hidden min-w-[700px]">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="bg-brand-gray/5 p-2 text-center text-[10px] font-extrabold text-brand-gray uppercase tracking-wider">{d}</div>)}
                {(() => {
                  const cur = parseLocalDay(selectedDate || todayISO());
                  const y = cur.getFullYear(); const mo = cur.getMonth();
                  const cells: (string | null)[] = [];
                  for (let i = 0; i < new Date(y, mo, 1).getDay(); i++) cells.push(null);
                  for (let i = 1; i <= new Date(y, mo + 1, 0).getDate(); i++) cells.push(localISO(new Date(y, mo, i)));
                  while (cells.length % 7) cells.push(null);
                  return cells.map((d, i) => {
                    if (!d) return <div key={`e${i}`} className="bg-white p-2 min-h-[90px]" />;
                    const ids = [...(dayIndex.get(d) || [])];
                    return (
                      <div key={d} onClick={() => { setSelectedDate(d); setViewMode('list'); }} className={`bg-white p-2 min-h-[90px] cursor-pointer hover:bg-brand-gray/5 ${d === selectedDate ? 'ring-2 ring-inset ring-brand-red' : ''}`}>
                        <span className={`text-[10px] font-bold inline-flex items-center justify-center w-6 h-6 rounded-full ${d === today ? 'bg-brand-red text-white' : 'text-brand-gray'}`}>{Number(d.slice(8))}</span>
                        <div className="mt-1 flex flex-col gap-1">
                          {ids.slice(0, 2).map((id) => <div key={id} className="text-[9px] truncate bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">{leadById.get(id)?.customerName || id}</div>)}
                          {ids.length > 2 && <div className="text-[9px] text-brand-gray font-bold px-1">+ {ids.length - 2} more</div>}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          ) : scheduleLeads.length === 0 ? (
            <div className="py-14 text-center space-y-3">
              <Clock size={32} className="mx-auto text-brand-gray/40" />
              <h4 className="font-bold text-sm text-brand-black">All clear for {parseLocalDay(selectedDate || todayISO()).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</h4>
              <p className="text-xs text-brand-gray max-w-md mx-auto">No meetings, site visits, offer follow-ups, follow-ups or expected closings are set for this date.</p>
              <button onClick={() => go('My leads', mine)} className="btn-primary text-xs font-extrabold px-4 py-2">Open the leads</button>
            </div>
          ) : (
            <div className="space-y-4">
              <span className="text-[10px] font-extrabold text-brand-gray uppercase tracking-widest block">{scheduleLeads.length} lead{scheduleLeads.length > 1 ? 's' : ''} with something on this day</span>
              {scheduleLeads.slice(0, 100).map((lead) => (
                <div key={lead.id} className="border border-brand-gray/15 rounded-2xl bg-brand-gray/5 hover:border-brand-red/30 transition-all p-5 flex flex-col md:flex-row justify-between gap-4">
                  <div className="space-y-3 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-extrabold text-brand-red">{lead.id}</span>
                      <h4 className="font-bold text-sm text-brand-black">{lead.customerName}</h4>
                      <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${priorityPill(lead.priority)}`}>{lead.priority}</span>
                      <span className="bg-brand-black text-white/80 text-[9px] font-extrabold px-2 py-0.5 rounded-full">{lead.status}{SLOW_STATUSES.has(lead.status) ? '' : ' (older status)'}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-brand-gray font-medium">
                      <span className="flex items-center gap-1.5"><Phone size={12} />{lead.phoneNumber || '—'}</span>
                      <span className="flex items-center gap-1.5"><Briefcase size={12} />{lead.project || '—'} ({Number(lead.requiredSize) > 0 ? `${lead.requiredSize} sqm` : 'size n/a'})</span>
                    </div>
                    <div className="bg-white rounded-xl p-3 border border-brand-gray/10 space-y-2">
                      <span className="text-[9px] font-extrabold text-brand-gray uppercase tracking-wider block">Day's scheduled focus</span>
                      {leadTasksForDate(lead).map((task, i) => (
                        <div key={i} className="flex gap-2 text-[11px] leading-relaxed">
                          {task.type === 'Follow-Up' && <Clock className="text-amber-500 mt-0.5 shrink-0" size={13} />}
                          {task.type === 'Deadline' && <AlertCircle className="text-rose-500 mt-0.5 shrink-0" size={13} />}
                          {task.type === 'Meeting' && <Calendar className="text-indigo-500 mt-0.5 shrink-0" size={13} />}
                          {task.type === 'Visit' && <MapPin className="text-amber-600 mt-0.5 shrink-0" size={13} />}
                          {task.type === 'Call' && <Phone className="text-emerald-500 mt-0.5 shrink-0" size={13} />}
                          {task.type === 'WhatsApp' && <MessageSquare className="text-green-500 mt-0.5 shrink-0" size={13} />}
                          {task.type === 'Email' && <Mail className="text-blue-500 mt-0.5 shrink-0" size={13} />}
                          <div className="flex-1"><span className="font-extrabold text-brand-black">{task.title}</span>{task.time && <span className="text-[10px] text-brand-gray ml-2">({task.time})</span>}{task.details && <p className="text-[10px] text-brand-gray mt-0.5 italic">{task.details}</p>}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="md:w-44 shrink-0"><QuickActions l={lead} /></div>
                </div>
              ))}
              {scheduleLeads.length > 100 && <p className="text-[10px] text-brand-gray">Showing 100 of {scheduleLeads.length}.</p>}
            </div>
          )}
        </div>
      )}

      {/* ---------------- modals ---------------- */}
      {modal && target && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={() => setModal(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-brand-black border border-brand-gray/20 rounded-2xl w-full max-w-md shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-brand-gray/5">
              <div>
                <h4 className="font-bold text-sm uppercase tracking-wide text-brand-black">
                  {modal === 'outcome' ? 'Log the outcome' : modal === 'log' ? 'Log an interaction' : modal === 'status' ? 'Change status' : 'Reschedule follow-up'}
                </h4>
                <p className="text-[10px] text-brand-gray mt-0.5">{target.customerName} ({target.id}) · {target.status}</p>
              </div>
              <button onClick={() => setModal(null)} aria-label="Close" className="text-brand-gray hover:text-brand-red"><XCircle size={18} /></button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              {modal === 'outcome' && (
                <>
                  <div>
                    <label className={lbl}>What happened?</label>
                    <div className="space-y-1.5">
                      {([['theirs', 'They will come back to me', 'Status becomes Client Will Call Back'], ['mine', 'I need to call again', 'Status becomes Call Back (needs the time and a note)'], ['send', 'I owe them something', 'Status stays; I set the next date'], ['none', 'No next step', 'Status stays; next date cleared']] as const).map(([k, t, d]) => (
                        <label key={k} className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer ${outcome === k ? 'border-brand-red bg-brand-red/5' : 'border-brand-gray/15'}`}>
                          <input type="radio" name="outcome" checked={outcome === k} onChange={() => setOutcome(k)} className="mt-0.5" />
                          <span><span className="font-bold text-brand-black block">{t}</span><span className="text-[10px] text-brand-gray">{d}</span></span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {outcome !== 'none' && (
                    <div>
                      <label className={lbl}>Come back in</label>
                      <div className="flex gap-1.5">{[1, 2, 3, 7, 14].map((n) => <button key={n} type="button" onClick={() => setComeBack(n)} className={`flex-1 py-1.5 rounded-lg border text-[10px] font-extrabold ${comeBack === n ? 'bg-brand-red text-white border-brand-red' : 'border-brand-gray/20 text-brand-gray'}`}>{n} d</button>)}</div>
                      <p className="text-[10px] text-brand-gray mt-1">Next action: {fmtDay(addDays(todayISO(), comeBack))}</p>
                    </div>
                  )}
                  {outcome === 'mine' && <div><label className={lbl}>Call-back time</label><input type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} className={fieldCls} /></div>}
                  <div><label className={lbl}>Note {outcome === 'mine' ? '(required)' : ''}</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={`${fieldCls} h-20 resize-none`} placeholder="What was said, what the client needs…" /></div>
                </>
              )}
              {modal === 'log' && (
                <>
                  <div><label className={lbl}>Type</label>
                    <div className="grid grid-cols-5 gap-1.5">{(['call', 'whatsapp', 'email', 'meeting', 'visit'] as const).map((k) => <button key={k} type="button" onClick={() => setIType(k)} className={`py-2 text-[9px] font-extrabold rounded-lg border uppercase tracking-wider ${iType === k ? 'bg-brand-red text-white border-brand-red' : 'bg-brand-gray/5 border-brand-gray/15 text-brand-gray'}`}>{k}</button>)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className={lbl}>Date</label><input type="date" value={iDate} onChange={(e) => setIDate(e.target.value)} className={fieldCls} /></div>
                    <div><label className={lbl}>Time</label><input type="time" value={iTime} onChange={(e) => setITime(e.target.value)} className={fieldCls} /></div>
                  </div>
                  {(iType === 'meeting' || iType === 'visit') && (
                    <>
                      <div><label className={lbl}>{iType === 'meeting' ? 'Location / link' : 'Project'}</label><input type="text" value={iPlace} onChange={(e) => setIPlace(e.target.value)} className={fieldCls} /></div>
                      <label className="flex items-center gap-2 text-[11px] font-semibold text-brand-black"><input type="checkbox" checked={iSchedule} onChange={(e) => setISchedule(e.target.checked)} />Set the status to {iType === 'meeting' ? 'Scheduled Meeting' : 'Site Visit Scheduled'} for this date and time</label>
                    </>
                  )}
                  <div><label className={lbl}>Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={`${fieldCls} h-24 resize-none`} placeholder="Result, client feedback, next steps…" /></div>
                </>
              )}
              {modal === 'status' && (
                <>
                  <div><label className={lbl}>New status</label>
                    <StatusPicker value={stStatus} onChange={setStStatus} className={fieldCls} hide={['Won']} allowEmpty />
                    <p className="text-[10px] text-brand-gray mt-1">To mark a deal Won, open the lead: it needs the deal value.</p>
                  </div>
                  {REQ_DATETIME.includes(stStatus) && (
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className={lbl}>Date</label><input type="date" value={stDate} onChange={(e) => setStDate(e.target.value)} className={fieldCls} /></div>
                      <div><label className={lbl}>Time</label><input type="time" value={stTime} onChange={(e) => setStTime(e.target.value)} className={fieldCls} /></div>
                    </div>
                  )}
                  {REQ_FOLLOWUP.includes(stStatus) && <div><label className={lbl}>Next follow-up date</label><input type="date" value={stNext} onChange={(e) => setStNext(e.target.value)} className={fieldCls} /></div>}
                  {stStatus === 'Lost' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className={lbl}>Reason</label><select value={stReason} onChange={(e) => setStReason(e.target.value)} className={fieldCls}><option value="">Choose…</option>{LOST_REASONS_TEAM.map((r) => <option key={r}>{r}</option>)}</select></div>
                      <div><label className={lbl}>Category</label><select value={stCat} onChange={(e) => setStCat(e.target.value)} className={fieldCls}><option value="">—</option>{LOST_CATEGORIES.map((r) => <option key={r}>{r}</option>)}</select></div>
                    </div>
                  )}
                  <div><label className={lbl}>Note {REQ_DATETIME.includes(stStatus) ? '(required)' : ''}</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={`${fieldCls} h-20 resize-none`} /></div>
                </>
              )}
              {modal === 'resched' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className={lbl}>Next action date</label><input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} className={fieldCls} /></div>
                    <div><label className={lbl}>Time (optional)</label><input type="time" value={fuTime} onChange={(e) => setFuTime(e.target.value)} className={fieldCls} /></div>
                  </div>
                  <div className="flex gap-1.5">{[1, 3, 7, 14].map((n) => <button key={n} type="button" onClick={() => setFuDate(addDays(todayISO(), n))} className="flex-1 py-1.5 rounded-lg border border-brand-gray/20 text-[10px] font-extrabold text-brand-gray hover:border-brand-red">+{n} d</button>)}</div>
                  <p className="text-[10px] text-brand-gray">The status is not changed. Leave the date empty to clear it.</p>
                </>
              )}
              <div className="flex gap-2 justify-end pt-3 border-t border-brand-gray/10">
                <button type="button" onClick={() => setModal(null)} className="px-4 py-2 text-xs font-bold text-brand-gray hover:bg-brand-gray/5 rounded-xl">Cancel</button>
                <button type="button" className="btn-primary text-xs" onClick={modal === 'outcome' ? saveOutcome : modal === 'log' ? saveInteraction : modal === 'status' ? saveStatus : saveResched}>Save</button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
