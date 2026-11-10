// Smart Assistant (Phase 1 of docs/LARA-SALES-AI-PLAN.md): the system tells each person what to do next and why, writes the message,
// matches Land Bank plots, coaches from the person's own activity and points at the data gaps. Rules run in the browser on the leads
// already loaded (no extra server calls); the AI buttons call the server only when pressed.
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Sparkles, Phone, MessageSquare, Mail, CalendarCheck, FileText, ChevronRight, Wand2, BookOpen, Copy, X, Map as MapIcon, Lightbulb,
  Wrench, TrendingUp, TrendingDown, Users, AlertTriangle, CheckCircle2, Clock, Target, RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../services/AuthContext';
import type { Lead } from './types';
import { crmNav } from './crmNav';
import { logAttempt } from './attemptLog';
import { phoneIntl } from './leadConfig';
import { crmScopeOf, fmtEGP, isManagerScope, sourceWinRates, todayISO } from './leadMetrics';
import { repNameFromEmail } from '../../lib/repName';
import { Plot, PlotsState, getPlotsSnapshot, loadPlots, plotsAreStale } from '../../lib/plotsService';
import {
  NextAction, Signal, availableByPark, briefOf, dataFixes, myWeek, nextActions, plotFit, signals, teamInsight, tips,
} from './smartEngine';
import { trackFeature } from './smartService';
import { SmartAskTips } from './SmartAskTips';
import { SITUATION_LABEL, Situation, preferredLang, situationsFor, writeFor } from './smartWriter';
import type { PlotFit } from './smartEngine';

interface Props { leads: Lead[]; onLeadsUpdated: () => void; setActiveSubTab: (t: string) => void }

const TONE: Record<string, string> = {
  red: 'border-rose-200 bg-rose-50 text-rose-900', amber: 'border-amber-200 bg-amber-50 text-amber-900',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-900', blue: 'border-sky-200 bg-sky-50 text-sky-900',
};
const TONE_ICON: Record<string, React.ReactNode> = {
  red: <AlertTriangle size={16} className="text-rose-600" />, amber: <Clock size={16} className="text-amber-600" />,
  green: <CheckCircle2 size={16} className="text-emerald-600" />, blue: <MapIcon size={16} className="text-sky-600" />,
};
const MOVE_ICON: Record<string, React.ReactNode> = {
  call: <Phone size={14} />, whatsapp: <MessageSquare size={14} />, email: <Mail size={14} />, confirm: <CalendarCheck size={14} />, offer: <FileText size={14} />,
};
const LEVEL = ['bg-rose-600', 'bg-amber-500', 'bg-sky-500', 'bg-brand-gray/50'];
const num = (n: number | null | undefined, dp = 0) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(dp));

const Section: React.FC<{ icon: React.ReactNode; title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode }> = ({ icon, title, hint, right, children }) => (
  <section className="bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="font-extrabold text-brand-black text-sm flex items-center gap-2">{icon}{title}</h3>
        {hint && <p className="text-[11px] text-brand-gray mt-0.5">{hint}</p>}
      </div>
      {right}
    </div>
    {children}
  </section>
);

export const CrmSmartAssistant: React.FC<Props> = ({ leads, setActiveSubTab }) => {
  const { user, permissions } = useAuth();
  const scope = crmScopeOf(user, permissions as any);
  const manager = isManagerScope(scope);
  const [personId, setPersonId] = useState<string>(String(user?.id || ''));
  const [plots, setPlots] = useState<PlotsState | null>(() => getPlotsSnapshot());
  const [compose, setCompose] = useState<{ lead: Lead; channel: 'whatsapp' | 'email' } | null>(null);
  const [brief, setBrief] = useState<Lead | null>(null);

  useEffect(() => { trackFeature('smart_open'); }, []);
  useEffect(() => { if (user?.id && !personId) setPersonId(String(user.id)); }, [user, personId]);
  useEffect(() => {
    let off = false;
    if (plotsAreStale()) loadPlots().then((s) => { if (!off) setPlots(s); }).catch(() => { /* plots are optional here */ });
    return () => { off = true; };
  }, []);

  const people = useMemo(() => {
    if (!manager) return [] as { id: string; name: string }[];
    const m = new Map<string, string>();
    for (const l of leads) if (l.assignedSalespersonId) m.set(String(l.assignedSalespersonId), l.assignedSalespersonName || String(l.assignedSalespersonId));
    if (user?.id) m.set(String(user.id), user.name || 'Me');
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [leads, manager, user]);
  const viewingSelf = String(personId) === String(user?.id);
  const personName = viewingSelf ? (user?.name || '') : (people.find((p) => p.id === personId)?.name || '');

  const today = todayISO();
  const now = useMemo(() => Date.now(), [leads]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = useMemo(() => leads.filter((l) => String(l.assignedSalespersonId) === String(personId)), [leads, personId]);
  const rates = useMemo(() => sourceWinRates(leads), [leads]);
  const byPark = useMemo(() => availableByPark(plots?.plots || []), [plots]);
  const byKey = useMemo(() => new Map((plots?.plots || []).map((p) => [p.key, p])), [plots]);
  const na = useMemo(() => nextActions(mine, today, now, rates, byPark, 8), [mine, today, now, rates, byPark]);
  const sig = useMemo(() => signals(mine, plots?.plots || [], byPark, today, now), [mine, plots, byPark, today, now]);
  const week = useMemo(() => myWeek(mine, personName, now), [mine, personName, now]);
  const fixes = useMemo(() => dataFixes(mine, today), [mine, today]);
  const tipList = useMemo(() => tips(mine, week, fixes), [mine, week, fixes]);
  const team = useMemo(() => (manager ? teamInsight(leads, today, now) : null), [manager, leads, today, now]);

  const me = repNameFromEmail(user?.email, user?.name || '');
  const urgent = na.board.callList.filter((t) => t.level === 0).length;   // the same number as the "Must do today" card
  const first = (user?.name || '').split(' ')[0];
  const hour = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Cairo' }));
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const openList = (ids: string[], title: string, feature: string) => { trackFeature(feature); crmNav.leads({ ids, title }); };
  const doCall = (l: Lead) => { const n = phoneIntl(l.phoneNumber); if (!n) { toast.error('No usable phone number on this lead.'); return; } trackFeature('smart_call'); logAttempt(l, 'call', user, n); window.location.href = `tel:${n}`; };

  return (
    <div className="space-y-5" id="smart-assistant">
      {/* header */}
      <div className="rounded-3xl p-6 text-white shadow-lg bg-gradient-to-br from-brand-red via-rose-700 to-brand-black relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-widest text-white/70 flex items-center gap-1.5"><Sparkles size={14} />Smart Assistant</p>
            <h2 className="text-2xl font-extrabold">{viewingSelf ? `${hello}${first ? `, ${first}` : ''}` : `Looking at ${personName || 'this person'}`}</h2>
            <p className="text-sm text-white/85 max-w-2xl">
              {na.list.length
                ? <>{urgent ? <><b>{urgent}</b> thing{urgent > 1 ? 's' : ''} must be done today. </> : 'Nothing urgent right now. '}
                  {na.total > na.list.length ? <>The best <b>{na.list.length}</b> of {na.total} open tasks are below, with the reason for each.</> : 'Here is what will move your deals forward.'}</>
                : 'No open tasks on these leads. Use the time to fix the data gaps below or to wake up old leads.'}
            </p>
          </div>
          {manager && people.length > 1 && (
            <label className="text-xs text-white/80 space-y-1">
              <span className="block font-bold">Show the assistant of</span>
              <select value={personId} onChange={(e) => { setPersonId(e.target.value); trackFeature('smart_person'); }} className="bg-white/15 border border-white/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none">
                {people.map((p) => <option key={p.id} value={p.id} className="text-brand-black">{p.id === String(user?.id) ? `${p.name} (me)` : p.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="relative grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          {[
            { k: 'Must do today', v: String(na.board.callList.filter((t) => t.level === 0).length) },
            { k: 'Never contacted', v: String(na.board.first.length) },
            { k: 'Actions this week', v: String(week.actions), sub: week.prevActions ? `last week ${week.prevActions}` : undefined },
            { k: 'First call (median)', v: week.firstContactMedianH == null ? '—' : `${Math.round(week.firstContactMedianH)} h`, sub: week.firstMeasured ? `${week.firstMeasured} new leads, 30 days` : 'not enough data' },
          ].map((c) => (
            <div key={c.k} className="bg-white/10 rounded-2xl px-4 py-3 backdrop-blur-sm">
              <p className="text-[10px] uppercase tracking-wider font-bold text-white/70">{c.k}</p>
              <p className="text-2xl font-extrabold">{c.v}</p>
              {c.sub && <p className="text-[10px] text-white/70">{c.sub}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* 1. next best actions */}
        <div className="xl:col-span-2 space-y-5">
          <Section icon={<Target size={16} className="text-brand-red" />} title="Do these next" hint="Ranked by urgency, deal size, lead score and response clocks. Each button logs the action on the lead for you."
            right={<button onClick={() => { trackFeature('smart_myday'); setActiveSubTab('my-day'); }} className="text-xs font-bold text-brand-red flex items-center gap-0.5 whitespace-nowrap">All my tasks<ChevronRight size={14} /></button>}>
            {na.list.length === 0 && <p className="text-sm text-brand-gray py-6 text-center">Nothing waiting. Well done.</p>}
            <ul className="divide-y divide-brand-gray/10">
              {na.list.map((a) => <ActionRow key={a.task.lead.id} a={a} onCall={doCall} onWrite={(l, channel) => { trackFeature('smart_write'); setCompose({ lead: l, channel }); }} onBrief={(l) => { trackFeature('smart_brief'); setBrief(l); }} />)}
            </ul>
          </Section>

          {/* 4 + 5. signals */}
          <Section icon={<Sparkles size={16} className="text-brand-red" />} title="What changed and needs you" hint="Patterns the system found on your leads and in the Land Bank plot list.">
            {sig.length === 0 && <p className="text-sm text-brand-gray">No alerts on these leads.</p>}
            <div className="grid sm:grid-cols-2 gap-3">
              {sig.map((s: Signal) => (
                <button key={s.id} onClick={() => openList(s.leadIds, s.title, `smart_sig_${s.id}`)} className={`text-left border rounded-2xl p-4 hover:shadow-md transition ${TONE[s.tone]}`}>
                  <p className="font-extrabold text-sm flex items-start gap-2">{TONE_ICON[s.tone]}<span>{s.title}</span></p>
                  <p className="text-xs mt-1.5 opacity-90">{s.why}</p>
                  <p className="text-[11px] font-bold mt-2 flex items-center gap-0.5">Show these leads<ChevronRight size={12} /></p>
                </button>
              ))}
            </div>
          </Section>

          {/* 8. team */}
          {team && (
            <Section icon={<Users size={16} className="text-brand-red" />} title="Team: load and risk" hint="Leads in your scope. Risk = overdue follow-ups + 2 × leads waiting over 48 h for a first call. Routing rules on the server still decide every move.">
              {team.advice.length > 0 && (
                <ul className="space-y-1.5">
                  {team.advice.map((t, i) => <li key={i} className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-3 py-2 flex gap-2"><Lightbulb size={14} className="shrink-0 mt-0.5" />{t}</li>)}
                </ul>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-brand-gray uppercase text-[10px] tracking-wider">
                    <th className="py-2 pr-2">Person</th><th className="px-2 text-right">Open</th><th className="px-2 text-right">Overdue</th><th className="px-2 text-right">Never contacted</th><th className="px-2 text-right">Waiting 48 h+</th><th className="px-2 text-right">No date</th><th className="pl-2 text-right">Risk</th>
                  </tr></thead>
                  <tbody>
                    {team.rows.slice(0, 15).map((r) => (
                      <tr key={r.id} className="border-t border-brand-gray/10 hover:bg-brand-gray/5 cursor-pointer" onClick={() => { setPersonId(r.id); trackFeature('smart_team_person'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                        <td className="py-2 pr-2 font-bold text-brand-black">{r.name}</td>
                        <td className="px-2 text-right">{r.open}</td>
                        <td className={`px-2 text-right ${r.overdue ? 'text-rose-600 font-bold' : ''}`}>{r.overdue}</td>
                        <td className="px-2 text-right">{r.neverContacted}</td>
                        <td className={`px-2 text-right ${r.neglected ? 'text-rose-600 font-bold' : ''}`}>{r.neglected}</td>
                        <td className="px-2 text-right">{r.noDate}</td>
                        <td className="pl-2 text-right font-extrabold">{r.risk}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-brand-gray">Unowned open leads: <b>{team.day.unassigned.length}</b> · VIP past 4 h: <b>{team.day.vipOverdue.length}</b> · Team average open per person: <b>{num(team.avgOpen)}</b>. Click a person to see their assistant.</p>
            </Section>
          )}
        </div>

        <div className="space-y-5">
          {/* 9. tips */}
          <Section icon={<Lightbulb size={16} className="text-amber-500" />} title="Tips for you" hint="From your own leads and habits.">
            {tipList.length === 0 && <p className="text-sm text-brand-gray">No tips right now.</p>}
            <ul className="space-y-2">
              {tipList.map((t) => (
                <li key={t.id} className="text-xs text-brand-black bg-amber-50/60 border border-amber-100 rounded-xl px-3 py-2.5">
                  {t.text}
                  {t.go && <button onClick={() => { trackFeature(`smart_tip_${t.id}`); setActiveSubTab(t.go === 'offers' ? 'offers' : t.go === 'myday' ? 'my-day' : 'leads'); }} className="block mt-1 font-bold text-brand-red">Open<ChevronRight size={12} className="inline" /></button>}
                </li>
              ))}
            </ul>
          </Section>

          {/* 6. my week */}
          <Section icon={<TrendingUp size={16} className="text-emerald-600" />} title={viewingSelf ? 'My week' : `${personName || 'Their'} week`} hint="Last 7 days against the 7 days before, from the actions logged on the leads.">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Actions logged" now={week.actions} prev={week.prevActions} />
              <Stat label="Leads worked" now={week.leadsWorked} prev={week.prevLeadsWorked} />
              <div className="bg-brand-gray/5 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-brand-gray">First call within 24 h</p><p className="text-lg font-extrabold">{week.within24 == null ? '—' : `${Math.round(week.within24)}%`}</p><p className="text-[10px] text-brand-gray">new leads, last 30 days</p></div>
              <div className="bg-brand-gray/5 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-brand-gray">Busiest hour</p><p className="text-lg font-extrabold">{week.bestHour == null ? '—' : `${String(week.bestHour).padStart(2, '0')}:00`}</p><p className="text-[10px] text-brand-gray">{week.activeDays} active day{week.activeDays === 1 ? '' : 's'} this week</p></div>
            </div>
            {Object.keys(week.byType).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(week.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k} className="text-[11px] bg-brand-gray/10 rounded-full px-2 py-0.5"><b>{v}</b> {k}</span>)}
              </div>
            )}
            {week.sources.some((s) => s.won > 0) && (
              <div>
                <p className="text-[10px] uppercase font-bold text-brand-gray mb-1">Won by source (5+ leads)</p>
                {week.sources.map((s) => (
                  <div key={s.source} className="flex items-center gap-2 text-xs py-0.5">
                    <span className="w-24 truncate">{s.source}</span>
                    <span className="flex-1 h-1.5 bg-brand-gray/10 rounded-full overflow-hidden"><span className="block h-full bg-emerald-500" style={{ width: `${Math.min(100, s.rate)}%` }} /></span>
                    <span className="w-20 text-right text-brand-gray">{s.won}/{s.leads} · {s.rate.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 7. fix my data */}
          <Section icon={<Wrench size={16} className="text-sky-600" />} title="Fix my data" hint="Small gaps that stop the system from helping you. Click to see the leads.">
            {fixes.length === 0 && <p className="text-sm text-brand-gray">Your open leads are complete.</p>}
            <ul className="space-y-1.5">
              {fixes.map((f) => (
                <li key={f.id}>
                  <button onClick={() => openList(f.leadIds, f.title, `smart_fix_${f.id}`)} className="w-full text-left rounded-xl border border-brand-gray/15 px-3 py-2 hover:bg-brand-gray/5">
                    <p className="text-xs font-bold text-brand-black flex justify-between gap-2"><span>{f.title}</span><span className="text-sky-700">{f.leadIds.length}</span></p>
                    <p className="text-[11px] text-brand-gray">{f.why}</p>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
          <SmartAskTips />
        </div>
      </div>

      {compose && <Composer lead={compose.lead} channel={compose.channel} me={me} user={user} fit={plotFit(compose.lead, byPark)} byKey={byKey} onClose={() => setCompose(null)} />}
      {brief && <BriefPanel lead={brief} fit={plotFit(brief, byPark)} onClose={() => setBrief(null)} onOpen={() => { crmNav.lead(brief.id); setBrief(null); }} />}
    </div>
  );
};

const Stat: React.FC<{ label: string; now: number; prev: number }> = ({ label, now, prev }) => {
  const up = now > prev; const same = now === prev;
  return (
    <div className="bg-brand-gray/5 rounded-xl p-3">
      <p className="text-[10px] uppercase font-bold text-brand-gray">{label}</p>
      <p className="text-lg font-extrabold flex items-center gap-1">{now}{!same && (up ? <TrendingUp size={14} className="text-emerald-600" /> : <TrendingDown size={14} className="text-rose-600" />)}</p>
      <p className="text-[10px] text-brand-gray">last week {prev}</p>
    </div>
  );
};

const ActionRow: React.FC<{ a: NextAction; onCall: (l: Lead) => void; onWrite: (l: Lead, c: 'whatsapp' | 'email') => void; onBrief: (l: Lead) => void }> = ({ a, onCall, onWrite, onBrief }) => {
  const l = a.task.lead;
  const primary = () => {
    if (a.move === 'call' || a.move === 'offer') onCall(l);
    else if (a.move === 'email') onWrite(l, 'email');
    else onWrite(l, 'whatsapp');
  };
  return (
    <li className="py-3 flex flex-col md:flex-row md:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${LEVEL[a.task.level]}`} />
          <button onClick={() => crmNav.lead(l.id)} className="font-extrabold text-sm text-brand-black truncate hover:text-brand-red">{l.customerName || l.companyName || l.id}</button>
          {l.companyName && l.customerName && <span className="text-[11px] text-brand-gray truncate hidden sm:inline">{l.companyName}</span>}
          {l.priority === 'VIP' && <span className="text-[10px] font-bold bg-purple-100 text-purple-800 rounded-full px-1.5">VIP</span>}
        </div>
        <p className="text-xs text-brand-gray mt-0.5">{a.why}</p>
        <p className="text-[11px] text-brand-gray/80 mt-0.5">
          {[l.project, l.status, Number(l.dealValue) > 0 ? fmtEGP(Number(l.dealValue)) : ''].filter(Boolean).join(' · ')}
          {a.fit && a.fit.count > 0 && <span className="text-sky-700 font-bold"> · {a.fit.count} plot{a.fit.count > 1 ? 's' : ''} fit</span>}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={primary} className="bg-brand-red text-white rounded-xl px-3 py-2 text-xs font-extrabold flex items-center gap-1.5 hover:opacity-90">{MOVE_ICON[a.move]}{a.label}</button>
        <button title="Write it for me" onClick={() => onWrite(l, a.move === 'email' ? 'email' : 'whatsapp')} className="btn-secondary rounded-xl p-2 border border-brand-gray/20"><Wand2 size={14} /></button>
        <button title="Brief me" onClick={() => onBrief(l)} className="btn-secondary rounded-xl p-2 border border-brand-gray/20"><BookOpen size={14} /></button>
      </div>
    </li>
  );
};

// ---------------------------------------------------------------------------------------------
// 2. Write it for me: the smart writer reads where the lead stands and the Land Bank plots (no AI, no cost)
// ---------------------------------------------------------------------------------------------
const Composer: React.FC<{ lead: Lead; channel: 'whatsapp' | 'email'; me: string; user: any; fit: PlotFit | null; byKey: Map<string, Plot>; onClose: () => void }> = ({ lead, channel: ch0, me, user, fit, byKey, onClose }) => {
  const ctx = useMemo(() => ({ rep: me, fit, byKey }), [me, fit, byKey]);
  const options = useMemo(() => situationsFor(lead, ctx), [lead, ctx]);
  const [channel, setChannel] = useState<'whatsapp' | 'email'>(ch0);
  const [lang, setLang] = useState<'ar' | 'en'>(() => preferredLang(lead));
  const [sit, setSit] = useState<Situation>(options[0]);
  const [ver, setVer] = useState(0);
  const drafts = useMemo(() => writeFor(lead, ctx, sit), [lead, ctx, sit]);
  const d = drafts[ver % drafts.length];
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  useEffect(() => { setText(lang === 'ar' ? d.ar : d.en); setSubject(lang === 'ar' ? d.subjectAr : d.subjectEn); }, [d, lang]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const phone = phoneIntl(lead.phoneNumber).replace('+', '');
  const email = String(lead.email || '').trim();
  const send = () => {
    if (channel === 'whatsapp') {
      if (!phone) { toast.error('No usable phone number on this lead.'); return; }
      trackFeature(`smart_send_wa_${sit}`); logAttempt(lead, 'whatsapp', user, text);
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } else {
      if (!email) { toast.error('No e-mail address on this lead.'); return; }
      trackFeature(`smart_send_mail_${sit}`); logAttempt(lead, 'email', user, `${subject}\n\n${text}`);
      window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    }
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-3 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-brand-red flex items-center gap-1"><Wand2 size={12} />Write it for me</p>
            <h3 className="font-extrabold text-brand-black">{lead.customerName || lead.id}</h3>
            <p className="text-[11px] text-brand-gray">{[lead.companyName, lead.project, lead.status].filter(Boolean).join(' · ')}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-brand-gray/10"><X size={18} /></button>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-brand-gray mb-1">Where this lead stands</p>
          <div className="flex flex-wrap gap-1.5">
            {options.map((o, i) => (
              <button key={o} onClick={() => { setSit(o); setVer(0); trackFeature('smart_write_situation'); }} className={`text-[11px] font-bold rounded-full px-2.5 py-1 border ${sit === o ? 'bg-brand-red text-white border-brand-red' : 'border-brand-gray/25 text-brand-black hover:bg-brand-gray/5'}`}>
                {SITUATION_LABEL[o]}{i === 0 ? ' ✓' : ''}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-xl border border-brand-gray/20 overflow-hidden text-xs font-bold">
            <button onClick={() => setChannel('whatsapp')} className={`px-3 py-1.5 flex items-center gap-1 ${channel === 'whatsapp' ? 'bg-green-600 text-white' : ''}`}><MessageSquare size={13} />WhatsApp</button>
            <button onClick={() => setChannel('email')} className={`px-3 py-1.5 flex items-center gap-1 ${channel === 'email' ? 'bg-sky-600 text-white' : ''}`}><Mail size={13} />E-mail</button>
          </div>
          <div className="flex rounded-xl border border-brand-gray/20 overflow-hidden text-xs font-bold">
            <button onClick={() => setLang('ar')} className={`px-3 py-1.5 ${lang === 'ar' ? 'bg-brand-black text-white' : ''}`}>العربية</button>
            <button onClick={() => setLang('en')} className={`px-3 py-1.5 ${lang === 'en' ? 'bg-brand-black text-white' : ''}`}>English</button>
          </div>
          <button onClick={() => { setVer((v) => v + 1); trackFeature('smart_write_version'); }} className="text-xs font-bold rounded-xl px-3 py-1.5 border border-brand-red/30 text-brand-red flex items-center gap-1 hover:bg-brand-red/5"><RefreshCw size={13} />Another version ({(ver % drafts.length) + 1}/{drafts.length})</button>
        </div>
        {channel === 'email' && <input value={subject} onChange={(e) => setSubject(e.target.value)} dir={lang === 'ar' ? 'rtl' : 'ltr'} className="input-field w-full text-sm" placeholder="Subject" />}
        <textarea value={text} onChange={(e) => setText(e.target.value)} dir={lang === 'ar' ? 'rtl' : 'ltr'} rows={10} className="input-field w-full text-sm leading-relaxed" />
        {fit && fit.count > 0 && <p className="text-[11px] text-sky-800 bg-sky-50 rounded-lg px-2 py-1.5">Uses the Land Bank list: {fit.count} available plot{fit.count > 1 ? 's' : ''} in {fit.park} fit this customer. No prices are put in the message.</p>}
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <button onClick={() => { void navigator.clipboard?.writeText(text).then(() => toast.success('Copied')); trackFeature('smart_copy'); }} className="btn-secondary text-xs font-bold rounded-xl px-3 py-2 flex items-center gap-1"><Copy size={13} />Copy</button>
          <button onClick={send} className={`text-xs font-extrabold rounded-xl px-4 py-2 text-white flex items-center gap-1.5 ${channel === 'whatsapp' ? 'bg-green-600' : 'bg-sky-600'}`}>{channel === 'whatsapp' ? <MessageSquare size={14} /> : <Mail size={14} />}Open {channel === 'whatsapp' ? 'WhatsApp' : 'e-mail'}</button>
        </div>
        <p className="text-[10px] text-brand-gray">Nothing is sent by the system: your WhatsApp or mail app opens with the text, and the attempt is logged on the lead.</p>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// 3. Brief me: instant summary from the record; "AI brief" adds a 3-line read of the history
// ---------------------------------------------------------------------------------------------
const BriefPanel: React.FC<{ lead: Lead; fit: ReturnType<typeof plotFit>; onClose: () => void; onOpen: () => void }> = ({ lead, fit, onClose, onOpen }) => {
  const b = useMemo(() => briefOf(lead, fit), [lead, fit]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex justify-end" onClick={onClose}>
      <aside className="bg-white w-full sm:max-w-md h-full shadow-2xl p-5 space-y-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-brand-red flex items-center gap-1"><BookOpen size={12} />Brief before the call</p>
            <h3 className="font-extrabold text-brand-black text-lg">{lead.customerName || lead.id}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-brand-gray/10"><X size={18} /></button>
        </div>
        <dl className="space-y-3 text-sm">
          <div><dt className="text-[10px] uppercase font-bold text-brand-gray">Who</dt><dd>{b.who}</dd></div>
          <div><dt className="text-[10px] uppercase font-bold text-brand-gray">What they need</dt><dd>{b.need}</dd></div>
          {fit && fit.best.length > 0 && (
            <div><dt className="text-[10px] uppercase font-bold text-brand-gray">Closest available plots</dt>
              <dd className="space-y-1 mt-1">{fit.best.map((p) => <div key={p.key} className="text-xs bg-sky-50 rounded-lg px-2 py-1">{p.unit} · {p.sector || '—'} · {p.areaSqM.toLocaleString('en-US')} sqm · {p.listTotal ? fmtEGP(p.listTotal) : '—'}</div>)}</dd>
            </div>
          )}
          {lead.description && <div><dt className="text-[10px] uppercase font-bold text-brand-gray">What they wrote</dt><dd className="text-xs text-brand-gray whitespace-pre-line">{String(lead.description).slice(0, 400)}</dd></div>}
          <div><dt className="text-[10px] uppercase font-bold text-brand-gray">Last touches</dt>
            <dd>{b.last.length ? b.last.map((x, i) => <p key={i} className="text-xs py-0.5"><b>{x.when}</b> — {x.text}</p>) : <span className="text-xs text-brand-gray">Nothing logged yet.</span>}</dd>
          </div>
          <div><dt className="text-[10px] uppercase font-bold text-brand-gray">Next</dt><dd>{b.next}</dd></div>
        </dl>
        <button onClick={onOpen} className="btn-primary w-full rounded-xl py-2.5 text-sm font-bold">Open the lead</button>
      </aside>
    </div>
  );
};
