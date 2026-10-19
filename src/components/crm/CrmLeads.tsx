import { cairoTimeHM } from '../../lib/cairoTime';
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Lead, Contact, Company, LeadStatus, LeadPriority, LostReason, CommentNote, Attachment, TimelineEvent } from './types';
import { toast } from 'sonner';
import { LeadPlotsPanel } from './LeadPlotsPanel';
import { ColumnSelector } from './ColumnSelector';
import { crmService, normalizePhone } from './crmService';
import {
  INDUSTRIES, NO_CHANNEL, channelOf, LOST_CATEGORIES, LOST_REASONS_TEAM, PRIORITIES, SOURCES, STATUS_GROUPS, LEGACY_STATUSES, isOpenStatus, leadScore, normSource, phoneIntl, statusStage,
} from './leadConfig';
import { statusAfterAction, REQ_FOLLOWUP, isTouchedLead } from './leadConfig';
import { LoadBar } from './LoadBar';
import { isPhoneDevice, repNameFromEmail, signOff } from '../../lib/repName';
import { useBackClose } from '../../lib/backNav';
import { CrmCallCenter } from './CrmCallCenter';
import { Collapse } from './Collapse';
import { CrmBulkMessage } from './CrmBulkMessage';
import { ccState } from './leadMetrics';
import { KanbanKey, LeadAuth, addDaysISO, withSideEffects, kanbanBucket, neglectInfo, prioKey, priorityClass, statusClass, todayISO } from './leadRules';
import { fmtSize, formatLeadDateTime, getSlaStatus, isSlaAtRisk, localISO } from './leadView';
import { KanbanCard, LeadRow, PAGE_SIZES, PageSize, PagerBar, ALL_CHUNK } from './LeadListParts';
import { LeadEditor, NATIONALITIES } from './LeadEditor';
import { ChipBar, EMPTY_XF, XF, XFilterPanel, makeXfPredicate, xfChips, xfCount } from './LeadFilters';
import { LeadAuditHistory } from './LeadAuditHistory';
import { LeadScoreChip, sourceWinRates } from './LeadScoreChip';
import { WA_LANGS, WaLang, WA_TEMPLATES, getWaLang, setWaLang, suggestTemplate, waCompose, waFill } from './waTemplates';
import DOMPurify from 'dompurify';
import { useAuth } from '../../services/AuthContext';
import { Plot, loadPlots } from '../../lib/plotsService';
import { OfferPrintsSection } from './OfferPrintsList';
import { 
  List, 
  Kanban, 
  Calendar, 
  Search, 
  Filter, 
  Plus, 
  MoreVertical, 
  Phone, 
  Mail, 
  MessageSquare, 
  CalendarDays, 
  Bell, 
  FileText, 
  Paperclip, 
  UserCheck, 
  RefreshCw, 
  SlidersHorizontal, 
  Trash2, 
  Edit, 
  Check, 
  CheckSquare, 
  Square, 
  Download, 
  Upload, 
  X, 
  ChevronDown, 
  ChevronUp, 
  Clock, 
  Activity, 
  FileSpreadsheet, 
  UserPlus, 
  AlertTriangle,
  ArrowRight,
  Info,
  ExternalLink,
  Lock,
  CornerDownRight,
  CheckCircle2,
  Bookmark,
  Cpu
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Local-calendar helpers (toISOString() is UTC and shifts the day for Egypt, UTC+2/+3)
const pad2 = (n: number) => String(n).padStart(2, '0');
// 'YYYY-MM-DD' stays as is; a full timestamp becomes its local calendar day ('' when invalid/missing)
const dayOf = (v?: string) => {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : localISO(d);
};
const EMAIL_RE = /^[^\s@,;<>()"?&=]+@[^\s@,;<>()"?&=]+\.[^\s@,;<>()"?&=]+$/;
// Only data:/blob:/https: URLs may be used as a link target (blocks javascript: etc. coming from stored data)
const safeUrl = (u?: string) => (u && /^(data:|blob:|https:)/i.test(u.trim()) ? u : undefined);
// Spreadsheet formula injection guard for CSV cells
const csvCell = (v: any) => {
  let str = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  return `"${str.replace(/"/g, '""')}"`;
};
// Email bodies are untrusted: strip scripts/styles/forms/remote media and non-http links
const sanitizeEmailHtml = (html: string): string =>
  DOMPurify.sanitize(String(html || ''), {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'img', 'video', 'audio', 'link', 'meta'],
    FORBID_ATTR: ['style', 'srcset', 'src'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
  });
// Digits for a wa.me link: 00-prefix dropped, Egyptian local 0xxxxxxxxxx -> 20xxxxxxxxxx; '' when not plausible
const waNumber = (phone?: string) => {
  const intl = phoneIntl(phone).replace(/\D/g, '');
  if (intl.length >= 8) return intl;
  let n = String(phone || '').replace(/[^\d]/g, '');
  if (n.startsWith('00')) n = n.substring(2);
  else if (n.startsWith('0')) n = '20' + n.substring(1);
  return n.length >= 8 && n.length <= 15 ? n : '';
};

const PRIORITY_ORDER: Record<string, number> = { VIP: 0, Urgent: 0, High: 1, Medium: 2, Normal: 2, Low: 3 };
const STATUS_ORDER = new Map<string, number>([...STATUS_GROUPS.flatMap((g) => g.statuses), ...LEGACY_STATUSES].map((st, i) => [st, i] as [string, number]));

const KANBAN_PAGE = 30;
const KANBAN_COLS: { key: KanbanKey; label: string; title: string; badge: string; tone: 'amber' | 'indigo' | 'blue' | 'closed' }[] = [
  { key: 'new', label: '1. New / Ops Review', title: 'text-amber-700', badge: 'bg-amber-100 text-amber-800', tone: 'amber' },
  { key: 'working', label: '2. Contact attempt / Follow-up', title: 'text-purple-700', badge: 'bg-purple-100 text-purple-800', tone: 'indigo' },
  { key: 'pipeline', label: '3. Sales pipeline', title: 'text-blue-700', badge: 'bg-blue-100 text-blue-800', tone: 'blue' },
  { key: 'closed', label: '4. Closed (won / lost / dead)', title: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-800', tone: 'closed' },
];

interface CrmLeadsProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string; // From parent settings switcher
  setActiveSubTab: (tab: string) => void;
}

type SortKind = 'text' | 'num' | 'date' | 'rank';
const SORT_KIND: Record<string, SortKind> = { id: 'num', date: 'date', customerName: 'text', project: 'text', requiredSize: 'num', slaDeadline: 'date', priority: 'rank', status: 'rank', assignedSalespersonName: 'text', channel: 'text', source: 'text' };
const SORT_WORDS: Record<SortKind, [string, string]> = { text: ['A → Z', 'Z → A'], num: ['Small → Large', 'Large → Small'], date: ['Oldest → Newest', 'Newest → Oldest'], rank: ['First → Last', 'Last → First'] };
/** a table header that shows how the list is sorted and lets the user pick the direction */
const SortTh: React.FC<{ field: string; label: string; sortField: string; dir: 'asc' | 'desc'; onToggle: () => void; onSet: (d: 'asc' | 'desc') => void; right?: boolean }> = ({ field, label, sortField, dir, onToggle, onSet, right }) => {
  const kind = SORT_KIND[field] || 'text';
  const on = sortField === field;
  return (
    <th className={`py-3 px-3 cursor-pointer select-none ${right ? 'text-right' : ''}`} onClick={onToggle} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <span className={`inline-flex items-center gap-1 ${right ? 'flex-row-reverse' : ''}`}>
        <span className={on ? 'text-brand-red' : ''}>{label}</span>
        <span className="inline-flex flex-col leading-none" onClick={(e) => e.stopPropagation()}>
          <button type="button" title={`Sort ${SORT_WORDS[kind][0]}`} onClick={() => onSet('asc')} className={`px-0.5 ${on && dir === 'asc' ? 'text-brand-red' : 'text-brand-gray/40 hover:text-brand-black'}`}><ChevronUp size={11} strokeWidth={3} /></button>
          <button type="button" title={`Sort ${SORT_WORDS[kind][1]}`} onClick={() => onSet('desc')} className={`px-0.5 -mt-1 ${on && dir === 'desc' ? 'text-brand-red' : 'text-brand-gray/40 hover:text-brand-black'}`}><ChevronDown size={11} strokeWidth={3} /></button>
        </span>
        {on && <span className="text-[9px] font-bold normal-case tracking-normal text-brand-red bg-brand-red/10 rounded px-1 whitespace-nowrap">{SORT_WORDS[kind][dir === 'asc' ? 0 : 1]}</span>}
      </span>
    </th>
  );
};

export const CrmLeads: React.FC<CrmLeadsProps> = ({ leads, onLeadsUpdated, currentRole, setActiveSubTab }) => {
  const { user, permissions } = useAuth();
  const isAdmin = (currentRole?.toLowerCase() || '').includes('admin') || (user?.role?.toLowerCase() || '').includes('admin');
  const isOps = isAdmin || (user?.role || currentRole) === 'Sales Operation' || !!permissions?.canViewSalesRules;
  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'calendar'>('list');
  const [searchTerm, setSearchTerm] = useState('');      // committed (debounced) search text
  const [searchInput, setSearchInput] = useState('');     // what is typed
  useEffect(() => { const t = setTimeout(() => setSearchTerm(searchInput), 250); return () => clearTimeout(t); }, [searchInput]);
  const clearSearch = () => { setSearchInput(''); setSearchTerm(''); };
  // cheap delta refresh while this screen is open (every ~90 s while the tab is visible, and on focus)
  useEffect(() => crmService.startAutoRefresh(), []);
  // minute clock: SLA texts are time based, memoised rows get a new `tick` once a minute
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') setTick((x) => x + 1); }, 60_000); return () => clearInterval(t); }, []);
  // paging: 25 / 50 / 100 / All, remembered
  const [pageSize, setPageSizeState] = useState<PageSize>(() => {
    try { const raw = localStorage.getItem('sid_leads_page_size'); const v = Number(raw); if (raw !== null && (PAGE_SIZES as readonly number[]).includes(v)) return v as PageSize; } catch { /* default */ }
    return 25;
  });
  const [page, setPage] = useState(0);
  const setPageSize = (n: PageSize) => { setPageSizeState(n); setPage(0); try { localStorage.setItem('sid_leads_page_size', String(n)); } catch { /* ignore */ } };
  const [kanbanCap, setKanbanCap] = useState<Record<string, number>>({});
  const [calDay, setCalDay] = useState<string | null>(null);
  const [calCap, setCalCap] = useState(50);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  
  // Advanced filters
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [plots, setPlots] = useState<Plot[]>([]);
  const [plotsInfo, setPlotsInfo] = useState<{ landBankUrl: string } | null>(null);

  // plots (Land Bank snapshot) are only needed for the recommendations inside an open lead: load them then, no timers
  useEffect(() => {
    if (!selectedLead) return;
    let cancelled = false;
    loadPlots().then((st) => { if (!cancelled) { setPlots(st.plots); setPlotsInfo({ landBankUrl: st.landBankUrl }); } })
      .catch((e: any) => console.error('Failed to load plots in CrmLeads', e.message || e));
    return () => { cancelled = true; };
  }, [selectedLead !== null]);

  // Keep the open lead panel in sync with the latest data (it is a copy; other edits would otherwise be shown stale)
  useEffect(() => {
    setSelectedLead(prev => {
      if (!prev) return prev;
      const fresh = leads.find(l => l.id === prev.id);
      if (fresh) return fresh === prev ? prev : fresh;
      return leads.length > 0 ? null : prev; // deleted elsewhere
    });
  }, [leads]);

  useEffect(() => {
    const checkAndSelectLead = () => {
      const targetLeadId = localStorage.getItem('crm_selected_lead_id_from_notification');
      if (targetLeadId && leads && leads.length > 0) {
        const foundLead = leads.find(l => String(l.id) === String(targetLeadId));
        if (foundLead) {
          setSelectedLead(foundLead);
          setFilterStatus('All');
          clearSearch();
          setFilterProject('All');
          setFilterPriority('All');
          setFilterSource('All');
          setFilterSalesperson('All');
          localStorage.removeItem('crm_selected_lead_id_from_notification');
        }
      }
    };

    checkAndSelectLead();

    const handleSelectLeadEvent = (e: any) => {
      if (e.detail && e.detail.leadId && leads && leads.length > 0) {
        const foundLead = leads.find(l => String(l.id) === String(e.detail.leadId));
        if (foundLead) {
          setSelectedLead(foundLead);
          setFilterStatus('All');
          clearSearch();
          setFilterProject('All');
          setFilterPriority('All');
          setFilterSource('All');
          setFilterSalesperson('All');
          localStorage.removeItem('crm_selected_lead_id_from_notification');
        }
      }
    };

    window.addEventListener('crm-select-lead', handleSelectLeadEvent);
    return () => {
      window.removeEventListener('crm-select-lead', handleSelectLeadEvent);
    };
  }, [leads]);
  const [filterProject, setFilterProject] = useState<string>('All');
  const [filterPriority, setFilterPriority] = useState<string>('All');
  const [filterTouch, setFilterTouch] = useState<string>('All');
  const [filterSource, setFilterSource] = useState<string>('All');
  const [filterSalesperson, setFilterSalesperson] = useState<string>('All');
  const [showFilters, setShowFilters] = useState(false);
  // filters the person pinned to the quick bar above the list: remembered for this person on this browser
  const pinKey = `crm_pinned_filters_${user?.id ?? 'anon'}`;
  const [pinned, setPinned] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem(pinKey) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } });
  const togglePin = (k: string) => setPinned((cur) => { const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]; try { localStorage.setItem(pinKey, JSON.stringify(next)); } catch { /* ignore */ } return next; });
  const [xf, setXf] = useState<XF>(EMPTY_XF);
  const [savedView, setSavedView] = useState<string>('All');
  // a clicked number elsewhere (dashboard tile, chart bar...) opens this list with exactly the leads that number counted
  const [idPreset, setIdPreset] = useState<{ ids: Set<string>; title: string } | null>(null);

  // Column management
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['id', 'date', 'customer', 'project', 'size', 'slaStatus', 'priority', 'score', 'status', 'touch', 'assigned', 'channel', 'leadSource']);
  
  const columns = {
    id: visibleColumns.includes('id'),
    date: visibleColumns.includes('date'),
    customer: visibleColumns.includes('customer'),
    project: visibleColumns.includes('project'),
    size: visibleColumns.includes('size'),
    slaStatus: visibleColumns.includes('slaStatus'),
    priority: visibleColumns.includes('priority'),
    score: visibleColumns.includes('score'),
    touch: visibleColumns.includes('touch'),
    status: visibleColumns.includes('status'),
    assigned: visibleColumns.includes('assigned'),
    channel: visibleColumns.includes('channel'),
    leadSource: visibleColumns.includes('leadSource'),
    customerId: visibleColumns.includes('customerId'),
  };

  const columnsList = [
    { key: 'id', label: 'Id' },
    { key: 'date', label: 'Date' },
    { key: 'customer', label: 'Customer' },
    { key: 'project', label: 'Project' },
    { key: 'size', label: 'Size' },
    { key: 'slaStatus', label: 'SLA Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'score', label: 'Lead score' },
    { key: 'touch', label: 'Touched / Untouched' },
    { key: 'status', label: 'Status' },
    { key: 'assigned', label: 'Assigned' },
    { key: 'channel', label: 'Channel' },
    { key: 'leadSource', label: 'Lead Source' },
    { key: 'customerId', label: 'Customer ID' },
  ];

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);
  const [deleteConfirmLeadId, setDeleteConfirmLeadId] = useState<string | null>(null);
  const [deleteConfirmBulk, setDeleteConfirmBulk] = useState<boolean>(false);

  // Selected leads for bulk actions
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<string>('');

  // Source Email View states
  const [showSourceEmailModal, setShowSourceEmailModal] = useState<boolean>(false);
  const [sourceEmailData, setSourceEmailData] = useState<{
    subject: string;
    sender: string;
    receivedTime?: string;
    bodyHtml?: string;
    bodyText?: string;
  } | null>(null);
  const [loadingSourceEmail, setLoadingSourceEmail] = useState<boolean>(false);
  const [reparsingLead, setReparcingLead] = useState<boolean>(false);

  // Form states
  // No pre-filled project / size: the user must state them (nothing invented)
  const EMPTY_LEAD_FORM = {
    customerName: '',
    phoneNumber: '',
    email: '',
    companyName: '',
    project: '',
    requiredSize: '' as number | '',
    source: '',
    priority: 'Medium' as LeadPriority,
    description: '',
    phone2: '',
    industry: '',
    nationality: '',
  };
  const [newLeadForm, setNewLeadForm] = useState(EMPTY_LEAD_FORM);

  const [assigneeId, setAssigneeId] = useState('');
  const [primaryLeadMergeId, setPrimaryLeadMergeId] = useState('');
  const [duplicateLeadMergeId, setDuplicateLeadMergeId] = useState('');
  const [lostCategory, setLostCategory] = useState('');
  const [lostReasonTeam, setLostReasonTeam] = useState('');
  const [lostComment, setLostComment] = useState('');

  // Interaction logs (calls, visits, reminders, email, whatsapp)
  const [showInteractionModal, setShowInteractionModal] = useState<string | null>(null); // 'call' | 'visit' | 'whatsapp' | 'email' | 'meeting' | 'reminder'
  const [interactionNotes, setInteractionNotes] = useState('');
  const [interactionDate, setInteractionDate] = useState(localISO(new Date()));
  const [interactionTime, setInteractionTime] = useState('10:00');
  // a logged call / WhatsApp / e-mail happened just now; meetings and visits keep their 10:00 starting point
  useEffect(() => { if (showInteractionModal === 'call' || showInteractionModal === 'whatsapp' || showInteractionModal === 'email') { const n = new Date(); setInteractionDate(localISO(n)); setInteractionTime(cairoTimeHM(n)); } }, [showInteractionModal]);
  const [interactionLocation, setInteractionLocation] = useState('');
  const [interactionProjectName, setInteractionProjectName] = useState('');
  const [interactionSiteEmail, setInteractionSiteEmail] = useState('');
  const [callOutcome, setCallOutcome] = useState('Contacted');

  // WhatsApp & Email Template modals
  const [showWhatsappTemplateModal, setShowWhatsappTemplateModal] = useState(false);
  const [whatsappTemplateText, setWhatsappTemplateText] = useState('');
  const [showEmailTemplateModal, setShowEmailTemplateModal] = useState(false);
  // the phone's Back button closes the open window or the lead card first
  useBackClose(!!showEmailTemplateModal, () => setShowEmailTemplateModal(false));
  useBackClose(!!showWhatsappTemplateModal, () => setShowWhatsappTemplateModal(false));
  useBackClose(!!showInteractionModal, () => setShowInteractionModal(null));
  useBackClose(!!selectedLead, () => setSelectedLead(null));
  const [emailTemplateText, setEmailTemplateText] = useState('');

  // New comments
  const [newCommentText, setNewCommentText] = useState('');
  const [commentPrivate, setCommentPrivate] = useState(false);

  // Drag and drop or sorting
  const [sortField, setSortField] = useState<keyof Lead>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const reminderTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { reminderTimers.current.forEach(clearTimeout); }, []);

  // CRM calendar month (current month by default)
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; });

  // Retrieve salespeople for select options. One pass over the leads (not one scan per person).
  const salespeople = useMemo(() => {
    const allReps = crmService.getSalesPeople();
    const byId = new Map<string, { active: number; total: number }>(), byName = new Map<string, { active: number; total: number }>();
    const bump = (m: Map<string, { active: number; total: number }>, k: string, open: boolean) => {
      let c = m.get(k); if (!c) { c = { active: 0, total: 0 }; m.set(k, c); }
      c.total++; if (open) c.active++;
    };
    for (const l of leads) {
      const open = isOpenStatus(l.status);
      if (l.assignedSalespersonId) bump(byId, String(l.assignedSalespersonId), open);
      else if (l.assignedSalespersonName) bump(byName, l.assignedSalespersonName, open);
    }
    const mappedReps = allReps.map((s: any) => {
      const a = byId.get(String(s.id)), b = !a && s.name ? byName.get(s.name) : undefined;
      const c = a || b;
      return { ...s, activeLeads: c?.active || 0, totalLeads: c?.total || 0 };
    });

    if (user?.role === 'Sales Team Leader') {
      return mappedReps.filter((s: any) => s.id === String(user.id) || s.teamLeaderId === String(user.id));
    }
    if (user?.role === 'Sales Rep') {
      return mappedReps.filter((s: any) => s.id === String(user.id));
    }
    return mappedReps;
  }, [leads, user]);

  // Win rate per source (for the lead score), computed once per list
  const winRates = useMemo(() => sourceWinRates(leads), [leads]);

  // Handle auto-selection of a lead from other tabs
  useEffect(() => {
    const targetId = localStorage.getItem('selected_lead_id');
    if (targetId) {
      const found = leads.find(l => l.id === targetId);
      if (found) {
        setSelectedLead(found);
      }
      localStorage.removeItem('selected_lead_id');
    }
  }, [leads]);

  // Handle column sort: a click on the header toggles; the two arrows pick the direction directly
  const handleSort = (field: keyof Lead) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(SORT_KIND[field as string] === 'text' ? 'asc' : 'desc');
    }
  };
  const setSort = (field: keyof Lead, dir: 'asc' | 'desc') => { setSortField(field); setSortDirection(dir); };

  // Reset all filters
  const resetFilters = () => {
    setFilterStatus('All');
    setFilterProject('All');
    setFilterPriority('All');
    setFilterSource('All');
    setFilterSalesperson('All');
    clearSearch();
    setXf(EMPTY_XF);
    setSavedView('All');
    setIdPreset(null);
  };
  useEffect(() => {
    const apply = () => {
      let raw: string | null = null;
      try { raw = localStorage.getItem('crm_leads_preset'); localStorage.removeItem('crm_leads_preset'); } catch { /* ignore */ }
      if (!raw) return;
      try {
        const p = JSON.parse(raw);
        resetFilters();
        if (Array.isArray(p.ids)) setIdPreset({ ids: new Set(p.ids.map(String)), title: String(p.title || 'Selected leads') });
        if (p.status) setFilterStatus(p.status);
        if (p.project) setFilterProject(p.project);
        if (p.source) setFilterSource(p.source);
        if (p.salesperson) setFilterSalesperson(p.salesperson);
        if (p.search) { setSearchInput(p.search); setSearchTerm(p.search); }
      } catch { /* ignore */ }
    };
    apply();
    window.addEventListener('crm-leads-preset', apply);
    return () => window.removeEventListener('crm-leads-preset', apply);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Saved Views Loader
  const handleSavedViewChange = (view: string) => {
    if (view === 'All') {
      resetFilters();
    } else if (view === 'My Open Leads') {
      resetFilters();
      // Filter leads assigned to current user, assuming user index/name match
      setFilterSalesperson(user?.name || '');
      setFilterStatus('OpenLeads'); // Internal flag
    } else if (view === 'SLA Violated') {
      resetFilters();
    } else if (view === 'SLA Within Limit') {
      resetFilters();
    } else if (view === 'Unassigned') {
      resetFilters();
      setFilterSalesperson('Unassigned');
    } else if (view === 'SLA At Risk') {
      resetFilters();
    }
    // resetFilters() clears savedView, so the chosen view is set last
    setSavedView(view);
  };

  // Search text of a lead is built once per lead object (rows keep their identity between refreshes)
  const searchIndex = useMemo(() => new WeakMap<Lead, { t: string; d: string }>(), []);
  const searchOf = (l: Lead) => {
    let e = searchIndex.get(l);
    if (!e) {
      e = {
        t: `${l.id} ${l.customerName || ''} ${l.phoneNumber || ''} ${l.phone2 || ''} ${l.email || ''} ${l.companyName || ''} ${l.project || ''} ${l.source || ''} ${l.assignedSalespersonName || ''} ${l.description || ''} ${l.notes || ''}`.toLowerCase(),
        d: `${normalizePhone(l.phoneNumber || '')} ${normalizePhone(l.phone2 || '')} ${phoneIntl(l.phoneNumber).replace(/\D/g, '')}`,
      };
      searchIndex.set(l, e);
    }
    return e;
  };

  // Process and Filter Leads
  const filteredLeads = useMemo(() => {
    // visibility by role (the server already limits what is sent; this keeps the screen consistent): one team set, no per-row scans
    const myId = user ? String(user.id) : '';
    const teamIds = new Set<string>();
    if (user?.role === 'Sales Team Leader') for (const s of salespeople as any[]) if (s.teamLeaderId === myId) teamIds.add(String(s.id));
    const q = searchTerm.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    const qPhone = qDigits.length >= 5 ? normalizePhone(qDigits) : '';
    const xfPred = makeXfPredicate(xf, (l) => leadScore(l, winRates.get(String(l.source || '')) || 0));
    const viewSla = savedView === 'SLA Violated' || savedView === 'SLA Within Limit' || savedView === 'SLA At Risk';

    const out = leads.filter(l => {
      if (user) {
        if (user.role === 'Sales Rep') {
          if (l.assignedSalespersonId !== myId) return false;
        } else if (user.role === 'Sales Team Leader') {
          // unassigned leads stay visible so a team leader can claim or assign them
          if (l.assignedSalespersonId && l.assignedSalespersonId !== myId && !teamIds.has(String(l.assignedSalespersonId))) return false;
        }
      }
      if (idPreset && !idPreset.ids.has(String(l.id))) return false;
      if (filterStatus === 'OpenLeads') { if (!isOpenStatus(l.status)) return false; }
      else if (filterStatus !== 'All' && l.status !== filterStatus) return false;
      if (filterProject !== 'All' && l.project !== filterProject) return false;
      if (filterPriority !== 'All' && prioKey(l.priority) !== filterPriority) return false;
      if (filterTouch !== 'All' && (filterTouch === 'Touched') !== isTouchedLead(l)) return false;
      if (filterSource !== 'All' && l.source !== filterSource) return false;
      if (filterSalesperson === 'Unassigned') { if (l.assignedSalespersonId) return false; }
      else if (filterSalesperson !== 'All' && l.assignedSalespersonName !== filterSalesperson) return false;
      if (xfPred && !xfPred(l)) return false;
      if (q) {
        const e = searchOf(l);
        // phone search also works across formats (+20 / 0020 / 01x)
        if (!e.t.includes(q) && !(qPhone && (e.d.includes(qPhone) || e.d.includes(qDigits)))) return false;
      }
      if (viewSla) {
        const sla = getSlaStatus(l);
        if (savedView === 'SLA Violated' && !sla.isViolated) return false;
        if (savedView === 'SLA Within Limit' && (sla.isViolated || sla.status === 'none')) return false;
        if (savedView === 'SLA At Risk' && !isSlaAtRisk(l, sla)) return false;
      }
      return true;
    });

    // comparable value per lead, computed once (not on every comparison); missing values are always last
    const keyOf = (l: Lead): string | number | null => {
      const v: any = l[sortField];
      if (sortField === 'priority') return PRIORITY_ORDER[l.priority as string] ?? 99;
      if (sortField === 'status') { const i = STATUS_ORDER.get(l.status); return i === undefined ? 999 : i; }
      if (sortField === 'requiredSize') { const n = Number(v); return isNaN(n) || v === '' ? null : n; }
      if (v === undefined || v === null || v === '') return null;
      if (typeof v === 'string') return v.toLowerCase();
      if (typeof v === 'number') return v;
      return null;
    };
    const keyed = out.map((l) => ({ l, k: keyOf(l) }));
    const dir = sortDirection === 'asc' ? 1 : -1;
    keyed.sort((a, b) => {
      if (a.k === null && b.k === null) return 0;
      if (a.k === null) return 1;
      if (b.k === null) return -1;
      return a.k < b.k ? -dir : a.k > b.k ? dir : 0;
    });
    const sorted = keyed.map((x) => x.l);
    // call center leads waiting for their first contact come first (most urgent on top) while the list is in its normal date order
    if (sortField === 'date') {
      const now = Date.now(); const cc: { l: Lead; left: number }[] = []; const rest: Lead[] = [];
      for (const l of sorted) { const st = ccState(l, now); if (st) cc.push({ l, left: st.leftMs }); else rest.push(l); }
      if (cc.length) { cc.sort((a, b) => a.left - b.left); return [...cc.map((x) => x.l), ...rest]; }
    }
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, salespeople, leads, searchTerm, filterStatus, filterProject, filterPriority, filterTouch, filterSource, filterSalesperson, savedView, xf, winRates, sortField, sortDirection, idPreset]);

  // back to the first page whenever the result set changes shape
  useEffect(() => { setPage(0); setKanbanCap({}); setCalDay(null); }, [searchTerm, filterStatus, filterProject, filterPriority, filterTouch, filterSource, filterSalesperson, savedView, xf, sortField, sortDirection, idPreset]);

  // Project List
  const projects = useMemo(() => {
    return Array.from(new Set(leads.map(l => l.project).filter(Boolean))).sort();
  }, [leads]);

  // option lists for the extra filters come only from the rows this user can see
  const xfOptions = useMemo(() => {
    const ch = new Set<string>(), ind = new Set<string>(), nat = new Set<string>();
    for (const l of leads) { ch.add(channelOf(l)); if (l.industry) ind.add(l.industry); if (l.nationality) nat.add(l.nationality); }
    return { channels: Array.from(ch).sort(), industries: Array.from(ind).sort(), nationalities: Array.from(nat).sort() };
  }, [leads]);

  // customer id per lead = the contact that holds the lead's phone (contacts are created per phone); built once per refresh
  const contactByPhone = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of crmService.getContacts()) { const k = normalizePhone(c.phoneNumber || ''); if (k && !m.has(k)) m.set(k, c); }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads]);
  const contactOf = (l: Lead) => contactByPhone.get(normalizePhone(l.phoneNumber || ''));
  const openContact = (c: Contact) => {
    try { localStorage.setItem('selected_contact_id', c.id); } catch { /* ignore */ }
    setActiveSubTab('contacts');
  };

  const activeChips = useMemo(() => {
    const out: { key: string; label: string; onClear: () => void }[] = [];
    if (filterStatus !== 'All') out.push({ key: 'status', label: `Status: ${filterStatus === 'OpenLeads' ? 'Open leads' : filterStatus}`, onClear: () => setFilterStatus('All') });
    if (filterProject !== 'All') out.push({ key: 'project', label: `Project: ${filterProject}`, onClear: () => setFilterProject('All') });
    if (filterPriority !== 'All') out.push({ key: 'priority', label: `Priority: ${filterPriority}`, onClear: () => setFilterPriority('All') });
    if (filterTouch !== 'All') out.push({ key: 'touch', label: filterTouch, onClear: () => setFilterTouch('All') });
    if (filterSource !== 'All') out.push({ key: 'source', label: `Source: ${filterSource}`, onClear: () => setFilterSource('All') });
    if (filterSalesperson !== 'All') out.push({ key: 'owner', label: `Owner: ${filterSalesperson === 'Unassigned' ? 'Unassigned' : filterSalesperson}`, onClear: () => setFilterSalesperson('All') });
    for (const c of xfChips(xf)) out.push({ key: c.key, label: c.label, onClear: () => setXf((x) => c.clear(x)) });
    if (idPreset) out.push({ key: 'ids', label: `${idPreset.title} · ${idPreset.ids.size} leads`, onClear: () => setIdPreset(null) });
    return out;
  }, [filterStatus, filterProject, filterPriority, filterTouch, filterSource, filterSalesperson, xf, idPreset]);

  // Sources list
  const sources = useMemo(() => {
    return Array.from(new Set(leads.map(l => l.source).filter(Boolean))).sort();
  }, [leads]);

  // View Source Ingested Email helper
  const handleViewInboundEmail = async (lead: Lead) => {
    if (!lead.emailId) return;
    
    setShowSourceEmailModal(true);
    setLoadingSourceEmail(true);
    setSourceEmailData(null);
    
    try {
      const res = await fetch(`/api/crm/webmail/body?id=${encodeURIComponent(lead.emailId)}`);
      const data = await res.json();
      
      if (data.success) {
        const matchingLog = crmService.getEmailLogs().find(log => log.id === lead.emailId);
        setSourceEmailData({
          subject: data.subject || matchingLog?.subject || '—',
          sender: matchingLog?.sender || '—',
          receivedTime: matchingLog?.receivedTime || lead.date,
          bodyHtml: data.body
        });
      } else {
        throw new Error("Could not fetch via API");
      }
    } catch (e) {
      // Mail server unavailable: fall back to the locally stored import log (shown as plain text below)
      const matchingLog = crmService.getEmailLogs().find(log => log.id === lead.emailId || log.parsedLeadId === lead.id);
      if (matchingLog) {
        setSourceEmailData({
          subject: matchingLog.subject,
          sender: matchingLog.sender,
          receivedTime: matchingLog.receivedTime,
          bodyText: matchingLog.bodyPreview
        });
      } else {
        setSourceEmailData({
          subject: '—',
          sender: '—',
          receivedTime: lead.date,
          bodyText: lead.description || 'No email content or logs found for this lead.'
        });
      }
    } finally {
      setLoadingSourceEmail(false);
    }
  };

  // Reparse lead with full HTML EWS body
  const handleReparseLead = async (lead: Lead) => {
    if (!lead.id) return;
    setReparcingLead(true);
    try {
      const res = await fetch('/api/crm/reparse-lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ leadId: lead.id })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Lead "${data.lead.customerName}" successfully reparsed and updated!\n` +
              `All extracted parameters have been synchronized with Contacts and Corporate Accounts.`);
        setShowSourceEmailModal(false);
        onLeadsUpdated(); // reload leads, contacts, and companies
        setSelectedLead(data.lead); // update active lead details view
      } else {
        alert(data.error || "Failed to reparse lead.");
      }
    } catch (err: any) {
      console.error(err);
      alert("Error reparsing lead: " + err.message);
    } finally {
      setReparcingLead(false);
    }
  };

  // Bulk Actions. Selection is a Set for lookups (a row test must not scan the whole selection).
  const selectedSet = useMemo(() => new Set(selectedLeadIds), [selectedLeadIds]);
  const [bulkMsg, setBulkMsg] = useState<'whatsapp' | 'email' | null>(null);
  const handleSelectLead = useCallback((id: string) => {
    setSelectedLeadIds(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]));
  }, []);

  // current page of the filtered list (All = everything)
  const pageCount = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filteredLeads.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  // "All" draws 250 rows and then more on request, so even 4,000 rows never freeze the page
  const [allShown, setAllShown] = useState(ALL_CHUNK);
  useEffect(() => { setAllShown(ALL_CHUNK); }, [filteredLeads, pageSize]);
  const pageLeads = useMemo(
    () => (pageSize === 0 ? filteredLeads.slice(0, allShown) : filteredLeads.slice(safePage * pageSize, (safePage + 1) * pageSize)),
    [filteredLeads, pageSize, safePage, allShown],
  );
  const pageAllSelected = pageLeads.length > 0 && pageLeads.every(l => selectedSet.has(l.id));
  const allFilteredSelected = filteredLeads.length > 0 && filteredLeads.length === selectedLeadIds.length && filteredLeads.every(l => selectedSet.has(l.id));

  // header checkbox = this page; "Select all N filtered" is an explicit second step
  const handleSelectAll = () => {
    if (pageAllSelected) {
      const drop = new Set(pageLeads.map(l => l.id));
      setSelectedLeadIds(prev => prev.filter(id => !drop.has(id)));
    } else {
      setSelectedLeadIds(prev => Array.from(new Set([...prev, ...pageLeads.map(l => l.id)])));
    }
  };
  const selectAllFiltered = () => setSelectedLeadIds(filteredLeads.map(l => l.id));

  const confirmBulkDelete = () => {
    // Re-read the stored leads right before writing so a stale prop copy cannot overwrite newer edits
    const remaining = crmService.getLeads().filter(l => !selectedSet.has(l.id));
    crmService.saveLeads(remaining);
    setSelectedLeadIds([]);
    setBulkAction('');
    setDeleteConfirmBulk(false);
    onLeadsUpdated();
  };

  // Bulk Won: the server needs a deal value for every Won lead, so each one is asked for
  const [bulkWon, setBulkWon] = useState<{ id: string; name: string; project: string; value: string }[] | null>(null);
  const BULK_WON_MAX = 100;
  const confirmBulkWon = () => {
    if (!bulkWon || bulkWon.some(r => !(Number(r.value) > 0))) return;
    const values = new Map(bulkWon.map(r => [r.id, Number(r.value)]));
    const now = new Date().toISOString();
    const updated = crmService.getLeads().map(l => {
      const v = values.get(l.id);
      if (v === undefined) return l;
      const next = withSideEffects(l, { ...l, status: 'Won' as LeadStatus, dealValue: v, lastUpdated: now });
      next.timeline = [...(l.timeline || []), {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: now,
        type: 'Status Change' as const,
        user: user?.name || 'Bulk Operation',
        title: 'Deal Won',
        description: `Marked as Won via bulk action. Deal value EGP ${v.toLocaleString('en-US')} (cash pending confirmation by accounts receivable).`,
      }];
      return next;
    });
    crmService.saveLeads(updated);
    setBulkWon(null);
    setSelectedLeadIds([]);
    setBulkAction('');
    onLeadsUpdated();
  };

  const executeBulkAction = () => {
    if (selectedLeadIds.length === 0 || !bulkAction) return;

    if (bulkAction === 'delete') {
      if (!isAdmin) {
        alert("Unauthorized: Only Administrators can bulk delete lead records.");
        return;
      }
      setDeleteConfirmBulk(true);
    } else if (bulkAction === 'assign') {
      setShowAssignModal(true);
    } else if (bulkAction === 'won') {
      if (currentRole === 'Read Only') return;
      const toWin = crmService.getLeads().filter(l => selectedSet.has(l.id) && !['Won', 'Duplicate', 'Invalid'].includes(l.status));
      if (toWin.length === 0) { alert('None of the selected leads can be marked as Won.'); return; }
      if (toWin.length > BULK_WON_MAX) { alert(`Every Won lead needs its own deal value, so Bulk Won is limited to ${BULK_WON_MAX} leads at a time (you selected ${toWin.length}).`); return; }
      setBulkWon(toWin.map(l => ({ id: l.id, name: l.customerName, project: l.project, value: l.dealValue ? String(l.dealValue) : '' })));
    }
  };

  // Create Lead
  const [createDup, setCreateDup] = useState<{ lead: Lead; why: string } | null>(null);
  const handleCreateLead = (e: React.FormEvent, force = false) => {
    e.preventDefault();
    const name = newLeadForm.customerName.trim();
    const phone = normalizePhone(newLeadForm.phoneNumber || '');
    if (!name) { alert('Customer name is required.'); return; }
    if (phone.replace(/\D/g, '').length < 8) { alert('Enter a valid mobile number.'); return; }
    if (!newLeadForm.project) { alert('Choose the target project.'); return; }
    if (!newLeadForm.source) { alert('Choose the lead source.'); return; }
    if (newLeadForm.email.trim() && !EMAIL_RE.test(newLeadForm.email.trim())) { alert('The e-mail address is not valid.'); return; }
    // same phone or same e-mail (generic e-mails ignored): show who owns it and offer to open that lead; never create silently
    if (!force) {
      const hit = crmService.findDuplicates({ phone: newLeadForm.phoneNumber, phone2: newLeadForm.phone2, email: newLeadForm.email })[0];
      if (hit) {
        const samePhone = [newLeadForm.phoneNumber, newLeadForm.phone2].some(p => p && phoneIntl(p) && (phoneIntl(p) === phoneIntl(hit.phoneNumber) || phoneIntl(p) === phoneIntl(hit.phone2)));
        setCreateDup({ lead: hit, why: samePhone ? 'the same phone number' : 'the same e-mail address' });
        return;
      }
    }
    try {
      const size = Number(newLeadForm.requiredSize);
      const { phone2, industry, nationality, ...base } = newLeadForm;
      crmService.createLead({
        ...base,
        ...(phone2.trim() ? { phone2: phone2.trim() } : {}),
        ...(industry ? { industry } : {}),
        ...(nationality.trim() ? { nationality: nationality.trim() } : {}),
        source: normSource(newLeadForm.source) || newLeadForm.source,
        customerName: name,
        // size is optional: when not stated it is stored as 'n/a' instead of an invented number
        requiredSize: size > 0 ? size : 'n/a'
      }, user?.name || 'Administrator');
      setShowCreateModal(false);
      setCreateDup(null);
      setNewLeadForm(EMPTY_LEAD_FORM);
      onLeadsUpdated();
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Assign Salesperson
  const handleAssignSalesperson = () => {
    const selectedRep = salespeople.find((s: any) => String(s.id) === String(assigneeId));
    if (!selectedRep) return;

    const idsToAssign = selectedLeadIds.length > 0 ? selectedLeadIds : (selectedLead ? [selectedLead.id] : []);
    if (idsToAssign.length === 0) return;
    const assignSet = new Set(idsToAssign);

    // Respect the queue settings: leave / inactive users and the per-person cap need an explicit OK
    const settings = crmService.getQueueSettings();
    const cap = Number(selectedRep.cap) > 0 ? Number(selectedRep.cap) : Number(settings?.maxLeadsPerSalesperson) || 0;
    const warnings: string[] = [];
    if (selectedRep.leave) warnings.push(`${selectedRep.name} is on leave.`);
    if (selectedRep.active === false) warnings.push(`${selectedRep.name} is inactive.`);
    if (cap > 0 && selectedRep.activeLeads + idsToAssign.length > cap) {
      warnings.push(`${selectedRep.name} would exceed the limit of ${cap} active leads (${selectedRep.activeLeads} now, +${idsToAssign.length}).`);
    }
    if (warnings.length > 0 && !window.confirm(`${warnings.join('\n')}\n\nAssign anyway?`)) return;

    // Re-read the stored leads right before writing (no stale-array overwrite)
    const updatedLeads = crmService.getLeads().map(l => {
      if (assignSet.has(l.id)) {
        const timelineEvent: TimelineEvent = {
          id: Math.random().toString(36).substr(2, 9),
          timestamp: new Date().toISOString(),
          type: 'Assignment',
          user: user?.name || 'Administrator',
          title: `Assigned to ${selectedRep.name}`,
          description: `Assigned manually by ${user?.name || 'Administrator'}.`
        };
        return {
          ...l,
          assignedSalespersonId: selectedRep.id,
          assignedSalespersonName: selectedRep.name,
          assignedDate: new Date().toISOString(),
          nextFollowUpDate: l.nextFollowUpDate || addDaysISO(2),
          lastUpdated: new Date().toISOString(),
          timeline: [...(l.timeline || []), timelineEvent]
        };
      }
      return l;
    });

    // Lead counts per salesperson are derived from the leads themselves; the stored salespeople list is NOT rewritten here
    // (the list shown is role-filtered, saving it would have dropped the other people).
    crmService.saveLeads(updatedLeads);

    setShowAssignModal(false);
    setSelectedLeadIds([]);
    setAssigneeId('');
    if (selectedLead) {
      const refreshed = updatedLeads.find(l => l.id === selectedLead.id);
      setSelectedLead(refreshed || null);
    }
    onLeadsUpdated();
  };

  // Merge Duplicates
  const handleMergeDuplicate = () => {
    if (!primaryLeadMergeId || !duplicateLeadMergeId || primaryLeadMergeId === duplicateLeadMergeId) return;
    if (!window.confirm(`Merge ${duplicateLeadMergeId} into ${primaryLeadMergeId}? ${duplicateLeadMergeId} will be closed as Duplicate.`)) return;
    try {
      crmService.mergeLeads(primaryLeadMergeId, duplicateLeadMergeId, user?.name || 'System CRM');
      setShowMergeModal(false);
      setPrimaryLeadMergeId('');
      setDuplicateLeadMergeId('');
      onLeadsUpdated();
      alert('Duplicate leads successfully merged. Primary record updated, secondary record closed as Duplicate.');
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Auto Purge Duplicates across entire leads collection
  const handleAutoPurgeDuplicates = () => {
    if (!isAdmin) {
      alert("Unauthorized: Only Administrators can bulk purge duplicate records.");
      return;
    }

    // Safer rule: a repeat is the same phone/email AND the same project; the earliest record is kept and
    // won / assigned-and-worked leads are never removed automatically.
    const seen = new Set<string>();
    const freshLeads = crmService.getLeads();
    const sorted = [...freshLeads].sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')));
    const dropIds = new Set<string>();

    for (const lead of sorted) {
      const cleanPhone = lead.phoneNumber ? normalizePhone(lead.phoneNumber) : '';
      const cleanEmail = lead.email ? lead.email.trim().toLowerCase() : '';
      const proj = (lead.project || '').trim().toLowerCase();
      const keys = [cleanPhone && `p:${cleanPhone}|${proj}`, cleanEmail && `e:${cleanEmail}|${proj}`].filter(Boolean) as string[];
      const isDup = keys.some(k => seen.has(k));
      if (isDup && lead.status !== 'Won') {
        dropIds.add(lead.id);
      } else {
        keys.forEach(k => seen.add(k));
      }
    }
    const leadsToKeep = freshLeads.filter(l => !dropIds.has(l.id));
    const purgedCount = dropIds.size;

    if (purgedCount === 0) {
      alert("No duplicate leads found (same phone or email on the same project).");
      return;
    }

    if (window.confirm(`Found ${purgedCount} duplicate lead records across phone numbers/emails. Purge all duplicates now?`)) {
      crmService.saveLeads(leadsToKeep);
      onLeadsUpdated();
      setShowMergeModal(false);
      alert(`Successfully purged ${purgedCount} duplicate records from CRM database.`);
    }
  };

  // Purge ALL Leads permanently from DB & Server
  const handlePurgeAllDatabaseLeads = async () => {
    if (!isAdmin) {
      alert("Unauthorized: Only Administrators can purge all database leads.");
      return;
    }

    const typed = window.prompt("CRITICAL WARNING: this permanently deletes ALL sales leads from the database, server, and cloud storage and CANNOT be undone.\n\nType DELETE ALL to confirm.");
    if (typed === 'DELETE ALL') {
      try {
        const res = await fetch('/api/crm/leads/purge-all', { method: 'POST' });
        if (res.ok) {
          localStorage.removeItem('crm_leads');
          crmService.saveLeads([]);
          onLeadsUpdated();
          alert("All sales leads have been completely wiped from database and server storage.");
        } else {
          const errData = await res.json().catch(() => ({}));
          alert("Failed to purge leads: " + (errData.error || 'Server error'));
        }
      } catch (err: any) {
        alert("Network error purging leads: " + err.message);
      }
    }
  };

  // Close Lead as Lost
  const handleMarkAsLost = () => {
    if (!selectedLead) return;
    if (!lostCategory || !lostReasonTeam) {
      alert('Choose the lost category and the lost reason.');
      return;
    }
    if (!lostComment.trim()) {
      alert('A comment is mandatory when closing a lead as Lost.');
      return;
    }

    const updatedLeads = crmService.getLeads().map(l => {
      if (l.id === selectedLead.id) {
        return {
          ...l,
          status: 'Lost' as LeadStatus,
          lostCategory,
          lostReason: lostReasonTeam,
          lostComment: lostComment.trim(),
          lastUpdated: new Date().toISOString(),
          timeline: [...(l.timeline || []), {
            id: Math.random().toString(36).substr(2, 9),
            timestamp: new Date().toISOString(),
            type: 'Status Change' as const,
            user: user?.name || 'Agent',
            title: 'Lead Closed as Lost',
            description: `Lost (${lostCategory}): ${lostReasonTeam}. Comments: ${lostComment.trim()}`
          }]
        };
      }
      return l;
    });

    crmService.saveLeads(updatedLeads);
    setShowLostModal(false);
    setLostComment('');
    setLostCategory('');
    setLostReasonTeam('');
    
    const refreshed = updatedLeads.find(l => l.id === selectedLead.id);
    setSelectedLead(refreshed || null);
    onLeadsUpdated();
  };

  // Add Comment/Note
  const handleAddComment = () => {
    if (!selectedLead || !newCommentText.trim()) return;

    const newComment: CommentNote = {
      id: Math.random().toString(36).substr(2, 9),
      date: localISO(new Date()),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      user: user?.name || 'User',
      comment: newCommentText.trim(),
      isPrivate: commentPrivate
    };

    const updatedLeads = crmService.getLeads().map(l => {
      if (l.id === selectedLead.id) {
        return {
          ...l,
          comments: [...(l.comments || []), newComment],
          lastUpdated: new Date().toISOString(),
          timeline: [...(l.timeline || []), {
            id: Math.random().toString(36).substr(2, 9),
            timestamp: new Date().toISOString(),
            type: 'Comment' as const,
            user: user?.name || 'User',
            title: 'New Note Added',
            description: commentPrivate ? 'A private note was added.' : `Note: "${newCommentText.trim().substring(0, 30)}${newCommentText.trim().length > 30 ? '...' : ''}"`
          }]
        };
      }
      return l;
    });

    crmService.saveLeads(updatedLeads);
    setNewCommentText('');
    
    const refreshed = updatedLeads.find(l => l.id === selectedLead.id);
    setSelectedLead(refreshed || null);
    onLeadsUpdated();
  };

  // Browser reminder 30 min before an event (timers are cleared on unmount)
  const scheduleReminder = (title: string, bodyText: string, when: Date) => {
    if (!('Notification' in window) || isNaN(when.getTime())) return;
    Notification.requestPermission().then(permission => {
      if (permission !== 'granted') return;
      const timeDiff = when.getTime() - Date.now();
      const thirtyMins = 30 * 60 * 1000;
      if (timeDiff > thirtyMins) {
        reminderTimers.current.push(setTimeout(() => { new Notification(title, { body: `${bodyText} in 30 minutes.` }); }, timeDiff - thirtyMins));
      } else if (timeDiff > 0) {
        new Notification(title, { body: `${bodyText} very soon.` });
      }
    }).catch(() => {});
  };

  // Log Interaction (call / meeting / follow-up / visit / whatsapp / email)
  const handleLogInteraction = () => {
    if (!selectedLead || !showInteractionModal) return;

    const when = new Date(`${interactionDate}T${interactionTime}:00`);
    if (!interactionDate || !interactionTime || isNaN(when.getTime())) {
      alert('Enter a valid date and time for the interaction.');
      return;
    }
    if (!user) {
      alert('You must be signed in to log an interaction.');
      return;
    }
    if (showInteractionModal === 'visit' && interactionSiteEmail.trim() && !EMAIL_RE.test(interactionSiteEmail.trim())) {
      alert('The site notification email address is not valid.');
      return;
    }

    const interactionType = showInteractionModal;
    let taskTitle = `${interactionType.charAt(0).toUpperCase() + interactionType.slice(1)} - ${selectedLead.customerName}`;
    let desc = interactionNotes.trim();

    if (interactionType === 'call') {
      taskTitle = `Call (${callOutcome}) - ${selectedLead.customerName}`;
      desc = `Call Outcome: ${callOutcome}` + (interactionNotes.trim() ? `\nNotes: ${interactionNotes.trim()}` : '');
    } else if (interactionType === 'meeting') {
      desc += interactionLocation ? `\nLocation: ${interactionLocation}` : '';
      scheduleReminder('Upcoming Meeting Reminder', `You have a meeting with ${selectedLead.customerName} (location: ${interactionLocation || 'not specified'})`, when);
    } else if (interactionType === 'follow-up') {
      // Create a task for the salesperson (assigned rep, else the logged-in user)
      const tasks = crmService.getTasks();
      tasks.push({
        id: 'task_' + Math.random().toString(36).substr(2, 9),
        salespersonId: String(selectedLead.assignedSalespersonId || user.id),
        title: `Follow Up: ${selectedLead.customerName}`,
        description: desc,
        dueDate: when.toISOString(),
        status: 'Pending',
        priority: 'High',
        leadId: selectedLead.id
      });
      crmService.saveTasks(tasks);
      scheduleReminder('Upcoming Follow Up Reminder', `You have a follow up scheduled with ${selectedLead.customerName}`, when);
    } else if (interactionType === 'visit') {
      desc += interactionProjectName ? `\nProject: ${interactionProjectName}` : '';
      desc += interactionSiteEmail.trim() ? `\nSite Email: ${interactionSiteEmail.trim()}` : '';

      // Only open the mail client when a validated site address was entered (all parts URL-encoded)
      if (interactionSiteEmail.trim()) {
        const mailtoSubject = encodeURIComponent(`Site Visit Confirmation: ${interactionProjectName}`);
        const mailtoBody = encodeURIComponent(`Dear Site Team,

This is to confirm a site visit for ${interactionProjectName}.

Customer Name: ${selectedLead.customerName}
Customer Phone: ${selectedLead.phoneNumber}

Date: ${interactionDate}
Time: ${interactionTime}

Best regards,
${user.name || ''}`);
        const cc = user.email && EMAIL_RE.test(user.email) ? `cc=${encodeURIComponent(user.email)}&` : '';
        window.open(`mailto:${encodeURIComponent(interactionSiteEmail.trim())}?${cc}subject=${mailtoSubject}&body=${mailtoBody}`, '_blank', 'noopener,noreferrer');
      }
      scheduleReminder('Upcoming Site Visit Reminder', `You have a site visit for ${selectedLead.customerName} at ${interactionProjectName || 'an unspecified project'}`, when);
    }

    const timelineEvent: TimelineEvent = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: when.toISOString(),
      type: (interactionType === 'call' || interactionType === 'follow-up' ? 'Call' : 
             interactionType === 'email' ? 'Email' :
             interactionType === 'whatsapp' ? 'WhatsApp' :
             interactionType === 'meeting' ? 'Meeting' : 'Visit') as any,
      user: user.name || 'Agent',
      title: taskTitle,
      description: desc || 'No notes entered.'
    };

    // Re-read the stored leads right before writing (no stale-array overwrite)
    const updatedLeads = crmService.getLeads().map(l => {
      if (l.id === selectedLead.id) {
        // Transition status on contact; never reopen or move closed leads. Team statuses where one fits.
        let nextStatus = l.status as LeadStatus;
        const patch: Partial<Lead> = { lastContactDate: todayISO() };
        if (isOpenStatus(l.status)) {
          const moved = statusAfterAction(l.status, interactionType as any, callOutcome);
          if (moved) nextStatus = moved as LeadStatus;
          if (interactionType === 'call' && callOutcome === 'Not Interested' && moved) {
            // 'Lost' needs category + reason (Lost dialog); a call outcome records 'Not Interested' instead
            patch.lostReason = 'Not Interested';
            patch.lostComment = interactionNotes.trim() || 'Customer not interested (call outcome).';
          }
          if (moved && REQ_FOLLOWUP.includes(moved)) patch.nextFollowUpDate = l.nextFollowUpDate || addDaysISO(2);
          if ((interactionType === 'meeting' || interactionType === 'visit') && moved) {
            patch.meetingDate = interactionDate;
            patch.meetingTime = interactionTime;
            patch.nextFollowUpDate = interactionDate;
            if (!String(l.notes || '').trim()) patch.notes = interactionNotes.trim() || `Meeting on ${interactionDate} ${interactionTime}${interactionLocation ? ` at ${interactionLocation}` : ''}`;
          }
          if (interactionType === 'follow-up') {
            patch.nextFollowUpDate = interactionDate;
            patch.nextFollowUpTime = interactionTime;
          }
        }

        const merged: Lead = {
          ...l,
          ...patch,
          status: nextStatus,
          lastUpdated: new Date().toISOString(),
          timeline: [...(l.timeline || []), timelineEvent]
        };
        return withSideEffects(l, merged, { id: user ? String(user.id) : undefined });
      }
      return l;
    });

    // Also save to global activities (attributed to the logged-in user)
    const acts = crmService.getActivities();
    acts.unshift({
      id: 'act_' + Math.random().toString(36).substr(2, 9),
      salespersonId: String(user.id),
      salespersonName: user.name || '—',
      type: (interactionType === 'call' || interactionType === 'follow-up' ? 'Call' : interactionType === 'email' ? 'Email' : interactionType === 'whatsapp' ? 'WhatsApp' : interactionType === 'meeting' ? 'Meeting' : 'Visit') as any,
      leadId: selectedLead.id,
      leadName: selectedLead.customerName,
      timestamp: when.toISOString(),
      notes: desc
    });
    crmService.saveActivities(acts);

    crmService.saveLeads(updatedLeads);
    setShowInteractionModal(null);
    setInteractionNotes('');
    setCallOutcome('Contacted');
    
    const refreshed = updatedLeads.find(l => l.id === selectedLead.id);
    setSelectedLead(refreshed || null);
    onLeadsUpdated();
  };

  // Upload Attachment File Simulation
  const handleAttachmentUploadClick = () => {
    fileInputRef.current?.click();
  };

  const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024; // stored as base64 in the lead record: keep records small

  const handleAttachmentSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    if (!selectedLead || !input.files || input.files.length === 0) return;

    const file = input.files[0];
    input.value = ''; // allow choosing the same file again
    if (file.size > MAX_ATTACHMENT_BYTES) {
      alert(`"${file.name}" is too large (${Math.round(file.size / 1024)} KB). The maximum attachment size is ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB.`);
      return;
    }
    const leadId = selectedLead.id;
    const reader = new FileReader();
    reader.onerror = () => alert(`Could not read "${file.name}".`);
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      const newAttach: Attachment = {
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        size: `${Math.round(file.size / 1024)} KB`,
        uploadedAt: localISO(new Date()),
        uploadedBy: user?.name || 'User',
        dataUrl: base64
      };

      const updatedLeads = crmService.getLeads().map(l => {
        if (l.id === leadId) {
          return {
            ...l,
            attachments: [...(l.attachments || []), newAttach],
            lastUpdated: new Date().toISOString(),
            timeline: [...(l.timeline || []), {
              id: Math.random().toString(36).substr(2, 9),
              timestamp: new Date().toISOString(),
              type: 'Comment' as const,
              user: user?.name || 'User',
              title: 'File Attached',
              description: `Attached file: ${file.name}`
            }]
          };
        }
        return l;
      });

      crmService.saveLeads(updatedLeads);
      const refreshed = updatedLeads.find(l => l.id === leadId);
      setSelectedLead(refreshed || null);
      onLeadsUpdated();
    };
    reader.readAsDataURL(file);
  };

  // WhatsApp: the team's 11 bilingual templates (Arabic + English, or one of them), filled with the lead's data
  const [waTemplate, setWaTemplate] = useState('');
  const [waLang, setWaLangState] = useState<WaLang>(getWaLang());
  const waWhen = (l: Lead) => ({ date: l.meetingDate || l.nextFollowUpDate || '', time: l.meetingTime || l.nextFollowUpTime || '' });
  const myName = repNameFromEmail(user?.email, user?.name || 'Sales Person');
  const buildWa = (l: Lead, key: string, lang: WaLang) => signOff(waFill(waCompose(key, lang), l, myName, waWhen(l)), myName);
  const handleWhatsappActionClick = () => {
    if (!selectedLead) return;
    const key = suggestTemplate(selectedLead);
    setWaTemplate(key);
    setWhatsappTemplateText(buildWa(selectedLead, key, waLang));
    setShowWhatsappTemplateModal(true);
  };
  const pickWaTemplate = (key: string) => { if (!selectedLead) return; setWaTemplate(key); setWhatsappTemplateText(buildWa(selectedLead, key, waLang)); };
  const pickWaLang = (lang: WaLang) => { setWaLangState(lang); setWaLang(lang); if (selectedLead && waTemplate) setWhatsappTemplateText(buildWa(selectedLead, waTemplate, lang)); };

  const handleWhatsappSend = () => {
    if (!selectedLead) return;

    const cleanPhone = waNumber(selectedLead.phoneNumber);
    if (!cleanPhone) {
      alert('This lead has no valid phone number for WhatsApp.');
      return;
    }

    // Open WhatsApp Web (digits only in the path; the text is URL-encoded)
    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(whatsappTemplateText)}`;
    const onPhone = isPhoneDevice();
    if (onPhone) window.location.href = whatsappUrl; else window.open(whatsappUrl, '_blank', 'noopener,noreferrer');

    // Create timeline log event
    const timelineEvent: TimelineEvent = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type: 'WhatsApp' as const,
      user: user?.name || 'Agent',
      title: onPhone ? 'Tried to send WhatsApp from phone' : 'WhatsApp Contact',
      description: whatsappTemplateText
    };

    // New / Assigned -> "Sent WhatsApp" with a follow-up in 2 days (that status needs a next follow-up date)
    const updatedLeads = crmService.getLeads().map(l => {
      if (l.id === selectedLead.id) {
        const moved = statusAfterAction(l.status, 'whatsapp');
        const merged: Lead = {
          ...l,
          ...(moved ? { status: moved as LeadStatus, nextFollowUpDate: l.nextFollowUpDate || addDaysISO(2) } : {}),
          lastContactDate: todayISO(),
          lastUpdated: new Date().toISOString(),
          timeline: [...(l.timeline || []), timelineEvent]
        };
        return withSideEffects(l, merged, { id: user ? String(user.id) : undefined });
      }
      return l;
    });

    // Save Activities
    const acts = crmService.getActivities();
    acts.unshift({
      id: 'act_' + Math.random().toString(36).substr(2, 9),
      salespersonId: String(user?.id || selectedLead.assignedSalespersonId || ''),
      salespersonName: user?.name || selectedLead.assignedSalespersonName || '—',
      type: 'WhatsApp' as any,
      leadId: selectedLead.id,
      leadName: selectedLead.customerName,
      timestamp: new Date().toISOString(),
      notes: (onPhone ? '[Tried to send WhatsApp from phone] ' : '') + whatsappTemplateText
    });
    crmService.saveActivities(acts);

    crmService.saveLeads(updatedLeads);
    setShowWhatsappTemplateModal(false);

    const refreshed = updatedLeads.find(l => l.id === selectedLead.id);
    setSelectedLead(refreshed || null);
    onLeadsUpdated();
  };

  // Phone: "Call now" opens the phone's dialer with the customer's number; the attempt is written to the timeline and the activity list
  // (no status change: the outcome is logged afterwards with the form below)
  const handleDialNow = () => {
    if (!selectedLead) return;
    const num = phoneIntl(selectedLead.phoneNumber) || String(selectedLead.phoneNumber || '').replace(/[^\d+]/g, '');
    if (!num) { alert('This lead has no valid phone number.'); return; }
    const now = new Date().toISOString();
    const ev: TimelineEvent = { id: Math.random().toString(36).substr(2, 9), timestamp: now, type: 'Call' as const, user: user?.name || 'Agent', title: 'Tried to call from phone', description: `Opened the dialer for ${num}.` };
    const updatedLeads = crmService.getLeads().map(l => l.id === selectedLead.id ? withSideEffects(l, { ...l, lastUpdated: now, timeline: [...(l.timeline || []), ev] }, { id: user ? String(user.id) : undefined }) : l);
    const acts = crmService.getActivities();
    acts.unshift({ id: 'act_' + Math.random().toString(36).substr(2, 9), salespersonId: String(user?.id || selectedLead.assignedSalespersonId || ''), salespersonName: user?.name || selectedLead.assignedSalespersonName || '—', type: 'Call' as any, leadId: selectedLead.id, leadName: selectedLead.customerName, timestamp: now, notes: `[Tried to call from phone] ${num}` });
    crmService.saveActivities(acts);
    crmService.saveLeads(updatedLeads);
    setSelectedLead(updatedLeads.find(l => l.id === selectedLead.id) || null);
    onLeadsUpdated();
    window.location.href = `tel:${num}`;
  };

  // Email Action Triggers
  const handleEmailActionClick = () => {
    if (!selectedLead) return;
    const salesPerson = myName;
    const initialText = `Dear Mr./Ms. ${selectedLead.customerName},\n\nThank you for your interest in Elsewedy Industrial Development.\n\nWe have received your inquiry regarding our industrial projects, and we are pleased to assist you in finding the perfect land size and location for your business operations.\n\nCould you please let us know when would be a suitable time for a brief call to discuss your specifications in more detail? Alternatively, you can reach me directly on my contact number.\n\nYours sincerely,\n\n${salesPerson}\nElsewedy Industrial Development`;
    setEmailTemplateText(signOff(initialText, myName));
    setShowEmailTemplateModal(true);
  };

  const handleEmailSend = () => {
    if (!selectedLead) return;

    const onPhone = isPhoneDevice();
    const subject = 'Inquiry - Elsewedy Industrial Development';
    // phone: open the mail app (Outlook) with the recipient, subject and body ready; computer: download an .eml
    if (onPhone) window.location.href = `mailto:${encodeURIComponent(String(selectedLead.email || '').replace(/[\r\n]+/g, ' ').trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailTemplateText)}`;
    // Generate .eml file content and download
    // Header values must be single-line (blocks CRLF header injection from stored data)
    const toAddr = String(selectedLead.email || '').replace(/[\r\n]+/g, ' ').trim();
    const emlContent = [
      `To: ${toAddr}`,
      `Subject: Inquiry - Elsewedy Industrial Development`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      emailTemplateText
    ].join('\r\n');

    const blob = new Blob([emlContent], { type: 'message/rfc822' });
    if (!onPhone) {
      const link = document.createElement('a');
      const emlUrl = URL.createObjectURL(blob);
      link.href = emlUrl;
      link.download = `Email_To_${String(selectedLead.customerName || 'lead').replace(/[^\w\u0600-\u06FF-]+/g, '_')}.eml`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(emlUrl), 10000);
    }

    // Create timeline log event
    const timelineEvent: TimelineEvent = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type: 'Email' as const,
      user: user?.name || 'Agent',
      title: onPhone ? 'Tried to send e-mail from phone' : 'Email Sent',
      description: emailTemplateText
    };

    // New / Assigned -> "Mail Sent" with a follow-up in 2 days
    const updatedLeads = crmService.getLeads().map(l => {
      if (l.id === selectedLead.id) {
        const moved = statusAfterAction(l.status, 'email');
        const merged: Lead = {
          ...l,
          ...(moved ? { status: moved as LeadStatus, nextFollowUpDate: l.nextFollowUpDate || addDaysISO(2) } : {}),
          lastContactDate: todayISO(),
          lastUpdated: new Date().toISOString(),
          timeline: [...(l.timeline || []), timelineEvent]
        };
        return withSideEffects(l, merged, { id: user ? String(user.id) : undefined });
      }
      return l;
    });

    // Save Activities
    const acts = crmService.getActivities();
    acts.unshift({
      id: 'act_' + Math.random().toString(36).substr(2, 9),
      salespersonId: String(user?.id || selectedLead.assignedSalespersonId || ''),
      salespersonName: user?.name || selectedLead.assignedSalespersonName || '—',
      type: 'Email' as any,
      leadId: selectedLead.id,
      leadName: selectedLead.customerName,
      timestamp: new Date().toISOString(),
      notes: (onPhone ? '[Tried to send e-mail from phone] ' : '') + emailTemplateText
    });
    crmService.saveActivities(acts);

    crmService.saveLeads(updatedLeads);
    setShowEmailTemplateModal(false);

    const refreshed = updatedLeads.find(l => l.id === selectedLead.id);
    setSelectedLead(refreshed || null);
    onLeadsUpdated();
  };

  // Direct Delete Lead (Admin Only)
  const handleDeleteLead = (id: string) => {
    if (!isAdmin) {
      alert("Unauthorized: Only Administrators can delete leads.");
      return;
    }
    setDeleteConfirmLeadId(id);
  };

  const confirmDeleteLead = () => {
    if (!deleteConfirmLeadId) return;
    const id = deleteConfirmLeadId;
    const remaining = crmService.getLeads().filter(l => l.id !== id);
    crmService.saveLeads(remaining);
    setSelectedLead(null);
    setSelectedLeadIds(selectedLeadIds.filter(itemId => itemId !== id));
    setDeleteConfirmLeadId(null);
    onLeadsUpdated();
  };

  // Duplicate check: same phone (phone or phone 2) or same e-mail on another lead, by index (no scan of all leads)
  const duplicateWarnings = useMemo(() => {
    if (!selectedLead) return [];
    return crmService.findDuplicates({ phone: selectedLead.phoneNumber, phone2: selectedLead.phone2, email: selectedLead.email }, selectedLead.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLead, leads]);

  // Private notes are for managers/operations (and their author) only
  const canSeePrivate = (author: string) => isAdmin || author === user?.name || !['Sales Rep', 'Read Only'].includes(user?.role || currentRole);
  const visibleComments = (selectedLead?.comments || []).filter(c => !c.isPrivate || canSeePrivate(c.user));

  // Export to CSV helper
  const exportToCSV = () => {
    const headers = ['Lead ID', 'Date', 'Source', 'Project', 'Customer', 'Phone', 'Email', 'Company', 'Size (sqm)', 'SLA Status', 'Priority', 'Status', 'Salesperson', 'SLA Deadline', 'Lost Reason', 'Lost Comment'];
    const rows = filteredLeads.map(l => [
      l.id,
      l.date,
      l.source,
      l.project,
      l.customerName,
      l.phoneNumber,
      l.email,
      l.companyName || '',
      l.requiredSize,
      getSlaStatus(l).isViolated ? 'Violated' : (l.slaDeadline ? 'Within SLA' : 'No SLA'),
      l.priority,
      l.status,
      l.assignedSalespersonName || 'Unassigned',
      l.slaDeadline || '',
      l.lostReason || '',
      l.lostComment || ''
    ]);

    const formatCSVRow = (arr: any[]) => arr.map(csvCell).join(',');

    const csvContent = [headers.map(csvCell).join(','), ...rows.map(formatCSVRow)].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `CRM_Leads_Report_${localISO(new Date())}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Calendar days for the selected month
  const calendarDays = useMemo(() => {
    const days: { day: number | null; dateStr: string | null }[] = [];
    const { y: year, m: month } = calMonth;
    const firstDayIndex = new Date(year, month, 1).getDay(); // Sunday=0
    const totalDays = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < firstDayIndex; i++) days.push({ day: null, dateStr: null });
    for (let d = 1; d <= totalDays; d++) days.push({ day: d, dateStr: `${year}-${pad2(month + 1)}-${pad2(d)}` });
    return days;
  }, [calMonth]);

  const shiftCalMonth = (delta: number) => setCalMonth(c => { const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  // Escape closes the top-most open dialog / panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (bulkWon) setBulkWon(null);
      else if (showSourceEmailModal) setShowSourceEmailModal(false);
      else if (deleteConfirmLeadId) setDeleteConfirmLeadId(null);
      else if (deleteConfirmBulk) setDeleteConfirmBulk(false);
      else if (showLostModal) setShowLostModal(false);
      else if (showWhatsappTemplateModal) setShowWhatsappTemplateModal(false);
      else if (showEmailTemplateModal) setShowEmailTemplateModal(false);
      else if (showInteractionModal) setShowInteractionModal(null);
      else if (showMergeModal) setShowMergeModal(false);
      else if (showAssignModal) setShowAssignModal(false);
      else if (showCreateModal) setShowCreateModal(false);
      else if (selectedLead) setSelectedLead(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bulkWon, showSourceEmailModal, deleteConfirmLeadId, deleteConfirmBulk, showLostModal, showWhatsappTemplateModal, showEmailTemplateModal, showInteractionModal, showMergeModal, showAssignModal, showCreateModal, selectedLead]);

  // Columns as one string (a memoised row compares it cheaply)
  const visibleColsKey = useMemo(() => visibleColumns.join(','), [visibleColumns]);
  const canRoute = currentRole !== 'Read Only' && currentRole !== 'Sales Rep';
  const openAssignFor = useCallback((l: Lead) => { setSelectedLead(l); setShowAssignModal(true); }, []);

  // Kanban: one pass puts every lead in its column (team and legacy statuses alike, via leadConfig)
  const kanban = useMemo(() => {
    const b: Record<KanbanKey, Lead[]> = { new: [], working: [], pipeline: [], closed: [] };
    if (viewMode === 'kanban') for (const l of filteredLeads) b[kanbanBucket(l.status)].push(l);
    return b;
  }, [filteredLeads, viewMode]);

  // Calendar: leads per day of the shown month, one pass (registered / follow-up / meeting / timeline events)
  const calendarIndex = useMemo(() => {
    const m = new Map<string, Lead[]>();
    if (viewMode !== 'calendar') return m;
    const prefix = `${calMonth.y}-${pad2(calMonth.m + 1)}`;
    const near = new Set([prefix, `${new Date(calMonth.y, calMonth.m - 1, 1).getFullYear()}-${pad2(new Date(calMonth.y, calMonth.m - 1, 1).getMonth() + 1)}`, `${new Date(calMonth.y, calMonth.m + 1, 1).getFullYear()}-${pad2(new Date(calMonth.y, calMonth.m + 1, 1).getMonth() + 1)}`]);
    for (const l of filteredLeads) {
      const days = new Set<string>();
      const add = (d: string) => { if (d && d.startsWith(prefix)) days.add(d); };
      add(dayOf(l.date)); add(l.nextFollowUpDate || ''); add(l.meetingDate || '');
      for (const t of l.timeline || []) if (t.timestamp && near.has(t.timestamp.slice(0, 7))) add(dayOf(t.timestamp));
      days.forEach((d) => { const a = m.get(d); if (a) a.push(l); else m.set(d, [l]); });
    }
    return m;
  }, [filteredLeads, calMonth, viewMode]);

  // Rights of the signed-in user on the open lead (a convenience: the server is the authority)
  const leadAuth = useMemo((): LeadAuth => {
    const role = user?.role || currentRole;
    const isOps = isAdmin || role === 'Sales Operation' || !!permissions?.canViewSalesRules;
    const myId = user ? String(user.id) : '';
    const owner = selectedLead?.assignedSalespersonId ? String(selectedLead.assignedSalespersonId) : '';
    const isOwner = !!owner && owner === myId;
    const isTeamLead = role === 'Sales Team Leader' && (!owner || isOwner || (salespeople as any[]).some((s) => String(s.id) === owner && s.teamLeaderId === myId));
    return { isOps, isOwner, isTeamLead, readOnly: currentRole === 'Read Only' || role === 'Read Only', canConfirmCash: !!permissions?.canConfirmCash };
  }, [user, currentRole, isAdmin, permissions, selectedLead, salespeople]);

  return (
    <div className="space-y-6" id="crm-leads-root">
      
      {/* Search and Action Bar */}
      <div className="flex flex-col xl:flex-row gap-4 justify-between items-start xl:items-center">
        
        {/* Navigation View switcher and Title */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full xl:w-auto">
          <div>
            <h3 className="text-xl font-bold text-brand-black flex items-center gap-2">
              <span>Sales Leads Pipeline</span>
              <span className="text-xs bg-brand-red/10 text-brand-red font-bold px-2 py-0.5 rounded-full">
                {filteredLeads.length} Records
              </span>
            </h3>
          </div>

          <div className="flex bg-brand-gray/10 p-1 rounded-xl items-center self-stretch sm:self-auto">
            <button
              onClick={() => setViewMode('list')}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'list' ? 'bg-white text-brand-black shadow-sm' : 'text-brand-gray/80 hover:text-brand-black'}`}
            >
              <List size={14} />
              <span>Grid View</span>
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'kanban' ? 'bg-white text-brand-black shadow-sm' : 'text-brand-gray/80 hover:text-brand-black'}`}
            >
              <Kanban size={14} />
              <span>Kanban Board</span>
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'calendar' ? 'bg-white text-brand-black shadow-sm' : 'text-brand-gray/80 hover:text-brand-black'}`}
            >
              <Calendar size={14} />
              <span>CRM Calendar</span>
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto justify-end">
          <select
            value={savedView}
            onChange={(e) => handleSavedViewChange(e.target.value)}
            className="bg-white border border-brand-gray/25 rounded-xl px-3 py-2 text-xs font-semibold text-brand-black focus:outline-none focus:ring-1 focus:ring-brand-red shadow-sm"
          >
            <option value="All">Saved View: All Leads</option>
            <option value="My Open Leads">My Active Leads</option>
            <option value="SLA Violated">SLA Violated Leads</option>
            <option value="SLA Within Limit">SLA Within Limit</option>
            <option value="Unassigned">Unrouted Queues</option>
            <option value="SLA At Risk">SLA At Risk (last 25% of window)</option>
          </select>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${showFilters ? 'bg-brand-black text-white border-brand-black' : 'bg-white text-brand-gray border-brand-gray/25 hover:bg-brand-gray/5'}`}
          >
            <Filter size={14} />
            <span>Filters{activeChips.length > 0 ? ` (${activeChips.length})` : ''}</span>
          </button>

          <ColumnSelector 
            columns={columnsList}
            visibleColumns={visibleColumns}
            onChange={setVisibleColumns}
          />

          {isAdmin && (
            <>
              <button
                onClick={exportToCSV}
                className="bg-white hover:bg-brand-gray/5 border border-brand-gray/25 text-brand-black px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
              >
                <Download size={14} />
                <span>Export</span>
              </button>
              <button
                onClick={handlePurgeAllDatabaseLeads}
                className="bg-red-50 hover:bg-red-100 text-brand-red border border-red-200 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
                title="Permanently wipe all leads from database and server"
              >
                <Trash2 size={13} />
                <span>Purge Database</span>
              </button>
            </>
          )}

          {!['Read Only','Sales Rep'].includes(currentRole) && (
          <button
            onClick={() => setShowMergeModal(true)}
            className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
            title="Merge Duplicate Lead Records"
          >
            <RefreshCw size={13} />
            <span>Merge Duplicates</span>
          </button>
          )}

          {currentRole !== 'Read Only' && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-brand-red hover:bg-brand-red-dark text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md hover:scale-[1.01] transition-all"
            >
              <Plus size={14} />
              <span>Inbound Lead</span>
            </button>
          )}
        </div>
      </div>

      <LoadBar />
      {pinned.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-white border border-brand-gray/15 rounded-2xl px-3 py-2 shadow-sm" aria-label="Quick filters">
          <span className="text-[10px] uppercase font-extrabold text-brand-gray">Quick filters</span>
          {pinned.includes('status') && (
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none max-w-[190px]" aria-label="Status">
              <option value="All">All statuses</option>
              <option value="OpenLeads">Open leads (not closed)</option>
              {STATUS_GROUPS.map((g) => (<optgroup key={g.group} label={g.group}>{g.statuses.map((st) => <option key={st} value={st}>{st}</option>)}</optgroup>))}
              <optgroup label="Legacy">{LEGACY_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}</optgroup>
            </select>
          )}
          {pinned.includes('project') && (
            <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className="bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none max-w-[190px]" aria-label="Project">
              <option value="All">All projects</option>
              {projects.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {pinned.includes('touch') && (
            <select value={filterTouch} onChange={(e) => setFilterTouch(e.target.value)} className="bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none" aria-label="Touched or untouched">
              <option value="All">Touched + untouched</option>
              <option value="Touched">Touched</option>
              <option value="Untouched">Untouched</option>
            </select>
          )}
          {pinned.includes('priority') && (
            <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none" aria-label="Priority">
              <option value="All">All priorities</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {pinned.includes('source') && (
            <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className="bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none max-w-[190px]" aria-label="Source">
              <option value="All">All sources</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {pinned.includes('owner') && (
            <select value={filterSalesperson} onChange={(e) => setFilterSalesperson(e.target.value)} className="bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none max-w-[190px]" aria-label="Account manager">
              <option value="All">All agents</option>
              <option value="Unassigned">Unassigned leads</option>
              {salespeople.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          )}
          <XFilterPanel barOnly xf={xf} setXf={setXf} channels={xfOptions.channels} industries={xfOptions.industries} nationalities={xfOptions.nationalities} pinned={pinned} />
          <button type="button" onClick={() => setShowFilters(true)} className="text-[11px] font-bold text-brand-red hover:underline ml-auto">Choose filters</button>
        </div>
      )}

      {activeChips.length > 0 && <ChipBar chips={activeChips} onClearAll={resetFilters} />}

      {/* Advanced Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white border border-brand-gray/15 p-5 rounded-2xl shadow-sm overflow-hidden"
          >
            <p className="text-[11px] text-brand-gray font-semibold mb-3">Tick the box above a filter to keep it in the quick bar above the list. Your choice is remembered for you.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-brand-gray mb-1.5 cursor-pointer select-none" title="Tick to keep this filter in the quick bar above the list"><input type="checkbox" checked={pinned.includes('status')} onChange={() => togglePin('status')} className="accent-brand-red" /> Funnel Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none"
                >
                  <option value="All">All Statuses</option>
                  <option value="OpenLeads">Open leads (not closed)</option>
                  {STATUS_GROUPS.map(g => (
                    <optgroup key={g.group} label={g.group}>
                      {g.statuses.map(st => <option key={st} value={st}>{st}</option>)}
                    </optgroup>
                  ))}
                  <optgroup label="Legacy">
                    {LEGACY_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-brand-gray mb-1.5 cursor-pointer select-none" title="Tick to keep this filter in the quick bar above the list"><input type="checkbox" checked={pinned.includes('project')} onChange={() => togglePin('project')} className="accent-brand-red" /> Industrial Project</label>
                <select
                  value={filterProject}
                  onChange={(e) => setFilterProject(e.target.value)}
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none"
                >
                  <option value="All">All Projects</option>
                  {projects.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-brand-gray mb-1.5 cursor-pointer select-none" title="Tick to keep this filter in the quick bar above the list"><input type="checkbox" checked={pinned.includes('touch')} onChange={() => togglePin('touch')} className="accent-brand-red" /> Touched / Untouched</label>
                <select value={filterTouch} onChange={(e) => setFilterTouch(e.target.value)} className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none">
                  <option value="All">Touched + untouched</option>
                  <option value="Touched">Touched (worked on)</option>
                  <option value="Untouched">Untouched (new, nobody worked on)</option>
                </select>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-brand-gray mb-1.5 cursor-pointer select-none" title="Tick to keep this filter in the quick bar above the list"><input type="checkbox" checked={pinned.includes('priority')} onChange={() => togglePin('priority')} className="accent-brand-red" /> Lead Priority</label>
                <select
                  value={filterPriority}
                  onChange={(e) => setFilterPriority(e.target.value)}
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none"
                >
                  <option value="All">All Priorities</option>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-brand-gray mb-1.5 cursor-pointer select-none" title="Tick to keep this filter in the quick bar above the list"><input type="checkbox" checked={pinned.includes('source')} onChange={() => togglePin('source')} className="accent-brand-red" /> Lead Source</label>
                <select
                  value={filterSource}
                  onChange={(e) => setFilterSource(e.target.value)}
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none"
                >
                  <option value="All">All Lead Sources</option>
                  {sources.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-brand-gray mb-1.5 cursor-pointer select-none" title="Tick to keep this filter in the quick bar above the list"><input type="checkbox" checked={pinned.includes('owner')} onChange={() => togglePin('owner')} className="accent-brand-red" /> Account Manager</label>
                <select
                  value={filterSalesperson}
                  onChange={(e) => setFilterSalesperson(e.target.value)}
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none"
                >
                  <option value="All">All Agents</option>
                  <option value="Unassigned">Unassigned Leads</option>
                  {salespeople.map((s: any) => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-brand-gray/10">
              <XFilterPanel xf={xf} setXf={setXf} channels={xfOptions.channels} industries={xfOptions.industries} nationalities={xfOptions.nationalities} pinned={pinned} onTogglePin={togglePin} />
            </div>

            <div className="flex justify-between items-center mt-4 pt-4 border-t border-brand-gray/10">
              <span className="text-xs text-brand-gray">Active Filters Yield: <strong>{filteredLeads.length}</strong> / {leads.length} records</span>
              <button
                onClick={resetFilters}
                className="text-brand-red text-xs font-bold hover:underline"
              >
                Clear All Parameters
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>



      {/* Bulk Action Controls Bar */}
      {selectedLeadIds.length > 0 && (
        <div className="bg-brand-black text-white p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-4 shadow-md">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-brand-red rounded-full animate-ping" />
            <span className="text-xs font-bold">{selectedLeadIds.length.toLocaleString('en-US')} Leads selected for Bulk Action</span>
            {!allFilteredSelected && pageAllSelected && filteredLeads.length > pageLeads.length && (
              <button onClick={selectAllFiltered} className="text-[11px] underline font-bold text-white/90 hover:text-white">Select all {filteredLeads.length.toLocaleString('en-US')} filtered leads</button>
            )}
            {allFilteredSelected && filteredLeads.length > pageLeads.length && <span className="text-[11px] text-white/70">(all {filteredLeads.length.toLocaleString('en-US')} filtered leads)</span>}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {currentRole !== 'Read Only' && (
              <>
                <button type="button" onClick={() => setBulkMsg('whatsapp')} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold px-3 py-2 rounded-xl shadow inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">WhatsApp</button>
                <button type="button" onClick={() => setBulkMsg('email')} className="bg-white/90 hover:bg-white text-brand-black text-xs font-extrabold px-3 py-2 rounded-xl shadow inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">E-mail</button>
              </>
            )}
            <select
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value)}
              className="bg-white/10 border border-white/20 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:bg-white focus:text-brand-black"
            >
              <option value="" className="text-brand-black">Select Action...</option>
              {currentRole !== 'Read Only' && currentRole !== 'Sales Rep' && (
                <option value="assign" className="text-brand-black">Bulk Assign Account Manager</option>
              )}
              {currentRole !== 'Read Only' && (
                <option value="won" className="text-brand-black">Bulk Mark as Won</option>
              )}
              {isAdmin && (
                <option value="delete" className="text-brand-black">Bulk Delete Records</option>
              )}
            </select>
            <button
              onClick={executeBulkAction}
              disabled={!bulkAction}
              className="bg-brand-red hover:bg-brand-red-dark disabled:opacity-50 text-white text-xs font-extrabold px-4 py-2 rounded-xl shadow transition-all"
            >
              Execute
            </button>
            <button
              onClick={() => setSelectedLeadIds([])}
              className="text-xs text-white/60 hover:text-white ml-2 font-semibold"
            >
              Clear Choice
            </button>
          </div>
        </div>
      )}

      {/* Search Bar Input */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-gray" size={16} />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Global Search across Leads (by name, phone, email, project, CRM Id, salesperson, comments...)"
          className="w-full pl-10 pr-4 py-3 bg-white border border-brand-gray/20 rounded-2xl focus:outline-none focus:ring-1 focus:ring-brand-red focus:border-brand-red shadow-sm text-xs font-medium"
        />
      </div>

      {bulkMsg && <CrmBulkMessage mode={bulkMsg} leads={(crmService.getLeads() as Lead[]).filter((l) => selectedSet.has(l.id))} userName={user?.name || 'Agent'} userId={user?.id != null ? String(user.id) : undefined} onClose={() => { setBulkMsg(null); onLeadsUpdated(); }} />}

      <CrmCallCenter leads={leads} onOpen={setSelectedLead} />

      {/* -------------------- 1. LIST VIEW -------------------- */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm overflow-hidden">
          {/* phone: one card per lead instead of a wide table */}
          <div className="md:hidden divide-y divide-brand-gray/10">
            {pageLeads.length === 0 && <p className="py-8 text-center text-brand-gray text-xs">No matching leads. Change the filters or register a new lead.</p>}
            {pageLeads.map((l) => {
              const cc = ccState(l, Date.now());
              return (
                <div key={l.id} className={`flex gap-3 px-3.5 py-3.5 ${cc ? 'bg-brand-red/5 shadow-[inset_4px_0_0_#A6192E]' : selectedSet.has(l.id) ? 'bg-brand-red/5' : ''}`}>
                  <button type="button" onClick={() => handleSelectLead(l.id)} aria-label={`Select lead ${l.id}`} className="pt-0.5 self-start">
                    {selectedSet.has(l.id) ? <CheckSquare size={20} className="text-brand-red" /> : <Square size={20} className="text-brand-gray/50" />}
                  </button>
                  <button type="button" onClick={() => setSelectedLead(l)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-bold text-brand-gray">{l.id}</span>
                      {cc && <span className={`text-[9px] font-extrabold rounded px-1.5 py-0.5 text-white ${cc.overdue ? 'bg-brand-red' : 'bg-brand-red/75'}`}>CC {cc.overdue ? 'LATE' : '24h'}</span>}
                      <span className={`ml-auto whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-bold ${statusClass(l.status)}`}>{l.status}</span>
                    </div>
                    <div className="mt-1 font-extrabold text-[15px] text-brand-black truncate" dir="auto">{l.customerName || '—'}</div>
                    <div className="mt-0.5 text-[12px] text-brand-gray font-mono">{phoneIntl(l.phoneNumber) || l.phoneNumber || 'no phone'}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-brand-gray font-semibold">
                      {l.project && <span>{l.project}</span>}
                      {Number(l.requiredSize) > 0 && <span>{Number(l.requiredSize).toLocaleString('en-US')} sqm</span>}
                      <span>{l.assignedSalespersonName || 'Unassigned'}</span>
                      {l.nextFollowUpDate && <span className={l.nextFollowUpDate <= todayISO() ? 'text-red-600 font-bold' : ''}>Follow-up {l.nextFollowUpDate}</span>}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-brand-gray/5 border-b border-brand-gray/15 text-brand-gray text-[10px] font-bold uppercase tracking-wider">
                  <th className="py-4 px-4 w-10">
                    <button onClick={handleSelectAll} aria-label="Select all leads on this page" title="Select the leads on this page" className="focus:outline-none">
                      {pageAllSelected ? <CheckSquare size={16} className="text-brand-red" /> : <Square size={16} />}
                    </button>
                  </th>
                  {columns.id && <SortTh field="id" label="Lead ID" sortField={sortField as string} dir={sortDirection} onToggle={() => handleSort('id' as any)} onSet={(d) => setSort('id' as any, d)} />}
                  {columns.date && <SortTh field="date" label="Date" sortField={sortField as string} dir={sortDirection} onToggle={() => handleSort('date' as any)} onSet={(d) => setSort('date' as any, d)} />}
                  {columns.customer && <SortTh field="customerName" label="Customer" sortField={sortField as string} dir={sortDirection} onToggle={() => handleSort('customerName' as any)} onSet={(d) => setSort('customerName' as any, d)} />}
                  {columns.project && <SortTh field="project" label="Project" sortField={sortField as string} dir={sortDirection} onToggle={() => handleSort('project' as any)} onSet={(d) => setSort('project' as any, d)} />}
                  {columns.size && <SortTh field="requiredSize" label="Size" sortField={sortField as string} dir={sortDirection} onToggle={() => handleSort('requiredSize' as any)} onSet={(d) => setSort('requiredSize' as any, d)} right />}
                  {columns.slaStatus && <SortTh field="slaDeadline" label="SLA Status" sortField={sortField as string} dir={sortDirection} onToggle={() => handleSort('slaDeadline' as any)} onSet={(d) => setSort('slaDeadline' as any, d)} />}
                  {columns.priority && <SortTh field="priority" label="Priority" sortField={sortField as string} dir={sortDirection} onToggle={() => handleSort('priority' as any)} onSet={(d) => setSort('priority' as any, d)} />}
                  {columns.score && <th className="py-4 px-3">Score</th>}
                  {columns.touch && <th className="py-4 px-3">Touch</th>}
                  {columns.status && <SortTh field="status" label="Funnel Status" sortField={sortField as string} dir={sortDirection} onToggle={() => handleSort('status' as any)} onSet={(d) => setSort('status' as any, d)} />}
                  {columns.assigned && <SortTh field="assignedSalespersonName" label="Assigned Agent" sortField={sortField as string} dir={sortDirection} onToggle={() => handleSort('assignedSalespersonName' as any)} onSet={(d) => setSort('assignedSalespersonName' as any, d)} />}
                  {columns.channel && <SortTh field="channel" label="Channel" sortField={sortField as string} dir={sortDirection} onToggle={() => handleSort('channel' as any)} onSet={(d) => setSort('channel' as any, d)} />}
                  {columns.leadSource && <SortTh field="source" label="Lead Source" sortField={sortField as string} dir={sortDirection} onToggle={() => handleSort('source' as any)} onSet={(d) => setSort('source' as any, d)} />}
                  {columns.customerId && <th className="py-4 px-3">Customer ID</th>}
                  <th className="py-4 px-4 text-right w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-gray/10 text-xs font-medium text-brand-black">
                {pageLeads.length > 0 ? (
                  pageLeads.map((l) => (
                    <LeadRow
                      key={l.id}
                      lead={l}
                      selected={selectedSet.has(l.id)}
                      cols={visibleColsKey}
                      tick={tick}
                      canAssign={canRoute}
                      winRate={winRates.get(String(l.source || '')) || 0}
                      contact={columns.customerId ? contactOf(l) : undefined}
                      onContact={openContact}
                      onSelect={handleSelectLead}
                      onOpen={setSelectedLead}
                      onAssign={openAssignFor}
                    />
                  ))
                ) : (
                  <tr>
                    <td colSpan={16} className="py-8 text-center text-brand-gray text-xs">
                      No matching leads in active database queue. Apply filters or register inbound leads.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <PagerBar total={filteredLeads.length} page={safePage} pageSize={pageSize} onPage={setPage} onSize={setPageSize} shown={allShown} onMore={() => setAllShown((n) => n + ALL_CHUNK)} />
        </div>
      )}

      {/* -------------------- 2. KANBAN BOARD VIEW -------------------- */}
      {viewMode === 'kanban' && (
        <div className="flex gap-4 overflow-x-auto pb-4 items-start">
          {KANBAN_COLS.map((col) => {
            const all = kanban[col.key];
            const cap = kanbanCap[col.key] || KANBAN_PAGE;
            const shown = all.slice(0, cap);
            return (
              <div key={col.key} className="bg-brand-gray/5 border border-brand-gray/20 rounded-2xl p-4 flex flex-col h-[550px] flex-1 min-w-[270px] shrink-0">
                <div className="flex justify-between items-center mb-3">
                  <span className={`text-[10px] font-extrabold uppercase tracking-wider ${col.title}`}>{col.label}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${col.badge}`}>{all.length.toLocaleString('en-US')}</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {shown.map((l) => (
                    <KanbanCard
                      key={l.id}
                      lead={l}
                      tick={tick}
                      tone={col.tone}
                      winRate={winRates.get(String(l.source || '')) || 0}
                      canRoute={canRoute && col.key === 'new'}
                      onOpen={setSelectedLead}
                      onAssign={openAssignFor}
                    />
                  ))}
                  {all.length > cap && (
                    <button onClick={() => setKanbanCap((c) => ({ ...c, [col.key]: cap + KANBAN_PAGE }))} className="w-full text-[11px] font-bold text-brand-red bg-white border border-brand-gray/20 rounded-xl py-2 hover:bg-brand-red/5">
                      Show more ({(all.length - cap).toLocaleString('en-US')} left)
                    </button>
                  )}
                  {all.length === 0 && <p className="text-[11px] text-brand-gray/70 text-center pt-6">No leads here.</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* -------------------- 3. CALENDAR VIEW -------------------- */}
      {viewMode === 'calendar' && (
        <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="font-bold text-brand-black text-sm uppercase tracking-wide">CRM Activity and Followups Calendar</h4>
            <div className="flex items-center gap-1.5">
              <button onClick={() => shiftCalMonth(-1)} aria-label="Previous month" className="px-2 py-1 border border-brand-gray/20 rounded-lg text-xs font-bold hover:bg-brand-gray/5">&lsaquo;</button>
              <span className="text-xs bg-brand-red/10 text-brand-red font-bold px-3 py-1 rounded-full uppercase">{new Date(calMonth.y, calMonth.m, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span>
              <button onClick={() => shiftCalMonth(1)} aria-label="Next month" className="px-2 py-1 border border-brand-gray/20 rounded-lg text-xs font-bold hover:bg-brand-gray/5">&rsaquo;</button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-2 text-center text-[10px] font-bold text-brand-gray uppercase tracking-widest pb-2 border-b border-brand-gray/10">
            <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
          </div>

          <div className="grid grid-cols-7 gap-2 text-left">
            {calendarDays.map((item, idx) => {
              const dayLeads = item.dateStr ? (calendarIndex.get(item.dateStr) || []) : [];
              return (
                <div
                  key={idx}
                  className={`border rounded-xl p-2 h-20 flex flex-col justify-between overflow-hidden relative group transition-all hover:bg-brand-red/5 ${!item.day ? 'bg-brand-gray/5 opacity-50 border-brand-gray/10' : calDay === item.dateStr ? 'bg-brand-red/5 border-brand-red/40' : 'bg-white border-brand-gray/10'}`}
                >
                  <button disabled={!item.day} onClick={() => { setCalDay(item.dateStr); setCalCap(50); }} className="text-xs font-bold text-brand-gray group-hover:text-brand-black text-left">{item.day}</button>
                  {dayLeads.length > 0 && (
                    <div className="space-y-0.5 max-h-10 overflow-hidden">
                      {dayLeads.slice(0, 2).map((dl) => (
                        <div
                          key={dl.id}
                          onClick={() => setSelectedLead(dl)}
                          className="bg-brand-red text-white text-[8px] font-bold px-1 py-0.5 rounded truncate cursor-pointer block"
                          title={`${dl.customerName} - ${dl.project}`}
                        >
                          {(dl.customerName || '—').split(' ')[0]}
                        </div>
                      ))}
                      {dayLeads.length > 2 && (
                        <button onClick={() => { setCalDay(item.dateStr); setCalCap(50); }} className="text-[8px] font-bold text-brand-gray/70 hover:text-brand-red">+{dayLeads.length - 2} more</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {calDay && (() => {
            const list = calendarIndex.get(calDay) || [];
            return (
              <div className="border border-brand-gray/15 rounded-xl p-3 bg-brand-gray/5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-brand-black">{calDay}: {list.length.toLocaleString('en-US')} lead{list.length === 1 ? '' : 's'}</span>
                  <button onClick={() => setCalDay(null)} className="text-[11px] text-brand-gray hover:text-brand-black font-bold">Close</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {list.slice(0, calCap).map((dl) => (
                    <button key={dl.id} onClick={() => setSelectedLead(dl)} className="flex items-center justify-between gap-2 text-left bg-white border border-brand-gray/15 rounded-lg px-2.5 py-1.5 hover:border-brand-red/40">
                      <span className="truncate text-xs"><span className="font-mono font-bold text-brand-red mr-1.5">{dl.id}</span>{dl.customerName}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap ${statusClass(dl.status)}`}>{dl.status}</span>
                    </button>
                  ))}
                </div>
                {list.length > calCap && (
                  <button onClick={() => setCalCap((c) => c + 50)} className="mt-2 text-[11px] font-bold text-brand-red">Show more ({list.length - calCap} left)</button>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* -------------------- INBOUND CREATION MODAL -------------------- */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-brand-black text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide">Register Inbound CRM Lead</h4>
              <button onClick={() => setShowCreateModal(false)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateLead} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Customer Name *</label>
                  <input
                    type="text"
                    required
                    value={newLeadForm.customerName}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, customerName: e.target.value })}
                    placeholder="e.g., صاحب شركة / اسلام محمد سماني"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Mobile Number *</label>
                  <input
                    type="text"
                    required
                    value={newLeadForm.phoneNumber}
                    onChange={(e) => { setCreateDup(null); setNewLeadForm({ ...newLeadForm, phoneNumber: e.target.value }); }}
                    placeholder="e.g., 01118485856"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Email Address</label>
                  <input
                    type="email"
                    value={newLeadForm.email}
                    onChange={(e) => { setCreateDup(null); setNewLeadForm({ ...newLeadForm, email: e.target.value }); }}
                    placeholder="e.g., eslam.samany@stefner.com"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Company Name</label>
                  <input
                    type="text"
                    value={newLeadForm.companyName}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, companyName: e.target.value })}
                    placeholder="e.g., ستيفنر للحديد"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Target Project</label>
                  <select
                    value={newLeadForm.project}
                    required
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, project: e.target.value })}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  >
                    <option value="">Select project...</option>
                    {(() => {
                      // Configured canonical projects first, else the standard list; plus any project already used by a lead
                      const configured = crmService.getQueueSettings()?.canonicalProjects;
                      const base = configured && configured.length > 0 ? configured : ['Industria East', 'Industria West', 'Industria Sadat', 'Industria Sokhna'];
                      return Array.from(new Set([...base, ...projects])).map(p => <option key={p} value={p}>{p}</option>);
                    })()}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Size Required (sqm)</label>
                  <input
                    type="number"
                    value={newLeadForm.requiredSize}
                    min={0}
                    placeholder="optional"
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, requiredSize: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0) })}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>

              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Lead Channel Source *</label>
                  <select
                    value={newLeadForm.source}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, source: e.target.value })}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  >
                    <option value="">Select source...</option>
                    {SOURCES.map(src => <option key={src} value={src}>{src}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Priority Alignment</label>
                  <select
                    value={newLeadForm.priority}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, priority: e.target.value as LeadPriority })}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  >
                    {PRIORITIES.map(p => <option key={p} value={p}>{p}{p === 'VIP' ? ' (first contact within 4 hours)' : ''}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Mobile Number 2</label>
                  <input type="text" value={newLeadForm.phone2} onChange={(e) => setNewLeadForm({ ...newLeadForm, phone2: e.target.value })} className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none font-mono" />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Industry</label>
                  <select value={newLeadForm.industry} onChange={(e) => setNewLeadForm({ ...newLeadForm, industry: e.target.value })} className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none">
                    <option value="">—</option>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Nationality</label>
                  <datalist id="crm-nat-create">{NATIONALITIES.map(n => <option key={n} value={n} />)}</datalist>
                  <input list="crm-nat-create" value={newLeadForm.nationality} onChange={(e) => setNewLeadForm({ ...newLeadForm, nationality: e.target.value })} className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none" />
                </div>
              </div>

              {createDup && (
                <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 space-y-2">
                  <p className="text-[11px] leading-relaxed flex gap-2"><AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" /><span>Lead <strong>{createDup.lead.id}</strong> ({createDup.lead.customerName}) already has {createDup.why}. It is owned by <strong>{createDup.lead.assignedSalespersonName || 'nobody yet (unrouted queue)'}</strong>.</span></p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setShowCreateModal(false); setSelectedLead(createDup.lead); setCreateDup(null); }} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg text-[11px]">Open that lead</button>
                    {isOps && <button type="button" onClick={(e) => handleCreateLead(e as any, true)} className="bg-white border border-amber-300 font-bold px-3 py-1.5 rounded-lg text-[11px]">Create another lead anyway</button>}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Inquiry Description Comments</label>
                <textarea
                  value={newLeadForm.description}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, description: e.target.value })}
                  rows={3}
                  placeholder="Insert any detailed comment or description..."
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl p-3 focus:outline-none"
                />
              </div>

              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl flex gap-3 text-yellow-800">
                <Info size={16} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  <strong>Automatic Duplicate Detection:</strong> the same phone number (any format) or the same e-mail address on another lead is detected before saving; you will see who owns it and can open that lead.
                </p>
              </div>

              <div className="flex justify-end gap-2.5 pt-4 border-t border-brand-gray/10">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-brand-red hover:bg-brand-red-dark text-white px-5 py-2 rounded-xl font-bold shadow"
                >
                  Confirm Lead Intake
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* -------------------- ROUTING ASSIGNMENT MODAL -------------------- */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-brand-black text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide">Assign / Reassign Salesperson</h4>
              <button onClick={() => setShowAssignModal(false)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <p className="text-brand-gray">Select an account manager to route the selected CRM Lead(s).</p>
              
              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Select Agent</label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2.5 text-xs focus:outline-none"
                >
                  <option value="">Select salesperson...</option>
                  {salespeople.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.activeLeads} active leads / {s.leave ? 'On Leave' : 'Online'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2.5 pt-4">
                <button
                  onClick={() => setShowAssignModal(false)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssignSalesperson}
                  disabled={!assigneeId}
                  className="bg-brand-red hover:bg-brand-red-dark disabled:opacity-50 text-white px-5 py-2 rounded-xl font-bold shadow"
                >
                  Assign Agent
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* -------------------- MERGE RECORD MODAL -------------------- */}
      {showMergeModal && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-brand-black text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide">Merge Duplicate CRM Leads</h4>
              <button onClick={() => setShowMergeModal(false)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <p className="text-brand-gray">Combine the timeline and specifications of two duplicate lead records. The duplicate record will be marked closed, and the primary record updated.</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Primary Record ID</label>
                  <select
                    value={primaryLeadMergeId}
                    onChange={(e) => setPrimaryLeadMergeId(e.target.value)}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none"
                  >
                    <option value="">Select primary...</option>
                    {leads.filter(l => l.status !== 'Duplicate').map(l => (
                      <option key={l.id} value={l.id}>{l.id} - {l.customerName}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Duplicate Record ID</label>
                  <select
                    value={duplicateLeadMergeId}
                    onChange={(e) => setDuplicateLeadMergeId(e.target.value)}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none"
                  >
                    <option value="">Select duplicate...</option>
                    {leads.filter(l => l.id !== primaryLeadMergeId).map(l => (
                      <option key={l.id} value={l.id}>{l.id} - {l.customerName}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row justify-between items-center gap-2.5 pt-4 border-t border-brand-gray/10">
                {isAdmin ? (
                  <button
                    onClick={handleAutoPurgeDuplicates}
                    className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-white px-3.5 py-2 rounded-xl font-bold text-xs shadow flex items-center justify-center gap-1.5"
                    title="Automatically scan and delete duplicate lead records by phone/email"
                  >
                    <RefreshCw size={13} className="animate-spin-slow" />
                    <span>Auto-Purge All Duplicates</span>
                  </button>
                ) : <div />}
                <div className="flex justify-end gap-2.5 w-full sm:w-auto">
                  <button
                    onClick={() => setShowMergeModal(false)}
                    className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleMergeDuplicate}
                    disabled={!primaryLeadMergeId || !duplicateLeadMergeId}
                    className="bg-brand-red hover:bg-brand-red-dark disabled:opacity-50 text-white px-5 py-2 rounded-xl font-bold shadow"
                  >
                    Confirm Record Merge
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* -------------------- DETAIL OVERLAY PANEL -------------------- */}
      <AnimatePresence>
        {selectedLead && !showAssignModal && (
          <>
            {/* Backdrop for clicking outside */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-brand-black/40 backdrop-blur-xs z-30"
              onClick={() => setSelectedLead(null)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.2 }}
              className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl z-40 border-l border-brand-gray/20 flex flex-col h-full overflow-hidden"
            >
            
            {/* Header */}
            <div className="p-5 border-b border-brand-gray/15 bg-brand-black text-white flex justify-between items-center">
              <div>
                <span className="font-mono text-xs font-bold text-brand-red">{selectedLead.id}</span>
                <h4 className="font-bold text-base leading-snug mt-0.5">{selectedLead.customerName}</h4>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    onClick={() => handleDeleteLead(selectedLead.id)}
                    className="p-1.5 hover:bg-rose-600/30 text-rose-400 hover:text-rose-200 rounded-lg transition-colors flex items-center gap-1 text-xs font-bold mr-2"
                    title="Delete Sales Lead"
                  >
                    <Trash2 size={16} />
                    <span>Delete</span>
                  </button>
                )}
                <button
                  onClick={() => setSelectedLead(null)}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-white"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Inner Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">

              {/* CRM Details Grid */}
              <Collapse title="Customer details" defaultOpen summary={`${selectedLead.phoneNumber || 'no phone'} · ${selectedLead.project || 'project —'}`}>
              <div className="grid grid-cols-2 gap-4 bg-white border border-brand-gray/15 rounded-xl p-4">
                <div>
                  <span className="text-brand-gray text-[10px] font-bold uppercase tracking-wider block mb-0.5">Customer Name</span>
                  <span className="font-extrabold text-brand-black text-xs">{selectedLead.customerName}</span>
                </div>
                <div>
                  <span className="text-brand-gray text-[10px] font-bold uppercase tracking-wider block mb-0.5">Project</span>
                  <span className="font-extrabold text-brand-black text-xs">{selectedLead.project}</span>
                </div>
                <div>
                  <span className="text-brand-gray text-[10px] font-bold uppercase tracking-wider block mb-0.5">Contact Number</span>
                  <span className="font-mono text-brand-black font-bold text-xs">{phoneIntl(selectedLead.phoneNumber) || selectedLead.phoneNumber || '—'}</span>
                </div>
                <div>
                  <span className="text-brand-gray text-[10px] font-bold uppercase tracking-wider block mb-0.5">Customer Email</span>
                  <span className="text-brand-black text-xs">{selectedLead.email || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-brand-gray text-[10px] font-bold uppercase tracking-wider block mb-0.5">Corporate Company</span>
                  <span className="text-brand-black text-xs font-bold">{selectedLead.companyName || 'Private Inquiry'}</span>
                </div>
                <div>
                  <span className="text-brand-gray text-[10px] font-bold uppercase tracking-wider block mb-0.5">Target Land Size</span>
                  <span className="font-mono text-brand-black text-xs font-bold">{fmtSize(selectedLead.requiredSize)}</span>
                </div>
                <div>
                  <span className="text-brand-gray text-[10px] font-bold uppercase tracking-wider block mb-0.5">SLA Status</span>
                  <span className={`font-mono text-xs font-extrabold px-2 py-0.5 rounded-md ${getSlaStatus(selectedLead).isViolated ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}`}>
                    {getSlaStatus(selectedLead).isViolated ? `VIOLATED: ${getSlaStatus(selectedLead).remainingText}` : `ACTIVE: ${getSlaStatus(selectedLead).remainingText}`}
                  </span>
                </div>
                <div>
                  <span className="text-brand-gray text-[10px] font-bold uppercase tracking-wider block mb-0.5">Channel</span>
                  <span className="text-brand-black text-xs font-semibold">{channelOf(selectedLead) === NO_CHANNEL ? '—' : channelOf(selectedLead)}</span>
                </div>
                <div>
                  <span className="text-brand-gray text-[10px] font-bold uppercase tracking-wider block mb-0.5">Customer ID</span>
                  {(() => { const c = contactOf(selectedLead); return c ? (
                    <button onClick={() => openContact(c)} className="font-mono text-xs font-bold text-brand-red hover:underline" title="Open this customer in Contacts">{c.serialNumber || c.id}</button>
                  ) : <span className="text-brand-black text-xs">—</span>; })()}
                </div>
                <div>
                  <span className="text-brand-gray text-[10px] font-bold uppercase tracking-wider block mb-0.5">Lead Source</span>
                  <div className="flex flex-col gap-1">
                    <span className="text-brand-black text-xs font-semibold">{selectedLead.source || '—'}</span>
                    {selectedLead.emailId && (
                      <button
                        onClick={() => handleViewInboundEmail(selectedLead)}
                        className="text-brand-red hover:underline text-[10px] font-bold flex items-center gap-1.5 w-fit mt-1 text-left"
                      >
                        <Mail size={12} className="inline" />
                        <span>View Ingested Email</span>
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-brand-gray text-[10px] font-bold uppercase tracking-wider block mb-0.5">Account Manager</span>
                  <span className="text-indigo-600 text-xs font-bold flex items-center gap-1">
                    <UserCheck size={12} />
                    {selectedLead.assignedSalespersonName || 'Unassigned Queue'}
                  </span>
                </div>
              </div>

              </Collapse>


              {/* SLA / Priority strip */}
              {(() => {
                const slaInfo = getSlaStatus(selectedLead);
                const stripBgClass = slaInfo.isViolated 
                  ? "bg-red-50 border-red-200 text-red-950" 
                  : "bg-brand-gray/5 border-brand-gray/15 text-brand-black";
                return (
                  <div className={`border rounded-xl p-4 space-y-3 transition-all ${stripBgClass}`}>
                    <div className="flex justify-between items-center flex-wrap gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider opacity-80">Priority:</span>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${priorityClass(selectedLead.priority)}`}>{prioKey(selectedLead.priority) || '—'}</span>
                        <LeadScoreChip lead={selectedLead} winRate={winRates.get(String(selectedLead.source || '')) || 0} />
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider opacity-80">SLA Status:</span>
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-extrabold border ${
                          slaInfo.status === 'violated' || slaInfo.status === 'missed'
                            ? 'bg-red-200/60 text-red-800 border-red-300 animate-pulse'
                            : slaInfo.status === 'met'
                            ? 'bg-emerald-200/60 text-emerald-800 border-emerald-300'
                            : 'bg-amber-100 text-amber-800 border-amber-200'
                        }`}>
                          {slaInfo.text} ({slaInfo.remainingText})
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2.5 border-t border-current/10 text-[11px]">
                      <div>
                        <span className="font-extrabold uppercase tracking-wider text-[9px] block opacity-70 mb-0.5">Lead Registered:</span>
                        <span className="font-mono font-semibold">{formatLeadDateTime(selectedLead.date)}</span>
                      </div>
                      <div>
                        <span className="font-extrabold uppercase tracking-wider text-[9px] block opacity-70 mb-0.5">SLA Deadline Date & Time:</span>
                        <span className="font-mono font-semibold">
                          {selectedLead.slaDeadline ? formatLeadDateTime(selectedLead.slaDeadline) : 'Pending'}
                        </span>
                      </div>
                      {(() => {
                        const n = neglectInfo(selectedLead);
                        if (n.state === 'na') return null;
                        const bad = n.state === 'vip-breach' || n.state === 'neglected';
                        return (
                          <div className="sm:col-span-2">
                            <span className="font-extrabold uppercase tracking-wider text-[9px] block opacity-70 mb-0.5">First-contact SLA (VIP 4h, others 48h):</span>
                            <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${bad ? 'bg-red-200/60 text-red-800 border-red-300' : n.state === 'contacted' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>{n.label}</span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}

              {/* Duplicate Warnings */}
              {duplicateWarnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex flex-col gap-2 text-amber-800">
                  <div className="flex gap-2 items-center">
                    <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
                    <span className="font-bold text-xs">Warning: {duplicateWarnings.length} Potential Duplicate Records Detected!</span>
                  </div>
                  <p className="text-[10px] leading-relaxed">
                    {duplicateWarnings.slice(0, 3).map(d => `${d.id} (${d.assignedSalespersonName || 'unrouted'})`).join(', ')}{duplicateWarnings.length > 3 ? ` +${duplicateWarnings.length - 3}` : ''} share the same phone number or e-mail with this lead.
                  </p>
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => setSelectedLead(duplicateWarnings[0])}
                      className="bg-white border border-amber-300 text-amber-800 font-bold px-3 py-1 rounded text-[10px]"
                    >
                      Open {duplicateWarnings[0].id}
                    </button>
                    <button
                      onClick={() => {
                        setPrimaryLeadMergeId(selectedLead.id);
                        setDuplicateLeadMergeId(duplicateWarnings[0].id);
                        setShowMergeModal(true);
                      }}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1 rounded text-[10px]"
                    >
                      Merge with {duplicateWarnings[0].id}
                    </button>
                  </div>
                </div>
              )}

              {/* Quick Actions Bar */}
              {currentRole !== 'Read Only' && (
                <div className="space-y-2">
                  <span className="text-[10px] font-extrabold text-brand-gray uppercase tracking-wider block mb-2">Communication Actions</span>
                  <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
                    <button
                      onClick={() => setShowInteractionModal('call')}
                      className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 p-2.5 rounded-xl flex flex-col items-center gap-1 font-bold shadow-sm"
                    >
                      <Phone size={16} />
                      <span>Log Call</span>
                    </button>

                    <button
                      onClick={handleEmailActionClick}
                      className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 p-2.5 rounded-xl flex flex-col items-center gap-1 font-bold shadow-sm"
                    >
                      <Mail size={16} />
                      <span>Send Mail</span>
                    </button>

                    <button
                      onClick={handleWhatsappActionClick}
                      className="bg-green-50 hover:bg-green-100 border border-green-200 text-green-800 p-2.5 rounded-xl flex flex-col items-center gap-1 font-bold text-center shadow-sm"
                    >
                      <MessageSquare size={16} />
                      <span>WhatsApp</span>
                    </button>

                    <button
                      onClick={() => setShowInteractionModal('meeting')}
                      className="bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-800 p-2.5 rounded-xl flex flex-col items-center gap-1 font-bold shadow-sm"
                    >
                      <CalendarDays size={16} />
                      <span>Meeting</span>
                    </button>

                    <button
                      onClick={() => setShowInteractionModal('follow-up')}
                      className="bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-800 p-2.5 rounded-xl flex flex-col items-center gap-1 font-bold shadow-sm"
                    >
                      <Clock size={16} />
                      <span>Follow Up</span>
                    </button>

                    <button
                      onClick={() => setShowInteractionModal('visit')}
                      className="bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 p-2.5 rounded-xl flex flex-col items-center gap-1 font-bold shadow-sm"
                    >
                      <Activity size={16} />
                      <span>Site Visit</span>
                    </button>

                    <button
                      onClick={() => handleAttachmentUploadClick()}
                      className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black p-2.5 rounded-xl flex flex-col items-center gap-1 font-bold shadow-sm"
                    >
                      <Paperclip size={16} />
                      <span>Attach File</span>
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleAttachmentSelected}
                      className="hidden"
                    />
                  </div>
                </div>
              )}

              {/* Lead form: status, follow-up, qualification, contact, deal stages (rules per spec) */}
              <LeadEditor
                lead={selectedLead}
                auth={leadAuth}
                actorName={user?.name || 'Agent'}
                actorId={user ? String(user.id) : undefined}
                onSaved={(u) => { setSelectedLead(u); onLeadsUpdated(); }}
                onOpenLead={(id) => { const f = crmService.getLeads().find(x => x.id === id); if (f) setSelectedLead(f); }}
              />

              {/* Description Comments */}
              <div>
                <span className="text-[10px] font-extrabold text-brand-gray uppercase tracking-wider block mb-2">Original Inquiry Comments</span>
                <p dir="auto" className="bg-brand-gray/5 border border-brand-gray/15 p-3.5 rounded-xl text-brand-black leading-relaxed whitespace-pre-wrap break-words">
                  {selectedLead.description || 'No original descriptions loaded.'}
                </p>
              </div>

              <Collapse title="Plot recommendations & offers" summary={`${(selectedLead.assignedPlots || []).length} plots chosen`}>
              <LeadPlotsPanel
                  lead={selectedLead} plots={plots} landBankUrl={plotsInfo?.landBankUrl} user={user?.name || 'User'}
                  onNavigateToInventory={() => setActiveSubTab('plots-inventory')}
                  onSave={(upd) => {
                    try { const u = crmService.updateLead(selectedLead.id, upd, user?.name || 'User', { userId: user?.id != null ? String(user.id) : undefined }); setSelectedLead(u); onLeadsUpdated(); }
                    catch (e: any) { toast.error(e?.message || 'Could not save.'); }
                  }}
              />

              <OfferPrintsSection leadId={selectedLead.id} />
              </Collapse>

              {/* Attachments Section */}
              {selectedLead.attachments?.length > 0 && (
                <Collapse title={`Attachments (${selectedLead.attachments?.length || 0})`}>

                  <div className="grid grid-cols-2 gap-2">
                    {selectedLead.attachments?.map((att, attIdx) => (
                      <div key={`${att.id}-${attIdx}`} className="flex items-center justify-between p-2.5 bg-brand-gray/5 border border-brand-gray/15 rounded-lg">
                        <div className="flex flex-col min-w-0">
                          {safeUrl(att.dataUrl) ? (
                            <a
                              href={safeUrl(att.dataUrl)}
                              download={att.name}
                              className="truncate font-semibold text-brand-red hover:underline text-xs"
                              title="Click to Download"
                            >
                              {att.name}
                            </a>
                          ) : (
                            <span className="truncate font-semibold text-brand-black" title={att.name}>{att.name}</span>
                          )}
                          <span className="text-[9px] text-brand-gray font-mono whitespace-nowrap">{att.size}</span>
                        </div>
                        {safeUrl(att.dataUrl) && (
                          <a
                            href={safeUrl(att.dataUrl)}
                            download={att.name}
                            className="text-brand-red hover:text-brand-red-dark text-[10px] font-bold underline"
                          >
                            Download
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </Collapse>
              )}

              {/* CRM Sales Notes / Comments Feed */}
              <div className="space-y-3">
                <span className="text-[10px] font-extrabold text-brand-gray uppercase tracking-wider block">CRM Sales Notes ({visibleComments.length})</span>
                
                {/* Notes List */}
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {visibleComments.map((cmt, cmtIdx) => (
                    <div key={`${cmt.id}-${cmtIdx}`} className={`p-3 rounded-xl border ${cmt.isPrivate ? 'bg-rose-50/50 border-rose-200' : 'bg-brand-gray/5 border-brand-gray/15'}`}>
                      <div className="flex justify-between items-center text-[10px] text-brand-gray font-semibold mb-1">
                        <span className="font-bold text-brand-black">{cmt.user} {cmt.isPrivate && <span className="bg-rose-200 text-rose-800 text-[8px] px-1 py-0.5 rounded ml-1 font-extrabold">PRIVATE</span>}</span>
                        <span>{cmt.date} {cmt.time}</span>
                      </div>
                      <p className="text-brand-black font-medium leading-relaxed">{cmt.comment}</p>
                    </div>
                  ))}
                </div>

                {/* Notes input */}
                {currentRole !== 'Read Only' && (
                  <div className="space-y-2 bg-brand-gray/5 p-3.5 rounded-xl border border-brand-gray/15">
                    <textarea
                      value={newCommentText}
                      onChange={(e) => setNewCommentText(e.target.value)}
                      placeholder="Add a new CRM note, meeting feedback or call logs..."
                      rows={2}
                      className="w-full bg-white border border-brand-gray/20 rounded-lg p-2.5 focus:outline-none"
                    />
                    <div className="flex justify-between items-center">
                      <label className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-brand-gray cursor-pointer">
                        <input
                          type="checkbox"
                          checked={commentPrivate}
                          onChange={() => setCommentPrivate(!commentPrivate)}
                          className="rounded text-brand-red focus:ring-brand-red"
                        />
                        <span>Private note (Manager/Operations only)</span>
                      </label>
                      <button
                        onClick={handleAddComment}
                        className="bg-brand-black text-white text-xs font-bold px-4 py-1.5 rounded-lg shadow hover:scale-101 transition-all"
                      >
                        Submit Note
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* TIMELINE TRACKER */}
              <Collapse title={`Timeline (${(selectedLead.timeline || []).length})`}>

                <div className="relative border-l border-brand-gray/20 pl-4 ml-2 space-y-4">
                  {(selectedLead.timeline || []).map((event, evIdx) => {
                    return (
                      <div key={`${event.id}-${evIdx}`} className="relative">
                        {/* Event icon dot */}
                        <div className="absolute -left-[21px] top-0.5 bg-white border border-brand-gray/30 p-1 rounded-full text-brand-red shadow-sm z-10">
                          <Activity size={8} />
                        </div>
                        <div>
                          <div className="flex justify-between items-center text-[10px] font-bold text-brand-gray">
                            <span className="text-brand-black font-extrabold uppercase">{event.type} — {event.title}</span>
                            <span className="font-mono">{new Date(event.timestamp).toLocaleString()}</span>
                          </div>
                          <p className="text-brand-gray mt-0.5">{event.description}</p>
                          <span className="text-[9px] text-indigo-600 font-bold block mt-0.5">Actor: {event.user}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Collapse>

              {/* Server-written change history: owner, status, source, value, stage dates, cash */}
              <LeadAuditHistory leadId={selectedLead.id} version={String((selectedLead as any)._rev || selectedLead.lastUpdated)} />

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>

      {/* -------------------- INTERACTION SIMULATION MODALS -------------------- */}
      {showInteractionModal && selectedLead && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-brand-black text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide">
                Log {showInteractionModal.toUpperCase()} Interaction
              </h4>
              <button onClick={() => setShowInteractionModal(null)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Date</label>
                  <input
                    type="date"
                    value={interactionDate}
                    onChange={(e) => setInteractionDate(e.target.value)}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Time</label>
                  <input
                    type="time"
                    value={interactionTime}
                    onChange={(e) => setInteractionTime(e.target.value)}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none"
                  />
                </div>
              </div>

              {showInteractionModal === 'call' && isPhoneDevice() && (
                <button type="button" onClick={handleDialNow} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-3 text-sm font-extrabold flex items-center justify-center gap-2 shadow">
                  <Phone size={18} /> Call {phoneIntl(selectedLead.phoneNumber) || selectedLead.phoneNumber} now
                </button>
              )}

              {showInteractionModal === 'call' && (
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Call Outcome / Status</label>
                  <select
                    value={callOutcome}
                    onChange={(e) => setCallOutcome(e.target.value)}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none font-semibold text-brand-black"
                  >
                    <option value="Contacted">Contacted / Reached Customer</option>
                    <option value="Line Busy">Line Busy</option>
                    <option value="No Answer">No Answer / Missed Call</option>
                    <option value="Wrong Number">Wrong Number</option>
                    <option value="Asked to Call Back">Asked to Call Back</option>
                    <option value="Not Interested">Not Interested</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              )}

              {showInteractionModal === 'meeting' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Location / Meeting Link</label>
                    <input
                      type="text"
                      value={interactionLocation}
                      onChange={(e) => setInteractionLocation(e.target.value)}
                      placeholder="e.g. Conference Room A, or Zoom link"
                      className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2 p-3 bg-brand-gray/5 border border-brand-gray/10 rounded-xl">
                    <div className="text-[10px] flex-1 text-brand-gray font-medium">
                      Need a physical room? Book one via Elsewedy MRB.
                    </div>
                    <a 
                      href="https://mrb.elsewedy.com/Login.aspx" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="bg-brand-red hover:bg-brand-red-dark text-white px-3 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap"
                    >
                      Book Room
                    </a>
                  </div>
                </div>
              )}

              {showInteractionModal === 'visit' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Project Name</label>
                    <input
                      type="text"
                      value={interactionProjectName}
                      onChange={(e) => setInteractionProjectName(e.target.value)}
                      placeholder="e.g. PI Parks"
                      className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Site Notification Email</label>
                    <input
                      type="email"
                      value={interactionSiteEmail}
                      onChange={(e) => setInteractionSiteEmail(e.target.value)}
                      placeholder="site@example.com"
                      className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Interaction Summary Notes</label>
                <textarea
                  value={interactionNotes}
                  onChange={(e) => setInteractionNotes(e.target.value)}
                  placeholder={`Detail notes of your ${showInteractionModal}...`}
                  rows={3}
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl p-3 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-4">
                <button
                  onClick={() => setShowInteractionModal(null)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLogInteraction}
                  className="bg-brand-red hover:bg-brand-red-dark text-white px-5 py-2 rounded-xl font-bold shadow"
                >
                  Confirm Logs
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* -------------------- BULK WON: a deal value per lead -------------------- */}
      {bulkWon && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-brand-black text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide">Mark {bulkWon.length} lead(s) as Won</h4>
              <button onClick={() => setBulkWon(null)} className="text-white/60 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 text-xs space-y-3 overflow-y-auto">
              <p className="text-[11px] text-brand-gray">Enter the cash value of each deal in EGP. A Won lead cannot be saved without it. Accounts receivable confirms the cash afterwards.</p>
              {bulkWon.map((r, i) => (
                <div key={r.id} className="grid grid-cols-5 items-center gap-3">
                  <div className="col-span-3 truncate"><span className="font-mono font-bold text-brand-red mr-1.5">{r.id}</span>{r.name} <span className="text-brand-gray">· {r.project}</span></div>
                  <input
                    type="number" min={0} value={r.value} placeholder="Deal value (EGP)"
                    onChange={(e) => setBulkWon(bulkWon.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    className={`col-span-2 bg-brand-gray/5 border rounded-xl px-3 py-1.5 focus:outline-none ${Number(r.value) > 0 ? 'border-brand-gray/20' : 'border-rose-300'}`}
                  />
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-brand-gray/10 flex justify-end gap-2.5">
              <button onClick={() => setBulkWon(null)} className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold text-xs">Cancel</button>
              <button onClick={confirmBulkWon} disabled={bulkWon.some(r => !(Number(r.value) > 0))} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-5 py-2 rounded-xl font-bold text-xs shadow">Mark as Won</button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- LOST REASON MODAL -------------------- */}
      {showLostModal && selectedLead && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-brand-black text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide">Close Lead as LOST</h4>
              <button onClick={() => setShowLostModal(false)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs font-medium">
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex gap-2 text-rose-800">
                <AlertTriangle size={16} className="text-rose-600 flex-shrink-0" />
                <p className="text-[10px] leading-relaxed">
                  <strong>Mandatory details required:</strong> An enterprise-grade audit trail requires explaining why this opportunity failed.
                </p>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Lost Category *</label>
                <select
                  value={lostCategory}
                  onChange={(e) => setLostCategory(e.target.value)}
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none"
                >
                  <option value="">Select...</option>
                  {LOST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Lost Reason *</label>
                <select
                  value={lostReasonTeam}
                  onChange={(e) => setLostReasonTeam(e.target.value)}
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none"
                >
                  <option value="">Select...</option>
                  {LOST_REASONS_TEAM.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Lost Comment / Explanation *</label>
                <textarea
                  value={lostComment}
                  onChange={(e) => setLostComment(e.target.value)}
                  rows={3}
                  required
                  placeholder="Explain exactly why this deal was lost..."
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl p-3 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-4">
                <button
                  onClick={() => setShowLostModal(false)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMarkAsLost}
                  disabled={!lostComment.trim() || !lostCategory || !lostReasonTeam}
                  className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-5 py-2 rounded-xl font-bold shadow"
                >
                  Confirm Lead Lost
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* -------------------- WHATSAPP TEMPLATE MODAL -------------------- */}
      {showWhatsappTemplateModal && selectedLead && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden text-xs"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-green-600 text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide flex items-center gap-2">
                <MessageSquare size={18} />
                <span>Prepare WhatsApp Message</span>
              </h4>
              <button onClick={() => setShowWhatsappTemplateModal(false)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 font-medium">
              <div className="p-3 bg-green-50 border border-green-100 rounded-xl flex gap-2 text-green-800">
                <Info size={16} className="text-green-600 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] leading-relaxed">
                  Review and customize the message template before sending. Once sent, the message will open in WhatsApp Web and the action will be registered in the Lead timeline history.
                </p>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Recipient</label>
                <div className="p-2.5 bg-brand-gray/5 border border-brand-gray/15 rounded-xl font-bold text-brand-black">
                  {selectedLead.customerName} ({phoneIntl(selectedLead.phoneNumber) || selectedLead.phoneNumber})
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Template</label>
                  <select value={waTemplate} onChange={(e) => pickWaTemplate(e.target.value)} className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none">
                    {Object.keys(WA_TEMPLATES).map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Language</label>
                  <select value={waLang} onChange={(e) => pickWaLang(e.target.value as WaLang)} className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none">
                    {(Object.keys(WA_LANGS) as WaLang[]).map(k => <option key={k} value={k}>{WA_LANGS[k]}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Message Text *</label>
                <textarea
                  value={whatsappTemplateText}
                  onChange={(e) => setWhatsappTemplateText(e.target.value)}
                  rows={8}
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl p-3.5 focus:outline-none font-sans text-brand-black leading-relaxed"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-4 border-t border-brand-gray/10">
                <button
                  type="button"
                  onClick={() => setShowWhatsappTemplateModal(false)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleWhatsappSend}
                  disabled={!whatsappTemplateText.trim()}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2 rounded-xl font-bold shadow flex items-center gap-1.5"
                >
                  <span>Launch WhatsApp Web</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* -------------------- EMAIL TEMPLATE MODAL -------------------- */}
      {showEmailTemplateModal && selectedLead && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden text-xs"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-blue-600 text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide flex items-center gap-2">
                <Mail size={18} />
                <span>Prepare Corporate Email</span>
              </h4>
              <button onClick={() => setShowEmailTemplateModal(false)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 font-medium">
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl flex gap-2 text-blue-800">
                <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] leading-relaxed">
                  Review and customize this professional email template. Clicking "Download" will download an offline-ready standard <strong>.eml</strong> message file containing headers and body, which automatically opens in corporate email software like Outlook or Mail, pre-addressed.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Recipient Email</label>
                  <div className="p-2.5 bg-brand-gray/5 border border-brand-gray/15 rounded-xl font-bold text-brand-black truncate">
                    {selectedLead.email || 'N/A (Will use contact name)'}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Customer Name</label>
                  <div className="p-2.5 bg-brand-gray/5 border border-brand-gray/15 rounded-xl font-bold text-brand-black">
                    {selectedLead.customerName}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Email Body *</label>
                <textarea
                  value={emailTemplateText}
                  onChange={(e) => setEmailTemplateText(e.target.value)}
                  rows={10}
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl p-3.5 focus:outline-none font-sans text-brand-black leading-relaxed"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-4 border-t border-brand-gray/10">
                <button
                  type="button"
                  onClick={() => setShowEmailTemplateModal(false)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleEmailSend}
                  disabled={!emailTemplateText.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-xl font-bold shadow flex items-center gap-1.5"
                >
                  <span>{isPhoneDevice() ? 'Open in my mail app' : 'Download .EML File'}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* -------------------- CUSTOM DELETE CONFIRMATION DIALOGS (ADMIN ONLY) -------------------- */}
      {deleteConfirmLeadId && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-[100] p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-rose-600 text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide flex items-center gap-2">
                <Trash2 size={18} />
                <span>Confirm Permanent Deletion</span>
              </h4>
              <button onClick={() => setDeleteConfirmLeadId(null)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <p className="text-brand-gray leading-relaxed text-sm">
                Are you absolutely sure you want to permanently delete lead <strong className="text-brand-black font-extrabold font-mono">{deleteConfirmLeadId}</strong>?
              </p>
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-800 leading-relaxed text-[11px]">
                <strong>Warning:</strong> This operation cannot be undone. All logs, specifications, and comments associated with this sales lead will be permanently deleted from local store.
              </div>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmLeadId(null)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteLead}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-5 py-2 rounded-xl font-bold shadow"
                >
                  Permanently Delete
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {deleteConfirmBulk && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-[100] p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-rose-600 text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide flex items-center gap-2">
                <Trash2 size={18} />
                <span>Confirm Bulk Deletion</span>
              </h4>
              <button onClick={() => setDeleteConfirmBulk(false)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <p className="text-brand-gray leading-relaxed text-sm">
                Are you absolutely sure you want to permanently delete the <strong className="text-brand-black font-extrabold">{selectedLeadIds.length}</strong> selected sales leads?
              </p>
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-800 leading-relaxed text-[11px]">
                <strong>Warning:</strong> This operation cannot be undone. These records will be permanently erased from local store.
              </div>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmBulk(false)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmBulkDelete}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-5 py-2 rounded-xl font-bold shadow"
                >
                  Permanently Delete Selected
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* -------------------- INBOUND EMAIL SOURCE VERIFICATION MODAL -------------------- */}
      {showSourceEmailModal && selectedLead && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-[100] p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden"
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-brand-black text-white">
              <div className="flex items-center gap-2.5">
                <Mail size={18} className="text-brand-red animate-pulse" />
                <div>
                  <h4 className="font-bold text-sm uppercase tracking-wide">Inbound Email Verification</h4>
                  <p className="text-[10px] text-white/60">Lead {selectedLead.id} Ingestion Verification Log</p>
                </div>
              </div>
              <button 
                onClick={() => setShowSourceEmailModal(false)} 
                className="p-1 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 text-xs overflow-y-auto max-h-[80vh]">
              {loadingSourceEmail ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3">
                  <RefreshCw className="animate-spin text-brand-red" size={24} />
                  <span className="text-brand-gray font-semibold text-xs">Retrieving secure email envelope...</span>
                </div>
              ) : sourceEmailData ? (
                <div className="space-y-4">
                  {/* Email Headers */}
                  <div className="p-3 bg-brand-gray/5 border border-brand-gray/15 rounded-xl space-y-1.5 font-sans">
                    <div className="flex justify-between">
                      <span className="text-[10px] uppercase font-bold text-brand-gray w-20">Subject:</span>
                      <span className="text-brand-black font-extrabold flex-1 text-left">{sourceEmailData.subject}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[10px] uppercase font-bold text-brand-gray w-20">From:</span>
                      <span className="text-brand-black font-semibold flex-1 text-left">{sourceEmailData.sender}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[10px] uppercase font-bold text-brand-gray w-20">Date Ingested:</span>
                      <span className="text-brand-gray font-mono flex-1 text-left">
                        {sourceEmailData.receivedTime ? new Date(sourceEmailData.receivedTime).toLocaleString() : 'Pending'}
                      </span>
                    </div>
                  </div>

                  {/* Synchronized Data Verification Checklist */}
                  <div>
                    <span className="text-[10px] font-extrabold text-brand-gray uppercase tracking-wider block mb-2">
                      Synced Parameters Checklist
                    </span>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 bg-emerald-50/50 border border-emerald-100 rounded-xl p-3 text-[11px]">
                      <div className="flex items-start gap-1.5">
                        <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-brand-gray text-[9px] font-bold block">CONTACT NAME</span>
                          <span className="text-brand-black font-bold">{selectedLead.customerName}</span>
                        </div>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-brand-gray text-[9px] font-bold block">PHONE NUMBER</span>
                          <span className="text-brand-black font-bold font-mono">{selectedLead.phoneNumber}</span>
                        </div>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-brand-gray text-[9px] font-bold block">EMAIL ADDRESS</span>
                          <span className="text-brand-black font-bold">{selectedLead.email || 'N/A'}</span>
                        </div>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-brand-gray text-[9px] font-bold block">PROJECT SITE</span>
                          <span className="text-brand-black font-bold">{selectedLead.project}</span>
                        </div>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-brand-gray text-[9px] font-bold block">REQUIRED PLOT SIZE</span>
                          <span className="text-brand-black font-bold font-mono">{fmtSize(selectedLead.requiredSize)}</span>
                        </div>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-brand-gray text-[9px] font-bold block">INGESTION SOURCE</span>
                          <span className="text-brand-black font-bold">{selectedLead.source}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Email Body Content */}
                  <div>
                    <span className="text-[10px] font-extrabold text-brand-gray uppercase tracking-wider block mb-2">
                      Original Inbound Email Body
                    </span>
                    {sourceEmailData.bodyHtml ? (
                      <div className="border border-brand-gray/15 rounded-xl overflow-hidden bg-white shadow-inner">
                        <iframe
                          srcDoc={sanitizeEmailHtml(sourceEmailData.bodyHtml)}
                          title="Original Inbound Email Body Content"
                          className="w-full h-80 bg-white"
                          sandbox=""
                        />
                      </div>
                    ) : (
                      <pre className="whitespace-pre-wrap bg-brand-gray/5 border border-brand-gray/15 p-4 rounded-xl font-mono text-[11px] max-h-80 overflow-y-auto leading-relaxed text-brand-black shadow-inner">
                        {sourceEmailData.bodyText || 'No email content is available for verification.'}
                      </pre>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-brand-gray">
                  No secure email ingestion records could be located for this lead identifier.
                </div>
              )}

              {/* Modal Actions */}
              <div className="flex justify-end gap-3 pt-2 border-t border-brand-gray/10">
                <button
                  type="button"
                  disabled={reparsingLead}
                  onClick={() => handleReparseLead(selectedLead)}
                  className="bg-brand-red hover:bg-brand-red/90 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow flex items-center gap-1.5"
                >
                  {reparsingLead ? (
                    <RefreshCw className="animate-spin" size={14} />
                  ) : (
                    <Cpu size={14} />
                  )}
                  <span>{reparsingLead ? 'Reparsing & Syncing...' : 'Reparse & Sync Lead'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSourceEmailModal(false)}
                  className="bg-brand-black hover:bg-brand-black/90 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow"
                >
                  Close Verification View
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

    </div>
  );
};
