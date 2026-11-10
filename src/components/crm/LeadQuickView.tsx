// 360 lead drawer (owner, 11 Nov 2026: "open the lead directly in the same page instead of making the user go to another page ... give a 360
// feeling across the app"). Any number or name clicked anywhere opens the lead HERE, over the current screen: edit it, see its timeline,
// plots, history, the customer's other leads and Lara's conversation — then close and carry on where you were. One drawer for the whole app,
// built from the same parts as the Leads page (LeadEditor, LeadPlotsPanel, LeadAuditHistory, Customer360), so there is no second copy to keep.
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { X, Phone, Mail, MessageCircle, Bot, ExternalLink, Loader2, UserRound, Clock, Map as MapIcon, History, Users } from 'lucide-react';
import type { Company, Contact, Lead } from './types';
import { crmService } from './crmService';
import { LeadEditor } from './LeadEditor';
import { LeadPlotsPanel } from './LeadPlotsPanel';
import { LeadAuditHistory } from './LeadAuditHistory';
import { Customer360, indexLeadsByPhone, phoneKeyOf, waLink } from './Customer360';
import { LeadAuth, statusClass } from './leadRules';
import { useAuth } from '../../services/AuthContext';
import { loadPlots, Plot } from '../../lib/plotsService';
import { crmNav } from './crmNav';

const LaraLeadPanel = lazy(() => import('../lara/LaraLeadPanel').then((m) => ({ default: m.LaraLeadPanel })));
const StartWithLara = lazy(() => import('../lara/StartWithLara').then((m) => ({ default: m.StartWithLara })));

type Tab = 'lead' | 'lara' | 'customer' | 'timeline' | 'plots' | 'history';
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export const LeadQuickView: React.FC<{ leads: Lead[]; contacts: Contact[]; companies: Company[]; setActiveSubTab: (t: string) => void }> = ({ leads, contacts, companies, setActiveSubTab }) => {
  const { user, permissions } = useAuth();
  const [id, setId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('lead');
  const [start, setStart] = useState(false);
  const [plots, setPlots] = useState<Plot[] | null>(null);
  const [landBankUrl, setLandBankUrl] = useState<string | undefined>();
  const [, bump] = useState(0);

  useEffect(() => {
    const open = (e: Event) => { const d = (e as CustomEvent).detail || {}; if (d.id) { setId(String(d.id)); setTab((d.tab as Tab) || 'lead'); } };
    window.addEventListener('crm-peek', open);
    return () => window.removeEventListener('crm-peek', open);
  }, []);
  useEffect(() => {
    if (!id) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !start) setId(null); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [id, start]);
  useEffect(() => { if (tab === 'plots' && !plots) void loadPlots().then((s) => { setPlots(s.plots); setLandBankUrl(s.landBankUrl); }).catch(() => setPlots([])); }, [tab, plots]);

  // the lead as the app holds it now (an edit anywhere shows here at once)
  const lead = useMemo(() => (id ? leads.find((l) => l.id === id) || crmService.getLeads().find((l) => l.id === id) || null : null), [id, leads]);
  const role = user?.role || '';
  const isAdmin = role === 'Admin';
  const laraUser = isAdmin || !!(permissions as any)?.canUseLara;
  const seesAll = isAdmin || role === 'Sales Operation' || !!permissions?.canViewSalesRules;
  const auth = useMemo((): LeadAuth => {
    const myId = user ? String(user.id) : '';
    const owner = lead?.assignedSalespersonId ? String(lead.assignedSalespersonId) : '';
    const isOwner = !!owner && owner === myId;
    const team = role === 'Sales Team Leader' && (!owner || isOwner || (crmService.getSalesPeople() as any[]).some((s) => String(s.id) === owner && String(s.teamLeaderId || '') === myId));
    return { isOps: seesAll, isOwner, isTeamLead: team, readOnly: role === 'Read Only', canConfirmCash: !!permissions?.canConfirmCash };
  }, [user, role, lead, seesAll, permissions]);
  // the customer behind the lead: the contact with the same mobile (or e-mail), and every lead of that customer the app shows this person
  const byPhone = useMemo(() => (id ? indexLeadsByPhone(leads) : null), [id, leads]);
  const contact = useMemo(() => {
    if (!lead) return null;
    const pk = phoneKeyOf(lead.phoneNumber); const em = String(lead.email || '').trim().toLowerCase();
    return contacts.find((c) => (pk && phoneKeyOf(c.phoneNumber) === pk) || (em && String(c.email || '').trim().toLowerCase() === em)) || null;
  }, [lead, contacts]);
  const customerLeads = useMemo(() => (lead && byPhone ? byPhone.get(phoneKeyOf(lead.phoneNumber)) || [lead] : []), [lead, byPhone]);

  if (!id) return null;
  const close = () => setId(null);
  const wa = lead ? waLink(lead.phoneNumber, lead.customerName) : '';
  const tabs: [Tab, string, React.ReactNode, boolean][] = [
    ['lead', 'Lead', <UserRound size={13} />, true], ['lara', 'Lara', <Bot size={13} />, laraUser], ['customer', `Customer${customerLeads.length > 1 ? ` · ${customerLeads.length} leads` : ''}`, <Users size={13} />, true],
    ['timeline', 'Timeline', <Clock size={13} />, true], ['plots', 'Plots & offers', <MapIcon size={13} />, true], ['history', 'Change history', <History size={13} />, true],
  ];
  const timeline = lead ? [
    ...(lead.timeline || []).map((t: any) => ({ ts: t.timestamp, who: t.user, title: t.title || t.type, text: t.description, type: t.type })),
    ...((lead as any).comments || []).filter((c: any) => !c.isPrivate).map((c: any) => ({ ts: c.timestamp || c.date, who: c.user || c.author, title: 'Comment', text: c.text || c.content, type: 'Comment' })),
  ].sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || ''))) : [];

  return (
    <div className="fixed inset-0 z-[70] flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-brand-black/40 backdrop-blur-xs" onClick={close} />
      <div className="relative w-full max-w-3xl h-full bg-[#F7F6F5] shadow-2xl flex flex-col animate-[slideIn_.18s_ease-out]">
        {!lead ? (
          <div className="p-6 space-y-3"><button onClick={close} className="float-right text-brand-gray"><X size={20} /></button><p className="text-sm text-brand-gray">This lead is not in your leads (or it was deleted).</p></div>
        ) : (
          <>
            <header className="bg-brand-black text-white px-5 py-4 space-y-2">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-mono text-brand-red/90 font-bold">{lead.id}</p>
                  <h3 className="font-extrabold text-lg leading-tight truncate" dir="auto">{lead.customerName || '—'}</h3>
                  <p className="text-[11px] text-white/70 flex flex-wrap gap-x-2">
                    <span className={`rounded-full px-2 py-0.5 font-bold ${statusClass(lead.status)}`}>{lead.status}</span>
                    <span>{lead.assignedSalespersonName || 'No owner'}</span><span>{lead.project || 'No park'}</span><span>{lead.source || ''}</span>
                  </p>
                </div>
                <button onClick={close} className="p-1.5 hover:bg-white/10 rounded-lg" aria-label="Close"><X size={20} /></button>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs font-bold">
                {lead.phoneNumber && <a href={`tel:${lead.phoneNumber}`} className="bg-white/10 hover:bg-white/20 rounded-xl px-3 py-1.5 flex items-center gap-1"><Phone size={13} />Call</a>}
                {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="bg-emerald-600 hover:bg-emerald-700 rounded-xl px-3 py-1.5 flex items-center gap-1"><MessageCircle size={13} />WhatsApp</a>}
                {lead.email && <a href={`mailto:${lead.email}`} className="bg-white/10 hover:bg-white/20 rounded-xl px-3 py-1.5 flex items-center gap-1"><Mail size={13} />E-mail</a>}
                {laraUser && <button onClick={() => setStart(true)} className="bg-brand-red hover:opacity-90 rounded-xl px-3 py-1.5 flex items-center gap-1"><Bot size={13} />Start with Lara</button>}
                <button onClick={() => { close(); crmNav.leadPage(lead.id); }} className="ml-auto text-white/70 hover:text-white rounded-xl px-2 py-1.5 flex items-center gap-1" title="Open on the Leads page"><ExternalLink size={13} />Leads page</button>
              </div>
            </header>
            <nav className="flex gap-1 px-3 border-b border-brand-gray/15 bg-white overflow-x-auto">
              {tabs.filter((t) => t[3]).map(([k, label, icon]) => (
                <button key={k} onClick={() => setTab(k)} className={`px-3 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 -mb-px flex items-center gap-1.5 ${tab === k ? 'border-brand-red text-brand-red' : 'border-transparent text-brand-gray hover:text-brand-black'}`}>{icon}{label}</button>
              ))}
            </nav>
            <div className="flex-1 overflow-y-auto p-4 text-xs">
              {tab === 'lead' && (
                <div className="space-y-4">
                  <LeadEditor lead={lead} auth={auth} actorName={user?.name || 'Agent'} actorId={user ? String(user.id) : undefined}
                    onSaved={() => bump((v) => v + 1)} onOpenLead={(x) => crmNav.lead(x)} />
                  {lead.description && <div><p className="text-[10px] font-extrabold text-brand-gray uppercase tracking-wider mb-1">Original inquiry</p><p dir="auto" className="bg-white border border-brand-gray/15 p-3 rounded-xl whitespace-pre-wrap break-words">{lead.description}</p></div>}
                </div>
              )}
              {tab === 'lara' && laraUser && <Suspense fallback={<Loader2 className="animate-spin text-brand-gray" />}><LaraLeadPanel lead={lead} isAdmin={seesAll} /></Suspense>}
              {tab === 'customer' && (contact
                ? <Customer360 contact={contact} leads={customerLeads} companies={companies} onBack={() => setTab('lead')} setActiveSubTab={(t) => { close(); setActiveSubTab(t); }} />
                : (
                  <div className="space-y-2">
                    <p className="text-brand-gray">No customer card with this mobile or e-mail yet. Leads with the same mobile:</p>
                    <ul className="bg-white rounded-2xl border border-brand-gray/15 divide-y divide-brand-gray/10">{customerLeads.map((l) => (
                      <li key={l.id}><button onClick={() => { setId(l.id); setTab('lead'); }} className={`w-full text-left px-3 py-2 hover:bg-brand-gray/5 ${l.id === lead.id ? 'bg-brand-red/5' : ''}`}><b className="font-mono text-brand-red">{l.id}</b> · {l.status} · {l.project || '—'} · {l.assignedSalespersonName || 'no owner'}</button></li>
                    ))}</ul>
                  </div>
                ))}
              {tab === 'timeline' && (timeline.length === 0 ? <p className="text-brand-gray">Nothing logged yet.</p> : (
                <ol className="space-y-2">{timeline.map((e, i) => (
                  <li key={i} className="bg-white border border-brand-gray/15 rounded-xl px-3 py-2">
                    <p className="flex flex-wrap gap-2 text-[11px]"><b>{e.title}</b><span className="text-brand-gray">{e.who || '—'}</span><span className="ml-auto text-brand-gray">{when(e.ts)}</span></p>
                    {e.text && <p dir="auto" className="whitespace-pre-line mt-0.5">{String(e.text).slice(0, 1200)}</p>}
                  </li>
                ))}</ol>
              ))}
              {tab === 'plots' && (!plots ? <Loader2 className="animate-spin text-brand-gray" /> : (
                <LeadPlotsPanel lead={lead} plots={plots} landBankUrl={landBankUrl} user={user?.name || 'User'}
                  onNavigateToInventory={() => { close(); setActiveSubTab('plots-inventory'); }}
                  onSave={(upd) => { try { crmService.updateLead(lead.id, upd, user?.name || 'User', { userId: user?.id != null ? String(user.id) : undefined }); bump((v) => v + 1); } catch (e: any) { toast.error(e?.message || 'Could not save.'); } }} />
              ))}
              {tab === 'history' && <LeadAuditHistory leadId={lead.id} version={String((lead as any)._rev || lead.lastUpdated)} />}
            </div>
          </>
        )}
      </div>
      {start && lead && <Suspense fallback={null}><StartWithLara lead={lead} onClose={() => setStart(false)} onDone={() => setTab('lara')} /></Suspense>}
    </div>
  );
};
