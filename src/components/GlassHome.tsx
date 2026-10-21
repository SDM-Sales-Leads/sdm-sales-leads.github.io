import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CalendarClock, PhoneCall, Trophy, Users } from 'lucide-react';
import { useAuth } from '../services/AuthContext';
import { crmService } from './crm/crmService';
import { crmNav } from './crm/crmNav';
import { isOpenStatus } from './crm/leadConfig';
import { dayOf, todayISO } from './crm/leadMetrics';
import { CrmCallCenter } from './crm/CrmCallCenter';
const CrmMyDay = lazy(() => import('./crm/CrmMyDay').then((m) => ({ default: m.CrmMyDay })));

const plus = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

/** The Glass home: the numbers of the signed-in person's day, every card opens exactly the leads behind its number. */
export const GlassHome: React.FC = () => {
  const { user } = useAuth();
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    window.addEventListener('crm-data-changed', f);
    // Home is the landing page: it loads and keeps refreshing by itself (it used to wait for the Leads page to be opened)
    void crmService.loadAll().then(f);
    const stop = crmService.startAutoRefresh();
    return () => { window.removeEventListener('crm-data-changed', f); stop(); };
  }, []);

  const d = useMemo(() => {
    const today = todayISO(), week = plus(today, 7);
    const mine = (crmService.getLeads() as any[]).filter((l) => !l.mergedInto && String(l.assignedSalespersonId || '') === String(user?.id ?? ''));
    const open = mine.filter((l) => isOpenStatus(l.status));
    const due = open.filter((l) => l.nextFollowUpDate && l.nextFollowUpDate <= today);
    const meet = open.filter((l) => l.meetingDate && l.meetingDate >= today && l.meetingDate <= week);
    const won = mine.filter((l) => l.status === 'Won');
    const fresh = open.filter((l) => l.status === 'New' && !l.lastContactDate);
    // activity of the last 7 days, one point per day (calls, mails, WhatsApp, meetings, visits that the person logged)
    const acts = (crmService.getActivities() as any[]).filter((a) => String(a.salespersonId) === String(user?.id ?? ''));
    const days = Array.from({ length: 7 }, (_, i) => plus(today, i - 6));
    const series = days.map((day) => acts.filter((a) => dayOf(a.timestamp) === day).length);
    return { open, due, meet, won, fresh, days, series, total: mine.length };
  }, [user?.id, crmService.versionKey()]); // eslint-disable-line react-hooks/exhaustive-deps -- any change to a lead (status, follow-up) recounts

  const go = (title: string, leads: any[]) => crmNav.leads({ title, ids: leads.map((l) => l.id) });
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';

  const max = Math.max(1, ...d.series);
  const pts = d.series.map((v, i) => [30 + i * (440 / 6), 130 - (v / max) * 100] as const);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  const area = `${path} L${pts[pts.length - 1][0]},140 L${pts[0][0]},140 Z`;

  const kpi = (label: string, value: number, sub: string, Icon: any, leads: any[]) => (
    <button type="button" onClick={() => go(label, leads)} className="glass-card text-left p-4 group">
      <div className="flex items-center justify-between"><span className="text-[12px] font-bold text-brand-black">{label}</span><span className="w-7 h-7 rounded-full bg-brand-red/10 text-brand-red flex items-center justify-center"><Icon size={14} /></span></div>
      <div className="mt-3 text-[28px] leading-none font-extrabold text-brand-red tabular-nums">{value.toLocaleString('en-US')}</div>
      <div className="mt-1.5 text-[11px] font-semibold text-brand-gray flex items-center justify-between">{sub}<ArrowUpRight size={13} className="opacity-0 group-hover:opacity-100 transition-opacity" /></div>
    </button>
  );
  return (
    <div className="space-y-5">
      {/* people who phoned us and wait for a call back: the first thing everybody who owns them sees */}
      <CrmCallCenter leads={crmService.getLeads() as any[]} onOpen={(l) => window.dispatchEvent(new CustomEvent('app-open-lead', { detail: { id: l.id } }))} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpi('Open leads', d.open.length, `${d.total.toLocaleString('en-US')} assigned to you`, Users, d.open)}
        {kpi('Follow-ups due', d.due.length, 'Today or overdue', PhoneCall, d.due)}
        {kpi('Meetings & visits', d.meet.length, 'Next 7 days', CalendarClock, d.meet)}
        {kpi('Won deals', d.won.length, 'All time', Trophy, d.won)}
      </div>

      <div className="glass-card p-5">
        <div className="flex items-center justify-between"><h3 className="font-bold text-brand-black text-[15px]">Activity tracking</h3><span className="text-[11px] font-bold text-brand-gray bg-brand-gray/10 rounded-lg px-2.5 py-1">Last 7 days</span></div>
        {d.series.every((v) => v === 0)
          ? <p className="text-center text-brand-gray text-sm py-10">No calls, mails or visits logged in the last 7 days.</p>
          : (
            <svg viewBox="0 0 500 170" className="w-full h-44 mt-2">
              <defs><linearGradient id="gh-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#A6192E" stopOpacity=".28" /><stop offset="100%" stopColor="#A6192E" stopOpacity="0" /></linearGradient></defs>
              {[30, 80, 130].map((y) => <line key={y} x1="20" x2="480" y1={y} y2={y} stroke="#e5e5e5" strokeWidth="1" />)}
              <path d={area} fill="url(#gh-area)" />
              <path d={path} fill="none" stroke="#A6192E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {pts.map((p, i) => <g key={i}><circle cx={p[0]} cy={p[1]} r="4" fill="#fff" stroke="#A6192E" strokeWidth="2.5" />{d.series[i] > 0 && <text x={p[0]} y={p[1] - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="#A6192E">{d.series[i]}</text>}<text x={p[0]} y="160" textAnchor="middle" fontSize="10" fill="#767676">{d.days[i].slice(5)}</text></g>)}
            </svg>
          )}
      </div>

      {/* the day's work (it used to be a second tab, "My day"): the queue, the follow-ups, the offers and the schedule, under the numbers */}
      <div>
        <div className="flex items-center justify-between mb-2.5"><h3 className="glass-home-h font-bold text-[15px] border-l-[3px] border-brand-red pl-2.5">My day</h3></div>
        <Suspense fallback={<div className="p-6 text-sm text-brand-gray">Loading your day…</div>}>
          <CrmMyDay leads={crmService.getLeads() as any[]} onLeadsUpdated={() => { void crmService.refreshDelta({ force: true, kinds: ['leads'] }); }} setActiveSubTab={() => {}} />
        </Suspense>
      </div>
    </div>
  );
};
