// The phone's Back button and the browser's Back arrow: they close the open card or window first, then go to the page the user
// came from (instead of leaving the system). Cards and windows register with useBackClose; page changes are pushed by the App.
import { useEffect, useRef } from 'react';

interface Layer { id: number; close: () => void; popped: boolean }
const layers: Layer[] = [];
let seq = 0;
let installed = false;
let navHandler: ((state: any) => void) | null = null;

function install() {
  if (installed) return;
  installed = true;
  window.addEventListener('popstate', (e) => {
    const st: any = e.state || {};
    const top = layers[layers.length - 1];
    if (top && st.sdmLayer !== top.id) { top.popped = true; layers.pop(); top.close(); return; }       // back closes the topmost card / window
    if (st.sdmLayer && !layers.some((l) => l.id === st.sdmLayer)) { history.back(); return; }          // an entry of a card that is already gone
    if (st.sdmNav && navHandler) navHandler(st.sdmNav);                                                // back to the previous page
  });
}

/** while `open` is true, Back closes it (close() is called) and the page underneath stays */
export function useBackClose(open: boolean, close: () => void) {
  const ref = useRef(close); ref.current = close;
  useEffect(() => {
    if (!open) return;
    install();
    const layer: Layer = { id: ++seq, close: () => ref.current(), popped: false };
    layers.push(layer);
    try { history.pushState({ ...(history.state || {}), sdmLayer: layer.id }, ''); } catch { /* ignore */ }
    return () => {
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
      // closed with the X button: remove the history entry that was added for it
      if (!layer.popped && (history.state as any)?.sdmLayer === layer.id) { try { history.back(); } catch { /* ignore */ } }
    };
  }, [open]);
}

/** the App tells here which page is open; Back calls onBack with the page that was stored in that history entry */
export function usePageHistory(page: { tab: string; sub: string }, enabled: boolean, onBack: (p: { tab: string; sub: string }) => void) {
  const last = useRef<{ tab: string; sub: string } | null>(null);
  const fromBack = useRef(false);
  const cb = useRef(onBack); cb.current = onBack;
  useEffect(() => {
    if (!enabled) return;
    install();
    navHandler = (p) => { fromBack.current = true; last.current = p; cb.current(p); };
    return () => { navHandler = null; };
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    if (fromBack.current) { fromBack.current = false; return; }
    const prev = last.current;
    if (prev && prev.tab === page.tab && prev.sub === page.sub) return;
    last.current = { ...page };
    try {
      if (!prev) history.replaceState({ ...(history.state || {}), sdmNav: { ...page } }, '');
      else history.pushState({ sdmNav: { ...page } }, '');
    } catch { /* ignore */ }
  }, [page.tab, page.sub, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
