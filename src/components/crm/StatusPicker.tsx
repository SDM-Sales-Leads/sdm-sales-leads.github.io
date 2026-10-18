import React, { useEffect, useState } from 'react';
import { statusOptions } from './leadRules';

/** Two small drop-downs instead of one long list: first the tab (New, Contact attempt, Follow-up, Sales pipeline, Won, Closed...),
 *  then only the statuses that belong to that tab. Picking a tab alone changes nothing: the status is set when one is chosen. */
export const StatusPicker: React.FC<{ value: string; onChange: (s: string) => void; disabled?: boolean; className?: string; hide?: string[]; allowEmpty?: boolean }> = ({ value, onChange, disabled, className = '', hide = [], allowEmpty }) => {
  const groups = statusOptions(value).map((g) => ({ ...g, statuses: g.statuses.filter((s) => !hide.includes(s)) })).filter((g) => g.statuses.length);
  const own = groups.find((g) => g.statuses.includes(value))?.group || '';
  const [tab, setTab] = useState(own);
  useEffect(() => { if (own) setTab(own); }, [own, value]);
  const cur = groups.find((g) => g.group === tab);
  return (
    <div className="flex flex-col gap-1.5">
      <select aria-label="Status tab" value={tab} disabled={disabled} onChange={(e) => { const g = groups.find((x) => x.group === e.target.value); setTab(e.target.value); if (g && g.statuses.length === 1 && g.statuses[0] !== value) onChange(g.statuses[0]); }} className={`${className} w-full min-w-0`}>
        {allowEmpty && !tab && <option value="">Tab…</option>}
        {groups.map((g) => <option key={g.group} value={g.group}>{g.group}</option>)}
      </select>
      <select aria-label="Status" value={cur?.statuses.includes(value) ? value : ''} disabled={disabled} onChange={(e) => e.target.value && onChange(e.target.value)} className={`${className} w-full min-w-0`}>
        {!cur?.statuses.includes(value) && <option value="">Choose…</option>}
        {(cur?.statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
};
