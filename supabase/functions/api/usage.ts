// deno-lint-ignore-file no-explicit-any
// Our own usage meter. The Supabase Free plan allows 5 GB of data sent out and 500,000 function calls per month (billing month: 11th to 11th).
// Every call is counted here (calls and bytes sent, per route); Admin > System Health > Usage shows the month so far with a projection,
// and every morning the system warns the administrators when the projection passes 70 % of a limit.
import { admin, can, forbidden, getConfig, setConfig, nowIso } from "./lib.ts";
import { route } from "./router.ts";
import { addNotifications } from "./notify.ts";

export const LIMITS = { egressBytes: 5 * 1024 ** 3, calls: 500_000 };
const ISO = Math.random().toString(36).slice(2, 8);
type Day = { calls: number; bytes: number; routes: Record<string, [number, number]> };
const cur: { day: string; data: Day; dirty: number; at: number } = { day: "", data: { calls: 0, bytes: 0, routes: {} }, dirty: 0, at: Date.now() };

const cairoDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const label = (path: string) => path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id").replace(/\b[A-Z]{1,4}-\d+\b/g, ":id").replace(/\/\d+/g, "/:n").slice(0, 60);

async function flushUsage() {
  if (!cur.day || !cur.dirty) return;
  cur.dirty = 0; cur.at = Date.now();
  // one row per function instance and day (overwritten with its running total): instances never write the same row, so nothing is lost
  await setConfig(`usage:${cur.day}:${ISO}`, cur.data).catch(() => {});
}

/** called for every answer: path without /api, the bytes that leave the server.
 *  21 Oct 2026: counted in the database (usage_counter, one atomic add per answer, done after the answer is sent). Each request runs in
 *  a short-lived server copy, so the old in-memory count was lost before it was saved (93 calls counted in a month). */
export function recordUsage(path: string, bytes: number) {
  const p = admin.rpc("usage_hit", { p_day: cairoDay(), p_route: label(path), p_bytes: Math.max(0, Math.round(bytes || 0)) }).then(() => {}, () => {});
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* older runtime: the add still runs */ }
}

/** the billing month that contains `now`: from the 11th to the 11th */
function cycle(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  const start = new Date(Date.UTC(d >= 11 ? y : y, d >= 11 ? m : m - 1, 11));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 11));
  return { start, end, days: Math.round((end.getTime() - start.getTime()) / 86400_000), elapsed: Math.max(1, (now.getTime() - start.getTime()) / 86400_000) };
}

export async function usageSummary() {
  await flushUsage();
  const cy = cycle();
  const since = cairoDay(cy.start);
  const { data } = await admin.from("system_config").select("key,value").like("key", "usage:%").gte("key", `usage:${since}`).limit(20000);
  const days: Record<string, Day> = {};
  for (const r of data || []) {
    const day = String(r.key).split(":")[1];
    const d = days[day] || (days[day] = { calls: 0, bytes: 0, routes: {} });
    const v: Day = r.value || { calls: 0, bytes: 0, routes: {} };
    d.calls += v.calls || 0; d.bytes += v.bytes || 0;
    for (const [k, [n, b]] of Object.entries(v.routes || {})) { const x = d.routes[k] || (d.routes[k] = [0, 0]); x[0] += n; x[1] += b; }
  }
  // the database counter (from 21 Oct 2026) is added to the old per-copy rows
  const { data: cnt } = await admin.from("usage_counter").select("day,route,calls,bytes").gte("day", since).limit(20000);
  for (const r of cnt || []) {
    const day = String(r.day); const d = days[day] || (days[day] = { calls: 0, bytes: 0, routes: {} });
    d.calls += Number(r.calls) || 0; d.bytes += Number(r.bytes) || 0;
    const x = d.routes[r.route] || (d.routes[r.route] = [0, 0]); x[0] += Number(r.calls) || 0; x[1] += Number(r.bytes) || 0;
  }
  const tot = Object.values(days).reduce((a, d) => ({ calls: a.calls + d.calls, bytes: a.bytes + d.bytes }), { calls: 0, bytes: 0 });
  const routes: Record<string, [number, number]> = {};
  for (const d of Object.values(days)) for (const [k, [n, b]] of Object.entries(d.routes)) { const x = routes[k] || (routes[k] = [0, 0]); x[0] += n; x[1] += b; }
  const top = Object.entries(routes).sort((a, b) => b[1][1] - a[1][1]).slice(0, 12).map(([route, [n, b]]) => ({ route, calls: n, mb: +(b / 1048576).toFixed(2) }));
  const perDay = Object.entries(days).sort().map(([day, d]) => ({ day, calls: d.calls, mb: +(d.bytes / 1048576).toFixed(1) }));
  // projection: what the month so far averages per day (working days weigh more, so the projection leans a little high on purpose)
  const proj = { calls: Math.round(tot.calls / cy.elapsed * cy.days), bytes: tot.bytes / cy.elapsed * cy.days };
  return {
    cycle: { from: cy.start.toISOString().slice(0, 10), to: cy.end.toISOString().slice(0, 10), daysLeft: Math.max(0, Math.round(cy.days - cy.elapsed)) },
    monthToDate: { calls: tot.calls, egressMb: +(tot.bytes / 1048576).toFixed(1) },
    projection: { calls: proj.calls, egressMb: Math.round(proj.bytes / 1048576) },
    limits: { calls: LIMITS.calls, egressMb: Math.round(LIMITS.egressBytes / 1048576) },
    pct: { calls: Math.round(proj.calls / LIMITS.calls * 100), egress: Math.round(proj.bytes / LIMITS.egressBytes * 100) },
    perDay, top, note: "Counted by this system since the meter was switched on (19 Oct 2026); the Supabase Usage page is the official figure.",
  };
}

/** every morning: warn the administrators when the projection passes 70 % of a free limit */
export async function usageGuard() {
  const day = cairoDay();
  const st = await getConfig<any>("usage_guard", {});
  if (st.day === day) return { guard: "done today" };
  await setConfig("usage_guard", { day, at: nowIso() });
  const u = await usageSummary();
  if (u.cycle.daysLeft > 28) return { guard: "too early" };
  const warn = u.pct.egress >= 70 || u.pct.calls >= 70;
  if (!warn) return { guard: "ok", pct: u.pct };
  const { data: admins } = await admin.from("app_users").select("id").eq("role", "Admin").eq("active", true);
  await addNotifications((admins || []).map((a: any) => ({ userId: a.id, type: "issue", title: "Usage warning: heading for a free-plan limit", body: `Projected this month: data out ${u.pct.egress}% of 5 GB, server calls ${u.pct.calls}% of 500,000. Open System Health > Usage.` })));
  return { guard: "warned", pct: u.pct };
}

route("GET", "/admin/usage", async ({ c }) => {
  if (!can(c, "canViewAdminPanel")) throw forbidden();
  return await usageSummary();
});
