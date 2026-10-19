// deno-lint-ignore-file no-explicit-any
// SDM Sales Leads — the one API edge function. All routes live in routes_*.ts.
import { admin, Caller, corsHeaders, dropCallerCache, getCaller, getSecret, viewAsCaller, HttpError, json, safeEqual } from "./lib.ts";
import { match, pathExists } from "./router.ts";
import "./routes_core.ts";
import "./routes_tickets.ts";
import "./routes_crm.ts";
import "./routes_crm2.ts";
import "./routes_bd.ts";
import "./integration.ts";
import "./routes_notify.ts";
import "./pool.ts";
import "./targets.ts";
import "./clientissues.ts";
import { route } from "./router.ts";
import { ingestInbox } from "./ingest.ts";
import { syncFacebook } from "./fbsheet.ts";

declare const Deno: any;

// Scheduled mail ingestion (pg_cron -> here). Uses a shared secret instead of a user login, and does nothing
// unless an administrator switched automatic ingestion on.
route("POST", "/cron/ingest", async ({ req }) => {
  const given = req.headers.get("x-cron-secret") || "";
  const want = await getSecret("cron_secret");
  if (!want || !safeEqual(given, want)) throw new HttpError(401, "Not allowed");
  const { data } = await admin.from("system_config").select("value").eq("key", "ingest_auto").maybeSingle();
  if (data?.value !== true) return { skipped: true, reason: "automatic ingestion is off" };
  // the schedule calls this every hour; it only works at 09:00, 12:00 and 15:00 Cairo time, Sunday to Thursday
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  if (["Fri", "Sat"].includes(parts.weekday) || ![9, 12, 15].includes(Number(parts.hour))) return { skipped: true, reason: "outside the sync hours" };
  const m: any = await ingestInbox(25, "Scheduled run").catch((e: any) => ({ mailError: String(e?.message || e).slice(0, 200) }));
  const fb = await syncFacebook({ byUser: "Scheduled run" }).catch(() => ({ fbNew: 0 }));
  return { ...m, ...fb };
}, { public: true });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const wrap = (r: Response) => { for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r; };
  try {
    const url = new URL(req.url);
    // the function name is the first path segment: /api/users -> /users
    const path = url.pathname.replace(/^\/(functions\/v1\/)?api/, "") || "/";
    const m = match(req.method, path);
    if (!m) return wrap(json({ error: pathExists(path) ? "Method not allowed" : "Not found" }, pathExists(path) ? 405 : 404));
    let c: Caller | null = null;
    if (!m.route.isPublic) {
      c = await getCaller(req);
      const as = req.headers.get("x-view-as");
      if (as && c.role === "Admin" && !/^\/(users|admin|auth)/.test(path) && as !== c.id) c = await viewAsCaller(c, as);
    }
    const result = await m.route.handler({ req, c: c as Caller, params: m.params, query: url.searchParams });
    // anything that can change who a person is or what they may do: forget the remembered callers at once
    if (req.method !== "GET" && /^\/(users|role-permissions|me|admin|auth)/.test(path)) dropCallerCache();
    if (result instanceof Response) return wrap(result);
    return wrap(json(result ?? { success: true }));
  } catch (e: any) {
    if (e instanceof HttpError) return wrap(json({ error: e.message, ...(e.extra || {}) }, e.status));
    console.error("api error", e?.message || e);
    return wrap(json({ error: "Something went wrong on the server" }, 500));
  }
});
