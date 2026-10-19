// deno-lint-ignore-file no-explicit-any
// What the browsers report about themselves: freezes, slow or failing calls, script errors, blank pages, automatic reloads, several tabs.
// Stored in the activity log (type "client-issue"); the serious kinds ring the bell of every administrator (at most one per kind per hour).
import { admin, body, can, forbidden, getConfig, needAdmin, nowIso, rateLimit, setConfig, str } from "./lib.ts";
import { route } from "./router.ts";
import { addNotifications } from "./notify.ts";

const LABEL: Record<string, string> = {
  freeze: "page froze", api_slow: "slow server call", api_fail: "server call failed", api_401: "login not accepted", js_error: "script error", js_promise: "script error",
  render_error: "page crashed", white_page: "blank page", slow_load: "slow start", auto_reload: "automatic reload", reload: "page reloaded", multi_tab: "several tabs open",
};
const SERIOUS = new Set(["freeze", "render_error", "white_page", "js_error", "auto_reload", "api_401"]);

route("POST", "/client-issues", async ({ req, c }) => {
  await rateLimit(`cliiss:${c.id}`, 3600, 250);
  const b = await body(req, 30_000);
  const evs = (Array.isArray(b.events) ? b.events : []).slice(0, 20).filter((e: any) => e && LABEL[String(e.k)]);
  if (!evs.length) return { ok: true };
  const rows = evs.map((e: any) => ({
    user_id: c.id, user_name: c.name, type: "client-issue", action: `App issue: ${LABEL[String(e.k)]}`,
    details: JSON.stringify({ k: str(e.k, 20), m: str(e.m, 200), p: str(e.p, 60), ms: Number.isFinite(Number(e.ms)) ? Math.round(Number(e.ms)) : null, tabs: Math.min(20, Number(e.tabs) || 1), ua: str(b.ua, 110), w: Number(b.w) || null, net: str(b.net, 10) }).slice(0, 590),
  }));
  await admin.from("activity_logs").insert(rows);
  // the bell for administrators, one per kind per hour
  const bell = await getConfig<Record<string, number>>("issue_bell", {});
  const fresh: any[] = [];
  for (const e of evs) { const k = String(e.k); if (SERIOUS.has(k) && !fresh.some((x) => x.k === k) && Date.now() - (bell[k] || 0) > 3600_000) fresh.push({ k, e }); }
  if (fresh.length) {
    const { data: admins } = await admin.from("app_users").select("id").eq("role", "Admin").eq("active", true);
    await addNotifications((admins || []).flatMap((a: any) => fresh.map(({ k, e }) => ({ userId: a.id, type: "issue", title: `App issue: ${LABEL[k]} (${c.name})`, body: `${str(e.p, 60)} · ${str(e.m, 160)}` }))));
    for (const { k } of fresh) bell[k] = Date.now();
    await setConfig("issue_bell", bell);
  }
  return { ok: true };
});

route("GET", "/admin/client-issues", async ({ c, query }) => {
  if (!can(c, "canViewAdminPanel")) throw forbidden();
  const days = Math.max(1, Math.min(60, parseInt(query.get("days") || "7") || 7));
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data } = await admin.from("activity_logs").select("id,at,user_name,action,details").eq("type", "client-issue").gte("at", since).order("at", { ascending: false }).limit(800);
  const items = (data || []).map((r: any) => { let d: any = {}; try { d = JSON.parse(r.details || "{}"); } catch { /* old row */ } return { id: r.id, at: r.at, user: r.user_name, kind: d.k || "", label: LABEL[d.k] || r.action, page: d.p || "", message: d.m || "", ms: d.ms ?? null, tabs: d.tabs || 1, ua: d.ua || "", width: d.w || null, net: d.net || "" }; });
  return { days, since, items, now: nowIso() };
});
void needAdmin;
