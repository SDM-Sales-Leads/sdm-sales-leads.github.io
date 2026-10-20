// Quiet problem reporter: freezes, slow or failing server calls, script errors, blank pages, slow loads, automatic reloads and
// several tabs open at once are sent to the server (Admin > System Health > App issues). Nothing the user types is sent.
type Ev = { k: string; m: string; p: string; ms?: number; tabs: number; at: string };
const queue: Ev[] = [];
let sent = 0;
const perKind: Record<string, number> = {};
let tabCount = 1;
let lastWake = Date.now();     // the computer woke up, the tab was restored or the network came back: failures right after that are not the system's fault
const justWoke = () => Date.now() - lastWake < 25_000;
const SLOW_API_MS = 8000, FREEZE_MS = 4000;

const page = () => String((window as any).__sdmPage || location.pathname + location.hash).slice(0, 60);

export function logIssue(k: string, m: string, ms?: number) {
  if (sent >= 80 || (perKind[k] = (perKind[k] || 0) + 1) > 15) return;
  queue.push({ k, m: String(m).slice(0, 200), p: page(), ms: ms === undefined ? undefined : Math.round(ms), tabs: tabCount, at: new Date().toISOString() });
}

/** call right before an automatic reload so the next page load can say why it happened */
export function markReload(reason: string) { try { sessionStorage.setItem('sdm_reload_reason', `${reason}@${Date.now()}`); } catch { /* ignore */ } }

const route = (url: string) => url.replace(/^.*\/api/, '').split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id').replace(/\b[A-Z]{1,4}-\d+\b/g, ':id').replace(/\/\d+/g, '/:n').slice(0, 80);

function flush(useBeacon = false) {
  if (!queue.length) return;
  const events = queue.splice(0, 20);
  sent += events.length;
  const body = JSON.stringify({ events, ua: navigator.userAgent.slice(0, 110), w: window.innerWidth, net: (navigator as any).connection?.effectiveType || '' });
  try { void window.fetch('/api/client-issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: useBeacon }).catch(() => {}); } catch { /* ignore */ }
}

export function installTelemetry() {
  if ((window as any).__telemetry) return;
  (window as any).__telemetry = true;

  // server calls: failing, slow, or an expired login
  const inner = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith('/api/') || url.startsWith('/api/client-issues') || url.startsWith('/api/client-error')) return inner(input as any, init);
    const t0 = performance.now();
    try {
      const res = await inner(input as any, init);
      const ms = performance.now() - t0;
      if (res.status >= 500) logIssue('api_fail', `${init?.method || 'GET'} ${route(url)} -> ${res.status}`, ms);
      else if (res.status === 401) logIssue('api_401', `${init?.method || 'GET'} ${route(url)} -> 401 (login not accepted)`, ms);
      else if (ms > SLOW_API_MS) logIssue('api_slow', `${init?.method || 'GET'} ${route(url)} took ${(ms / 1000).toFixed(1)} s`, ms);
      return res;
    } catch (e: any) {
      if (e?.name !== 'AbortError' && navigator.onLine !== false && !justWoke()) logIssue('api_fail', `${init?.method || 'GET'} ${route(url)} failed: ${e?.message || 'network'}`, performance.now() - t0);
      throw e;
    }
  };

  // script errors (the boot guard already shows a message for a blank start; this one keeps the list)
  window.addEventListener('error', (e) => {
    if (e.target && e.target !== window) return;
    const m = String(e.message || '');
    if (!m || /ResizeObserver|Script error\.?$/i.test(m)) return;
    logIssue('js_error', `${m} @ ${String(e.filename || '').split('/').pop()}:${e.lineno}`);
  });
  window.addEventListener('unhandledrejection', (e: any) => {
    const m = String(e?.reason?.message || e?.reason || '');
    if (!m || /AbortError|ResizeObserver|Failed to fetch|NetworkError|Load failed/i.test(m)) return;
    logIssue('js_promise', m);
  });

  for (const ev of ['resume', 'pageshow', 'online']) window.addEventListener(ev, () => { lastWake = Date.now(); });
  document.addEventListener('resume', () => { lastWake = Date.now(); });
  // freeze: the page did not answer for several seconds while the tab was in front
  let last = performance.now(), hiddenSince = 0, wasHidden = false;
  document.addEventListener('visibilitychange', () => { if (document.hidden) { hiddenSince = performance.now(); } else wasHidden = true; });
  setInterval(() => {
    const now = performance.now(), gap = now - last; last = now;
    if (document.hidden) return;
    if (wasHidden) { wasHidden = false; return; }
    if (!justWoke() && gap > FREEZE_MS + 1000) logIssue('freeze', `the page stopped responding for ${(gap / 1000).toFixed(1)} s`, gap);
  }, 1000);
  void hiddenSince;

  // why did the page reload?
  try {
    const r = sessionStorage.getItem('sdm_reload_reason');
    if (r) { sessionStorage.removeItem('sdm_reload_reason'); const [why, at] = r.split('@'); logIssue('auto_reload', `reloaded by the system: ${why}`, Date.now() - Number(at)); }
    else {
      const nav: any = performance.getEntriesByType('navigation')[0];
      if (nav?.type === 'reload') logIssue('reload', 'the page was reloaded (button, F5 or the browser)');
    }
  } catch { /* ignore */ }

  // blank page and slow start
  window.addEventListener('load', () => {
    setTimeout(() => {
      const nav: any = performance.getEntriesByType('navigation')[0];
      if (nav && nav.loadEventEnd > 10000) logIssue('slow_load', `the page took ${(nav.loadEventEnd / 1000).toFixed(1)} s to load`, nav.loadEventEnd);
    }, 0);
    setTimeout(() => { const r = document.getElementById('root'); if (!r || (r.innerText || '').trim().length < 5) logIssue('white_page', 'blank screen 10 s after start'); }, 10000);
  });

  // several tabs of the system open in the same browser
  try {
    const id = Math.random().toString(36).slice(2), seen = new Map<string, number>([[id, Date.now()]]);
    const bc = new BroadcastChannel('sdm-tabs');
    const beat = () => bc.postMessage(id);
    bc.onmessage = (e) => { seen.set(String(e.data), Date.now()); };
    let warned = false;
    setInterval(() => {
      beat();
      const cut = Date.now() - 25_000; for (const [k, t] of seen) if (t < cut) seen.delete(k);
      tabCount = Math.max(1, seen.size);
      if (tabCount > 1 && !warned) { warned = true; logIssue('multi_tab', `${tabCount} tabs of the system are open in this browser`); }
    }, 10_000);
    beat();
  } catch { /* old browser */ }

  setInterval(() => flush(false), 15_000);
  window.addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); });
}
