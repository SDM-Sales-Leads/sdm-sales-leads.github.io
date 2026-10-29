import React, { useMemo, useState } from 'react';
import { TextSizeButton, LightModeButton } from './TextSizeButton';
import { createPortal } from 'react-dom';
import { useBackClose } from '../lib/backNav';
import { LogOut, MoreHorizontal, X } from 'lucide-react';
import { useAuth } from '../services/AuthContext';
import { buildGroups, groupOf, isHere, NavGroup, NavItem } from './navGroups';
import { ViewSwitch } from './ViewSwitch';
import { getLang, setLang } from '../i18n/lang';

/** Phone only: a bottom bar like a mobile app (day, leads, contacts, calendar, more) plus a sheet with every menu. */
export const MobileTabBar: React.FC<{ activeTab: string; crmSubTab: string; go: (tab: string, sub?: string) => void }> = ({ activeTab, crmSubTab, go }) => {
  const { user, permissions, logout } = useAuth();
  const [more, setMore] = useState(false);
  useBackClose(more, () => setMore(false));   // the phone's Back closes the menu sheet first
  const groups = useMemo(() => buildGroups(permissions, user?.role), [permissions, user?.role]);
  const cur = groupOf(groups, activeTab, crmSubTab);
  const ids = ['home', 'leads', 'customers', 'reports'];
  const picked = ids.map((id) => groups.find((g) => g.id === id)).filter(Boolean) as NavGroup[];
  const tabs = (picked.length ? picked : groups.slice(0, 4)).slice(0, 4);
  const pick = (n: NavItem) => { setMore(false); go(n.tab, n.sub); };

  return (
    <>
      <nav className="mobile-tabbar lg:hidden" aria-label="Main">
        {tabs.map((g) => { const I = g.icon; return (
          <button key={g.id} type="button" onClick={() => pick(g.items[0])} className={g.id === cur?.id ? 'on' : ''}><I size={21} /><span>{g.label}</span></button>
        ); })}
        <button type="button" onClick={() => setMore(true)} className={more ? 'on' : ''}><MoreHorizontal size={21} /><span>More</span></button>
      </nav>
      {more && createPortal(
        <div className="fixed inset-0 z-[9993] bg-black/50 flex items-end lg:hidden" onClick={() => setMore(false)}>
          <div className="bg-white w-full max-h-[85dvh] overflow-y-auto rounded-t-3xl p-4 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><b className="text-base text-brand-black">All menus</b><button type="button" onClick={() => setMore(false)} aria-label="Close" className="p-2"><X size={20} /></button></div>
            {groups.map((g) => { const GI = g.icon; return (
              <div key={g.id} className="mb-4">
                <p className="text-[10px] uppercase tracking-widest text-brand-gray font-bold mb-2 flex items-center gap-1.5"><GI size={12} />{g.label}</p>
                <div className="grid grid-cols-2 gap-2">
                  {g.items.map((n) => (
                    <button key={n.id} type="button" onClick={() => pick(n)} className={`text-left rounded-xl px-3 py-3 text-[13px] font-semibold border ${isHere(n, activeTab, crmSubTab) ? 'bg-brand-red text-white border-brand-red' : 'bg-brand-gray/5 border-brand-gray/15 text-brand-black'}`}>{n.label}</button>
                  ))}
                </div>
              </div>
            ); })}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <ViewSwitch tone="light" />
              <TextSizeButton className="border border-brand-gray/25 rounded-full px-4 py-2 text-xs font-bold" />
              <LightModeButton className="border border-brand-gray/25 rounded-full px-4 py-2 text-xs font-bold inline-flex items-center" />
              <button type="button" translate="no" onClick={() => setLang(getLang() === 'ar' ? 'en' : 'ar')} className="border border-brand-gray/25 rounded-full px-4 py-2 text-xs font-bold">{getLang() === 'ar' ? 'English' : 'العربية'}</button>
              <button type="button" onClick={logout} className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold text-brand-red px-3 py-2"><LogOut size={15} /> Sign out</button>
            </div>
          </div>
        </div>, document.body)}
    </>
  );
};
