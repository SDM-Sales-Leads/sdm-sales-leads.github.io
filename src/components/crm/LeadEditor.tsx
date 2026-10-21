// The lead detail form: every field of the sales team's previous CRM, with its required-field rules (spec_A 2.4, 4.1-4.7).
// Field enabling is a convenience; the server decides and its refusal is shown as a toast by crmService.
import { cairoDateISO } from '../../lib/cairoTime';
import { StatusPicker } from './StatusPicker';
import { Collapse } from './Collapse';
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Lock, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { Lead } from './types';
import {
  INDUSTRIES, LOST_CATEGORIES, LOST_REASONS_TEAM, PRIORITIES, PROJECTS, QUALIFICATIONS, REQ_DATETIME, REQ_FOLLOWUP, SOURCES,
  TEMPERATURES, CHANNELS, closingDate, isOpenStatus, normSource, wonDateFor,
} from './leadConfig';
import { EDITABLE_KEYS, LeadAuth, fieldRights, prioKey, statusOptions, validateLead, withSideEffects, addDaysISO } from './leadRules';
import { crmService } from './crmService';

export const NATIONALITIES = ['Egyptian', 'Saudi', 'Emirati', 'Kuwaiti', 'Qatari', 'Bahraini', 'Omani', 'Yemeni', 'Jordanian', 'Lebanese', 'Syrian', 'Palestinian', 'Iraqi', 'Sudanese', 'Libyan', 'Tunisian', 'Algerian', 'Moroccan', 'Turkish', 'Chinese', 'Indian', 'Pakistani', 'Russian', 'Italian', 'German', 'French', 'Spanish', 'British', 'American', 'Greek', 'Korean', 'Japanese', 'Nigerian', 'Kenyan', 'Ethiopian', 'Tanzanian', 'South African', 'Other'];

type Draft = Record<string, any>;
// 'channel' is protected on the server like source / phone (leadRules.EDITABLE_KEYS does not list it, so it is added here)
const KEYS: readonly string[] = [...EDITABLE_KEYS, 'channel'];
const toDraft = (l: Lead): Draft => {
  const d: Draft = {};
  for (const k of KEYS) {
    const v = (l as any)[k];
    d[k] = v === undefined || v === null ? (k === 'offerSent' ? false : k === 'eoiApplicable' ? null : '') : v;
  }
  if (d.requiredSize === 'n/a') d.requiredSize = '';
  d.priority = prioKey(d.priority) || '';
  d.date = String(d.date || '').slice(0, 10);
  for (const k of ['dealValue', 'totalSoldValue', 'soldArea']) d[k] = d[k] === '' ? '' : String(d[k]);
  return d;
};
const eq = (a: any, b: any) => String(a ?? '') === String(b ?? '');

const inputCls = 'w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand-red disabled:opacity-60 disabled:cursor-not-allowed';

const Field: React.FC<{ label: string; req?: boolean; locked?: boolean; wide?: boolean; children: React.ReactNode }> = ({ label, req, locked, wide, children }) => (
  <div className={wide ? 'col-span-2' : ''}>
    <label className="flex items-center gap-1 text-[10px] uppercase font-bold text-brand-gray mb-1">
      <span>{label}</span>{req && <span className="text-brand-red">*</span>}{locked && <Lock size={9} className="text-brand-gray/60" aria-label="Locked for your role" />}
    </label>
    {children}
  </div>
);

interface Props {
  lead: Lead;
  auth: LeadAuth;
  actorName: string;
  actorId?: string;
  onSaved: (l: Lead) => void;
  onOpenLead: (id: string) => void;
}

export const LeadEditor: React.FC<Props> = ({ lead, auth, actorName, actorId, onSaved, onOpenLead }) => {
  const rights = useMemo(() => fieldRights(auth, false), [auth]);
  const [d, setD] = useState<Draft>(() => toDraft(lead));
  const [baseRev, setBaseRev] = useState<string | undefined>((lead as any)._rev);
  const [err, setErr] = useState('');
  const [dupMsg, setDupMsg] = useState<{ id: string; owner: string; why: string } | null>(null);

  const original = useMemo(() => toDraft(lead), [lead]);
  const dirtyKeys = useMemo(() => KEYS.filter((k) => !eq(d[k], original[k])), [d, original]);
  const dirty = dirtyKeys.length > 0;
  const stale = dirty && (lead as any)._rev !== baseRev;

  // a change from elsewhere (or our own save coming back) refreshes the form unless the user is typing
  useEffect(() => {
    if (!dirty) { setD(toDraft(lead)); setBaseRev((lead as any)._rev); setErr(''); setDupMsg(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead]);

  const set = (k: string, v: any) => { setD((p) => ({ ...p, [k]: v })); setErr(''); };
  const status = String(d.status || 'New');
  const needMeeting = REQ_DATETIME.includes(status);
  const needFollow = REQ_FOLLOWUP.includes(status);
  const open = isOpenStatus(status);
  const roLock = auth.readOnly;

  const onStatus = (s: string) => {
    setD((p) => {
      const n: Draft = { ...p, status: s };
      if (REQ_FOLLOWUP.includes(s) && !n.nextFollowUpDate) n.nextFollowUpDate = addDaysISO(2);
      return n;
    });
    setErr('');
  };

  const buildNext = (): Lead => {
    const next: any = { ...lead };
    for (const k of dirtyKeys) {
      let v: any = d[k];
      if (k === 'requiredSize') { const n = Number(v); v = n > 0 ? n : 'n/a'; }
      else if (k === 'dealValue' || k === 'totalSoldValue' || k === 'soldArea') v = v === '' ? undefined : Number(v);
      else if (k === 'source') v = normSource(v) || String(v).trim();
      else if (typeof v === 'string' && !['notes', 'qualNotes', 'lostComment'].includes(k)) v = v.trim();
      next[k] = v;
    }
    return next as Lead;
  };

  const save = () => {
    if (!dirty) return;
    if (stale && !window.confirm('This lead was changed by someone else while you were editing. Save anyway and overwrite their change?')) return;
    const next = buildNext();
    if ([next.dealValue, next.totalSoldValue, next.soldArea].some((v) => v !== undefined && v !== null && Number.isNaN(Number(v)))) { setErr('Value and area fields must be numbers.'); return; }
    if (next.email && !/^[^\s@,;<>()"?&=]+@[^\s@,;<>()"?&=]+\.[^\s@,;<>()"?&=]+$/.test(next.email)) { setErr('The e-mail address is not valid.'); return; }
    const problem = validateLead(next, lead);
    if (problem) { setErr(problem); toast.error(problem); return; }
    // same phone / same e-mail on another lead: show who owns it and let the user open it
    if (dirtyKeys.some((k) => k === 'phoneNumber' || k === 'phone2' || k === 'email')) {
      const hit = crmService.findDuplicates({ phone: next.phoneNumber, phone2: next.phone2, email: next.email }, lead.id)[0];
      if (hit && !dupMsg) {
        setDupMsg({ id: hit.id, owner: hit.assignedSalespersonName || 'nobody yet (unrouted)', why: 'the same phone number or e-mail' });
        return;
      }
    }
    const patch: Partial<Lead> = {};
    for (const k of dirtyKeys) (patch as any)[k] = (next as any)[k];
    if (patch.status === 'Won' && lead.status !== 'Won' && !patch.wonDate) patch.wonDate = wonDateFor(next, cairoDateISO(new Date()));
    let updated: Lead;
    try { updated = crmService.updateLead(lead.id, patch, actorName, { userId: actorId }); }
    catch (e: any) { setErr(e?.message || 'The lead could not be saved.'); return; }
    setDupMsg(null); setErr('');
    setD(toDraft(updated)); setBaseRev((updated as any)._rev);
    toast.success('Lead saved');
    onSaved(updated);
  };

  const reset = () => { setD(toDraft(lead)); setBaseRev((lead as any)._rev); setErr(''); setDupMsg(null); };

  const lockedCore = !rights.core, lockedFollow = !rights.follow;
  const sourceOptions = Array.from(new Set([...SOURCES, ...(d.source ? [String(d.source)] : [])]));
  const channelOptions = Array.from(new Set<string>([...CHANNELS, ...(d.channel ? [String(d.channel)] : [])]));
  const projectOptions = Array.from(new Set([...PROJECTS, ...(d.project ? [String(d.project)] : [])]));
  const industryOptions = Array.from(new Set([...INDUSTRIES, ...(d.industry ? [String(d.industry)] : [])]));
  const showStages = rights.stages;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-extrabold text-brand-gray uppercase tracking-wider">Lead details</span>
        {roLock && <span className="text-[10px] text-brand-gray flex items-center gap-1"><Lock size={10} /> Read only</span>}
      </div>

      {stale && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 text-[11px] flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5"><AlertTriangle size={13} /> Someone changed this lead while you were editing.</span>
          <button onClick={reset} className="font-bold underline">Discard my edits</button>
        </div>
      )}

      {/* Status and follow-up */}
      <Collapse title="Status & follow-up" defaultOpen forceOpen={!!err} summary={`${status} · next follow-up ${d.nextFollowUpDate || '—'}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
        <Field label="Status" locked={lockedFollow}>
          <StatusPicker value={status} disabled={lockedFollow} onChange={onStatus} className={inputCls} />
        </Field>
        <Field label="Priority" locked={lockedCore}>
          <select value={d.priority} disabled={lockedCore} onChange={(e) => set('priority', e.target.value)} className={inputCls}>
            <option value="">—</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>

        <Field label="Next follow-up" req={needFollow} locked={lockedFollow}>
          <input type="date" value={d.nextFollowUpDate} disabled={lockedFollow} onChange={(e) => set('nextFollowUpDate', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Follow-up time" locked={lockedFollow}>
          <input type="time" value={d.nextFollowUpTime} disabled={lockedFollow} onChange={(e) => set('nextFollowUpTime', e.target.value)} className={inputCls} />
        </Field>

        {needMeeting && (
          <>
            <Field label="Meeting date" req locked={lockedFollow}>
              <input type="date" value={d.meetingDate} disabled={lockedFollow} onChange={(e) => set('meetingDate', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Meeting time" req locked={lockedFollow}>
              <input type="time" value={d.meetingTime} disabled={lockedFollow} onChange={(e) => set('meetingTime', e.target.value)} className={inputCls} />
            </Field>
          </>
        )}

        {status === 'Lost' && (
          <>
            <Field label="Lost category" req locked={lockedFollow}>
              <select value={d.lostCategory} disabled={lockedFollow} onChange={(e) => set('lostCategory', e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {LOST_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Lost reason" req locked={lockedFollow}>
              <select value={d.lostReason} disabled={lockedFollow} onChange={(e) => set('lostReason', e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {Array.from(new Set([...LOST_REASONS_TEAM, ...(d.lostReason ? [String(d.lostReason)] : [])])).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Lost comment" wide locked={lockedFollow}>
              <textarea rows={2} value={d.lostComment} disabled={lockedFollow} onChange={(e) => set('lostComment', e.target.value)} className={inputCls} />
            </Field>
          </>
        )}

        <Field label="Offer sent" locked={lockedFollow}>
          <label className="flex items-center gap-2 py-2 text-xs font-semibold">
            <input type="checkbox" checked={!!d.offerSent} disabled={lockedFollow} onChange={(e) => { set('offerSent', e.target.checked); if (!e.target.checked) set('offerDate', ''); }} className="rounded text-brand-red" />
            <span>An offer was sent</span>
          </label>
        </Field>
        <Field label="Offer date" req={!!d.offerSent} locked={lockedFollow}>
          <input type="date" value={d.offerDate} disabled={lockedFollow || !d.offerSent} onChange={(e) => set('offerDate', e.target.value)} className={inputCls} />
        </Field>
      </div>

      </Collapse>

      {/* Qualification */}
      <Collapse title="Qualification & industry" summary={`${d.qualification || 'Not qualified yet'} · ${d.industry || 'industry —'}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
        <Field label="Qualification" locked={lockedFollow}>
          <select value={d.qualification} disabled={lockedFollow} onChange={(e) => set('qualification', e.target.value)} className={inputCls}>
            <option value="">Not qualified yet</option>
            {QUALIFICATIONS.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </Field>
        {d.qualification === 'Qualified' ? (
          <Field label="Temperature" req locked={lockedFollow}>
            <select value={d.temperature} disabled={lockedFollow} onChange={(e) => set('temperature', e.target.value)} className={inputCls}>
              <option value="">Select…</option>
              {TEMPERATURES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        ) : <div />}
        {d.qualification && (
          <Field label="Qualification notes" req wide locked={lockedFollow}>
            <textarea rows={2} value={d.qualNotes} disabled={lockedFollow} onChange={(e) => set('qualNotes', e.target.value)} className={inputCls} />
          </Field>
        )}
        <Field label="Industry" locked={lockedFollow}>
          <select value={d.industry} disabled={lockedFollow} onChange={(e) => set('industry', e.target.value)} className={inputCls}>
            <option value="">—</option>
            {industryOptions.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="Nationality" locked={lockedFollow}>
          <input list="crm-nationalities" value={d.nationality} disabled={lockedFollow} onChange={(e) => set('nationality', e.target.value)} className={inputCls} placeholder="Type or choose" />
          <datalist id="crm-nationalities">{NATIONALITIES.map((n) => <option key={n} value={n} />)}</datalist>
        </Field>
      </div>

      </Collapse>

      {/* Contact and origin */}
      <Collapse title="Customer, contact & origin" summary={`${d.phoneNumber || 'no phone'} · ${d.email || 'no e-mail'} · ${d.project || 'project —'}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
        <Field label="Customer name" locked={!rights.shared}>
          <input value={d.customerName} disabled={!rights.shared} onChange={(e) => set('customerName', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Company" locked={!rights.shared}>
          <input value={d.companyName} disabled={!rights.shared} onChange={(e) => set('companyName', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Phone" locked={lockedCore}>
          <input value={d.phoneNumber} disabled={lockedCore} onChange={(e) => set('phoneNumber', e.target.value)} className={`${inputCls} font-mono`} />
        </Field>
        <Field label="Phone 2" locked={!rights.shared}>
          <input value={d.phone2} disabled={!rights.shared} onChange={(e) => set('phone2', e.target.value)} className={`${inputCls} font-mono`} />
        </Field>
        <Field label="E-mail" locked={lockedCore}>
          <input type="email" value={d.email} disabled={lockedCore} onChange={(e) => set('email', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Channel" locked={lockedCore}>
          <select value={d.channel} disabled={lockedCore} onChange={(e) => set('channel', e.target.value)} className={inputCls}>
            <option value="">—</option>
            {channelOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Lead source" locked={lockedCore}>
          <select value={d.source} disabled={lockedCore} onChange={(e) => set('source', e.target.value)} className={inputCls}>
            <option value="">—</option>
            {sourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Project" locked={!rights.shared}>
          <select value={d.project} disabled={!rights.shared} onChange={(e) => set('project', e.target.value)} className={inputCls}>
            <option value="">—</option>
            {projectOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Requested area (sqm)" locked={!rights.shared}>
          <input type="number" min={0} value={d.requiredSize} disabled={!rights.shared} onChange={(e) => set('requiredSize', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Lead date" locked={lockedCore}>
          <input type="date" value={d.date} disabled={lockedCore} onChange={(e) => set('date', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Cash status">
          <div className={`${inputCls} flex items-center`}>{lead.cashStatus === 'confirmed' ? 'Confirmed by accounts receivable' : lead.cashStatus === 'pending' ? 'Pending confirmation' : '—'}</div>
        </Field>
        <Field label="Notes" wide locked={lockedFollow}>
          <textarea rows={2} value={d.notes} disabled={lockedFollow} onChange={(e) => set('notes', e.target.value)} className={inputCls} placeholder={needMeeting ? 'Required: what was agreed' : ''} />
        </Field>
      </div>

      </Collapse>

      {/* Deal stages and values: owner / operations / team leader, existing leads only */}
      {showStages && (
        <Collapse title="Deal stages & value" summary={status === 'Won' ? 'Won deal' : 'EOI, reservation, contract, value'} forceOpen={status === 'Won'}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
          <div className="col-span-2 text-[10px] font-extrabold text-brand-gray uppercase tracking-wider">Deal stages and value</div>
          <Field label="Deal path">
            <select value={d.eoiApplicable === true ? 'yes' : d.eoiApplicable === false ? 'no' : ''} onChange={(e) => set('eoiApplicable', e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null)} className={inputCls}>
              <option value="">Not chosen yet</option>
              <option value="yes">Start with EOI (EOI → Reservation → Contract)</option>
              <option value="no">Start with Reservation Form (Reservation → Contract)</option>
            </select>
          </Field>
          <Field label="EOI date">
            <input type="date" value={d.eoiDate} disabled={d.eoiApplicable !== true} onChange={(e) => set('eoiDate', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Reservation date">
            <input type="date" value={d.reservationDate} onChange={(e) => set('reservationDate', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Contract date">
            <input type="date" value={d.contractDate} onChange={(e) => set('contractDate', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Deal value, cash (EGP)" req={status === 'Won'}>
            <input type="number" min={0} value={d.dealValue} onChange={(e) => set('dealValue', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Total sold value (EGP)">
            <input type="number" min={0} value={d.totalSoldValue} onChange={(e) => set('totalSoldValue', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Sold area (sqm)">
            <input type="number" min={0} value={d.soldArea} onChange={(e) => set('soldArea', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Plot number">
            <input value={d.plotNo} onChange={(e) => set('plotNo', e.target.value)} className={inputCls} />
          </Field>
          {status === 'Won' && (
            <Field label="Deal won on (counts in reports)">
              <input type="date" value={d.wonDate} onChange={(e) => set('wonDate', e.target.value)} className={inputCls} placeholder={closingDate(buildNext())} />
              {!d.wonDate && <span className="text-[10.5px] text-brand-gray">Empty = {closingDate(withSideEffects(null, buildNext())) || '—'} (EOI / reservation / contract date)</span>}
            </Field>
          )}
        </div>
        </Collapse>
      )}

      {dupMsg && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-[11px] space-y-2">
          <p className="flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /><span>Lead <strong>{dupMsg.id}</strong> already has {dupMsg.why}. It is owned by <strong>{dupMsg.owner}</strong>.</span></p>
          <div className="flex gap-2">
            <button onClick={() => onOpenLead(dupMsg.id)} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1 rounded text-[10px]">Open that lead</button>
            {auth.isOps && <button onClick={save} className="bg-white border border-amber-300 font-bold px-3 py-1 rounded text-[10px]">Save anyway</button>}
            <button onClick={() => setDupMsg(null)} className="font-bold px-2 py-1 text-[10px] underline">Dismiss</button>
          </div>
        </div>
      )}

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg p-2.5 text-[11px] font-semibold">{err}</div>}

      {!roLock && (
        <div className="flex items-center justify-end gap-2">
          <button onClick={reset} disabled={!dirty} className="bg-brand-gray/10 hover:bg-brand-gray/20 disabled:opacity-40 text-brand-black px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5"><RotateCcw size={13} /> Reset</button>
          <button onClick={save} disabled={!dirty} className="bg-brand-red hover:bg-brand-red-dark disabled:opacity-40 text-white px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow"><Save size={13} /> Save changes</button>
        </div>
      )}
      {!open && lead.status !== 'Won' && <p className="text-[10px] text-brand-gray">This lead is closed. Choosing another status re-opens it.</p>}
    </div>
  );
};
