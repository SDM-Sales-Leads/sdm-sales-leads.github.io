// Lara — offers in the Land Bank "Sales Offer" format. No AI.
// Prices: the customer sees the real price + 20% (list price); a discount % can be given and is printed as its own line, never below
// the real price. The REAL price is shown here (inside the system) and never in the PDF or the e-mail.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Loader2, Search, Download, CheckSquare, Square, Send, Lock, Percent } from 'lucide-react';
import type { Lead } from '../crm/types';
import { crmNav } from '../crm/crmNav';

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api${path}`, init ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const post = (p: string, b: any) => api(p, { method: 'POST', body: JSON.stringify(b) });
const egp = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `EGP ${Math.round(n).toLocaleString('en-US')}`);
const num = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US'));
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const TYPES = ['Monthly', 'Every 2 Months', 'Quarterly', 'Semi-Annually', 'Annually'];

/** opens the offer PDF (the same file that is attached when the offer is sent) */
export async function openOfferPdf(draftId: string, ref = 'offer') {
  try {
    const r = await fetch(`/api/lara/offers/${draftId}/pdf`);
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error || 'The PDF could not be made'); }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = `${ref}.pdf`; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e: any) { toast.error(e.message); }
}

/** the price summary: real (internal) vs. what the customer sees */
const PriceBox: React.FC<{ o: any }> = ({ o }) => {
  if (!o?.listSqm) return null;
  const plan = o.mode === 'plan' && o.planOut;
  return (
    <div className="rounded-xl border border-brand-gray/15 text-xs overflow-hidden">
      <div className="bg-brand-black text-white px-3 py-2 flex items-center gap-2"><Lock size={12} /><span>Real price (internal, never printed): <b>{num(o.realSqm)} EGP/m²</b> · {egp(o.realTotal)}</span></div>
      <div className="p-3 space-y-1">
        <p>Customer list price (+{o.markupPct}%): <b>{num(o.listSqm)} EGP/m²</b> · {egp(o.listTotal)}</p>
        {o.discountPct > 0 && <p className="text-rose-700">Special discount {o.discountPct}%: <b>{num(o.netSqm)} EGP/m²</b> · {egp(o.netTotal)}</p>}
        {plan && <p>With instalments ({o.plan.adv}% advance, {o.planOut.n} × {o.planOut.label.toLowerCase()} over {o.planOut.years} y, {o.plan.rate}% interest): <b>{egp(o.due)}</b> · {num(o.due / o.area)} EGP/m²</p>}
        <p className="pt-1 border-t border-brand-gray/10">Customer pays: <b className="text-brand-red text-sm">{egp(o.due)}</b> · above real price by <b>{egp(o.netTotal - o.realTotal)}</b> on the cash value · max discount {o.maxDiscountPct}%</p>
      </div>
    </div>
  );
};

/** cash / instalments + discount controls */
const Terms: React.FC<{ v: any; set: (v: any) => void; maxDisc?: number }> = ({ v, set, maxDisc }) => (
  <div className="space-y-2 text-xs">
    <div className="flex rounded-xl border border-brand-gray/20 overflow-hidden font-bold w-fit">
      <button onClick={() => set({ ...v, mode: 'cash' })} className={`px-3 py-1.5 ${v.mode === 'cash' ? 'bg-brand-red text-white' : ''}`}>Cash</button>
      <button onClick={() => set({ ...v, mode: 'plan' })} className={`px-3 py-1.5 ${v.mode === 'plan' ? 'bg-brand-red text-white' : ''}`}>Instalments</button>
    </div>
    {v.mode === 'plan' && (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label>Payment type<select value={v.plan.type} onChange={(e) => set({ ...v, plan: { ...v.plan, type: e.target.value } })} className="input-field w-full text-xs mt-0.5">{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>Advance %<input type="number" value={v.plan.adv} onChange={(e) => set({ ...v, plan: { ...v.plan, adv: Number(e.target.value) } })} className="input-field w-full text-xs mt-0.5" /></label>
        <label>Years<input type="number" value={v.plan.years} onChange={(e) => set({ ...v, plan: { ...v.plan, years: Number(e.target.value) } })} className="input-field w-full text-xs mt-0.5" /></label>
        <label>Interest % / year<input type="number" value={v.plan.rate} onChange={(e) => set({ ...v, plan: { ...v.plan, rate: Number(e.target.value) } })} className="input-field w-full text-xs mt-0.5" /></label>
      </div>
    )}
    <label className="flex items-center gap-2"><Percent size={13} className="text-rose-600" />Special discount<input type="number" step="0.5" min={0} max={maxDisc ?? 100} value={v.discountPct} onChange={(e) => set({ ...v, discountPct: Number(e.target.value) })} className="input-field w-20 text-xs" />%{maxDisc != null && <span className="text-brand-gray">(0–{maxDisc}%, never below the real price)</span>}</label>
  </div>
);

export const LaraOffers: React.FC<{ leads: Lead[]; reload: () => void; go: (t: string) => void }> = ({ leads, reload, go }) => {
  const [q, setQ] = useState('');
  const [leadId, setLeadId] = useState('');
  const [cand, setCand] = useState<any>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [terms, setTerms] = useState<any>({ mode: 'cash', discountPct: 0, plan: { type: 'Quarterly', adv: 30, years: 3, rate: 23 } });
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const loadRows = useCallback(async () => { try { setRows((await api('/lara/offers')).rows); } catch (e: any) { toast.error(e.message); setRows([]); } }, []);
  useEffect(() => { void loadRows(); }, [loadRows]);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase(); if (t.length < 2) return [];
    return leads.filter((l) => `${l.id} ${l.customerName} ${l.companyName} ${l.email}`.toLowerCase().includes(t)).slice(0, 8);
  }, [q, leads]);
  const choose = async (id: string) => {
    setLeadId(id); setQ(''); setCand(null); setPreview(null); setBusy(true);
    try { const c = await api(`/lara/offers/candidates?leadId=${encodeURIComponent(id)}`); setCand(c); setPick(new Set(c.suggested)); setTerms((t: any) => ({ ...t, plan: { ...c.planDefault } })); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  // live preview of the prices (server computes, same as the PDF)
  useEffect(() => {
    if (!leadId || !pick.size) { setPreview(null); return; }
    const t = setTimeout(async () => { try { setPreview((await post('/lara/offers/preview', { leadId, plotKeys: [...pick], ...terms })).offer); } catch (e: any) { setPreview({ error: e.message }); } }, 350);
    return () => clearTimeout(t);
  }, [leadId, pick, terms]);
  const prepare = async () => {
    setBusy(true);
    try {
      const r = await post('/lara/offers', { leadId, plotKeys: [...pick], ...terms });
      toast.success(`Offer ${r.offer.ref} prepared. Check the PDF; it waits in Drafts (Lara is on hold: nothing is sent).`);
      setCand(null); setLeadId(''); setPreview(null); void loadRows(); reload();
      void openOfferPdf(r.draftId, r.offer.ref);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid lg:grid-cols-5 gap-5">
      <section className="lg:col-span-2 bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-3">
        <h3 className="font-extrabold text-sm flex items-center gap-2"><FileText size={16} className="text-brand-red" />New offer (Land Bank format)</h3>
        <p className="text-xs text-brand-gray">The same Sales Offer as the Land Bank (park colours, logo, notes, fees, signatures). The customer sees the <b>real price +20%</b>; a special discount is printed as its own line and can never go below the real price. The real price stays inside the system.</p>
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
          <div className="space-y-3">
            <div className="text-xs bg-brand-gray/5 rounded-xl p-3">
              <p className="font-bold text-brand-black">{cand.lead.customer || cand.lead.id} <span className="font-normal text-brand-gray">· {cand.lead.id}</span></p>
              <p className="text-brand-gray">{cand.lead.company || '—'} · {cand.lead.project || 'no park'} · asked {cand.lead.requiredSize || '—'} m² · owner {cand.lead.owner || '—'}</p>
              {!cand.lead.email && <p className="text-rose-700 font-bold mt-1">This lead has no e-mail address: add one on the lead first.</p>}
            </div>
            {cand.plots.length === 0 ? <p className="text-xs text-amber-800">No available plot in this park and size range. Check the lead's park and size.</p> : (
              <ul className="max-h-60 overflow-y-auto divide-y divide-brand-gray/10 border border-brand-gray/10 rounded-xl">
                {cand.plots.map((p: any) => {
                  const on = pick.has(p.key);
                  return (
                    <li key={p.key}><button onClick={() => { const n = new Set(pick); on ? n.delete(p.key) : n.size < 10 && n.add(p.key); setPick(n); }} className={`w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 ${on ? 'bg-brand-red/5' : ''}`}>
                      {on ? <CheckSquare size={14} className="text-brand-red shrink-0" /> : <Square size={14} className="text-brand-gray shrink-0" />}
                      <span className="flex-1"><b>{p.unit}</b> · {p.park} · {Math.round(p.areaSqm).toLocaleString('en-US')} m²{cand.assigned.includes(p.key) ? ' · chosen on the lead' : ''}</span>
                      <span className="text-brand-gray whitespace-nowrap" title="Real list price (internal)">{p.listPriceSqm ? `${num(p.listPriceSqm)}/m²` : 'no price'}</span>
                    </button></li>
                  );
                })}
              </ul>
            )}
            <Terms v={terms} set={setTerms} maxDisc={preview?.maxDiscountPct} />
            {preview?.error ? <p className="text-xs text-rose-700">{preview.error}</p> : <PriceBox o={preview} />}
            <button onClick={prepare} disabled={busy || !pick.size || !cand.lead.email || !!preview?.error} className="btn-primary w-full rounded-xl py-2 text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}Prepare offer (PDF)</button>
          </div>
        )}
      </section>

      <section className="lg:col-span-3 bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-extrabold text-sm flex items-center gap-2"><Send size={16} className="text-brand-red" />Offers by Lara</h3><button onClick={() => go('lara-inbox')} className="text-xs font-bold text-brand-red">Approve in Drafts</button></div>
        {rows === null ? <Loader2 className="animate-spin text-brand-gray" /> : rows.length === 0 ? <p className="text-sm text-brand-gray py-4 text-center">No offers yet.</p> : (
          <ul className="divide-y divide-brand-gray/10">{rows.map((r) => <OfferRow key={r.id} r={r} onChanged={loadRows} />)}</ul>
        )}
      </section>
    </div>
  );
};

const OfferRow: React.FC<{ r: any; onChanged: () => void }> = ({ r, onChanged }) => {
  const o = r.offer || {};
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<any>({ mode: o.mode || 'cash', discountPct: o.discountPct || 0, plan: o.plan || { type: 'Quarterly', adv: 30, years: 3, rate: 23 } });
  const [busy, setBusy] = useState(false);
  const waiting = r.status === 'shadow';
  const save = async () => { setBusy(true); try { await post(`/lara/offers/${r.id}/update`, v); toast.success('Offer updated'); setOpen(false); onChanged(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  return (
    <li className="py-2.5 text-xs space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-0">
          <button onClick={() => crmNav.lead(r.lead_id)} className="font-bold text-sm text-brand-black hover:text-brand-red">{r.customer}</button>
          <p className="text-brand-gray">{o.ref} · {o.project || ''} · {(o.plots || []).map((p: any) => p.unit).join(', ')} · {o.mode === 'plan' ? 'instalments' : 'cash'}{o.discountPct ? ` · discount ${o.discountPct}%` : ''}</p>
          <p className="text-brand-gray">Customer pays <b className="text-brand-black">{egp(o.due ?? o.total)}</b>{o.realTotal ? <> · real <b>{egp(o.realTotal)}</b></> : null} · {r.owner_name || '—'} · {when(r.created_at)}{r.sent_at ? ` · sent ${when(r.sent_at)}` : ''}{r.send_error && r.send_status !== 'sent' ? ` · ${r.send_error}` : ''}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 font-bold ${r.send_status === 'sent' ? 'bg-emerald-100 text-emerald-800' : r.status === 'rejected' ? 'bg-rose-100 text-rose-800' : r.status === 'expired' ? 'bg-brand-gray/10' : 'bg-amber-100 text-amber-800'}`}>{r.send_status === 'sent' ? 'Sent' : waiting ? 'Waiting for approval' : r.send_status === 'queued' ? 'Queued' : r.send_status === 'failed' ? 'Not sent' : r.status}</span>
        {o.listSqm && <button onClick={() => openOfferPdf(r.id, o.ref)} className="btn-secondary rounded-lg px-2 py-1 font-bold flex items-center gap-1"><Download size={12} />PDF</button>}
        {waiting && o.listSqm && <button onClick={() => setOpen((x) => !x)} className="btn-secondary rounded-lg px-2 py-1 font-bold flex items-center gap-1"><Percent size={12} />Discount / terms</button>}
        {waiting && o.listSqm && <button onClick={async () => { try { await post(`/lara/offers/${r.id}/test-copy`, {}); toast.success('Test copy sent to your own e-mail'); } catch (e: any) { toast.error(e.message); } }} className="btn-secondary rounded-lg px-2 py-1 font-bold">Test copy to me</button>}
      </div>
      {open && (
        <div className="bg-brand-gray/5 rounded-xl p-3 space-y-2">
          <Terms v={v} set={setV} maxDisc={o.maxDiscountPct} />
          <div className="flex gap-2"><button onClick={save} disabled={busy} className="btn-primary rounded-lg px-3 py-1.5 font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save and rebuild the PDF'}</button><button onClick={() => setOpen(false)} className="btn-secondary rounded-lg px-3 py-1.5 font-bold">Cancel</button></div>
        </div>
      )}
    </li>
  );
};
