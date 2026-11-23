import React, { useEffect, useMemo, useState } from 'react';
import { Award, Flame, Trophy, Star, Zap } from 'lucide-react';
import { Lead } from './types';
import { PIPELINE_STATUSES, closingDate } from './leadConfig';
import { useAuth } from '../../services/AuthContext';
import { adminService } from '../../services/adminService';
import { crmScopeOf, isManagerScope, localISO } from './leadMetrics';
import { fmtEgp } from './crmCsv';

export interface CrmAchievementsProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string;
  setActiveSubTab?: (tab: string) => void;
}

// Old "Achievements & Rankings" (spec_D 4), sales track only. Everything is computed from the leads and their timelines on every
// open: nothing is stored, so points cannot be edited and there is no per-user state to sync.
const LEVELS = [
  { at: 0, name: 'Land Scout', icon: '🌱' }, { at: 150, name: 'Prospector', icon: '⛏️' }, { at: 400, name: 'Negotiator', icon: '🤝' },
  { at: 900, name: 'Dealmaker', icon: '💼' }, { at: 1800, name: 'Rainmaker', icon: '🌟' }, { at: 3500, name: 'Sales Legend', icon: '👑' },
];
const levelOf = (xp: number) => { let i = 0; LEVELS.forEach((l, k) => { if (xp >= l.at) i = k; }); return i; };
const isWorkday = (d: Date) => d.getDay() >= 0 && d.getDay() <= 4; // Sunday - Thursday
const MEET = ['Scheduled Meeting', 'Site Visit Scheduled'];

interface Agg {
  leads: number; wins: number; winValue: number; winSqm: number; meetings: number; qualified: number; logs: number; pipeline: number;
  meetLogs: number; contracts: number; bestDeal: number; monthWins: Map<string, number>; winsThisMonth: number; days: Set<string>;
  hours: number[]; comeback: boolean;
}
const blank = (): Agg => ({ leads: 0, wins: 0, winValue: 0, winSqm: 0, meetings: 0, qualified: 0, logs: 0, pipeline: 0, meetLogs: 0, contracts: 0, bestDeal: 0, monthWins: new Map(), winsThisMonth: 0, days: new Set(), hours: [], comeback: false });
const xpOf = (a: Agg) => a.wins * 100 + a.meetings * 15 + a.qualified * 10 + a.logs * 2;

export const CrmAchievements: React.FC<CrmAchievementsProps> = ({ leads }) => {
  const { user, permissions } = useAuth();
  const uid = String(user?.id ?? '');
  const me = user?.name || '';
  const manager = isManagerScope(crmScopeOf(user, permissions));
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!manager) return;
    let alive = true;
    adminService.getUsers().then((all: any[]) => { if (alive) setNames(new Map(all.map((u) => [String(u.id), String(u.name || '')]))); }).catch(() => { /* names fall back to the lead's owner name */ });
    return () => { alive = false; };
  }, [manager]);

  const monthKey = localISO(new Date()).slice(0, 7);
  // ONE pass: per owner aggregate + my own activity days (log entries written by me)
  const { per, mine } = useMemo(() => {
    const per = new Map<string, Agg>();
    const mine = new Set<string>();
    const ownerName = new Map<string, string>();
    for (const l of leads) {
      if (l.mergedInto) continue;
      const id = String(l.assignedSalespersonId || '');
      let a: Agg | undefined;
      if (id) { a = per.get(id); if (!a) { a = blank(); per.set(id, a); } if (l.assignedSalespersonName) ownerName.set(id, l.assignedSalespersonName); }
      const tl = l.timeline || [];
      if (me) for (const e of tl) if (e.user === me && e.timestamp) mine.add(e.timestamp.slice(0, 10));
      if (!a) continue;
      a.leads++;
      a.logs += tl.length;
      if (l.qualification === 'Qualified') a.qualified++;
      if (l.meetingDate || MEET.includes(String(l.status))) a.meetings++;
      if (PIPELINE_STATUSES.includes(String(l.status))) a.pipeline++;
      for (const e of tl) if (MEET.includes(String(e.title)) || /Scheduled Meeting|Site Visit Scheduled/.test(e.description || '')) a.meetLogs++;
      if (l.contractDate) a.contracts++;
      if (l.status === 'Won' && l.cashStatus === 'confirmed') {   // 23 Nov 2026: achievements count finance-confirmed deals only
        a.wins++;
        const v = Number(l.dealValue) || 0, sqm = Number(l.soldArea) || 0;
        a.winValue += v; a.winSqm += sqm; a.bestDeal = Math.max(a.bestDeal, sqm);
        const cd = closingDate(l).slice(0, 7);
        if (cd) { a.monthWins.set(cd, (a.monthWins.get(cd) || 0) + 1); if (cd === monthKey) a.winsThisMonth++; }
        if (tl.some((e) => /→ Lost|-> Lost/.test(e.description || e.title || ''))) a.comeback = true;
      }
    }
    return { per, mine, ownerName };
  }, [leads, me, monthKey]);

  const a = per.get(uid) || blank();
  const xp = xpOf(a);
  const li = levelOf(xp);
  const next = LEVELS[li + 1];
  const pctNext = next ? Math.round(((xp - LEVELS[li].at) / (next.at - LEVELS[li].at)) * 100) : 100;

  // activity streak: consecutive working days (Sun-Thu) with at least one entry of mine; Fri/Sat neither count nor break it
  const streaks = useMemo(() => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    let cur = 0, best = 0, run = 0, broken = false, perfect = 0;
    const d = new Date(today);
    // today may still be in progress: an inactive today does not break the current streak
    for (let i = 0; i < 400; i++, d.setDate(d.getDate() - 1)) {
      if (!isWorkday(d)) continue;
      if (mine.has(localISO(d))) { run++; best = Math.max(best, run); if (!broken) cur = run; }
      else if (i > 0) { broken = true; run = 0; }
    }
    // perfect weeks: the last 12 completed weeks with all 5 working days active
    const ws = new Date(today); ws.setDate(ws.getDate() - ws.getDay() - 7);
    for (let w = 0; w < 12; w++, ws.setDate(ws.getDate() - 7)) {
      let ok = true; const t = new Date(ws);
      for (let k = 0; k < 5; k++, t.setDate(t.getDate() + 1)) if (!mine.has(localISO(t))) { ok = false; break; }
      if (ok) perfect++;
    }
    return { cur, best, perfect };
  }, [mine]);

  const badges = [
    { n: 'First Win', d: '1 deal won', cur: a.wins, goal: 1 },
    { n: 'Hat-Trick', d: '3 wins in one month', cur: Math.max(0, ...a.monthWins.values()), goal: 3 },
    { n: 'Ten Closer', d: '10 deals won', cur: a.wins, goal: 10 },
    { n: 'Rainmaker', d: '25 M EGP won', cur: a.winValue, goal: 25e6 },
    { n: 'Century Caller', d: '100 log entries', cur: a.logs, goal: 100 },
    { n: 'Pipeline Builder', d: '10 leads in the pipeline', cur: a.pipeline, goal: 10 },
    { n: 'On Fire', d: 'Best activity streak of 7 days', cur: streaks.best, goal: 7 },
    { n: 'Land Baron', d: '100,000 sqm sold', cur: a.winSqm, goal: 1e5 },
    { n: 'Factory Founder', d: 'One deal of 50,000 sqm or more', cur: a.bestDeal, goal: 5e4 },
    { n: 'Meeting Machine', d: '20 meetings / site visits scheduled', cur: a.meetLogs, goal: 20 },
    { n: 'Groundbreaker', d: '5 deals with a contract date', cur: a.contracts, goal: 5 },
    { n: 'Comeback Closer', d: 'Won a lead that was once lost', cur: a.comeback ? 1 : 0, goal: 1 },
    { n: 'Perfectionist', d: '3 perfect weeks (Sun–Thu all active)', cur: streaks.perfect, goal: 3 },
  ];

  const ranking = useMemo(() => {
    if (!manager) return [];
    return [...per.entries()].map(([id, g]) => {
      const nm = names.get(id) || leads.find((l) => String(l.assignedSalespersonId) === id)?.assignedSalespersonName || id;
      return { id, name: nm, xp: xpOf(g), lvl: levelOf(xpOf(g)), month: g.winsThisMonth, wins: g.wins, value: g.winValue };
    }).filter((r) => r.xp > 0).sort((x, y) => y.xp - x.xp).slice(0, 25);
  }, [manager, per, names, leads]);

  const card = 'bg-white border border-gray-100 rounded-2xl shadow-sm p-4';
  const num = (n: number) => Math.round(n).toLocaleString('en-US');

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-black text-brand-dark flex items-center gap-2"><Trophy size={20} /> Achievements</h2>
        <p className="text-sm text-brand-gray">Points, levels, streaks and badges are worked out from your leads and the activity you logged. Nothing is stored or editable.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className={`${card} md:col-span-2`}>
          <div className="flex items-center gap-3">
            <div className="text-4xl">{LEVELS[li].icon}</div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-brand-gray">Your level</div>
              <div className="text-xl font-black text-brand-dark">{LEVELS[li].name}</div>
            </div>
            <div className="ml-auto text-right"><div className="text-3xl font-black text-brand-red">{num(xp)}</div><div className="text-xs text-brand-gray">points</div></div>
          </div>
          <div className="mt-3 h-3 rounded-full bg-black/5 overflow-hidden"><div className="h-full bg-brand-red rounded-full" style={{ width: `${pctNext}%` }} /></div>
          <div className="text-xs text-brand-gray mt-1">{next ? `${num(next.at - xp)} points to ${next.name}` : 'Top level reached'}</div>
          <div className="flex flex-wrap gap-1.5 mt-3 text-[11px]">
            {LEVELS.map((l, i) => <span key={l.name} className={`px-2 py-1 rounded-full border ${i <= li ? 'bg-brand-red/10 border-brand-red/30 text-brand-red font-bold' : 'border-gray-200 text-brand-gray'}`}>{l.icon} {l.name} · {num(l.at)}</span>)}
          </div>
          <div className="text-xs text-brand-gray mt-3">How points are earned: win 100 · meeting or site visit 15 · qualified lead 10 · each log entry 2.</div>
        </div>
        <div className={`${card} space-y-2`}>
          <div className="flex items-center gap-2 font-black text-brand-dark"><Flame size={16} className="text-orange-500" /> Streaks</div>
          <div className="flex justify-between text-sm"><span className="text-brand-gray">Current activity streak</span><b>{streaks.cur} day(s)</b></div>
          <div className="flex justify-between text-sm"><span className="text-brand-gray">Best streak</span><b>{streaks.best} day(s)</b></div>
          <div className="flex justify-between text-sm"><span className="text-brand-gray">Perfect weeks (last 12)</span><b>{streaks.perfect}</b></div>
          <div className="text-[11px] text-brand-gray">A day counts when you logged at least one entry. Working week is Sunday to Thursday; Friday and Saturday never break a streak.</div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[['Deals won', num(a.wins)], ['Won value (EGP)', fmtEgp(a.winValue)], ['Won this month', num(a.winsThisMonth)], ['Meetings / visits', num(a.meetings)], ['Log entries', num(a.logs)]].map(([k, v]) => (
          <div key={k} className={card}><div className="text-xs font-bold text-brand-gray uppercase tracking-wide">{k}</div><div className="text-2xl font-black text-brand-dark mt-1">{v}</div></div>))}
      </div>

      <div className={card}>
        <h3 className="font-black text-brand-dark flex items-center gap-2 mb-3"><Award size={16} /> Badges <span className="text-xs font-semibold text-brand-gray">{badges.filter((b) => b.cur >= b.goal).length} of {badges.length} earned</span></h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {badges.map((b) => {
            const got = b.cur >= b.goal; const p = Math.min(100, Math.round((b.cur / b.goal) * 100));
            return (
              <div key={b.n} className={`rounded-xl border p-3 ${got ? 'border-amber-300 bg-amber-50' : 'border-gray-100'}`}>
                <div className="flex items-center gap-2 font-bold text-brand-dark">{got ? <Star size={14} className="text-amber-500" /> : <Zap size={14} className="text-gray-300" />}{b.n}</div>
                <div className="text-xs text-brand-gray">{b.d}</div>
                <div className="h-1.5 rounded-full bg-black/5 mt-2 overflow-hidden"><div className={`h-full ${got ? 'bg-amber-500' : 'bg-brand-red/60'}`} style={{ width: `${p}%` }} /></div>
                <div className="text-[11px] text-brand-gray mt-1">{got ? 'Earned' : `${num(b.cur)} / ${num(b.goal)}`}</div>
              </div>);
          })}
        </div>
      </div>

      {manager && (
        <div className={`${card} overflow-x-auto`}>
          <h3 className="font-black text-brand-dark mb-3">Team ranking</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-brand-gray border-b border-gray-100">
              {['#', 'Name', 'Level', 'Points', 'Wins this month', 'Wins all time', 'Won value (EGP)'].map((h) => <th key={h} className="px-3 py-2 font-bold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>{ranking.length === 0 ? <tr><td colSpan={7} className="px-3 py-4 text-brand-gray">No data yet.</td></tr> : ranking.map((r, i) => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="px-3 py-2">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                <td className="px-3 py-2 font-bold">{r.name}</td><td className="px-3 py-2">{LEVELS[r.lvl].icon} {LEVELS[r.lvl].name}</td>
                <td className="px-3 py-2">{num(r.xp)}</td><td className="px-3 py-2">{r.month || '—'}</td><td className="px-3 py-2">{r.wins || '—'}</td><td className="px-3 py-2">{fmtEgp(r.value)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
};
