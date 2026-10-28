import { crmNav } from './crmNav';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle, FileText, Phone, Plus, Printer, Search, XCircle } from 'lucide-react';
import { Lead, TimelineEvent } from './types';
import { useAuth } from '../../services/AuthContext';
import { crmService } from './crmService';
import { OfferPrintsList } from './OfferPrintsList';
import { cairoDateISO } from '../../lib/cairoTime';

export interface CrmOffersProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string;
  setActiveSubTab?: (tab: string) => void;
}

const OFFER_FOLLOWUP_DAYS = 2; // calendar days (not working days)
const OFFER_STATUS = 'Offer Sent – Following Up';
const pad2 = (n: number) => String(n).padStart(2, '0');
const localISO = (d: Date) => cairoDateISO(d);
const addDays = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return localISO(d); };
const dayOf = (v?: string) => { if (!v) return ''; if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10); const d = new Date(v); return isNaN(d.getTime()) ? '' : localISO(d); };
const isOpenOffer = (l: Lead) => !!l.offerSent && l.status !== 'Won' && l.status !== 'Lost' && !l.mergedInto;
const dueOf = (l: Lead) => dayOf(l.offerDueDate) || dayOf(l.nextFollowUpDate);
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const PAGES = [25, 50, 100, 0];

type Filter = 'all' | 'overdue' | 'today' | 'waiting';

export const CrmOffers: React.FC<CrmOffersProps> = ({ leads, onLeadsUpdated, setActiveSubTab }) => {
  const { user } = useAuth();
  const who = user?.name || 'Agent';
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [followLead, setFollowLead] = useState<Lead | null>(null);
  const [fuNote, setFuNote] = useState('');
  const [fuDate, setFuDate] = useState('');
  const [markOpen, setMarkOpen] = useState(false);
  const [pickQ, setPickQ] = useState('');
  const [lbOpen, setLbOpen] = useState(false);
  const [lbLead, setLbLead] = useState('');
  const [sheetLead, setSheetLead] = useState<Lead | null>(null);
  const [sheet, setSheet] = useState({ client: '', project: '', area: '', price: '', plan: '', valid: '2 days' });

  useEffect(() => { const t = setTimeout(() => setDq(q.trim().toLowerCase()), 250); return () => clearTimeout(t); }, [q]);

  const today = localISO(new Date());
  const offers = useMemo(() => leads.filter(isOpenOffer).map((l) => {
    const due = dueOf(l);
    return { l, due, overdue: !!due && due < today, dueToday: due === today };
  }).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')), [leads, today]);

  const counts = useMemo(() => ({
    all: offers.length, overdue: offers.filter((o) => o.overdue).length,
    today: offers.filter((o) => o.dueToday).length, waiting: offers.filter((o) => !o.overdue && !o.dueToday).length,
  }), [offers]);

  const shown = useMemo(() => offers.filter((o) =>
    (filter === 'all' || (filter === 'overdue' && o.overdue) || (filter === 'today' && o.dueToday) || (filter === 'waiting' && !o.overdue && !o.dueToday)) &&
    (!dq || `${o.l.customerName} ${o.l.companyName || ''} ${o.l.id} ${o.l.phoneNumber} ${o.l.project}`.toLowerCase().includes(dq)),
  ), [offers, filter, dq]);

  const pages = size ? Math.max(1, Math.ceil(shown.length / size)) : 1;
  const cur = Math.min(page, pages - 1);
  const visible = size ? shown.slice(cur * size, cur * size + size) : shown;

  // leads that can receive "Mark offer sent": open, no offer yet (only searched when the panel is open)
  const candidates = useMemo(() => {
    if (!markOpen) return [];
    const k = pickQ.trim().toLowerCase();
    if (k.length < 2) return [];
    const out: Lead[] = [];
    for (const l of leads) {
      if (l.offerSent || l.mergedInto || l.status === 'Won' || l.status === 'Lost') continue;
      if (`${l.customerName} ${l.companyName || ''} ${l.id} ${l.phoneNumber}`.toLowerCase().includes(k)) { out.push(l); if (out.length >= 8) break; }
    }
    return out;
  }, [leads, markOpen, pickQ]);

  // Re-read the stored leads right before writing so other edits are not overwritten by a stale prop copy
  const patch = (id: string, fn: (l: Lead) => Lead) => {
    crmService.saveLeads(crmService.getLeads().map((l) => (l.id === id ? fn(l) : l)));
    onLeadsUpdated();
  };
  const event = (title: string, description: string): TimelineEvent => ({
    id: 'offer_' + Math.random().toString(36).slice(2, 10), timestamp: new Date().toISOString(), type: 'Comment', user: who, title, description,
  });

  const markSent = (lead: Lead) => {
    const due = addDays(OFFER_FOLLOWUP_DAYS);
    patch(lead.id, (l) => ({
      ...l, offerSent: true, offerDate: today, offerDueDate: due, status: OFFER_STATUS as Lead['status'],
      nextFollowUpDate: !l.nextFollowUpDate || l.nextFollowUpDate > due ? due : l.nextFollowUpDate,
      lastContactDate: today, lastUpdated: new Date().toISOString(),
      timeline: [...(l.timeline || []), event('Offer sent', `Offer marked as sent. Follow up by ${due} (${OFFER_FOLLOWUP_DAYS} calendar days).`)],
    }));
    toast.success(`Offer marked as sent for ${lead.customerName || lead.id}. Follow up by ${due}.`);
    setMarkOpen(false); setPickQ('');
  };

  const saveFollowUp = () => {
    if (!followLead) return;
    if (!fuDate) return toast.error('Choose the next follow-up date');
    if (fuDate < today) return toast.error('The next follow-up cannot be in the past');
    const note = fuNote.trim();
    patch(followLead.id, (l) => ({
      ...l, nextFollowUpDate: fuDate, offerDueDate: fuDate, lastContactDate: today, lastUpdated: new Date().toISOString(),
      timeline: [...(l.timeline || []), event('Offer follow-up', `${note || 'Followed up on the offer'}. Next follow-up ${fuDate}.`)],
    }));
    toast.success('Follow-up logged');
    setFollowLead(null); setFuNote('');
  };

  // Won needs a deal value, Lost needs a reason: the lead page already asks for both
  const openLead = (l: Lead) => {
    localStorage.setItem('selected_lead_id', l.id);
    localStorage.setItem('crm_selected_lead_id_from_notification', l.id);
    setActiveSubTab?.('leads');
  };

  const openSheet = (l: Lead) => {
    setSheetLead(l);
    setSheet({ client: l.companyName || l.customerName || '', project: l.project || '', area: String(l.requiredSize || '').replace(/[,\s]/g, ''), price: '', plan: 'Cash', valid: '2 days' });
  };
  const printSheet = () => {
    const area = Number(String(sheet.area).replace(/[,\s]/g, '')) || 0, price = Number(String(sheet.price).replace(/[,\s]/g, '')) || 0;
    const total = area && price ? `${Math.round(area * price).toLocaleString('en-US')} EGP` : '—';
    const row = (k: string, v: string) => `<tr><td>${esc(k)}</td><td>${esc(v || '—')}</td></tr>`;
    const html = `<!doctype html><meta charset="utf-8"><title>Offer summary</title><style>
      body{font:14px Arial,sans-serif;margin:40px;color:#111}h1{font-size:20px;border-bottom:3px solid #c8102e;padding-bottom:8px}
      table{border-collapse:collapse;width:100%;margin-top:16px}td{border:1px solid #ccc;padding:8px 10px}td:first-child{width:34%;background:#f5f5f5;font-weight:bold}
      p{color:#666;font-size:12px;margin-top:24px}</style>
      <h1>Offer summary</h1><table>${row('Client', sheet.client)}${row('Project', sheet.project)}${row('Area (sqm)', area ? area.toLocaleString('en-US') : '')}
      ${row('Price per sqm (EGP)', price ? price.toLocaleString('en-US') : '')}${row('Total value', total)}${row('Payment plan', sheet.plan)}
      ${row('Valid for', sheet.valid)}${row('Date', today)}${row('Prepared by', who)}</table>
      <p>Summary for discussion only. The signed commercial offer and reservation form prevail. Prices exclude VAT unless stated.</p>`;
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(f);
    f.srcdoc = html;
    f.onload = () => { try { f.contentWindow?.focus(); f.contentWindow?.print(); } finally { setTimeout(() => f.remove(), 3000); } };
  };

  const tabBtn = (k: Filter, label: string) => (
    <button key={k} onClick={() => { setFilter(k); setPage(0); }} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${filter === k ? 'bg-white shadow' : 'text-brand-gray'}`}>
      {label} <span className={k === 'overdue' && counts.overdue ? 'text-brand-red' : ''}>({counts[k]})</span>
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><FileText size={22} className="text-brand-red" /> Offers ({counts.all})</h2>
          <p className="text-sm text-brand-gray">Leads that have an offer and are not yet Won or Lost. Offers are chased within {OFFER_FOLLOWUP_DAYS} calendar days.</p>
        </div>
        <button onClick={() => setMarkOpen((v) => !v)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={14} /> Mark offer sent</button>
      </div>

      {markOpen && (
        <div className="bento-card space-y-3">
          <p className="text-sm font-semibold">Find the lead (name, company, phone or lead ID)</p>
          <input autoFocus className="input-field" placeholder="Type at least 2 characters" value={pickQ} onChange={(e) => setPickQ(e.target.value)} />
          {candidates.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 border-t border-black/5 pt-2">
              <div className="text-sm"><b>{l.customerName || '—'}</b> <span className="text-brand-gray">{l.companyName} · <button type="button" className="font-mono underline decoration-dotted underline-offset-2 hover:text-brand-red" title="Open this lead" onClick={() => crmNav.lead(l.id)}>{l.id}</button> · {l.project || '—'} · {l.status}</span></div>
              <button onClick={() => markSent(l)} className="px-3 py-1.5 rounded-lg bg-brand-red text-white text-xs font-bold">Mark sent</button>
            </div>
          ))}
          {pickQ.trim().length >= 2 && candidates.length === 0 && <p className="text-sm text-brand-gray">No open lead without an offer matches.</p>}
          <p className="text-xs text-brand-gray">Sets the offer date to today, the follow-up to {OFFER_FOLLOWUP_DAYS} calendar days from now and the status to "{OFFER_STATUS}".</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 p-1 rounded-xl bg-black/5">
          {tabBtn('all', 'All')}{tabBtn('overdue', 'Overdue')}{tabBtn('today', 'Due today')}{tabBtn('waiting', 'Waiting')}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-gray" />
          <input className="input-field !pl-9" placeholder="Search client, phone, ID, project" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
      </div>

      <div className="bento-card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b border-black/5 text-xs uppercase text-brand-gray">
            <th className="p-3">Lead</th><th className="p-3">Project</th><th className="p-3">Owner</th><th className="p-3">Offer date</th>
            <th className="p-3">Follow-up due</th><th className="p-3 text-right">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-black/5">
            {visible.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-brand-gray">No offers waiting for these filters.</td></tr>}
            {visible.map(({ l, due, overdue, dueToday }) => (
              <tr key={l.id} className={overdue ? 'bg-red-50/60' : ''}>
                <td className="p-3"><button onClick={() => openLead(l)} className="text-left hover:underline"><b>{l.customerName || '—'}</b></button>
                  <div className="text-xs text-brand-gray">{l.companyName ? `${l.companyName} · ` : ''}<button type="button" className="font-mono underline decoration-dotted underline-offset-2 hover:text-brand-red" title="Open this lead" onClick={() => crmNav.lead(l.id)}>{l.id}</button>{l.phoneNumber ? <> · <Phone size={10} className="inline" /> {l.phoneNumber}</> : ''}</div></td>
                <td className="p-3">{l.project || '—'}</td>
                <td className="p-3">{l.assignedSalespersonName || '—'}</td>
                <td className="p-3 whitespace-nowrap">{dayOf(l.offerDate) || '—'}</td>
                <td className="p-3 whitespace-nowrap">{due || '—'}
                  {overdue && <span className="ml-2 px-2 py-0.5 rounded-lg bg-brand-red/10 text-brand-red text-[10px] font-bold uppercase inline-flex items-center gap-1"><AlertCircle size={10} /> Overdue</span>}
                  {dueToday && <span className="ml-2 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700 text-[10px] font-bold uppercase">Today</span>}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button onClick={() => { setFollowLead(l); setFuDate(addDays(OFFER_FOLLOWUP_DAYS)); setFuNote(''); }} className="px-2 py-1 rounded-lg border border-black/10 text-xs font-semibold mr-1">Log follow-up</button>
                  <button onClick={() => openSheet(l)} title="Printable offer summary" className="p-1.5 text-brand-gray hover:text-brand-black"><Printer size={15} /></button>
                  <button onClick={() => openLead(l)} title="Open the lead to mark it Won (needs the deal value)" className="p-1.5 text-emerald-600"><CheckCircle size={17} /></button>
                  <button onClick={() => openLead(l)} title="Open the lead to mark it Lost (needs a reason)" className="p-1.5 text-brand-red"><XCircle size={17} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-brand-gray">
        <div className="flex items-center gap-2">Rows
          <select className="input-field !w-auto !py-1" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
            {PAGES.map((p) => <option key={p} value={p}>{p || 'All'}</option>)}
          </select>
        </div>
        {size > 0 && pages > 1 && (
          <div className="flex items-center gap-2">
            <button disabled={cur === 0} onClick={() => setPage(cur - 1)} className="px-3 py-1 rounded-lg border border-black/10 disabled:opacity-40">Prev</button>
            <span>{cur + 1} / {pages}</span>
            <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="px-3 py-1 rounded-lg border border-black/10 disabled:opacity-40">Next</button>
          </div>
        )}
      </div>

      {followLead && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setFollowLead(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg">Log follow-up · {followLead.customerName || followLead.id}</h3>
            <textarea className="input-field" rows={3} placeholder="What did the client say?" value={fuNote} onChange={(e) => setFuNote(e.target.value)} />
            <label className="text-xs text-brand-gray">Next follow-up date</label>
            <input type="date" min={today} className="input-field" value={fuDate} onChange={(e) => setFuDate(e.target.value)} />
            <div className="flex justify-end gap-2"><button onClick={() => setFollowLead(null)} className="px-4 py-2 text-sm text-brand-gray">Cancel</button>
              <button onClick={saveFollowUp} className="btn-primary text-sm">Save</button></div>
          </div>
        </div>
      )}

      <div className="bento-card space-y-3">
        <button onClick={() => setLbOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
          <span className="text-sm font-bold flex items-center gap-2"><Printer size={15} className="text-brand-red" /> Printed in Land Bank</span>
          <span className="text-xs text-brand-gray">{lbOpen ? 'Hide' : 'Show'}</span>
        </button>
        {lbOpen && (
          <>
            <select className="input-field" value={lbLead} onChange={(e) => setLbLead(e.target.value)}>
              <option value="">Choose a lead with an open offer…</option>
              {offers.slice(0, 500).map(({ l }) => <option key={l.id} value={l.id}>{l.id} · {l.customerName || '—'}{l.companyName ? ` · ${l.companyName}` : ''}</option>)}
            </select>
            {lbLead ? <OfferPrintsList leadId={lbLead} compact /> : <p className="text-xs text-brand-gray">Offers printed from the Land Bank page are recorded on the lead and on the customer.</p>}
          </>
        )}
      </div>

      {sheetLead && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSheetLead(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg">Offer summary (print)</h3>
            {([['client', 'Client'], ['project', 'Project'], ['area', 'Area (sqm)'], ['price', 'Price per sqm (EGP)'], ['plan', 'Payment plan'], ['valid', 'Valid for']] as const).map(([k, label]) => (
              <input key={k} className="input-field" placeholder={label} aria-label={label} title={label} type={k === 'area' || k === 'price' ? 'number' : 'text'} value={sheet[k]} onChange={(e) => setSheet({ ...sheet, [k]: e.target.value })} />
            ))}
            <div className="flex justify-end gap-2"><button onClick={() => setSheetLead(null)} className="px-4 py-2 text-sm text-brand-gray">Close</button>
              <button onClick={printSheet} className="btn-primary text-sm">Print</button></div>
          </div>
        </div>
      )}
    </div>
  );
};
