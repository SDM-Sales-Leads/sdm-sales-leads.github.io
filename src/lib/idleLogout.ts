// Automatic sign-out after 1 hour with no activity, so a browser left open overnight stops polling the server and database.
// Any click, key, touch, scroll or mouse move in ANY tab of this browser counts (the last-activity time is shared through localStorage).
// A warning with "Stay signed in" shows at 55 minutes; at 60 minutes onTimeout runs and the login screen says why.
const LIMIT = 60 * 60_000, WARN = 55 * 60_000, KEY = 'sdm.lastActive', FLAG = 'sdm.autoLogout';

export const AUTO_LOGOUT_FLAG = FLAG;
/** true once, if the person was just signed out by this rule (the flag is consumed) */
export function takeAutoLogoutNotice(): boolean {
  try { if (localStorage.getItem(FLAG)) { localStorage.removeItem(FLAG); return true; } } catch { /* ignore */ }
  return false;
}

export function startIdleWatch(onTimeout: () => void | Promise<void>): () => void {
  let mem = 0, lastWrite = 0, done = false, bar: HTMLDivElement | null = null;
  const read = () => { let v = 0; try { v = Number(localStorage.getItem(KEY)) || 0; } catch { /* ignore */ } return Math.max(mem, v); };
  const write = (t: number) => { mem = t; try { localStorage.setItem(KEY, String(t)); } catch { /* ignore */ } };
  const hide = () => { if (bar) { bar.remove(); bar = null; } };
  const touch = () => { const n = Date.now(); mem = n; if (n - lastWrite > 10_000) { lastWrite = n; write(n); } if (bar) hide(); };
  const show = (left: number) => {
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'idleWarn'; bar.setAttribute('role', 'alert');
      bar.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100000;max-width:calc(100vw - 32px);display:flex;gap:14px;align-items:center;flex-wrap:wrap;justify-content:center;background:#1c1c1f;color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px 16px;font:500 14px/1.35 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.4)';
      const t = document.createElement('span'); t.id = 'idleTxt';
      const b = document.createElement('button'); b.id = 'idleStay'; b.textContent = 'Stay signed in';
      b.style.cssText = 'background:#A6192E;color:#fff;border:0;border-radius:10px;padding:8px 14px;font:600 14px system-ui,sans-serif;cursor:pointer;min-height:36px';
      b.onclick = () => { lastWrite = Date.now(); write(lastWrite); hide(); };
      bar.append(t, b); document.body.appendChild(bar);
    }
    const m = Math.max(1, Math.ceil(left / 60_000));
    bar.querySelector('#idleTxt')!.textContent = `No activity for a while. You will be signed out automatically in ${m} minute${m > 1 ? 's' : ''}.`;
  };
  const tick = () => {
    if (done) return;
    const idle = Date.now() - read();
    if (idle < 0) { hide(); return; }                    // the clock moved back: never sign out because of it
    if (idle >= LIMIT) {
      done = true; hide();
      try { localStorage.setItem(FLAG, String(Date.now())); } catch { /* ignore */ }
      void Promise.resolve(onTimeout());
    } else if (idle >= WARN) show(LIMIT - idle); else hide();
  };
  const evs = ['pointerdown', 'mousedown', 'keydown', 'wheel', 'touchstart', 'touchmove', 'mousemove', 'click', 'input', 'scroll'];
  evs.forEach((e) => window.addEventListener(e, touch, { capture: true, passive: true }));
  const wake = () => setTimeout(tick, 200);
  ['visibilitychange', 'focus', 'pageshow', 'online'].forEach((e) => window.addEventListener(e, wake));
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) mem = Math.max(mem, Number(e.newValue) || 0); };
  window.addEventListener('storage', onStorage);
  try { if (!localStorage.getItem(KEY)) write(Date.now()); } catch { /* ignore */ }   // first visit: the hour starts now
  const timer = setInterval(tick, 15_000);
  return () => {
    clearInterval(timer); hide();
    evs.forEach((e) => window.removeEventListener(e, touch, { capture: true } as any));
    ['visibilitychange', 'focus', 'pageshow', 'online'].forEach((e) => window.removeEventListener(e, wake));
    window.removeEventListener('storage', onStorage);
  };
}
