// Extra filters for the Sales Leads list: every field the lead carries. The predicate is built once per filter change
// (cheap checks first, nothing per-row that scans other leads), so 4,000+ leads stay instant.
import React from 'react';
import { X } from 'lucide-react';
import { MultiSelect } from '../ui/MultiSelect';
import type { Lead } from './types';
import { channelOf, isOpenStatus, statusStage } from './leadConfig';
import { getSlaStatus, isSlaAtRisk, localISO } from './leadView';
import { todayISO } from './leadRules';

export interface XF {
  stages: string[]; channels: string[]; industries: string[]; nationalities: string[];
  qualification: string[]; temperature: string[];
  sizeMin: string; sizeMax: string;
  createdFrom: string; createdTo: string; updatedFrom: string; updatedTo: string;
  follow: string[]; followFrom: string; followTo: string;
  closeFrom: string; closeTo: string;
  phone2: string; email: string; offer: string[]; contract: string[]; cash: string[]; sla: string[]; score: string[];
}
export const EMPTY_XF: XF = {
  stages: [], channels: [], industries: [], nationalities: [], qualification: [], temperature: [],
  sizeMin: '', sizeMax: '', createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '',
  follow: [], followFrom: '', followTo: '', closeFrom: '', closeTo: '',
  phone2: '', email: '', offer: [], contract: [], cash: [], sla: [], score: [],
};

export const STAGE_LABELS: Record<string, string> = { active: 'Active', pipeline: 'Pipeline', won: 'Won', lost: 'Lost', closed: 'Closed (other)' };
const day = (v?: string) => {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v); return isNaN(d.getTime()) ? '' : localISO(d);
};
const inRange = (v: string, from: string, to: string) => !!v && (!from || v >= from) && (!to || v <= to);
const sizeNum = (v: any) => { const n = Number(v); return v === '' || v == null || isNaN(n) || n <= 0 ? null : n; };

export const xfCount = (xf: XF): number => {
  let n = 0;
  (Object.keys(xf) as (keyof XF)[]).forEach((k) => { const v = xf[k]; if (Array.isArray(v) ? v.length : v) n++; });
  // a date range counts once
  for (const [a, b] of [['createdFrom', 'createdTo'], ['updatedFrom', 'updatedTo'], ['followFrom', 'followTo'], ['closeFrom', 'closeTo'], ['sizeMin', 'sizeMax']] as [keyof XF, keyof XF][]) if (xf[a] && xf[b]) n--;
  return n;
};

/** null = no extra filter active (skip the check entirely) */
export function makeXfPredicate(xf: XF, scoreOf: (l: Lead) => number): ((l: Lead) => boolean) | null {
  if (!xfCount(xf)) return null;
  const st = new Set(xf.stages), ch = new Set(xf.channels), ind = new Set(xf.industries), nat = new Set(xf.nationalities);
  const qual = new Set(xf.qualification), temp = new Set(xf.temperature), fol = new Set(xf.follow), off = new Set(xf.offer), con = new Set(xf.contract), cas = new Set(xf.cash), slaS = new Set(xf.sla), scr = new Set(xf.score);
  const sMin = sizeNum(xf.sizeMin), sMax = sizeNum(xf.sizeMax);
  const today = todayISO();
  const hasRange = (a: string, b: string) => !!(a || b);
  return (l) => {
    if (st.size && !st.has(statusStage(l.status))) return false;
    if (ch.size && !ch.has(channelOf(l))) return false;
    if (ind.size && !ind.has(l.industry || '')) return false;
    if (nat.size && !nat.has(l.nationality || '')) return false;
    if (qual.size && !qual.has(l.qualification || 'none')) return false;
    if (temp.size && !temp.has(l.temperature || 'none')) return false;
    if (sMin !== null || sMax !== null) {
      const n = sizeNum(l.requiredSize);
      if (n === null || (sMin !== null && n < sMin) || (sMax !== null && n > sMax)) return false;
    }
    if (hasRange(xf.createdFrom, xf.createdTo) && !inRange(day(l.date), xf.createdFrom, xf.createdTo)) return false;
    if (hasRange(xf.updatedFrom, xf.updatedTo) && !inRange(day(l.lastUpdated), xf.updatedFrom, xf.updatedTo)) return false;
    if (hasRange(xf.closeFrom, xf.closeTo) && !inRange(day(l.expectedClosingDate), xf.closeFrom, xf.closeTo)) return false;
    if (fol.size || hasRange(xf.followFrom, xf.followTo)) {
      const f = day(l.nextFollowUpDate);
      if (fol.size) {
        const hit = (fol.has('none') && !f) || (fol.has('overdue') && !!f && f < today && isOpenStatus(l.status)) || (fol.has('today') && f === today) || (fol.has('upcoming') && !!f && f > today);
        if (!hit) return false;
      }
      if (hasRange(xf.followFrom, xf.followTo) && !inRange(f, xf.followFrom, xf.followTo)) return false;
    }
    if (xf.phone2 === 'yes' && !l.phone2) return false;
    if (xf.phone2 === 'no' && l.phone2) return false;
    if (xf.email === 'yes' && !l.email) return false;
    if (xf.email === 'no' && l.email) return false;
    if (off.size === 1 && (off.has('sent') ? !l.offerSent : !!l.offerSent)) return false;
    if (con.size && !con.has(l.contract?.status || 'none')) return false;
    if (cas.size && !cas.has(l.cashStatus || 'none')) return false;
    if (slaS.size) {
      let hit = false;
      if (!l.slaDeadline) hit = slaS.has('none');
      else {
        const sl = getSlaStatus(l);
        hit = (slaS.has('breached') && (sl.isViolated || sl.status === 'missed')) || (slaS.has('at_risk') && isSlaAtRisk(l, sl)) || (slaS.has('within') && !(sl.isViolated || sl.status === 'none' || sl.status === 'missed'));
      }
      if (!hit) return false;
    }
    if (scr.size) {
      const sc = scoreOf(l);
      if (!((scr.has('high') && sc >= 70) || (scr.has('mid') && sc >= 40 && sc < 70) || (scr.has('low') && sc < 40))) return false;
    }
    return true;
  };
}

const LABELS: Record<string, string> = {
  qualification: 'Qualification', temperature: 'Temperature', follow: 'Follow-up', phone2: 'Phone 2', email: 'E-mail', offer: 'Offer', contract: 'Contract', cash: 'Cash', sla: 'SLA', score: 'Score',
};
const VAL: Record<string, Record<string, string>> = {
  follow: { overdue: 'Overdue', today: 'Due today', upcoming: 'Upcoming', none: 'None set' },
  phone2: { yes: 'Has', no: 'None' }, email: { yes: 'Has', no: 'None' },
  offer: { sent: 'Sent', not_sent: 'Not sent' }, cash: { none: 'Not applicable', pending: 'Pending', confirmed: 'Confirmed' },
  sla: { at_risk: 'At risk', breached: 'Breached', within: 'Within SLA', none: 'No SLA' },
  score: { high: 'High (70+)', mid: 'Medium (40-69)', low: 'Low (<40)' },
};
export interface Chip { key: string; label: string; clear: (x: XF) => XF }
export function xfChips(xf: XF): Chip[] {
  const out: Chip[] = [];
  const arr = (k: 'stages' | 'channels' | 'industries' | 'nationalities', name: string, map?: Record<string, string>) => {
    if (xf[k].length) out.push({ key: k, label: `${name}: ${xf[k].map((v) => map?.[v] || v).join(', ')}`, clear: (x) => ({ ...x, [k]: [] }) });
  };
  arr('stages', 'Stage', STAGE_LABELS); arr('channels', 'Channel'); arr('industries', 'Industry'); arr('nationalities', 'Nationality');
  for (const k of ['qualification', 'temperature', 'follow', 'offer', 'contract', 'cash', 'sla', 'score'] as const) {
    if (xf[k].length) out.push({ key: k, label: `${LABELS[k]}: ${xf[k].map((v) => VAL[k]?.[v] || v).join(', ')}`, clear: (x) => ({ ...x, [k]: [] }) });
  }
  for (const k of ['phone2', 'email'] as const) {
    if (xf[k]) out.push({ key: k, label: `${LABELS[k]}: ${VAL[k]?.[xf[k]] || xf[k]}`, clear: (x) => ({ ...x, [k]: '' }) });
  }
  const rng = (key: string, name: string, a: keyof XF, b: keyof XF) => {
    if (xf[a] || xf[b]) out.push({ key, label: `${name}: ${xf[a] || '…'} → ${xf[b] || '…'}`, clear: (x) => ({ ...x, [a]: '', [b]: '' }) });
  };
  rng('size', 'Size (sqm)', 'sizeMin', 'sizeMax'); rng('created', 'Created', 'createdFrom', 'createdTo'); rng('updated', 'Updated', 'updatedFrom', 'updatedTo');
  rng('followR', 'Follow-up date', 'followFrom', 'followTo'); rng('close', 'Expected closing', 'closeFrom', 'closeTo');
  return out;
}

const box = 'w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none';
const lbl = 'block text-[10px] uppercase font-bold text-brand-gray mb-1.5';

const Sel: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: [string, string][] }> = ({ label, value, onChange, options }) => (
  <div><label className={lbl}>{label}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)} className={box}>
      <option value="">Any</option>
      {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select></div>
);
const Range: React.FC<{ label: string; a: string; b: string; onA: (v: string) => void; onB: (v: string) => void; type?: string }> = ({ label, a, b, onA, onB, type = 'date' }) => (
  <div><label className={lbl}>{label}</label>
    <div className="flex items-center gap-1">
      <input type={type} value={a} onChange={(e) => onA(e.target.value)} placeholder={type === 'number' ? 'Min' : undefined} className={box} />
      <span className="text-brand-gray text-xs">–</span>
      <input type={type} value={b} onChange={(e) => onB(e.target.value)} placeholder={type === 'number' ? 'Max' : undefined} className={box} />
    </div></div>
);

export const XFilterPanel: React.FC<{ xf: XF; setXf: (f: XF) => void; channels: string[]; industries: string[]; nationalities: string[]; pinned?: string[]; onTogglePin?: (id: string) => void; barOnly?: boolean }> = ({ xf, setXf, channels, industries, nationalities, pinned = [], onTogglePin, barOnly }) => {
  const up = (p: Partial<XF>) => setXf({ ...xf, ...p });
  const o = (a: string[]) => a.map((v) => ({ value: v, label: v }));
  const items: [string, React.ReactElement][] = [
    ['x:stages', <MultiSelect label="Stage group" allLabel="Any" options={Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }))} value={xf.stages} onChange={(v) => up({ stages: v })} />],
    ['x:channels', <MultiSelect label="Channel" allLabel="Any" options={o(channels)} value={xf.channels} onChange={(v) => up({ channels: v })} />],
    ['x:industries', <MultiSelect label="Industry / plot type" allLabel="Any" options={o(industries)} value={xf.industries} onChange={(v) => up({ industries: v })} />],
    ['x:nationalities', <MultiSelect label="Nationality" allLabel="Any" options={o(nationalities)} value={xf.nationalities} onChange={(v) => up({ nationalities: v })} />],
    ['x:size', <Range label="Required size (sqm)" type="number" a={xf.sizeMin} b={xf.sizeMax} onA={(v) => up({ sizeMin: v })} onB={(v) => up({ sizeMax: v })} />],
    ['x:created', <Range label="Date created" a={xf.createdFrom} b={xf.createdTo} onA={(v) => up({ createdFrom: v })} onB={(v) => up({ createdTo: v })} />],
    ['x:updated', <Range label="Last updated" a={xf.updatedFrom} b={xf.updatedTo} onA={(v) => up({ updatedFrom: v })} onB={(v) => up({ updatedTo: v })} />],
    ['x:closing', <Range label="Expected closing" a={xf.closeFrom} b={xf.closeTo} onA={(v) => up({ closeFrom: v })} onB={(v) => up({ closeTo: v })} />],
    ['x:follow', <MultiSelect label="Next follow-up" allLabel="Any" options={[{ value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'Due today' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'none', label: 'None set' }]} value={xf.follow} onChange={(v) => up({ follow: v })} />],
    ['x:followRange', <Range label="Follow-up date range" a={xf.followFrom} b={xf.followTo} onA={(v) => up({ followFrom: v })} onB={(v) => up({ followTo: v })} />],
    ['x:sla', <MultiSelect label="SLA" allLabel="Any" options={[{ value: 'at_risk', label: 'At risk' }, { value: 'breached', label: 'Breached' }, { value: 'within', label: 'Within SLA' }, { value: 'none', label: 'No SLA' }]} value={xf.sla} onChange={(v) => up({ sla: v })} />],
    ['x:score', <MultiSelect label="Lead score" allLabel="Any" options={[{ value: 'high', label: 'High (70+)' }, { value: 'mid', label: 'Medium (40-69)' }, { value: 'low', label: 'Low (<40)' }]} value={xf.score} onChange={(v) => up({ score: v })} />],
    ['x:qualification', <MultiSelect label="Qualification" allLabel="Any" options={[{ value: 'Qualified', label: 'Qualified' }, { value: 'Unqualified', label: 'Unqualified' }, { value: 'none', label: 'Not set' }]} value={xf.qualification} onChange={(v) => up({ qualification: v })} />],
    ['x:temperature', <MultiSelect label="Temperature" allLabel="Any" options={[{ value: 'Hot', label: 'Hot' }, { value: 'Warm', label: 'Warm' }, { value: 'Cold', label: 'Cold' }, { value: 'none', label: 'Not set' }]} value={xf.temperature} onChange={(v) => up({ temperature: v })} />],
    ['x:offer', <MultiSelect label="Offer" allLabel="Any" options={[{ value: 'sent', label: 'Sent' }, { value: 'not_sent', label: 'Not sent' }]} value={xf.offer} onChange={(v) => up({ offer: v })} />],
    ['x:contract', <MultiSelect label="Contract" allLabel="Any" options={[{ value: 'none', label: 'No contract' }, { value: 'Draft', label: 'Draft' }, { value: 'In Progress', label: 'In progress' }, { value: 'On Hold', label: 'On hold' }, { value: 'Signed', label: 'Signed' }, { value: 'Cancelled', label: 'Cancelled' }]} value={xf.contract} onChange={(v) => up({ contract: v })} />],
    ['x:cash', <MultiSelect label="Cash" allLabel="Any" options={[{ value: 'pending', label: 'Pending' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'none', label: 'Not applicable' }]} value={xf.cash} onChange={(v) => up({ cash: v })} />],
    ['x:phone2', <Sel label="Second phone" value={xf.phone2} onChange={(phone2) => up({ phone2 })} options={[['yes', 'Has phone 2'], ['no', 'No phone 2']]} />],
    ['x:email', <Sel label="E-mail" value={xf.email} onChange={(email) => up({ email })} options={[['yes', 'Has e-mail'], ['no', 'No e-mail']]} />],
  ];
  if (barOnly) {
    return <>{items.filter(([id]) => pinned.includes(id)).map(([id, node]) => <div key={id} className="min-w-[140px] max-w-[260px]">{node}</div>)}</>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
      {items.map(([id, node]) => (
        <div key={id}>
          {onTogglePin && (
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-brand-gray mb-1 cursor-pointer select-none" title="Tick to keep this filter in the quick bar above the list">
              <input type="checkbox" checked={pinned.includes(id)} onChange={() => onTogglePin(id)} className="accent-brand-red" /> Quick bar
            </label>
          )}
          {node}
        </div>
      ))}
    </div>
  );
};

export const ChipBar: React.FC<{ chips: { key: string; label: string; onClear: () => void }[]; onClearAll: () => void }> = ({ chips, onClearAll }) => (
  chips.length === 0 ? null : (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1 bg-brand-red/10 text-brand-red text-[11px] font-bold pl-2.5 pr-1.5 py-1 rounded-full">
          {c.label}<button onClick={c.onClear} aria-label={`Remove filter ${c.label}`} className="hover:bg-brand-red/20 rounded-full p-0.5"><X size={11} /></button>
        </span>
      ))}
      <button onClick={onClearAll} className="text-[11px] font-bold text-brand-gray hover:text-brand-red underline ml-1">Clear all</button>
    </div>
  )
);
