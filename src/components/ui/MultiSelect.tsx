import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface MsOption { value: string; label: string; group?: string }

/**
 * Filter drop-down with a check box in front of every option (tick as many as you want). Nothing ticked = no filter ("All").
 * The list opens in a layer above the page (never cut off by a panel), has a search box for long lists and Select all / Clear.
 */
export const MultiSelect: React.FC<{
  options: MsOption[]; value: string[]; onChange: (v: string[]) => void;
  allLabel: string;              // text when nothing is ticked, e.g. "All statuses"
  label?: string;                // small caption above (filter panel); the quick bar passes none and shows the name inside the button
  name?: string;                 // short noun for "3 statuses" style summaries
  className?: string; buttonClassName?: string;
}> = ({ options, value, onChange, allLabel, label, name, className = '', buttonClassName }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const set = useMemo(() => new Set(value), [value]);

  const place = () => {
    const r = btn.current?.getBoundingClientRect(); if (!r) return;
    const w = Math.max(r.width, 230), vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - Math.min(w, vw - 16) - 8));
    const up = r.bottom + 280 > vh && r.top > vh - r.bottom;      // not enough room below: open upwards
    setPos({ left, top: up ? r.top - 6 : r.bottom + 6, width: Math.min(w, vw - 16), up });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: Event) => { const t = e.target as Node; if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const re = () => place();
    document.addEventListener('mousedown', down); document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('keydown', key); window.addEventListener('resize', re); window.addEventListener('scroll', re, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); document.removeEventListener('keydown', key); window.removeEventListener('resize', re); window.removeEventListener('scroll', re, true); };
  }, [open]);
  useEffect(() => { if (!open) setQ(''); }, [open]);

  const toggle = (v: string) => onChange(set.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options; }, [options, q]);
  const summary = value.length === 0 ? allLabel
    : value.length === 1 ? (options.find((o) => o.value === value[0])?.label || value[0])
    : `${value.length} ${name || 'selected'}`;
  const groups = useMemo(() => { const g: { name: string; items: MsOption[] }[] = []; for (const o of shown) { const n = o.group || ''; const last = g[g.length - 1]; if (last && last.name === n) last.items.push(o); else g.push({ name: n, items: [o] }); } return g; }, [shown]);

  return (
    <div className={className}>
      {label && <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">{label}</label>}
      <button ref={btn} type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={buttonClassName || `w-full bg-brand-gray/5 border rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none flex items-center justify-between gap-2 text-left ${value.length ? 'border-brand-red/50 text-brand-red' : 'border-brand-gray/20'}`}>
        <span className="truncate">{summary}</span><ChevronDown size={12} className="shrink-0" />
      </button>
      {open && pos && createPortal(
        <div ref={pop} role="listbox" aria-multiselectable="true"
          style={{ position: 'fixed', left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }), zIndex: 200 }}
          className="bg-white border border-brand-gray/25 rounded-xl shadow-2xl overflow-hidden text-xs">
          {options.length > 8 && (
            <div className="p-2 border-b border-brand-gray/10 flex items-center gap-2"><Search size={13} className="text-brand-gray" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="flex-1 bg-transparent outline-none text-xs" /></div>
          )}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-brand-gray/10 bg-brand-gray/5">
            <button type="button" className="text-[11px] font-bold text-brand-red" onClick={() => onChange(Array.from(new Set([...value, ...shown.map((o) => o.value)])))}>Select all</button>
            <span className="text-[10px] text-brand-gray">{value.length} ticked</span>
            <button type="button" className="text-[11px] font-bold text-brand-gray hover:text-brand-red" onClick={() => onChange([])}>Clear</button>
          </div>
          <div className="max-h-[min(50vh,300px)] overflow-y-auto overscroll-contain py-1">
            {shown.length === 0 && <p className="px-3 py-2 text-brand-gray">Nothing found</p>}
            {groups.map((g, gi) => (
              <div key={gi}>
                {g.name && <p className="px-3 pt-2 pb-1 text-[10px] uppercase font-extrabold text-brand-gray">{g.name}</p>}
                {g.items.map((o) => (
                  <label key={o.value} role="option" aria-selected={set.has(o.value)} className="flex items-center gap-2.5 px-3 py-2 sm:py-1.5 hover:bg-brand-gray/10 cursor-pointer select-none">
                    <input type="checkbox" className="sr-only" checked={set.has(o.value)} onChange={() => toggle(o.value)} />
                    <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${set.has(o.value) ? 'bg-brand-red border-brand-red text-white' : 'border-brand-gray/40 bg-white'}`}>{set.has(o.value) && <Check size={11} strokeWidth={3} />}</span>
                    <span className="truncate">{o.label}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>, document.body)}
    </div>
  );
};
