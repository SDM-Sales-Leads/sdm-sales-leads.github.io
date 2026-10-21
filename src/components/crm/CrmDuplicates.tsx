import { crmNav } from './crmNav';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Lead, TimelineEvent } from './types';
import { crmService } from './crmService';
import { useAuth } from '../../services/AuthContext';
import { leadKeys } from './importEngine';
import { isMarketingSource } from './leadConfig';
import { Copy, GitMerge, ShieldCheck, Search, X, AlertTriangle, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string;
  setActiveSubTab?: (t: string) => void;
}

const PAGE = 20;
const DAY = 864e5;
const uid = () => Math.random().toString(36).slice(2, 11);
const keyLabel = (k: string) => (k[0] === 'e' ? `e-mail ${k.slice(1)}` : `phone ${k.slice(1)}`);

// ---------------------------------------------------------------------------------------------
// rules (spec_D 13/14, spec_A 4.9)
// ---------------------------------------------------------------------------------------------
const NOT_WORK = /^(lead (added|registered)|imported|self-generated|assigned|transferred|merged|duplicate|\[merged\])/i;
/** how much real work has been done on a lead */
export function workScore(l: Lead): number {
  const real = (l.timeline || []).filter((e) => !['Creation', 'Import', 'Assignment'].includes(e.type) && !NOT_WORK.test(e.title || '')).length;
  let s = 3 * real;
  if (l.firstContactAt) s += 6;
  if (l.qualification === 'Qualified') s += 8;
  if (l.meetingDate) s += 12;
  if (l.offerSent) s += 15;
  if (l.status === 'Negotiation' || l.reservationDate || l.contractDate || l.eoiDate) s += 15;
  if (l.status === 'Won') s += 40;
  if (Number(l.dealValue) > 0) s += 10;
  return s;
}
const COMPLETE_FIELDS: (keyof Lead)[] = ['customerName', 'companyName', 'phoneNumber', 'phone2', 'email', 'project', 'soldArea', 'requiredSize', 'dealValue', 'plotNo', 'industry', 'notes', 'source', 'nationality'];
const filled = (v: unknown) => !(v === undefined || v === null || v === '' || v === 0 || (typeof v === 'number' && Number.isNaN(v)));
const completeness = (l: Lead) => COMPLETE_FIELDS.filter((k) => filled(l[k])).length + Math.min((l.timeline || []).length, 10);
const t = (s?: string) => { const n = s ? Date.parse(s) : NaN; return Number.isFinite(n) ? n : Infinity; };

/** who keeps the lead, and why */
export function mergeWinner(group: Lead[]): { lead: Lead; why: string } {
  const won = group.filter((l) => l.status === 'Won');
  if (won.length === 1) return { lead: won[0], why: 'holds the won deal' };
  const unique = (vals: number[], best: 'min' | 'max'): number => {
    const top = best === 'min' ? Math.min(...vals) : Math.max(...vals);
    if (!Number.isFinite(top)) return -1;
    const idx = vals.flatMap((v, i) => (v === top ? [i] : []));
    return idx.length === 1 ? idx[0] : -1;
  };
  // owner's rule (12 Oct 2026): the customer stays with the salesperson who was ASSIGNED the lead first
  let i = unique(group.map((l) => t(l.assignedDate || l.date)), 'min');
  if (i >= 0) return { lead: group[i], why: 'assigned the lead first' };
  i = unique(group.map((l) => t(l.firstContactAt)), 'min');                          // then: spoke to the client first
  if (i >= 0) return { lead: group[i], why: 'first contact with the client' };
  i = unique(group.map(workScore), 'max');
  if (i >= 0) return { lead: group[i], why: 'furthest along' };
  i = unique(group.map(completeness), 'max');
  if (i >= 0) return { lead: group[i], why: 'the fuller record' };
  const oldest = [...group].sort((a, b) => t(a.date) - t(b.date))[0];
  return { lead: oldest, why: 'the oldest record' };
}

// every field the old MERGE_FIELDS knew plus the EOI / reservation / contract / offer ones it missed.
// Only EMPTY fields of the winner are filled.
const FILL_FIELDS: (keyof Lead)[] = [
  'customerName', 'companyName', 'phoneNumber', 'phone2', 'email', 'refNo', 'industry', 'nationality', 'project', 'requiredSize', 'budget',
  'soldArea', 'plotNo', 'notes', 'description', 'qualification', 'qualNotes', 'temperature', 'priority', 'meetingDate', 'meetingTime',
  'nextFollowUpDate', 'nextFollowUpTime', 'expectedClosingDate', 'offerDate', 'offerDueDate', 'dealValue', 'totalSoldValue', 'wonDate',
  'lostCategory', 'lostReason', 'lostComment', 'eoiDate', 'reservationDate', 'contractDate', 'firstContactAt', 'contract', 'legacyId', 'legacyOwnerName',
];

const lastActivity = (l: Lead): string => {
  let best = l.lastContactDate ? t(l.lastContactDate) : -Infinity;
  for (const e of l.timeline || []) { if (['Creation', 'Import', 'Assignment'].includes(e.type)) continue; const x = t(e.timestamp); if (Number.isFinite(x) && x > best) best = x; }
  if (best === -Infinity) { const u = t(l.lastUpdated); return Number.isFinite(u) ? new Date(u).toISOString().slice(0, 10) : '—'; }
  return new Date(best).toISOString().slice(0, 10);
};
const ageDays = (l: Lead) => { const d = t(l.date); return Number.isFinite(d) ? Math.max(0, Math.floor((Date.now() - d) / DAY)) : null; };

interface Group { id: string; leads: Lead[]; via: string[] }

/** connected groups through shared phone / e-mail: one pass, hash maps + union-find, O(n) */
function findGroups(leads: Lead[]): Group[] {
  const list = leads.filter((l) => !l.mergedInto);
  const parent = list.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const first = new Map<string, number>();
  const keysOf: string[][] = list.map((l) => leadKeys(l));
  list.forEach((_, i) => {
    for (const k of keysOf[i]) {
      const j = first.get(k);
      if (j === undefined) first.set(k, i); else { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
    }
  });
  const comps = new Map<number, number[]>();
  list.forEach((_, i) => { const r = find(i); const a = comps.get(r); if (a) a.push(i); else comps.set(r, [i]); });
  const out: Group[] = [];
  const count = new Map<string, number>();
  for (const idx of comps.values()) {
    if (idx.length < 2) continue;
    const members = idx.map((i) => list[i]);
    if (members.every((l) => l.dupCleared)) continue;
    count.clear();
    for (const i of idx) for (const k of keysOf[i]) count.set(k, (count.get(k) || 0) + 1);
    const via = [...count.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    out.push({ id: members.map((l) => l.id).sort()[0], leads: members, via });
  }
  return out.sort((a, b) => b.leads.length - a.leads.length || t(b.leads[0].date) - t(a.leads[0].date));
}

export const CrmDuplicates: React.FC<Props> = ({ leads, onLeadsUpdated, currentRole, setActiveSubTab }) => {
  const { user, permissions } = useAuth();
  const roleLc = (currentRole || '').toLowerCase();
  const isOps = roleLc.includes('admin') || roleLc.startsWith('sales operation');
  const canView = isOps || currentRole === 'Sales Team Leader' || permissions?.canViewSalesRules === true;
  const me = user?.name || 'User';

  const groups = useMemo(() => (canView ? findGroups(leads) : []), [leads, canView]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'phone' | 'email'>('all');
  const [page, setPage] = useState(0);
  const [dlg, setDlg] = useState<null | { g: Group; keep: string; owner: string }>(null);
  const [busy, setBusy] = useState('');

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const digits = s.replace(/\D/g, '');
    return groups.filter((g) => {
      if (kind === 'phone' && !g.via.some((k) => k[0] === 'p')) return false;
      if (kind === 'email' && !g.via.some((k) => k[0] === 'e')) return false;
      if (!s) return true;
      return g.leads.some((l) => `${l.id} ${l.customerName} ${l.companyName || ''} ${l.email || ''} ${l.assignedSalespersonName || ''}`.toLowerCase().includes(s)
        || (digits.length >= 5 && `${l.phoneNumber}${l.phone2 || ''}`.replace(/\D/g, '').includes(digits)));
    });
  }, [groups, q, kind]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const slice = filtered.slice(cur * PAGE, cur * PAGE + PAGE);
  const records = useMemo(() => groups.reduce((n, g) => n + g.leads.length, 0), [groups]);

  const people = useMemo(() => (crmService.getSalesPeople() as any[]).filter((p) => p && p.active !== false && /sales|business|bd/i.test(p.role || '') && !/operation/i.test(p.role || '')), []);

  const ev = (title: string, description: string): TimelineEvent => ({ id: 'mg_' + uid(), timestamp: new Date().toISOString(), type: 'Approval', user: me, title, description });

  // ---------------------------------------------------------------------------------------------
  const notDuplicate = async (g: Group) => {
    setBusy(g.id);
    try {
      const ids = new Set(g.leads.map((l) => l.id));
      const now = new Date().toISOString();
      crmService.saveLeads(crmService.getLeads().map((l) => !ids.has(l.id) ? l : {
        ...l, dupCleared: true, lastUpdated: now,
        timeline: [...(l.timeline || []), ev('Marked as not a duplicate', `${me} confirmed that ${g.leads.filter((x) => x.id !== l.id).map((x) => x.id).join(', ')} is a different customer.`)],
      }));
      await crmService.whenSaved();
      toast.success('Kept both: the group is cleared.');
      onLeadsUpdated();
    } finally { setBusy(''); }
  };

  const doMerge = async (g: Group, keepId: string, ownerId: string) => {
    setBusy(g.id);
    try {
      const cache = new Map(crmService.getLeads().map((l) => [l.id, l]));
      const all = g.leads.map((l) => cache.get(l.id)).filter(Boolean) as Lead[];
      const win0 = cache.get(keepId);
      if (!win0 || all.length !== g.leads.length) { toast.error('One of these leads changed or disappeared. Reload and try again.'); return; }
      const losers = all.filter((l) => l.id !== keepId);
      const wonCount = all.filter((l) => l.status === 'Won').length;
      if (wonCount > 1) { toast.error('More than one lead in this group is Won: merging money deals must be done by hand.'); return; }
      if (wonCount === 1 && win0.status !== 'Won') { toast.error('The Won lead must be the one that is kept.'); return; }

      const now = new Date().toISOString();
      const w: any = { ...win0, timeline: [...(win0.timeline || [])], comments: [...(win0.comments || [])] };
      const filledNames: string[] = [];
      for (const l of losers) {
        for (const k of FILL_FIELDS) {
          if (!filled(w[k]) && filled((l as any)[k])) { w[k] = (l as any)[k]; if (!filledNames.includes(String(k))) filledNames.push(String(k)); }
        }
        if (w.eoiApplicable === undefined || w.eoiApplicable === null) if (l.eoiApplicable !== undefined && l.eoiApplicable !== null) { w.eoiApplicable = l.eoiApplicable; filledNames.push('eoiApplicable'); }
        if (!w.offerSent && l.offerSent) { w.offerSent = true; filledNames.push('offerSent'); }
        if (filled(l.phoneNumber) && l.phoneNumber !== w.phoneNumber && !filled(w.phone2)) { w.phone2 = l.phoneNumber; filledNames.push('phone2'); }
        if (l.lastContactDate && (!w.lastContactDate || l.lastContactDate > w.lastContactDate)) w.lastContactDate = l.lastContactDate;
        if (t(l.date) < t(w.date)) w.date = l.date;                                    // the lead counts from the earliest date
        if (t(l.firstContactAt) < t(w.firstContactAt)) w.firstContactAt = l.firstContactAt;
        // marketing origin wins: a customer who reached us through marketing first is not a personal lead
        if (!isMarketingSource(w.source) && l.source && isMarketingSource(l.source)) {
          w.timeline.push(ev('Source kept as ' + l.source, `This customer reached us through marketing first (was ${w.source || 'blank'}).`));
          w.srcOriginal = w.source || w.srcOriginal; w.source = l.source;
        }
        // history is copied, never lost
        for (const e of l.timeline || []) w.timeline.push({ ...e, id: `mg_${l.id}_${e.id}`, title: '[merged] ' + (e.title || '') });
        for (const c of l.comments || []) w.comments.push({ ...c, id: `mg_${l.id}_${c.id}`, comment: '[merged] ' + (c.comment || '') });
      }
      // the owner stays; only Sales Operation / admin can hand it to someone else here
      let ownerNote = `Owner unchanged (${w.assignedSalespersonName || 'unassigned'}).`;
      if (isOps && ownerId) {
        const p = people.find((x) => String(x.id) === ownerId);
        if (p && String(p.id) !== String(w.assignedSalespersonId || '')) {
          ownerNote = `Owner changed by ${me}: ${w.assignedSalespersonName || 'unassigned'} → ${p.name}.`;
          w.assignedSalespersonId = String(p.id); w.assignedSalespersonName = p.name; w.assignedDate = now;
        }
      }
      const firstEvId = 'mg_' + uid();
      losers.forEach((l, i) => w.timeline.push({
        id: i === 0 ? firstEvId : 'mg_' + uid(), timestamp: now, type: 'Approval', user: me, title: `Merged lead ${l.id} into this lead by ${me}`,
        description: `${l.customerName}${l.companyName ? ' (' + l.companyName + ')' : ''}, owner ${l.assignedSalespersonName || 'unassigned'}, status ${l.status}. ` + (i === 0 ? `Kept because: ${mergeWinner(all).lead.id === keepId ? mergeWinner(all).why : 'chosen by ' + me}. ${filledNames.length ? 'Filled in: ' + filledNames.join(', ') + '. ' : ''}${ownerNote}` : ''),
      }));
      w.dupCleared = false; w.lastUpdated = now;

      const stamped = new Map<string, Lead>([[w.id, w as Lead]]);
      for (const l of losers) {
        stamped.set(l.id, {
          ...l, mergedInto: w.id, status: 'Duplicate', lastUpdated: now,
          timeline: [...(l.timeline || []), ev('Merged into ' + w.id, `Merged into ${w.id} by ${me}. This record is closed.`)],
        });
      }
      // phase 1: the winner and the stamped copies reach the server
      crmService.saveLeads(crmService.getLeads().map((l) => stamped.get(l.id) || l));
      await crmService.whenSaved();
      const check = new Map(crmService.getLeads().map((l) => [l.id, l]));
      const okWin = (check.get(w.id)?.timeline || []).some((e) => e.id === firstEvId);
      if (!okWin || losers.some((l) => check.get(l.id)?.mergedInto !== w.id)) {
        toast.error('The merge was not saved (see the message above). Nothing was removed.');
        onLeadsUpdated();
        return;
      }
      // phase 2: the losing copies leave the list through the normal delete path (soft delete on the server)
      const gone = new Set(losers.map((l) => l.id));
      crmService.saveLeads(crmService.getLeads().filter((l) => !gone.has(l.id)));
      await crmService.whenSaved();
      crmService.addActivityLog(me, 'Merge Leads', `Merged ${[...gone].join(', ')} into ${w.id}`, 'ticket');
      toast.success(`Merged ${losers.length} lead${losers.length > 1 ? 's' : ''} into ${w.id}.`);
      setDlg(null);
      onLeadsUpdated();
    } catch (e: any) {
      toast.error(e?.message || 'The merge failed.');
    } finally { setBusy(''); }
  };

  if (!canView) {
    return <div className="bg-white rounded-2xl border border-brand-gray/20 p-8 text-center text-brand-gray text-xs font-semibold">Only Sales Operation, administrators and team leaders can review duplicate leads.</div>;
  }

  return (
    <div className="space-y-5 text-xs font-semibold" id="crm-duplicates-root">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-brand-black flex items-center gap-2"><Copy size={20} className="text-brand-red" /> Duplicates</h3>
          <p className="text-brand-gray/80 mt-1">
            {groups.length
              ? `${groups.length.toLocaleString()} customer${groups.length === 1 ? ' is' : 's are'} in the system more than once (${records.toLocaleString()} records). Same phone or same e-mail only: names never count.`
              : 'No duplicate customers: every phone number and e-mail appears on one lead only.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-gray/50" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search name, phone, e-mail…" className="pl-8 pr-3 py-2 rounded-xl border border-brand-gray/25 bg-white w-60" />
          </div>
          <select value={kind} onChange={(e) => { setKind(e.target.value as any); setPage(0); }} className="py-2 px-2 rounded-xl border border-brand-gray/25 bg-white">
            <option value="all">Phone or e-mail</option><option value="phone">Same phone</option><option value="email">Same e-mail</option>
          </select>
        </div>
      </div>

      {slice.map((g) => {
        const win = mergeWinner(g.leads);
        const sorted = [...g.leads].sort((a, b) => workScore(b) - workScore(a) || t(a.date) - t(b.date));
        const wonN = g.leads.filter((l) => l.status === 'Won').length;
        return (
          <div key={g.id} className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-brand-gray/5 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-extrabold text-brand-black">{win.lead.customerName}</span>
                <span className="text-brand-gray"> · {g.leads.length} records · {g.via.slice(0, 2).map(keyLabel).join(' · ') || 'linked through other records'}</span>
              </div>
              <div className="flex items-center gap-2">
                <button disabled={!!busy} onClick={() => void notDuplicate(g)} className="px-3 py-1.5 rounded-lg border border-brand-gray/25 text-brand-black font-bold flex items-center gap-1.5 hover:bg-white disabled:opacity-50">
                  <ShieldCheck size={13} /> Not a duplicate - keep both
                </button>
                <button disabled={!!busy || wonN > 1} title={wonN > 1 ? 'More than one Won lead: merge by hand' : ''} onClick={() => setDlg({ g, keep: win.lead.id, owner: '' })}
                  className="px-3 py-1.5 rounded-lg bg-brand-red text-white font-extrabold flex items-center gap-1.5 disabled:opacity-40">
                  {busy === g.id ? <Loader2 size={13} className="animate-spin" /> : <GitMerge size={13} />} Merge
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-[10px] uppercase tracking-wide text-brand-gray">
                  <tr><th className="px-4 py-2">Lead</th><th className="px-2 py-2">Owner</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Age</th><th className="px-2 py-2">Last activity</th><th className="px-2 py-2">Work done</th><th className="px-2 py-2">Contact</th></tr>
                </thead>
                <tbody>
                  {sorted.map((l) => {
                    const age = ageDays(l);
                    return (
                      <tr key={l.id} className="border-t border-brand-gray/10">
                        <td className="px-4 py-2">
                          <button type="button" className="font-mono underline decoration-dotted underline-offset-2 hover:text-brand-red" title="Open this lead" onClick={() => crmNav.lead(l.id)}>{l.id}</button>{' '}
                          {l.id === win.lead.id && <span className="text-[10.5px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-extrabold">KEEP: {win.why}</span>}
                          <div className="text-brand-gray">{l.customerName}{l.companyName ? ` · ${l.companyName}` : ''}</div>
                        </td>
                        <td className="px-2 py-2">{l.assignedSalespersonName || l.legacyOwnerName || <span className="text-brand-gray/60">Unassigned</span>}</td>
                        <td className="px-2 py-2">{l.status}</td>
                        <td className="px-2 py-2">{age === null ? '—' : `${age} d`}</td>
                        <td className="px-2 py-2">{lastActivity(l)}</td>
                        <td className="px-2 py-2 font-mono">{workScore(l)}</td>
                        <td className="px-2 py-2 text-brand-gray">{[l.phoneNumber, l.phone2, l.email].filter(Boolean).join(' · ') || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {!slice.length && groups.length > 0 && <p className="text-center text-brand-gray py-6">No group matches your search.</p>}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-brand-gray">
          <button disabled={cur === 0} onClick={() => setPage(cur - 1)} className="p-1.5 rounded-lg border border-brand-gray/25 disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={14} /></button>
          <span>Page {cur + 1} of {pages}</span>
          <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="p-1.5 rounded-lg border border-brand-gray/25 disabled:opacity-30" aria-label="Next page"><ChevronRight size={14} /></button>
        </div>
      )}

      {dlg && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-brand-black text-sm flex items-center gap-2"><GitMerge size={16} className="text-brand-red" /> Merge {dlg.g.leads.length} records into one lead</h4>
              <button onClick={() => setDlg(null)} aria-label="Close"><X size={16} className="text-brand-gray" /></button>
            </div>
            <p className="text-brand-gray leading-relaxed">
              The kept lead stays as it is: only its empty fields are filled from the others. Their history is copied with a "[merged]" mark, and the other records are closed and removed from the lists.
            </p>
            <div className="space-y-2">
              {dlg.g.leads.map((l) => (
                <label key={l.id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${dlg.keep === l.id ? 'border-brand-red bg-brand-red/5' : 'border-brand-gray/20'}`}>
                  <input type="radio" name="keep" checked={dlg.keep === l.id} onChange={() => setDlg({ ...dlg, keep: l.id })} className="mt-1" />
                  <div className="min-w-0">
                    <div className="font-bold text-brand-black">{dlg.keep === l.id ? 'Keep' : 'Merge away'}: <span className="font-mono">{l.id}</span> · {l.customerName}</div>
                    <div className="text-brand-gray">Owner {l.assignedSalespersonName || 'unassigned'} · {l.status} · added {l.date ? String(l.date).slice(0, 10) : '—'} · work {workScore(l)} · last activity {lastActivity(l)}</div>
                  </div>
                </label>
              ))}
            </div>
            {dlg.keep !== mergeWinner(dlg.g.leads).lead.id && (
              <p className="flex items-start gap-2 text-amber-700"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />The fair rule would keep {mergeWinner(dlg.g.leads).lead.id} ({mergeWinner(dlg.g.leads).why}). Your choice is written on the lead's history.</p>
            )}
            {isOps ? (
              <label className="block">
                <span className="text-brand-gray block mb-1">Who follows the kept lead up?</span>
                <select value={dlg.owner} onChange={(e) => setDlg({ ...dlg, owner: e.target.value })} className="w-full border border-brand-gray/25 rounded-xl px-3 py-2 bg-white">
                  <option value="">Keep the current owner ({dlg.g.leads.find((l) => l.id === dlg.keep)?.assignedSalespersonName || 'unassigned'})</option>
                  {people.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                </select>
              </label>
            ) : (
              <p className="text-brand-gray">The owner of the kept lead does not change.</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setDlg(null)} className="px-4 py-2 rounded-xl border border-brand-gray/25 font-bold">Cancel</button>
              <button disabled={!!busy} onClick={() => void doMerge(dlg.g, dlg.keep, dlg.owner)} className="px-4 py-2 rounded-xl bg-brand-red text-white font-extrabold flex items-center gap-1.5 disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <GitMerge size={13} />} Merge now
              </button>
            </div>
          </div>
        </div>
      )}
      {setActiveSubTab && groups.length === 0 && (
        <p className="text-center"><button onClick={() => setActiveSubTab('leads')} className="text-indigo-600 font-bold hover:underline">Back to Leads</button></p>
      )}
    </div>
  );
};
