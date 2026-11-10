// The Lara part of the Leads page's lead panel: "Start with Lara" always at hand; the conversation (every channel) loads only when opened,
// so opening a lead costs nothing extra. Shown only to people Lara is switched on for (admin, or roles with "Lara Sales AI").
import React, { Suspense, lazy, useState } from 'react';
import { Bot, ChevronDown, Loader2 } from 'lucide-react';
import type { Lead } from './types';
import { useAuth } from '../../services/AuthContext';

const LaraLeadPanel = lazy(() => import('../lara/LaraLeadPanel').then((m) => ({ default: m.LaraLeadPanel })));
const StartWithLara = lazy(() => import('../lara/StartWithLara').then((m) => ({ default: m.StartWithLara })));

export const LaraLeadSection: React.FC<{ lead: Lead }> = ({ lead }) => {
  const { user, permissions } = useAuth();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(false);
  const [ver, setVer] = useState(0);
  const isAdmin = user?.role === 'Admin';
  if (!isAdmin && !(permissions as any)?.canUseLara) return null;
  const seesAll = isAdmin || user?.role === 'Sales Operation' || !!permissions?.canViewSalesRules;
  return (
    <section className="rounded-xl border border-brand-red/20 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex-1 flex items-center gap-2 text-left text-[11px] font-extrabold text-brand-black uppercase tracking-wider">
          <Bot size={14} className="text-brand-red" />Lara — interactions (e-mail, WhatsApp, chat)
          <ChevronDown size={16} className={`text-brand-gray transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button onClick={() => setStart(true)} className="btn-primary rounded-xl px-3 py-1.5 text-[11px] font-bold flex items-center gap-1"><Bot size={12} />Start with Lara</button>
      </div>
      {open && <div className="px-4 pb-4 pt-1 border-t border-brand-gray/10"><Suspense fallback={<Loader2 className="animate-spin text-brand-gray" size={16} />}><LaraLeadPanel key={ver} lead={lead} isAdmin={seesAll} /></Suspense></div>}
      {start && <Suspense fallback={null}><StartWithLara lead={lead} onClose={() => setStart(false)} onDone={() => { setOpen(true); setVer((v) => v + 1); }} /></Suspense>}
    </section>
  );
};
