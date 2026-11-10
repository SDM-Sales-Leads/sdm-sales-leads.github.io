// Lara — phase 5: initial offers (PDF at Land Bank list prices, approve first). No AI.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Loader2, Search, Download, CheckSquare, Square, Send } from 'lucide-react';
import type { Lead } from '../crm/types';
import { crmNav } from '../crm/crmNav';

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api${path}`, init ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const egp = (n: number | null | undefined) => (n == null ? '—' : `EGP ${Math.round(n).toLocaleString('en-US')}`);
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** opens the offer PDF (the same file that is attached when the offer is sent) */
export async function openOfferPdf(draftId: string, ref = 'offer') {
  try {
    const r = await fetch(`/api/lara/offers/${draftId}/pdf`);
    if (!r.ok) throw new Error('The PDF could not be made');
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = `${ref}.pdf`; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e: any) { toast.error(e.message); }
}

export const LaraOffers: React.FC<{ leads: Lead[]; reload: () => void; go: (t: string) => void }> = ({ leads, reload, go }) => {
  const [q, setQ] = useState('');
  const [leadId, setLeadId] = useState('');
  const [cand, setCand] = useState<any>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const loadRows = useCallback(async () => { try { setRows((await api('/lara/offers')).rows); } catch (e: any) { toast.error(e.message); setRows([]); } }, []);
  useEffect(() => { void loadRows(); }, [loadRows]);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase(); if (t.length < 2) return [];
    return leads.filter((l) => `${l.id} ${l.customerName} ${l.companyName} ${l.email}`.toLowerCase().includes(t)).slice(0, 8);
  }, [q, leads]);
  const choose = async (id: string) => {
    setLeadId(id); setQ(''); setCand(null); setBusy(true);
    try { const c = await api(`/lara/offers/candidates?leadId=${encodeURIComponent(id)}`); setCand(c); setPick(new Set(c.suggested)); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const total = useMemo(() => (cand?.plots || []).filter((p: any) => pick.has(p.key)).reduce((s: number, p: any) => s + (p.listTotal || 0), 0), [cand, pick]);
  const prepare = async () => {
    setBusy(true);
    try {
      const r = await api('/lara/offers', { method: 'POST', body: JSON.stringify({ leadId, plotKeys: [...pick], validDays: days }) });
      toast.success(`Offer ${r.offer.ref} prepared. Check the PDF, then approve it in Drafts.`);
      setCand(null); setLeadId(''); void loadRows(); reload();
      void openOfferPdf(r.draftId, r.offer.ref);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid lg:grid-cols-5 gap-5">
      <section className="lg:col-span-2 bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-3">
        <h3 className="font-extrabold text-sm flex items-center gap-2"><FileText size={16} className="text-brand-red" />New initial offer</h3>
        <p className="text-xs text-brand-gray">Lara builds a one-page PDF from the Land Bank plots at <b>list prices</b> (never a discount or a deal price) with a cover e-mail in the customer's language. It waits in Drafts until a person approves it; before sending she checks again that every plot is still available.</p>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-brand-gray" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find the lead: number, name, company, e-mail" className="input-field w-full pl-8 text-sm" />
          {matches.length > 0 && (
            <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-brand-gray/20 rounded-xl shadow-lg max-h-64 overflow-y-auto">
              {matches.map((l) => <li key={l.id}><button onClick={() => choose(l.id)} className="w-full text-left px-3 py-2 text-xs hover:bg-brand-gray/5"><b>{l.customerName || l.id}</b> · {l.id} · {l.project || '—'}{l.email ? '' : ' · no e-mail'}</button></li>)}
            </ul>
          )}
        </div>
        {busy && !cand && <Loader2 className="animate-spin text-brand-gray" />}
        {cand && (
          <div className="space-y-2">
            <div className="text-xs bg-brand-gray/5 rounded-xl p-3">
              <p className="font-bold text-brand-black">{cand.lead.customer || cand.lead.id} <span className="font-normal text-brand-gray">· {cand.lead.id}</span></p>
              <p className="text-brand-gray">{cand.lead.company || '—'} · {cand.lead.project || 'no park'} · asked {cand.lead.requiredSize || '—'} m² · owner {cand.lead.owner || '—'}</p>
              {!cand.lead.email && <p className="text-rose-700 font-bold mt-1">This lead has no e-mail address: add one on the lead first.</p>}
            </div>
            {cand.plots.length === 0 ? <p className="text-xs text-amber-800">No available plot in this park and size range. Check the lead's park and size.</p> : (
              <ul className="max-h-72 overflow-y-auto divide-y divide-brand-gray/10 border border-brand-gray/10 rounded-xl">
                {cand.plots.map((p: any) => {
                  const on = pick.has(p.key);
                  return (
                    <li key={p.key}><button onClick={() => { const n = new Set(pick); on ? n.delete(p.key) : n.size < 10 && n.add(p.key); setPick(n); }} className={`w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 ${on ? 'bg-brand-red/5' : ''}`}>
                      {on ? <CheckSquare size={14} className="text-brand-red shrink-0" /> : <Square size={14} className="text-brand-gray shrink-0" />}
                      <span className="flex-1"><b>{p.unit}</b> · {p.park} · {p.sector || '—'} · {Math.round(p.areaSqm).toLocaleString('en-US')} m²{cand.assigned.includes(p.key) ? ' · chosen on the lead' : ''}</span>
                      <span className="text-brand-gray whitespace-nowrap">{egp(p.listTotal)}</span>
                    </button></li>
                  );
                })}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span>{pick.size} plot{pick.size === 1 ? '' : 's'} · list total {egp(total)}</span>
              <label className="ml-auto flex items-center gap-1">Valid for <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} className="input-field w-16 text-xs" /> days</label>
            </div>
            <button onClick={prepare} disabled={busy || !pick.size || !cand.lead.email} className="btn-primary w-full rounded-xl py-2 text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}Prepare offer (PDF)</button>
          </div>
        )}
      </section>

      <section className="lg:col-span-3 bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-extrabold text-sm flex items-center gap-2"><Send size={16} className="text-brand-red" />Offers by Lara</h3><button onClick={() => go('lara-inbox')} className="text-xs font-bold text-brand-red">Approve in Drafts</button></div>
        {rows === null ? <Loader2 className="animate-spin text-brand-gray" /> : rows.length === 0 ? <p className="text-sm text-brand-gray py-4 text-center">No offers yet.</p> : (
          <ul className="divide-y divide-brand-gray/10">
            {rows.map((r) => (
              <li key={r.id} className="py-2.5 text-xs flex flex-wrap items-start gap-2">
                <div className="flex-1 min-w-0">
                  <button onClick={() => crmNav.lead(r.lead_id)} className="font-bold text-sm text-brand-black hover:text-brand-red">{r.customer}</button>
                  <p className="text-brand-gray">{r.offer?.ref} · {r.offer?.plots?.length || 0} plot(s): {(r.offer?.plots || []).map((p: any) => p.unit).join(', ')} · {egp(r.offer?.total)} · valid until {r.offer?.validUntil}</p>
                  <p className="text-brand-gray">{r.owner_name || '—'} · prepared {when(r.created_at)}{r.sent_at ? ` · sent ${when(r.sent_at)}` : ''}{r.send_error && r.send_status !== 'sent' ? ` · ${r.send_error}` : ''}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 font-bold ${r.send_status === 'sent' ? 'bg-emerald-100 text-emerald-800' : r.status === 'rejected' ? 'bg-rose-100 text-rose-800' : r.status === 'expired' ? 'bg-brand-gray/10' : 'bg-amber-100 text-amber-800'}`}>{r.send_status === 'sent' ? 'Sent' : r.status === 'shadow' ? 'Waiting for approval' : r.send_status === 'queued' ? 'Queued' : r.send_status === 'failed' ? 'Not sent' : r.status}</span>
                <button onClick={() => openOfferPdf(r.id, r.offer?.ref)} className="btn-secondary rounded-lg px-2 py-1 font-bold flex items-center gap-1"><Download size={12} />PDF</button>
                {r.status === 'shadow' && <button onClick={async () => { try { await api(`/lara/offers/${r.id}/test-copy`, { method: 'POST', body: '{}' }); toast.success('Test copy sent to your own e-mail'); } catch (e: any) { toast.error(e.message); } }} className="btn-secondary rounded-lg px-2 py-1 font-bold">Test copy to me</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
