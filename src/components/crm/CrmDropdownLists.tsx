import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Lock, Plus, RotateCcw, Save, X } from 'lucide-react';
import { DEFAULT_LISTS, DropdownLists, PROTECTED_STATUSES, applyLists, LOST_CATEGORIES, LOST_REASONS_TEAM, INDUSTRIES, PROJECTS, SOURCES, STATUS_GROUPS, TEMPERATURES } from './leadConfig';

type Key = 'statuses' | 'sources' | 'projects' | 'industries' | 'lostReasons' | 'lostCategories' | 'temperatures';
const LISTS: { key: Key; title: string; hint: string }[] = [
  { key: 'statuses', title: 'Lead status', hint: 'The status drop-down of a lead. Statuses the system rules depend on (New, Won, Lost, follow-up and meeting ones) are locked: they cannot be deleted.' },
  { key: 'lostReasons', title: 'Lost reasons', hint: 'The reasons offered when a lead is marked Lost.' },
  { key: 'sources', title: 'Lead source', hint: 'Where a lead came from.' },
  { key: 'projects', title: 'Projects', hint: 'Projects offered on leads and in filters.' },
  { key: 'industries', title: 'Industries', hint: 'The industry of the customer.' },
  { key: 'temperatures', title: 'Lead temperature', hint: 'Hot / warm / cold style labels.' },
];
const live = (): Required<DropdownLists> => JSON.parse(JSON.stringify({
  statuses: STATUS_GROUPS, sources: SOURCES, projects: PROJECTS, industries: INDUSTRIES, lostReasons: LOST_REASONS_TEAM, lostCategories: LOST_CATEGORIES, temperatures: TEMPERATURES,
}));

/** Admin > Dropdown lists: add or delete the items of the drop-down menus used across the sales system. */
export const CrmDropdownLists: React.FC = () => {
  const [data, setData] = useState<Required<DropdownLists>>(live);
  const [key, setKey] = useState<Key>('statuses');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = useMemo(() => JSON.stringify(data) !== JSON.stringify(live()), [data, saving]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = LISTS.find((l) => l.key === key)!;

  const add = (slot: string, gi?: number) => {
    const t = (draft[slot] || '').trim().slice(0, 80);
    if (!t) return;
    const all = key === 'statuses' ? data.statuses.flatMap((g) => g.statuses) : (data[key] as string[]);
    if (all.some((x) => x.toLowerCase() === t.toLowerCase())) { toast.error(`"${t}" is already in the list`); return; }
    setData((d) => key === 'statuses'
      ? { ...d, statuses: d.statuses.map((g, i) => (i === gi ? { ...g, statuses: [...g.statuses, t] } : g)) }
      : { ...d, [key]: [...(d[key] as string[]), t] });
    setDraft((x) => ({ ...x, [slot]: '' }));
  };
  const del = (v: string, gi?: number) => setData((d) => key === 'statuses'
    ? { ...d, statuses: d.statuses.map((g, i) => (i === gi ? { ...g, statuses: g.statuses.filter((x) => x !== v) } : g)) }
    : { ...d, [key]: (d[key] as string[]).filter((x) => x !== v) });
  const reset = () => setData((d) => ({ ...d, [key]: JSON.parse(JSON.stringify(DEFAULT_LISTS[key])) }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/crm/lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not save the lists.');
      applyLists(data);
      try { localStorage.setItem('crm_lists', JSON.stringify(data)); } catch { /* ignore */ }
      window.dispatchEvent(new Event('crm-lists-changed'));
      toast.success('Dropdown lists saved. Everybody sees them on the next page load.');
    } catch (e: any) { toast.error(e.message || 'Could not save the lists.'); } finally { setSaving(false); }
  };

  const chip = (v: string, onDel: () => void, locked = false) => (
    <span key={v} className="inline-flex items-center gap-1 bg-brand-gray/10 border border-brand-gray/20 rounded-full pl-3 pr-1.5 py-1 text-xs font-semibold text-brand-black">
      {v}
      {locked ? <Lock size={11} className="text-brand-gray/60 mx-1" aria-label="Locked: the system rules use this" /> : <button type="button" onClick={onDel} className="p-0.5 rounded-full hover:bg-rose-100 text-brand-gray hover:text-rose-600" title={`Delete "${v}"`}><X size={12} /></button>}
    </span>
  );
  const adder = (slot: string, gi?: number) => (
    <div className="flex gap-2 mt-2">
      <input className="input-field flex-1" placeholder="Add a new item…" value={draft[slot] || ''} onChange={(e) => setDraft((x) => ({ ...x, [slot]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(slot, gi); } }} />
      <button type="button" onClick={() => add(slot, gi)} className="bg-brand-black text-white px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1"><Plus size={14} /> Add</button>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
      <div className="space-y-1">
        {LISTS.map((l) => (
          <button key={l.key} type="button" onClick={() => setKey(l.key)} className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold ${key === l.key ? 'bg-brand-red text-white' : 'bg-brand-gray/5 text-brand-black hover:bg-brand-gray/10'}`}>{l.title}</button>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-brand-gray/20 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="font-bold text-brand-black">{cur.title}</h3><p className="text-[11px] text-brand-gray font-semibold">{cur.hint} Existing leads keep the value they already have.</p></div>
          <div className="flex gap-2">
            <button type="button" onClick={reset} className="px-3 py-1.5 rounded-xl text-xs font-bold border border-brand-gray/30 text-brand-gray hover:bg-brand-gray/10 inline-flex items-center gap-1"><RotateCcw size={13} /> Reset this list</button>
            <button type="button" onClick={save} disabled={!dirty || saving} className="px-4 py-1.5 rounded-xl text-xs font-bold bg-brand-red text-white disabled:opacity-40 inline-flex items-center gap-1"><Save size={13} /> {saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
        {key === 'statuses' ? (
          <div className="space-y-4">
            {data.statuses.map((g, gi) => (
              <div key={g.group}>
                <p className="text-[10px] uppercase tracking-wider font-bold text-brand-gray mb-1.5">{g.group}</p>
                <div className="flex flex-wrap gap-1.5">{g.statuses.map((s) => chip(s, () => del(s, gi), PROTECTED_STATUSES.has(s)))}</div>
                {adder(`st${gi}`, gi)}
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div className="flex flex-wrap gap-1.5">{(data[key] as string[]).map((s) => chip(s, () => del(s)))}</div>
            {adder('one')}
          </div>
        )}
        {dirty && <p className="text-[11px] font-bold text-amber-700">You have unsaved changes (all lists). Press "Save changes" to apply them.</p>}
      </div>
    </div>
  );
};
