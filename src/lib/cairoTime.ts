// Every time in the system is Cairo time, whatever the time zone of the computer or phone.
export const CAIRO = 'Africa/Cairo';
const FMT = new Intl.DateTimeFormat('en-GB', { timeZone: CAIRO, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** the wall-clock parts of a moment in Cairo */
export function cairoParts(d: Date = new Date()) {
  const p: Record<string, string> = {};
  for (const x of FMT.formatToParts(d)) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
const p2 = (n: number) => String(n).padStart(2, '0');
export const cairoDateISO = (d: Date = new Date()) => { const c = cairoParts(d); return `${c.y}-${p2(c.mo)}-${p2(c.d)}`; };
export const cairoTimeHM = (d: Date = new Date()) => { const c = cairoParts(d); return `${p2(c.h)}:${p2(c.mi)}`; };

/** the default time zone of date formatting becomes Cairo (an explicit timeZone in the call still wins) */
export function installCairoTime() {
  const w = window as any;
  if (w.__cairoInstalled) return;
  w.__cairoInstalled = true;
  for (const k of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const) {
    const orig = (Date.prototype as any)[k];
    (Date.prototype as any)[k] = function (loc?: any, opt?: any) { return orig.call(this, loc, opt && opt.timeZone ? opt : { ...(opt || {}), timeZone: CAIRO }); };
  }
  const Orig = Intl.DateTimeFormat;
  const Patched: any = function (loc?: any, opt?: any) { return new Orig(loc, opt && opt.timeZone ? opt : { ...(opt || {}), timeZone: CAIRO }); };
  Patched.prototype = Orig.prototype;
  Patched.supportedLocalesOf = Orig.supportedLocalesOf;
  (Intl as any).DateTimeFormat = Patched;
}
