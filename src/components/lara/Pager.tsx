// One pager for every Lara list (owner, 11 Nov 2026: pages of 10 / 25 / 50 / 100; never download a whole list on a refresh).
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZES = [10, 25, 50, 100];
export const Pager: React.FC<{ page: number; size: number; total: number; onPage: (p: number) => void; onSize?: (s: number) => void; busy?: boolean }> = ({ page, size, total, onPage, onSize, busy }) => {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total ? (page - 1) * size + 1 : 0, to = Math.min(total, page * size);
  const nums: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) nums.push(p);
  const b = 'min-w-[28px] h-7 rounded-lg text-xs font-bold px-1.5 disabled:opacity-40';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-brand-gray pt-2">
      <span>{total ? `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}` : 'Nothing'}</span>
      <div className="flex items-center gap-1">
        <button className={`${b} border border-brand-gray/20`} disabled={busy || page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} className="mx-auto" /></button>
        {nums[0] > 1 && <><button className={`${b} border border-brand-gray/20`} onClick={() => onPage(1)}>1</button>{nums[0] > 2 && <span>…</span>}</>}
        {nums.map((p) => <button key={p} disabled={busy} onClick={() => onPage(p)} className={`${b} ${p === page ? 'bg-brand-red text-white' : 'border border-brand-gray/20'}`}>{p}</button>)}
        {nums[nums.length - 1] < pages && <>{nums[nums.length - 1] < pages - 1 && <span>…</span>}<button className={`${b} border border-brand-gray/20`} onClick={() => onPage(pages)}>{pages}</button></>}
        <button className={`${b} border border-brand-gray/20`} disabled={busy || page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={14} className="mx-auto" /></button>
        {onSize && <select value={size} onChange={(e) => onSize(Number(e.target.value))} className="input-field text-xs py-1 ml-1">{PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / page</option>)}</select>}
      </div>
    </div>
  );
};

/** a value that settles after the person stops typing (search boxes call the server once, not on every key) */
export function useDebounced<T>(v: T, ms = 350): T {
  const [d, setD] = React.useState(v);
  React.useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
