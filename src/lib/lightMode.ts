// Light mode: no blur, no moving background, no big transitions. For weak PCs (little memory, few cores), slow links, "reduce motion",
// and any device that turns out to be slow (frame-rate check). A person can force it On or Off from the menu; the choice is kept in this browser.
import { useSyncExternalStore } from 'react';

export type LightPref = 'auto' | 'on' | 'off';
const KEY = 'sdm_light_mode';
const AUTO_KEY = 'sdm_light_auto';   // set when the frame-rate check found this device slow
export const LIGHT_LABEL: Record<LightPref, string> = { auto: 'Auto', on: 'On', off: 'Off' };
export const nextLightPref = (p: LightPref): LightPref => (p === 'auto' ? 'on' : p === 'on' ? 'off' : 'auto');

export function getLightPref(): LightPref {
  try { const v = localStorage.getItem(KEY); if (v === 'on' || v === 'off' || v === 'auto') return v; } catch { /* ignore */ }
  return 'auto';
}

/** why Auto would switch light mode on for this device ('' = it would not) */
export function lightReason(): string {
  try {
    const nav: any = navigator;
    if (nav.deviceMemory && nav.deviceMemory <= 4) return `little memory (${nav.deviceMemory} GB)`;
    if (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) return `few processor cores (${nav.hardwareConcurrency})`;
    const c = nav.connection;
    if (c && (c.saveData || ['slow-2g', '2g', '3g'].includes(c.effectiveType))) return 'a slow connection';
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced motion is set on this device';
    if (localStorage.getItem(AUTO_KEY) === '1') return 'this device ran slowly';
  } catch { /* ignore */ }
  return '';
}
export function isLight(): boolean {
  const p = getLightPref();
  return p === 'on' || (p === 'auto' && lightReason() !== '');
}
export function applyLight() {
  document.documentElement.classList.toggle('light-mode', isLight());
  window.dispatchEvent(new Event('sdm-light-mode'));
}
export function setLightPref(p: LightPref) {
  try { localStorage.setItem(KEY, p); if (p !== 'auto') localStorage.removeItem(AUTO_KEY); } catch { /* ignore */ }
  applyLight();
}
const subscribe = (cb: () => void) => { window.addEventListener('sdm-light-mode', cb); return () => window.removeEventListener('sdm-light-mode', cb); };
export const useLight = (): boolean => useSyncExternalStore(subscribe, isLight, () => false);

/**
 * Frame-rate check (Auto only): two 3-second windows, 12 s and 30 s after the page opened. Both under 35 frames per second while the tab is
 * in front = this device is slow, so light mode is turned on for it (and a short message says so). Never runs when the person chose.
 */
export function startFpsGuard() {
  if (getLightPref() !== 'auto' || isLight()) return;
  const sample = (after: number) => new Promise<number | null>((resolve) => {
    setTimeout(() => {
      let n = 0, hidden = false; const t0 = performance.now();
      const tick = () => {
        if (document.visibilityState !== 'visible') hidden = true;
        n++;
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else resolve(hidden ? null : n / 3);
      };
      requestAnimationFrame(tick);
    }, after);
  });
  void (async () => {
    const a = await sample(12_000); if (a === null || a >= 35) return;
    const b = await sample(18_000); if (b === null || b >= 35) return;
    if (getLightPref() !== 'auto') return;
    try { localStorage.setItem(AUTO_KEY, '1'); } catch { /* ignore */ }
    applyLight();
    void import('sonner').then((m) => m.toast.message('Light mode switched on', { description: 'This device was running slowly. Menu → Light mode lets you change it.', duration: 9000 })).catch(() => {});
  })();
}
