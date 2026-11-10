import React, { Suspense, lazy, useMemo, useState } from 'react';
import { useAuth } from '../../services/AuthContext';
const LaraContactPanel = lazy(() => import('../lara/LaraLeadPanel').then((m) => ({ default: m.LaraContactPanel })));
import { Contact, Company, Lead } from './types';
import { normalizePhone } from './crmService';
import { channelOf, isOpenStatus, normSource, phoneIntl, statusStage, NO_CHANNEL } from './leadConfig';
import { statusClass } from './leadRules';
import { waCompose, waFill } from './waTemplates';
import { OfferPrintsList } from './OfferPrintsList';
import { ArrowLeft, Phone, Mail, MessageCircle, Building, Edit, Trash2, Users, TrendingUp, Clock, FileText, MapPin, Languages, History } from 'lucide-react';

export const phoneKeyOf = (v?: string) => normalizePhone(v || '');

/** One pass over all leads: contact phone key -> that contact's leads (no per-row scans). */
export function indexLeadsByPhone(leads: Lead[]): Map<string, Lead[]> {
  const m = new Map<string, Lead[]>();
  for (const l of leads) {
    const k = phoneKeyOf(l.phoneNumber);
    if (!k) continue;
    const a = m.get(k);
    if (a) a.push(l); else m.set(k, [l]);
  }
  return m;
}

export interface ContactAgg {
  total: number; open: number; won: number; lost: number;
  wonValue: number; lastActivity: string; firstDate: string;
  channels: string[]; sources: string[]; owners: string[];
}
export const EMPTY_AGG: ContactAgg = { total: 0, open: 0, won: 0, lost: 0, wonValue: 0, lastActivity: '', firstDate: '', channels: [], sources: [], owners: [] };

const dayOf = (s?: string) => (s || '').slice(0, 10);

export function aggregateLeads(ls: Lead[]): ContactAgg {
  if (!ls.length) return EMPTY_AGG;
  const ch = new Set<string>(), src = new Set<string>(), ow = new Set<string>();
  let open = 0, won = 0, lost = 0, wonValue = 0, last = '', first = '';
  for (const l of ls) {
    const st = statusStage(l.status);
    if (isOpenStatus(l.status)) open++;
    if (st === 'won') { won++; wonValue += Number(l.dealValue ?? l.totalSoldValue ?? 0) || 0; }
    if (st === 'lost') lost++;
    const c = channelOf(l); if (c !== NO_CHANNEL) ch.add(c);
    const s = normSource(l.source); if (s) src.add(s);
    const o = l.assignedSalespersonName || l.legacyOwnerName; if (o) ow.add(o);
    const la = dayOf(l.lastContactDate) > dayOf(l.lastUpdated) ? dayOf(l.lastContactDate) : dayOf(l.lastUpdated);
    if (la && la > last) last = la;
    const d = dayOf(l.date);
    if (d && (!first || d < first)) first = d;
  }
  return { total: ls.length, open, won, lost, wonValue, lastActivity: last, firstDate: first, channels: [...ch], sources: [...src], owners: [...ow] };
}

export const fmtEgp = (n: number) => n > 0 ? 'EGP ' + (n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : Math.round(n).toLocaleString('en-US')) : '—';
const dash = (v?: string | number | null) => (v === undefined || v === null || v === '' ? '—' : String(v));

export const waLink = (phone: string | undefined, name: string) => {
  const p = phoneIntl(phone).replace('+', '');
  if (!p) return '';
  const msg = waFill(waCompose('Follow-up'), { customerName: name }, '');
  return `https://wa.me/${p}?text=${encodeURIComponent(msg)}`;
};

type Tab = 'overview' | 'leads' | 'timeline' | 'offers' | 'company' | 'lara';

interface Props {
  contact: Contact;
  leads: Lead[];               // this contact's leads
  companies: Company[];
  onBack: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  setActiveSubTab?: (tab: string) => void;
}

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone = 'text-brand-black' }) => (
  <div className="bg-white border border-brand-gray/15 rounded-2xl p-4 shadow-sm">
    <div className="text-[10px] uppercase font-bold tracking-wider text-brand-gray">{label}</div>
    <div className={`text-xl font-black mt-1 ${tone}`}>{value}</div>
  </div>
);

const Chips: React.FC<{ items: string[] }> = ({ items }) => items.length
  ? <div className="flex flex-wrap gap-1.5">{items.map(i => <span key={i} className="px-2 py-0.5 rounded-full bg-brand-gray/10 text-brand-black text-[11px] font-semibold">{i}</span>)}</div>
  : <span className="text-brand-gray">—</span>;

export const Customer360: React.FC<Props> = ({ contact, leads, companies, onBack, onEdit, onDelete, setActiveSubTab }) => {
  const [tab, setTab] = useState<Tab>('overview');
  const { user, permissions } = useAuth();
  const laraUser = user?.role === 'Admin' || !!(permissions as any)?.canUseLara;
  const agg = useMemo(() => aggregateLeads(leads), [leads]);
  const sorted = useMemo(() => [...leads].sort((a, b) => (b.date || '').localeCompare(a.date || '')), [leads]);
  const company = useMemo(() => {
    const n = (contact.company || '').trim().toLowerCase();
    return n ? companies.find(c => (c.name || '').trim().toLowerCase() === n) : undefined;
  }, [contact.company, companies]);

  const timeline = useMemo(() => {
    const out: { ts: string; type: string; user: string; title: string; text: string; leadId: string; project: string }[] = [];
    for (const l of leads) {
      for (const t of l.timeline || []) out.push({ ts: t.timestamp || '', type: t.type, user: t.user, title: t.title, text: t.description, leadId: l.id, project: l.project });
      for (const c of l.comments || []) {
        if (c.isPrivate) continue;
        out.push({ ts: `${c.date || ''}${c.time ? 'T' + c.time : ''}`, type: 'Note', user: c.user, title: 'Note', text: c.comment, leadId: l.id, project: l.project });
      }
    }
    return out.sort((a, b) => b.ts.localeCompare(a.ts));
  }, [leads]);
  const [tlShown, setTlShown] = useState(50);

  const openLead = (id: string) => { try { localStorage.setItem('selected_lead_id', id); } catch { /* ignore */ } setActiveSubTab?.('leads'); };
  const openCompany = () => {
    try {
      if (company) localStorage.setItem('selected_company_id', company.id);
      localStorage.setItem('selected_crm_company_name', company?.name || contact.company || '');
    } catch { /* ignore */ }
    setActiveSubTab?.('companies');
  };
  const wa = waLink(contact.phoneNumber, contact.name);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'leads', label: 'Leads', count: leads.length },
    { id: 'timeline', label: 'Timeline', count: timeline.length },
    { id: 'offers', label: 'Offers' },
    { id: 'company', label: 'Company' },
    ...(laraUser ? [{ id: 'lara' as Tab, label: 'Lara interactions' }] : []),
  ];

  return (
    <div className="space-y-5" id="customer-360">
      <button onClick={onBack} className="inline-flex items-center gap-2 bg-white hover:bg-brand-gray/5 border border-brand-gray/25 text-brand-black px-4 py-2 rounded-xl text-xs font-bold shadow-sm">
        <ArrowLeft size={14} /> Back to contacts
      </button>

      <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-14 h-14 shrink-0 rounded-full bg-brand-red text-white flex items-center justify-center font-black text-2xl">{(contact.name || '?').charAt(0).toUpperCase()}</div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-black text-brand-black truncate">{contact.name}</h3>
              <span className="font-mono text-[10px] text-brand-red bg-brand-red/10 px-2 py-0.5 rounded font-bold">{contact.serialNumber || '—'}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${contact.status === 'Inactive' ? 'bg-brand-gray/15 text-brand-gray' : 'bg-emerald-100 text-emerald-800'}`}>{contact.status || 'Active'}</span>
            </div>
            <p className="text-xs text-brand-gray mt-0.5">{[contact.jobTitle, contact.company].filter(Boolean).join(' · ') || 'Private customer'}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-brand-black font-semibold">
              <span className="font-mono">{dash(contact.phoneNumber)}</span>
              <span>{dash(contact.email)}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {contact.phoneNumber && <a href={`tel:${contact.phoneNumber}`} className="px-3 py-2 rounded-xl bg-brand-black text-white text-xs font-bold flex items-center gap-1.5"><Phone size={13} /> Call</a>}
          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5"><MessageCircle size={13} /> WhatsApp</a>}
          {contact.email && <a href={`mailto:${contact.email}`} className="px-3 py-2 rounded-xl bg-white border border-brand-gray/25 text-brand-black text-xs font-bold flex items-center gap-1.5"><Mail size={13} /> Email</a>}
          {onEdit && <button onClick={onEdit} className="px-3 py-2 rounded-xl bg-brand-red/10 hover:bg-brand-red/20 text-brand-red text-xs font-bold flex items-center gap-1.5"><Edit size={13} /> Edit</button>}
          {onDelete && <button onClick={onDelete} className="px-3 py-2 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs font-bold flex items-center gap-1.5"><Trash2 size={13} /> Delete</button>}
        </div>
      </div>

      <div className="flex gap-1 border-b border-brand-gray/15 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 -mb-px transition-all ${tab === t.id ? 'border-brand-red text-brand-red' : 'border-transparent text-brand-gray hover:text-brand-black'}`}>
            {t.label}{t.count !== undefined && <span className="ml-1.5 text-[10px] bg-brand-gray/10 px-1.5 py-0.5 rounded-full">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Stat label="Leads" value={agg.total} />
            <Stat label="Open" value={agg.open} tone="text-blue-700" />
            <Stat label="Won" value={agg.won} tone="text-emerald-700" />
            <Stat label="Lost" value={agg.lost} tone="text-rose-600" />
            <Stat label="Total won value" value={fmtEgp(agg.wonValue)} tone="text-brand-red" />
            <Stat label="Last activity" value={<span className="text-base">{dash(agg.lastActivity)}</span>} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 space-y-3 text-xs">
              <h5 className="text-[10px] uppercase font-bold text-brand-gray tracking-widest flex items-center gap-1.5"><TrendingUp size={12} className="text-brand-red" /> Engagement</h5>
              <div className="flex justify-between"><span className="text-brand-gray font-semibold">First contact</span><span className="font-mono font-bold">{dash(agg.firstDate)}</span></div>
              <div className="flex justify-between"><span className="text-brand-gray font-semibold">Last contact</span><span className="font-mono font-bold">{dash(agg.lastActivity)}</span></div>
              <div className="space-y-1"><span className="text-brand-gray font-semibold">Channels</span><Chips items={agg.channels} /></div>
              <div className="space-y-1"><span className="text-brand-gray font-semibold">Sources</span><Chips items={agg.sources} /></div>
              <div className="space-y-1"><span className="text-brand-gray font-semibold">Assigned salespeople</span><Chips items={agg.owners} /></div>
            </div>
            <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 space-y-3 text-xs">
              <h5 className="text-[10px] uppercase font-bold text-brand-gray tracking-widest flex items-center gap-1.5"><Users size={12} className="text-brand-red" /> Profile</h5>
              {([
                ['Alternative number', contact.alternativeNumber],
                ['Department', contact.department],
                ['Industry', contact.industry],
                ['Location', [contact.city, contact.country].filter(Boolean).join(', ')],
                ['Nationality', contact.nationality],
                ['Preferred contact', contact.preferredCommunication],
                ['Language', contact.preferredLanguage],
                ['Registered', contact.createdDate],
              ] as [string, string | undefined][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><span className="text-brand-gray font-semibold">{k}</span><span className="font-semibold text-brand-black text-right">{dash(v)}</span></div>
              ))}
            </div>
          </div>
          {(contact.editLogs?.length || 0) > 0 && (
            <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 space-y-2 text-xs">
              <h5 className="text-[10px] uppercase font-bold text-brand-gray tracking-widest flex items-center gap-1.5"><History size={12} className="text-brand-red" /> Profile change log ({contact.editLogs!.length})</h5>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {[...contact.editLogs!].reverse().map((log, i) => (
                  <div key={`${log.id}-${i}`} className="text-[11px] bg-brand-gray/5 rounded-xl px-3 py-2">
                    <span className="font-bold">{log.user}</span> · {new Date(log.timestamp).toLocaleString()} — <strong className="text-brand-red">{log.field}</strong>: "{log.from}" → "{log.to}"
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'leads' && (
        <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="bg-brand-gray/5 border-b border-brand-gray/15 text-brand-gray text-[10px] font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Lead</th><th className="py-3 px-3">Date</th><th className="py-3 px-3">Status</th><th className="py-3 px-3">Project</th><th className="py-3 px-3">Channel / source</th><th className="py-3 px-3">Owner</th><th className="py-3 px-3 text-right">Deal value</th>
              </tr></thead>
              <tbody className="divide-y divide-brand-gray/10">
                {sorted.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-brand-gray">No leads for this customer.</td></tr>}
                {sorted.map(l => (
                  <tr key={l.id} onClick={() => openLead(l.id)} className="hover:bg-brand-gray/5 cursor-pointer">
                    <td className="py-3 px-4 font-mono font-bold text-brand-red">{l.id}</td>
                    <td className="py-3 px-3 font-mono text-brand-gray">{dash(dayOf(l.date))}</td>
                    <td className="py-3 px-3"><span className={`px-2 py-0.5 rounded-full text-[10px] ${statusClass(l.status)}`}>{l.status}</span></td>
                    <td className="py-3 px-3 font-semibold">{dash(l.project)}</td>
                    <td className="py-3 px-3">{channelOf(l)}{l.source ? <span className="text-brand-gray"> · {normSource(l.source)}</span> : null}</td>
                    <td className="py-3 px-3">{dash(l.assignedSalespersonName || l.legacyOwnerName)}</td>
                    <td className="py-3 px-3 text-right font-mono">{statusStage(l.status) === 'won' ? fmtEgp(Number(l.dealValue ?? l.totalSoldValue ?? 0)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'timeline' && (
        <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5">
          {timeline.length === 0 ? <p className="text-center py-8 text-brand-gray text-xs">No timeline entries yet.</p> : (
            <ol className="relative border-l-2 border-brand-gray/15 ml-2 space-y-4">
              {timeline.slice(0, tlShown).map((t, i) => (
                <li key={i} className="pl-5 relative">
                  <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-brand-red border-2 border-white" />
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-brand-gray font-semibold">
                    <Clock size={11} /><span className="font-mono">{t.ts ? t.ts.replace('T', ' ').slice(0, 16) : '—'}</span>
                    <span className="px-1.5 py-0.5 rounded bg-brand-gray/10 text-brand-black">{t.type}</span>
                    <button onClick={() => openLead(t.leadId)} className="font-mono text-brand-red hover:underline">{t.leadId}</button>
                    <span>{dash(t.project)}</span><span>· {dash(t.user)}</span>
                  </div>
                  <div className="text-xs font-bold text-brand-black mt-0.5">{t.title}</div>
                  {t.text && <p className="text-xs text-brand-black/80 whitespace-pre-line leading-relaxed">{t.text}</p>}
                </li>
              ))}
            </ol>
          )}
          {timeline.length > tlShown && <button onClick={() => setTlShown(n => n + 50)} className="mt-4 px-4 py-2 rounded-xl bg-brand-gray/10 text-xs font-bold">Show more ({timeline.length - tlShown} left)</button>}
        </div>
      )}

      {tab === 'offers' && (
        <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-3">
          <OfferPrintsList contactId={contact.id} />
        </div>
      )}

      {tab === 'lara' && laraUser && <Suspense fallback={null}><LaraContactPanel leadIds={leads.map((l) => l.id)} /></Suspense>}

      {tab === 'company' && (
        <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 text-xs space-y-3">
          {!contact.company ? <p className="text-brand-gray py-6 text-center">Private customer — no company linked.</p> : (
            <>
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-base font-black flex items-center gap-2"><Building size={16} className="text-brand-red" /> {contact.company}</h4>
                {setActiveSubTab && <button onClick={openCompany} className="px-3 py-2 rounded-xl bg-brand-red text-white text-xs font-bold">Open in Corporate Accounts</button>}
              </div>
              {company ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">
                  {([['Industry', company.industry], ['City', company.city], ['Address', company.address], ['Website', company.website], ['Commercial registration', company.commercialRegistration], ['Tax number', company.taxNumber], ['Account manager', company.assignedAccountManager]] as [string, string | undefined][]).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 border-b border-brand-gray/5 pb-1.5"><span className="text-brand-gray font-semibold flex items-center gap-1">{k === 'City' && <MapPin size={11} />}{k}</span><span className="font-semibold text-right">{dash(v)}</span></div>
                  ))}
                </div>
              ) : <p className="text-brand-gray">No company record with this name yet.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
};
