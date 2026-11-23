import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { OFFER_TYPE_LABEL, OfferPrint, fetchOfferPrints } from '../../lib/plotsService';
import { crmService } from './crmService';

const egp = (n?: number | null) => (typeof n === 'number' && n > 0 ? 'EGP ' + Math.round(n).toLocaleString('en-US') : '—');
const when = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; };

// 23 Nov 2026: the customer's answer to each offer (server: routes_offers.ts). Same list of reasons as the server.
export const REJECT_REASONS = ['Price too high', 'Payment plan', 'Plot / location', 'Plot size', 'Chose a competitor', 'Not ready / postponed', 'Other'];
const RESULT: Record<string, { label: string; cls: string; tip: string }> = {
  open: { label: 'Open', cls: 'bg-sky-50 text-sky-700 border-sky-200', tip: 'Printed, waiting for the customer' },
  accepted: { label: 'Accepted · waiting finance', cls: 'bg-amber-50 text-amber-700 border-amber-200', tip: 'The lead is Won; finance has to confirm the cash before it counts in the sales numbers' },
  confirmed: { label: 'Confirmed Won', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', tip: 'Finance confirmed the cash: counted in the sales numbers' },
  rejected: { label: 'Rejected', cls: 'bg-rose-50 text-rose-700 border-rose-200', tip: 'The customer said no' },
  closed: { label: 'Closed', cls: 'bg-brand-gray/10 text-brand-gray border-brand-gray/20', tip: 'Another offer on this lead was accepted' },
};

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j: any = null; try { j = await res.json(); } catch { /* below */ }
  if (!res.ok || !j || j.success === false) throw new Error((j && (j.error || j.message)) || `HTTP ${res.status}`);
  return j;
}
const refreshLeads = async () => { try { await crmService.refreshDelta({ force: true, kinds: ['leads'] }); } catch { /* the 2-minute refresh will catch up */ } window.dispatchEvent(new CustomEvent('crm-data-changed')); };

const ResultBadge: React.FC<{ r: OfferPrint }> = ({ r }) => {
  const k = r.result || r.status || 'open', m = RESULT[k] || RESULT.open;
  const extra = k === 'rejected' && r.rejectReason ? ` — ${r.rejectReason}${r.decisionNote ? ': ' + r.decisionNote : ''}` : '';
  const by = r.decidedByName ? ` (${r.decidedByName}${r.decidedAt ? ', ' + when(r.decidedAt) : ''})` : '';
  const hold = k === 'accepted' || k === 'confirmed' ? (r.holdReq ? ` · Land Bank hold request #${r.holdReq}` : r.holdNote ? ` · No Land Bank hold: ${r.holdNote}` : '') : '';
  return <span title={m.tip + extra + by + hold} className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap ${m.cls}`}>{m.label}{k === 'rejected' && r.rejectReason ? ` · ${r.rejectReason}` : ''}</span>;
};

/** Offers printed in the Land Bank for a contact / lead / plot, with the customer's answer. Loads when it is mounted. */
export const OfferPrintsList: React.FC<{ contactId?: string; leadId?: string; plotKey?: string; compact?: boolean }> = ({ contactId, leadId, plotKey, compact }) => {
  const [rows, setRows] = useState<OfferPrint[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [rej, setRej] = useState<{ id: string; reason: string; note: string } | null>(null);
  const load = useCallback(() => {
    let off = false;
    setErr('');
    fetchOfferPrints({ contactId, leadId, plotKey }).then((r) => { if (!off) setRows(r); }).catch((e) => { if (!off) setErr(e.message || 'Could not load.'); });
    return () => { off = true; };
  }, [contactId, leadId, plotKey]);
  useEffect(() => { setRows(null); return load(); }, [load]);

  const accept = async (r: OfferPrint) => {
    if (!window.confirm(`Record that the customer ACCEPTED this ${OFFER_TYPE_LABEL[r.offerType] || 'offer'} (${egp(r.totalValue)})?\n\nThe lead becomes Won with this value, other open offers on it are closed, and finance is asked to confirm the cash.`)) return;
    setBusy(r.id);
    try {
      const j = await post(`/api/crm/offer-prints/${encodeURIComponent(r.id)}/decide`, { decision: 'accept' });
      toast.success('Offer accepted — the lead is Won and waits for finance to confirm.'); void j;
      load(); void refreshLeads();
    } catch (e: any) { toast.error(e.message || 'Could not record the answer'); }
    setBusy('');
  };
  const reject = async () => {
    if (!rej) return;
    if (!rej.reason) { toast.error('Choose why the customer rejected the offer'); return; }
    setBusy(rej.id);
    try { await post(`/api/crm/offer-prints/${encodeURIComponent(rej.id)}/decide`, { decision: 'reject', reason: rej.reason, note: rej.note }); toast.success('Offer marked as rejected'); setRej(null); load(); void refreshLeads(); }
    catch (e: any) { toast.error(e.message || 'Could not record the answer'); }
    setBusy('');
  };

  if (err) return <p className="text-xs text-rose-600 font-semibold py-3">{err}</p>;
  if (!rows) return <p className="text-xs text-brand-gray py-4 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading…</p>;
  if (!rows.length) return <p className="text-xs text-brand-gray py-4 text-center">No offers printed yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="bg-brand-gray/5 border-b border-brand-gray/15 text-brand-gray text-[10px] font-bold uppercase tracking-wider">
          <th className="py-2 px-3">Type</th><th className="py-2 px-3">Plots</th><th className="py-2 px-3 text-right">Total</th>{!compact && <th className="py-2 px-3">Document</th>}<th className="py-2 px-3">By</th><th className="py-2 px-3">When</th><th className="py-2 px-3">Result</th>
        </tr></thead>
        <tbody className="divide-y divide-brand-gray/10">
          {rows.map((r) => (
            <React.Fragment key={r.id}>
              <tr>
                <td className="py-2 px-3 font-bold text-brand-black whitespace-nowrap">{OFFER_TYPE_LABEL[r.offerType] || r.offerType || '—'}</td>
                <td className="py-2 px-3 font-mono">{(r.plots || []).map((p) => [p.park, p.unit].filter(Boolean).join(' ')).filter(Boolean).join(', ') || '—'}</td>
                <td className="py-2 px-3 text-right font-mono">{egp(r.totalValue)}</td>
                {!compact && <td className="py-2 px-3 text-brand-gray">{r.docName || r.summary || '—'}</td>}
                <td className="py-2 px-3">{r.printedByName || r.printedBy || '—'}</td>
                <td className="py-2 px-3 text-brand-gray whitespace-nowrap">{when(r.printedAt)}</td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <ResultBadge r={r} />
                    {r.canDecide && (
                      <>
                        <button type="button" disabled={!!busy} onClick={() => accept(r)} title="The customer accepted this offer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold disabled:opacity-50"><Check size={12} />Accepted</button>
                        <button type="button" disabled={!!busy} onClick={() => setRej({ id: r.id, reason: '', note: '' })} title="The customer rejected this offer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold disabled:opacity-50"><X size={12} />Rejected</button>
                      </>
                    )}
                    {busy === r.id && <Loader2 size={13} className="animate-spin text-brand-gray" />}
                  </div>
                </td>
              </tr>
              {rej && rej.id === r.id && (
                <tr className="bg-rose-50/50"><td colSpan={compact ? 6 : 7} className="py-2 px-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-rose-700">Why did the customer reject it?</span>
                    <select value={rej.reason} onChange={(e) => setRej({ ...rej, reason: e.target.value })} className="input-field py-1 text-xs w-auto">
                      <option value="">Choose a reason…</option>{REJECT_REASONS.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                    <input value={rej.note} onChange={(e) => setRej({ ...rej, note: e.target.value })} maxLength={500} placeholder="Note (optional)" className="input-field py-1 text-xs flex-1 min-w-[160px]" />
                    <button type="button" disabled={!!busy} onClick={reject} className="px-3 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold disabled:opacity-50">Save</button>
                    <button type="button" onClick={() => setRej(null)} className="px-3 py-1 rounded-lg border border-brand-gray/20 text-[11px] font-bold">Cancel</button>
                  </div>
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Section on the lead: open by default, so the offers and their results sit with the lead's history. */
export const OfferPrintsSection: React.FC<{ leadId: string }> = ({ leadId }) => {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="text-[10px] font-extrabold text-brand-gray uppercase tracking-wider">Offers printed &amp; customer answer {open ? '▴' : '▾'}</button>
      {open && <div className="mt-2 border border-brand-gray/15 rounded-xl bg-white"><OfferPrintsList leadId={leadId} compact /></div>}
    </div>
  );
};
