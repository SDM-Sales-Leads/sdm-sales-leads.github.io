import React, { useMemo, useState } from 'react';
import { MultiSelect } from '../ui/MultiSelect';
import { ChevronLeft, ChevronRight, Calendar as CalIcon } from 'lucide-react';
import { Lead } from './types';
import { ACTIVE_EXCLUDE, REQ_DATETIME } from './leadConfig';
import { useAuth } from '../../services/AuthContext';
import { crmScopeOf, isManagerScope } from './leadMetrics';

export interface CrmCalendarProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string;
  setActiveSubTab?: (tab: string) => void;
}

// Old "Calendar" (spec_D 7): follow-ups, call backs, meetings, site visits (+ offer chase dates) of the leads the user can see.
type Kind = 'Call back' | 'Meeting' | 'Site visit' | 'Follow-up' | 'Offer chase';
const KIND_CLS: Record<Kind, string> = {
  'Call back': 'bg-amber-50 text-amber-700 border-amber-200',
  Meeting: 'bg-blue-50 text-blue-700 border-blue-200',
  'Site visit': 'bg-purple-50 text-purple-700 border-purple-200',
  'Follow-up': 'bg-red-50 text-red-700 border-red-200',
  'Offer chase': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const KINDS = Object.keys(KIND_CLS) as Kind[];
interface Ev { lead: Lead; kind: Kind; date: string; time: string }

const pad2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const d10 = (v?: string) => (v ? String(v).slice(0, 10) : '');
const t5 = (v?: string) => (/^\d{1,2}:\d{2}/.test(v || '') ? String(v).slice(0, 5).padStart(5, '0') : '');
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function eventsOf(l: Lead): Ev[] {
  if (l.mergedInto || ACTIVE_EXCLUDE.includes(String(l.status))) return [];
  const out: Ev[] = [];
  const next = d10(l.nextFollowUpDate), meet = d10(l.meetingDate);
  if (REQ_DATETIME.includes(String(l.status))) {
    const date = meet || next;
    if (date) out.push({ lead: l, date, time: t5(l.meetingTime) || t5(l.nextFollowUpTime), kind: l.status === 'Call Back' ? 'Call back' : l.status === 'Scheduled Meeting' ? 'Meeting' : 'Site visit' });
  } else if (next) out.push({ lead: l, date: next, time: t5(l.nextFollowUpTime), kind: 'Follow-up' });
  const due = d10(l.offerDueDate);
  if (l.offerSent && due && due !== next) out.push({ lead: l, date: due, time: '', kind: 'Offer chase' });
  return out;
}

export const CrmCalendar: React.FC<CrmCalendarProps> = ({ leads, setActiveSubTab }) => {
  const { user, permissions } = useAuth();
  const manager = isManagerScope(crmScopeOf(user, permissions));
  const [mode, setMode] = useState<'month' | 'week' | 'day'>('month');
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; });
  const [owner, setOwner] = useState<string[]>([]);
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(KINDS));
  const today = iso(new Date());

  // one pass over the leads -> events grouped by day
  const owners = useMemo(() => manager ? [...new Set(leads.map((l) => l.assignedSalespersonName || '').filter(Boolean))].sort() : [], [leads, manager]);
  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const l of leads) {
      if (owner.length && !owner.includes(l.assignedSalespersonName || '')) continue;
      for (const e of eventsOf(l)) {
        if (!kinds.has(e.kind)) continue;
        const a = m.get(e.date); if (a) a.push(e); else m.set(e.date, [e]);
      }
    }
    for (const a of m.values()) a.sort((x, y) => (x.time || '99').localeCompare(y.time || '99'));
    return m;
  }, [leads, owner, kinds]);

  const shift = (dir: number) => setCursor((c) => {
    const d = new Date(c);
    if (mode === 'month') d.setMonth(d.getMonth() + dir, 1); else d.setDate(d.getDate() + dir * (mode === 'week' ? 7 : 1));
    return d;
  });
  const openLead = (id: string) => {
    try { localStorage.setItem('selected_lead_id', id); localStorage.setItem('crm_selected_lead_id_from_notification', id); } catch { /* ignore */ }
    setActiveSubTab?.('leads');
  };

  const weekStart = (d: Date) => { const w = new Date(d); w.setDate(w.getDate() - w.getDay()); return w; };
  const days = useMemo(() => {
    if (mode === 'day') return [new Date(cursor)];
    const start = mode === 'week' ? weekStart(cursor) : weekStart(new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12));
    const n = mode === 'week' ? 7 : (() => { const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1); const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0); return Math.ceil((first.getDay() + last.getDate()) / 7) * 7; })();
    return Array.from({ length: n }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [mode, cursor]);

  const title = mode === 'month' ? `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`
    : mode === 'day' ? cursor.toDateString()
    : `${days[0].toDateString().slice(4)} – ${days[6].toDateString().slice(4)}`;

  const chip = (e: Ev, full: boolean) => (
    <button key={e.lead.id + e.kind} onClick={() => openLead(e.lead.id)} title={`${e.kind} · ${e.lead.customerName}`}
      className={`w-full text-left text-[11px] leading-tight border rounded-lg px-1.5 py-1 truncate ${KIND_CLS[e.kind]}`}>
      {e.time && <b>{e.time} </b>}{e.lead.customerName || e.lead.id}{full ? ` · ${e.kind}${e.lead.project ? ' · ' + e.lead.project : ''}${manager && e.lead.assignedSalespersonName ? ' · ' + e.lead.assignedSalespersonName : ''}` : ''}
    </button>
  );

  const total = useMemo(() => { let n = 0; for (const d of days) n += byDay.get(iso(d))?.length || 0; return n; }, [days, byDay]);

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-brand-dark flex items-center gap-2"><CalIcon size={20} /> Calendar</h2>
          <p className="text-sm text-brand-gray">Call backs, meetings, site visits and follow-ups. Click an item to open the lead.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {manager && (
            <MultiSelect options={owners.map((o) => ({ value: o, label: o }))} value={owner} onChange={setOwner} allLabel="Everyone" name="people" className="min-w-[140px] max-w-[220px]" buttonClassName={`px-3 py-2 rounded-xl border text-sm bg-white flex items-center justify-between gap-2 text-left w-full ${owner.length ? 'border-brand-red/50 text-brand-red' : 'border-gray-200'}`} />)}
          <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm font-bold">
            {(['month', 'week', 'day'] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={`px-3 py-2 capitalize ${mode === m ? 'bg-brand-red text-white' : 'bg-white text-brand-dark'}`}>{m}</button>)}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-3 flex flex-wrap items-center gap-2">
        <button onClick={() => shift(-1)} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50" aria-label="Previous"><ChevronLeft size={16} /></button>
        <button onClick={() => setCursor(new Date())} className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-bold hover:bg-gray-50">Today</button>
        <button onClick={() => shift(1)} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50" aria-label="Next"><ChevronRight size={16} /></button>
        <div className="font-black text-brand-dark ml-2">{title}</div>
        <div className="text-xs text-brand-gray ml-auto">{total.toLocaleString('en-US')} item(s) in view</div>
        <div className="w-full flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button key={k} onClick={() => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
              className={`px-2.5 py-1 rounded-full text-xs font-bold border ${kinds.has(k) ? KIND_CLS[k] : 'bg-white text-brand-gray border-gray-200 line-through'}`}>{k}</button>))}
        </div>
      </div>

      {mode === 'day' ? (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-2">
          {(byDay.get(iso(cursor)) || []).length === 0 ? <div className="text-sm text-brand-gray">Nothing planned for this day.</div>
            : (byDay.get(iso(cursor)) || []).map((e) => chip(e, true))}
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 text-center text-xs font-bold uppercase tracking-wide text-brand-gray border-b border-gray-100">
            {WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const k = iso(d), list = byDay.get(k) || [];
              const out = mode === 'month' && d.getMonth() !== cursor.getMonth();
              const cap = mode === 'week' ? 12 : 3;
              return (
                <div key={k} className={`min-h-[96px] border-b border-r border-gray-50 p-1.5 space-y-1 ${out ? 'bg-gray-50/60' : ''} ${k === today ? 'ring-2 ring-inset ring-brand-red/40' : ''}`}>
                  <button onClick={() => { setCursor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)); setMode('day'); }}
                    className={`text-xs font-bold ${out ? 'text-gray-300' : k === today ? 'text-brand-red' : 'text-brand-dark'} hover:underline`}>{d.getDate()}</button>
                  {list.slice(0, cap).map((e) => chip(e, false))}
                  {list.length > cap && <button onClick={() => { setCursor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)); setMode('day'); }} className="text-[11px] font-bold text-brand-gray hover:underline">+{list.length - cap} more</button>}
                </div>);
            })}
          </div>
        </div>
      )}
    </div>
  );
};
