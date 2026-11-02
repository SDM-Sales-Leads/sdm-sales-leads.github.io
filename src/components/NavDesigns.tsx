import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, LogOut, MoreHorizontal, PanelLeft } from 'lucide-react';
import { Logo } from '../constants';
import { NotificationBell } from './NotificationBell';
import { ViewSwitch } from './ViewSwitch';
import { LightModeButton, TextSizeButton } from './TextSizeButton';
import { getLang, setLang } from '../i18n/lang';
import type { NavGroup } from './navGroups';

// 3 Nov 2026: three alternative menus for laptops with a small screen (13 inch): the old sidebar needed scrolling to reach most pages.
//   rail  = a slim icon rail that opens its labels when the mouse is on it
//   dense = the same sidebar, but compact: everything (labels too) fits without scrolling
//   top   = the menu moves to a bar on top, extra pages fold into "More"
// The choice is kept in this browser only (localStorage), so nobody else sees a change until one design is made the default.
export type NavDesign = 'current' | 'rail' | 'dense' | 'top';
type Stored = NavDesign | 'auto';   // 'auto' = nobody chose: the top bar on laptops (under 1500 px wide), the side menu on big screens
const KEY = 'sdm_nav_design';
const listeners = new Set<() => void>();
const valid = (v: any): v is NavDesign => v === 'current' || v === 'rail' || v === 'dense' || v === 'top';
export const readNavDesign = (): Stored => { try { const v = localStorage.getItem(KEY); return valid(v) ? v : 'auto'; } catch { return 'auto'; } };
export const setNavDesign = (d: Stored) => { try { localStorage.setItem(KEY, d); } catch { /* private mode */ } listeners.forEach((f) => f()); };
// ?nav=rail|dense|top|current|auto picks a design in this browser (for testing); people switch between top bar and side menu from their account menu
try {
  const q = new URLSearchParams(location.search);
  if (valid(q.get('nav'))) localStorage.setItem(KEY, q.get('nav')!);
} catch { /* ignore */ }
export const useNavDesign = (): Stored =>
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, readNavDesign, () => 'auto');

const useMin = (px: number) => {
  const q = `(min-width: ${px}px)`;
  const [on, setOn] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia(q).matches));
  useEffect(() => {
    const m = window.matchMedia(q); const f = () => setOn(window.matchMedia(q).matches);
    m.addEventListener('change', f); window.addEventListener('resize', f); f();
    return () => { m.removeEventListener('change', f); window.removeEventListener('resize', f); };
  }, [q]);
  return on;
};
/** the new designs are for desktop screens; below 1024 px the existing drawer menu stays. Nobody chose: top bar under 1500 px, side menu above */
export const useActiveDesign = (): NavDesign => {
  const d = useNavDesign(); const desk = useMin(1024); const big = useMin(1500);
  if (!desk) return 'current';
  return d === 'auto' ? (big ? 'current' : 'top') : d;
};

interface Props { groups: NavGroup[]; activeId?: string; onPick: (g: NavGroup) => void; user: any; logout: () => void }
const langBtn = (cls: string, withLabel: boolean) => (
  <button type="button" translate="no" title={getLang() === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'} onClick={() => setLang(getLang() === 'ar' ? 'en' : 'ar')} className={cls}>
    <span className="font-bold text-sm w-5 text-center">{getLang() === 'ar' ? 'EN' : 'ع'}</span>{withLabel && <span className="ml-1.5">{getLang() === 'ar' ? 'English' : 'العربية'}</span>}
  </button>
);

/** avatar + a small menu with everything that used to fill the bottom of the sidebar */
const AccountMenu: React.FC<{ user: any; logout: () => void; place: 'right' | 'below' }> = ({ user, logout, place }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f);
  }, [open]);
  const row = 'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-white/75 hover:bg-white/10 hover:text-white text-[13px]';
  return (
    <div ref={ref} className="relative">
      <button type="button" title={`${user?.name || ''} · menu`} onClick={() => setOpen((o) => !o)} className="w-9 h-9 rounded-full bg-brand-red flex items-center justify-center font-bold text-base shadow-lg hover:opacity-90">{String(user?.name || '?').charAt(0)}</button>
      {open && (
        <div className={`absolute z-[100] w-60 rounded-2xl bg-brand-black/95 backdrop-blur-md border border-white/15 shadow-2xl p-2 ${place === 'right' ? 'left-12 bottom-0' : 'right-0 top-11'}`}>
          <div className="px-3 py-2 border-b border-white/10 mb-1"><p className="font-bold text-white truncate">{user?.name}</p><p className="text-[10px] text-white/45 uppercase tracking-wider font-bold truncate">{user?.role}</p></div>
          <div className="px-3 py-1.5"><span className="block text-[10px] text-white/40 uppercase font-bold mb-1">Look</span><ViewSwitch /></div>
          <TextSizeButton className={row} />
          <LightModeButton className={row} />
          {langBtn(row, true)}
          <button type="button" onClick={() => setNavDesign('current')} className={row}><PanelLeft size={16} /><span className="ml-1.5">Use the side menu</span></button>
          <button type="button" onClick={logout} className={row}><LogOut size={16} /><span className="ml-1.5">Logout</span></button>
        </div>
      )}
    </div>
  );
};

/** A: slim icon rail; the labels slide open while the mouse is on it (or a key is focused in it) */
export const RailNav: React.FC<Props> = ({ groups, activeId, onPick, user, logout }) => {
  const [hover, setHover] = useState(false);
  return (
    <div className="hidden lg:block relative w-[68px] shrink-0 h-screen z-50">
      <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}
        className={`absolute inset-y-0 left-0 glass-sidebar text-white flex flex-col h-screen transition-[width] duration-200 overflow-hidden ${hover ? 'w-56 shadow-2xl' : 'w-[68px]'}`}>
        <div className="flex items-center gap-2 px-3 h-14 border-b border-white/10 shrink-0">
          <div className="w-11 flex justify-center shrink-0"><Logo height="h-8" /></div>
          {hover && <span className="font-bold text-[11px] tracking-widest uppercase whitespace-nowrap text-white/85">W-CRM</span>}
          {hover && <span className="ml-auto"><NotificationBell dark /></span>}
        </div>
        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto overflow-x-hidden [scrollbar-width:none]">
          {groups.map((g) => {
            const on = g.id === activeId, Icon = g.icon;
            return (
              <button key={g.id} type="button" title={g.label} onClick={() => onPick(g)} className={`w-full h-10 flex items-center gap-3 rounded-xl px-[13px] transition-colors ${on ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}>
                <Icon size={19} className="shrink-0" />{hover && <span className="text-[13px] font-medium whitespace-nowrap">{g.label}</span>}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-2 flex items-center gap-2 shrink-0 h-14">
          <div className="w-11 flex justify-center shrink-0"><AccountMenu user={user} logout={logout} place="right" /></div>
          {hover && <div className="min-w-0"><p className="text-[12px] font-medium truncate">{user?.name}</p><p className="text-[9px] text-white/40 uppercase tracking-wider font-bold truncate">{user?.role}</p></div>}
        </div>
      </div>
    </div>
  );
};

/** B: the same sidebar, made compact: small logo, 36 px rows, the bottom buttons in one row - labels stay, no scrolling on a 13 inch screen */
export const DenseNav: React.FC<Props> = ({ groups, activeId, onPick, user, logout }) => (
  <div className="hidden lg:flex glass-sidebar text-white flex-col h-screen w-56 shrink-0 sticky top-0 z-50">
    <div className="flex items-center gap-2 px-3 h-14 border-b border-white/10 shrink-0">
      <Logo height="h-8" />
      <span className="font-bold text-[11px] tracking-widest uppercase text-white/85">W-CRM</span>
      <span className="ml-auto"><NotificationBell dark /></span>
    </div>
    <nav className="flex-1 min-h-0 py-2 px-2 space-y-px overflow-y-auto [scrollbar-width:thin]">
      {groups.map((g) => {
        const on = g.id === activeId, Icon = g.icon;
        return (
          <button key={g.id} type="button" onClick={() => onPick(g)} className={`w-full h-9 flex items-center gap-2.5 rounded-lg px-3 transition-colors ${on ? 'bg-brand-red text-white shadow-md shadow-brand-red/20' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}>
            <Icon size={17} className="shrink-0" /><span className="text-[13px] font-medium whitespace-nowrap">{g.label}</span>
          </button>
        );
      })}
    </nav>
    <div className="border-t border-white/10 px-3 py-2 shrink-0 space-y-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-full bg-brand-red flex items-center justify-center font-bold text-sm shrink-0">{String(user?.name || '?').charAt(0)}</div>
        <div className="min-w-0 flex-1"><p className="text-[12px] font-medium truncate leading-tight">{user?.name}</p><p className="text-[9px] text-white/40 uppercase tracking-wider font-bold truncate">{user?.role}</p></div>
        <button type="button" title="Logout" onClick={logout} className="w-8 h-8 rounded-lg text-white/60 hover:bg-white/10 hover:text-white inline-flex items-center justify-center shrink-0"><LogOut size={16} /></button>
      </div>
      <div className="flex items-center justify-between">
        <ViewSwitch />
        <div className="flex items-center text-white/60">
          <TextSizeButton compact className="w-7 h-7 rounded-lg hover:bg-white/10 hover:text-white inline-flex items-center justify-center text-xs" />
          <LightModeButton compact className="w-7 h-7 rounded-lg hover:bg-white/10 hover:text-white inline-flex items-center justify-center" />
          {langBtn('w-7 h-7 rounded-lg hover:bg-white/10 hover:text-white inline-flex items-center justify-center', false)}
        </div>
      </div>
    </div>
  </div>
);

/** C: the menu on a bar across the top: as many groups as fit, the rest under "More" */
export const TopNav: React.FC<Props> = ({ groups, activeId, onPick, user, logout }) => {
  const box = useRef<HTMLDivElement>(null), ghost = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(groups.length);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const calc = () => {
      if (!box.current || !ghost.current) return;
      const avail = box.current.clientWidth - 96;         // room kept for "More"
      let used = 0, n = 0;
      const kids = Array.from(ghost.current.children) as HTMLElement[];
      for (const k of kids) { used += k.offsetWidth + 4; if (used > avail) break; n++; }
      setFit(n >= kids.length ? kids.length : Math.max(2, n));
    };
    calc();
    const ro = new ResizeObserver(calc); if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [groups]);
  useEffect(() => {
    if (!more) return;
    const f = (e: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMore(false); };
    document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f);
  }, [more]);
  const shown = groups.slice(0, fit), hidden = groups.slice(fit);
  // the page you are on is always visible: if it is hidden, it swaps in for the last visible one
  const activeHidden = hidden.find((g) => g.id === activeId);
  const bar = activeHidden ? [...shown.slice(0, Math.max(0, shown.length - 1)), activeHidden] : shown;
  const rest = activeHidden ? [...hidden.filter((g) => g.id !== activeHidden.id), shown[shown.length - 1]].filter(Boolean) : hidden;
  const btn = (g: NavGroup, on: boolean) => { const Icon = g.icon; return (
    <button key={g.id} type="button" onClick={() => { onPick(g); setMore(false); }} className={`h-9 px-3 flex items-center gap-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors ${on ? 'bg-brand-red text-white shadow-md shadow-brand-red/20' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
      <Icon size={16} />{g.label}
    </button>); };
  return (
    <header className="hidden lg:flex glass-sidebar text-white items-center gap-3 px-4 h-14 shrink-0 z-50 relative">
      <div className="flex items-center gap-2 shrink-0"><Logo height="h-8" /><span className="font-bold text-[11px] tracking-widest uppercase text-white/85">W-CRM</span></div>
      <div ref={box} className="flex-1 min-w-0 relative">
        <div ref={ghost} aria-hidden className="absolute opacity-0 pointer-events-none flex gap-1 whitespace-nowrap">{groups.map((g) => btn(g, false))}</div>
        <nav className="flex items-center gap-1">
          {bar.map((g) => btn(g, g.id === activeId))}
          {rest.length > 0 && (
            <div ref={moreRef} className="relative">
              <button type="button" onClick={() => setMore((m) => !m)} className="h-9 px-3 flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-white/70 hover:bg-white/10 hover:text-white"><MoreHorizontal size={16} />More<ChevronDown size={13} /></button>
              {more && <div className="absolute left-0 top-11 w-52 rounded-2xl bg-brand-black/95 backdrop-blur-md border border-white/15 shadow-2xl p-1.5 z-[100]">{rest.map((g) => { const Icon = g.icon; return (
                <button key={g.id} type="button" onClick={() => { onPick(g); setMore(false); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-white/75 hover:bg-white/10 hover:text-white"><Icon size={16} />{g.label}</button>); })}</div>}
            </div>
          )}
        </nav>
      </div>
      <div className="flex items-center gap-2 shrink-0"><NotificationBell dark /><AccountMenu user={user} logout={logout} place="below" /></div>
    </header>
  );
};
