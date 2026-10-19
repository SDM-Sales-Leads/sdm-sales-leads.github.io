import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TextSizeButton } from './TextSizeButton';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Grid2x2, LogOut, Menu, PanelRightClose, PanelRightOpen, Search, X } from 'lucide-react';
import { useAuth } from '../services/AuthContext';
import { Logo } from '../constants';
import { NotificationBell } from './NotificationBell';
import { crmService } from './crm/crmService';
import { crmNav } from './crm/crmNav';
import { dayOf, todayISO } from './crm/leadMetrics';
import { isOpenStatus } from './crm/leadConfig';
import { ViewSwitch } from './ViewSwitch';
import { getLang, setLang } from '../i18n/lang';
import { buildGroups, groupOf, isHere, NavGroup, NavItem } from './navGroups';

const RAIL = ['home', 'leads', 'customers', 'land', 'deals', 'reports', 'targets'];
const PANEL_KEY = 'sdm_glass_panel';

/** The Glass look: dark frosted panels floating over a photo, white cards inside. Same pages, same logic as the other two looks. */
export const GlassShell: React.FC<{ activeTab: string; crmSubTab: string; go: (tab: string, sub?: string) => void; children: React.ReactNode }> = ({ activeTab, crmSubTab, go, children }) => {
  const { user, permissions, logout } = useAuth();
  const groups = useMemo(() => buildGroups(permissions, user?.role), [permissions, user?.role]);
  const curGroup = groupOf(groups, activeTab, crmSubTab);
  const curItem = curGroup?.items.find((i) => isHere(i, activeTab, crmSubTab));
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(() => { try { return localStorage.getItem(PANEL_KEY) !== 'off'; } catch { return true; } });
  const [q, setQ] = useState('');
  const [, bump] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const [day, setDay] = useState(todayISO());
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  const togglePanel = () => setPanel((p) => { const n = !p; try { localStorage.setItem(PANEL_KEY, n ? 'on' : 'off'); } catch { /* ignore */ } return n; });
  const pick = (n: NavItem) => { setMenu(false); go(n.tab, n.sub); };

  // the lists are loaded once for the side panel and the home (cheap: the page does the same when it opens)
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    window.addEventListener('crm-data-changed', f);
    if (permissions?.canViewSalesCrm || permissions?.canViewSalesLeads) { if (!crmService.getLeads().length) void crmService.loadAll().then(f); }
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('crm-data-changed', f); window.removeEventListener('keydown', k); };
  }, [permissions?.canViewSalesCrm, permissions?.canViewSalesLeads]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [] as any[];
    const digits = t.replace(/\D/g, '');
    const out: any[] = [];
    for (const l of crmService.getLeads() as any[]) {
      if ((l.customerName || '').toLowerCase().includes(t) || (l.companyName || '').toLowerCase().includes(t) || (l.id || '').toLowerCase().includes(t) || (digits.length >= 4 && String(l.phoneNumber || '').replace(/\D/g, '').includes(digits))) { out.push(l); if (out.length >= 8) break; }
    }
    return out;
  }, [q]);

  // my follow-ups and meetings, by day, for the side calendar
  const mine = (crmService.getLeads() as any[]).filter((l) => !l.mergedInto && isOpenStatus(l.status) && String(l.assignedSalespersonId || '') === String(user?.id ?? ''));
  const byDay = useMemo(() => {
    const m = new Map<string, { lead: any; kind: string; time?: string }[]>();
    const add = (iso: string | undefined, lead: any, kind: string, time?: string) => { const k = dayOf(iso); if (!k) return; m.set(k, [...(m.get(k) || []), { lead, kind, time }]); };
    for (const l of mine) { add(l.nextFollowUpDate, l, 'Follow-up', l.nextFollowUpTime); add(l.meetingDate, l, 'Meeting', l.meetingTime); }
    return m;
  }, [mine.length, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = todayISO();
  const list = byDay.get(day) || [];
  const upcoming = day === today && !list.length ? [...byDay.entries()].filter(([k]) => k > today).sort(([a], [b]) => a.localeCompare(b)).slice(0, 3).flatMap(([, v]) => v).slice(0, 4) : [];

  const first = (user?.name || '').trim().split(/\s+/)[0] || '';
  const hour = new Date().getHours();
  const isHome = activeTab === 'glass-home';
  const title = isHome ? `${hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening'}, ${first} 👋` : curItem?.label || '';
  const sub = isHome ? "Let's close some deals today" : 'Elsewedy Industrial Development';
  const rail = RAIL.map((id) => groups.find((g) => g.id === id)).filter(Boolean) as NavGroup[];

  const monthDays = useMemo(() => {
    const y = month.getFullYear(), m = month.getMonth();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;                    // Monday first
    const n = new Date(y, m + 1, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => new Date(y, m, i + 1).toLocaleDateString('en-CA'))] as (string | null)[];
  }, [month]);

  const railBtn = (g: NavGroup) => {
    const I = g.icon, on = g.id === curGroup?.id;
    return <button key={g.id} type="button" title={g.label} onClick={() => pick(g.items[0])} className={`glass-rail-btn ${on ? 'on' : ''}`}><I size={20} /></button>;
  };

  return (
    <div className="glass-view" id="glass-view-root">
      <div className="glass-bg" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}glass-bg.jpg)` }} />
      <div className="relative z-10 h-full flex gap-3 md:gap-4 p-2.5 md:p-4">
        {/* rail */}
        <aside className="glass-panel hidden lg:flex w-[76px] shrink-0 flex-col items-center py-5 gap-2">
          <div className="mb-3"><Logo height="h-9" src="https://elsewedydevelopment.com/wp-content/uploads/2023/04/SD-web-Logo.png" /></div>
          <div className="flex-1 flex flex-col items-center gap-2.5 overflow-y-auto">{rail.map(railBtn)}
            <button type="button" title="All menus" onClick={() => setMenu(true)} className="glass-rail-btn"><Grid2x2 size={20} /></button>
          </div>
          <ViewSwitch className="flex-col !rounded-2xl !p-1" />
          <button type="button" translate="no" title={getLang() === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'} onClick={() => setLang(getLang() === 'ar' ? 'en' : 'ar')} className="glass-rail-btn text-[13px] font-extrabold">{getLang() === 'ar' ? 'EN' : 'ع'}</button>
          <TextSizeButton compact className="glass-rail-btn text-[13px]" />
          <button type="button" title="Sign out" onClick={logout} className="glass-rail-btn"><LogOut size={19} /></button>
        </aside>

        {/* main */}
        <section className="glass-panel flex-1 min-w-0 flex flex-col overflow-hidden">
          <header className="flex items-center gap-3 px-4 md:px-7 pt-4 md:pt-6 pb-3">
            <button type="button" className="lg:hidden glass-rail-btn !w-10 !h-10" onClick={() => setMenu(true)} aria-label="Menu"><Menu size={20} /></button>
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] md:text-[26px] font-extrabold tracking-tight truncate">{title}</h1>
              <p className="text-[12px] text-white/55 truncate">{sub}</p>
            </div>
            <div className="relative hidden md:block w-[300px]">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads…  (Ctrl+K)" className="glass-input w-full" />
              {results.length > 0 && (
                <div className="absolute top-12 left-0 right-0 glass-pop z-50 overflow-hidden">
                  {results.map((l) => (
                    <button key={l.id} type="button" onClick={() => { setQ(''); crmNav.lead(l.id); go('sales-crm', 'leads'); }} className="block w-full text-left px-3.5 py-2.5 text-xs hover:bg-white/10 border-b border-white/10 last:border-0">
                      <b>{l.customerName || l.companyName || l.id}</b> <span className="text-white/55">· {l.phoneNumber || '—'} · {l.status}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <NotificationBell dark />
            <button type="button" onClick={togglePanel} title={panel ? 'Hide the side panel' : 'Show the side panel'} className="hidden xl:flex glass-rail-btn !w-10 !h-10">{panel ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button>
          </header>
          <main className={`flex-1 overflow-y-auto px-3 md:px-7 pb-24 ${isHome ? '' : ''}`}>
            {isHome ? children : <div className="glass-sheet p-4 md:p-6">{children}</div>}
          </main>
        </section>

        {/* side panel: profile, calendar, my schedule */}
        {panel && (
          <aside className="glass-panel hidden xl:flex w-[300px] shrink-0 flex-col p-5 gap-4 overflow-y-auto">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-brand-red text-white font-extrabold flex items-center justify-center text-lg">{(user?.name || '–').trim().charAt(0).toUpperCase()}</div>
              <div className="min-w-0"><div className="font-bold truncate">{user?.name}</div><div className="text-[11px] text-white/55 truncate">{user?.role}</div></div>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-white/5 border border-white/10 py-2.5 text-center">
              {[['Open', mine.length], ['Due', mine.filter((l) => l.nextFollowUpDate && l.nextFollowUpDate <= today).length], ['Meetings', mine.filter((l) => l.meetingDate && l.meetingDate >= today).length]].map(([k, v]) => (
                <div key={k as string}><div className="font-extrabold text-[15px] tabular-nums">{(v as number).toLocaleString('en-US')}</div><div className="text-[10px] text-white/50">{k}</div></div>
              ))}
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-3.5">
              <div className="flex items-center justify-between mb-2">
                <b className="text-[13px]">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
                <span className="flex gap-1"><button type="button" className="glass-mini" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={14} /></button><button type="button" className="glass-mini" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={14} /></button></span>
              </div>
              <div className="grid grid-cols-7 text-center text-[10px] text-white/45 mb-1">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d}>{d}</span>)}</div>
              <div className="grid grid-cols-7 gap-y-1 text-center text-[12px]">
                {monthDays.map((iso, i) => iso === null ? <span key={i} /> : (
                  <button key={iso} type="button" onClick={() => setDay(iso)} className={`relative mx-auto w-7 h-7 rounded-full font-semibold ${iso === day ? 'bg-brand-red text-white' : iso === today ? 'ring-1 ring-brand-red text-white' : 'text-white/80 hover:bg-white/10'}`}>
                    {Number(iso.slice(8))}
                    {byDay.has(iso) && iso !== day && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-brand-red" />}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2"><b className="text-[13px] border-l-[3px] border-brand-red pl-2">{day === today ? 'Today' : new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</b>
                <button type="button" className="text-[11px] text-white/55 hover:text-white" onClick={() => go('sales-crm', 'calendar')}>view all</button></div>
              <div className="space-y-2">
                {(list.length ? list : upcoming).map((e, i) => (
                  <button key={i} type="button" onClick={() => crmNav.lead(e.lead.id)} className="w-full text-left rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 px-3 py-2.5">
                    <span className="text-[9px] font-bold uppercase tracking-wide bg-brand-red/90 rounded px-1.5 py-0.5">{e.kind}</span>
                    <div className="text-[13px] font-bold truncate mt-1">{e.lead.customerName || e.lead.id}</div>
                    <div className="text-[11px] text-white/50">{e.lead.project || '—'}{e.time ? ` · ${e.time}` : ''}{!list.length ? ` · ${dayOf(e.kind === 'Meeting' ? e.lead.meetingDate : e.lead.nextFollowUpDate).slice(5)}` : ''}</div>
                  </button>
                ))}
                {!list.length && !upcoming.length && <p className="text-[12px] text-white/45 text-center py-4">Nothing scheduled.</p>}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* all menus */}
      {menu && createPortal(
        <div className="fixed inset-0 z-[9990] flex items-start justify-center p-4 md:p-10 bg-black/45 backdrop-blur-sm" onClick={() => setMenu(false)}>
          <div className="glass-panel w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5 md:p-6 text-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><b className="text-lg">All menus</b><button type="button" className="glass-mini" onClick={() => setMenu(false)}><X size={16} /></button></div>
            {groups.map((g) => { const GI = g.icon; return (
              <div key={g.id} className="mb-4">
                <p className="text-[10px] uppercase tracking-widest text-white/45 font-bold mb-2 flex items-center gap-1.5"><GI size={12} />{g.label}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {g.items.map((n) => (
                    <button key={n.id} type="button" onClick={() => pick(n)} className={`text-left rounded-xl px-3 py-2.5 text-[13px] font-semibold border ${isHere(n, activeTab, crmSubTab) ? 'bg-brand-red border-brand-red' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>{n.label}</button>
                  ))}
                </div>
              </div>
            ); })}
            <div className="flex gap-2 items-center lg:hidden pt-2 flex-wrap"><ViewSwitch /><TextSizeButton className="glass-pill px-4 py-2 text-xs font-bold" /><button type="button" onClick={() => setLang(getLang() === 'ar' ? 'en' : 'ar')} className="glass-pill px-4 py-2 text-xs font-bold" translate="no">{getLang() === 'ar' ? 'English' : 'العربية'}</button><button type="button" onClick={logout} className="glass-pill px-4 py-2 text-xs font-bold">Sign out</button></div>
          </div>
        </div>, document.body)}
    </div>
  );
};
