import { useEffect, useMemo, useState, useCallback } from 'react';
import { PAGE_SIZES, PageSize, ALL_CHUNK } from './LeadListParts';

/** Value that follows `value` after `ms` of quiet (search boxes). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (value === v) return;
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms, v]);
  return v;
}

/** Lowercase search text, built once per row object (WeakMap keyed by the row). */
export function makeSearchIndex<T extends object>(build: (row: T) => string) {
  const cache = new WeakMap<T, string>();
  return (row: T): string => {
    let s = cache.get(row);
    if (s === undefined) { s = build(row).toLowerCase(); cache.set(row, s); }
    return s;
  };
}

/** Page size (25/50/100/All, remembered in localStorage) + current page + the visible slice. */
export function usePagedList<T>(rows: T[], storageKey: string, resetKey: unknown) {
  const [pageSize, setPageSizeState] = useState<PageSize>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const v = Number(raw);
      if (raw !== null && v !== 0 && (PAGE_SIZES as readonly number[]).includes(v)) return v as PageSize;
    } catch { /* default */ }
    return 25;
  });
  const [page, setPage] = useState(0);
  const setPageSize = useCallback((n: PageSize) => {
    setPageSizeState(n);
    setPage(0);
    try { localStorage.setItem(storageKey, String(n)); } catch { /* ignore */ }
  }, [storageKey]);
  // back to the first page when the filter changes
  useEffect(() => { setPage(0); }, [resetKey]);
  // "All" draws 250 rows and then more on request, so even 4,000 rows never freeze the page
  const [allShown, setAllShown] = useState(ALL_CHUNK);
  useEffect(() => { setAllShown(ALL_CHUNK); }, [resetKey, pageSize]);
  const more = useCallback(() => setAllShown((n) => n + ALL_CHUNK), []);
  const pageCount = pageSize === 0 ? 1 : Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => (pageSize === 0 ? rows.slice(0, allShown) : rows.slice(safePage * pageSize, (safePage + 1) * pageSize)),
    [rows, pageSize, safePage, allShown],
  );
  return { pageRows, page: safePage, pageSize, setPage, setPageSize, allShown, more };
}
