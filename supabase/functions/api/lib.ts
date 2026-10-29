// deno-lint-ignore-file no-explicit-any
// Shared helpers for the `api` edge function: client, auth, permissions, validation, logging.
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

export const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL")!;
export const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------------------------
// responses & errors
// ---------------------------------------------------------------------------------------------
export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}
export const bad = (m: string, extra?: Record<string, unknown>) => new HttpError(400, m, extra);
export const forbidden = (m = "You do not have permission for this action") => new HttpError(403, m);
export const notFound = (m = "Not found") => new HttpError(404, m);

const DEFAULT_ORIGINS = [
  "https://sdm-sales-leads.github.io",
  "https://sdm-land-bank.github.io",
  "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173",
];
export function allowedOrigins(): string[] {
  const env = Deno.env.get("ALLOWED_ORIGINS");
  return env ? env.split(",").map((s: string) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
}
export function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-view-as",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins().includes(origin)) { h["Access-Control-Allow-Origin"] = origin; h["Timing-Allow-Origin"] = origin; }
  return h;
}
export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

// ---------------------------------------------------------------------------------------------
// auth & permissions
// ---------------------------------------------------------------------------------------------
export interface Caller {
  id: string;
  email: string;
  name: string;
  role: string;
  department: string | null;
  teamLeaderId: string | null;
  mustChangePassword: boolean;
  perms: Record<string, any>;
}

const FALLBACK_PERMS: Record<string, any> = {
  canViewDashboard: true,
  canViewTickets: true,
  canViewKnowledgeBase: true,
};

// Who is calling? Three database/auth round trips (verify the token, load the user, load the role's permissions)
// used to run on EVERY request (~350 ms of every call). Both answers are now remembered briefly in this
// function instance: the token check for 60 s, the user + permissions for 20 s. Any change to users or roles
// clears them at once (see index.ts); a disabled person loses access within a minute at most.
const tokenCache = new Map<string, { uid: string; until: number }>();
const callerCache = new Map<string, { until: number; caller: Caller }>();
const TOKEN_TTL = 60_000, CALLER_TTL = 20_000;
export function dropCallerCache() { tokenCache.clear(); callerCache.clear(); }

// Token check without a trip to the Auth service: this project signs its tokens (ES256) with a public key, so the signature,
// expiry and audience are verified here with the published key (kept for an hour). Anything unusual (another algorithm, key not
// found) falls back to asking Auth. A temporary Auth failure answers 503 "busy", never 401, so nobody is logged out by a hiccup.
const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
let jwkCache: { at: number; keys: Map<string, CryptoKey> } | null = null;
async function jwkFor(kid: string, force = false): Promise<CryptoKey | null> {
  if (!force && jwkCache && Date.now() - jwkCache.at < 3600_000 && jwkCache.keys.has(kid)) return jwkCache.keys.get(kid)!;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, { headers: { apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "" } });
  if (!r.ok) throw new Error("jwks " + r.status);
  const keys = new Map<string, CryptoKey>();
  for (const k of (await r.json()).keys || []) {
    if (k.kty !== "EC" || k.crv !== "P-256" || !k.kid) continue;
    keys.set(k.kid, await crypto.subtle.importKey("jwk", { kty: k.kty, crv: k.crv, x: k.x, y: k.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
  }
  jwkCache = { at: Date.now(), keys };
  return keys.get(kid) || null;
}
/** user id from a valid token; null = the token is not valid (or cannot be judged locally -> ask Auth) */
async function localUid(token: string): Promise<{ uid: string } | "invalid" | null> {
  try {
    const [h, p, sig] = token.split(".");
    if (!h || !p || !sig) return "invalid";
    const head = JSON.parse(new TextDecoder().decode(b64u(h)));
    if (head.alg !== "ES256" || !head.kid) return null;                       // not what we can judge here: ask Auth
    let key = await jwkFor(head.kid);
    if (!key) key = await jwkFor(head.kid, true);
    if (!key) return null;
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64u(sig), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return "invalid";
    const pay = JSON.parse(new TextDecoder().decode(b64u(p)));
    if (!pay.sub || (pay.exp && pay.exp * 1000 < Date.now()) || (pay.aud && pay.aud !== "authenticated")) return "invalid";
    return { uid: String(pay.sub) };
  } catch { return null; }
}

export async function getCaller(req: Request): Promise<Caller> {
  const h = req.headers.get("authorization") || "";
  const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Sign in required");
  const now = Date.now();
  let uid = tokenCache.get(token)?.until! > now ? tokenCache.get(token)!.uid : "";
  if (!uid) {
    const local = await localUid(token);
    if (local === "invalid") throw new HttpError(401, "Session expired, sign in again");
    if (local) uid = local.uid;
    else {
      let res: any = null;
      for (let i = 0; i < 2 && !(res?.data?.user); i++) res = await admin.auth.getUser(token).catch((e: any) => ({ error: e }));
      if (!res?.data?.user) {
        const st = Number(res?.error?.status || 0);
        // Auth says "this token is bad" (4xx) = sign in again; Auth failing or unreachable = busy, try again
        if (st >= 400 && st < 500) throw new HttpError(401, "Session expired, sign in again");
        throw new HttpError(503, "The sign-in service is busy. Please try again in a moment.");
      }
      uid = res.data.user.id;
    }
    if (tokenCache.size > 400) tokenCache.clear();
    tokenCache.set(token, { uid, until: now + TOKEN_TTL });
  }
  const hit = callerCache.get(uid);
  if (hit && hit.until > now) return hit.caller;
  const caller = await callerFromRow((await admin.from("app_users").select("*").eq("id", uid).maybeSingle()).data, uid);
  return caller;
}

async function callerFromRow(u: any, cacheKey: string): Promise<Caller> {
  const now = Date.now();
  if (!u || !u.active) { callerCache.delete(cacheKey); throw new HttpError(403, "This account is not active"); }
  const { data: rp } = await admin.from("role_permissions").select("perms").eq("role", u.role).maybeSingle();
  const caller: Caller = {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    department: u.department,
    teamLeaderId: u.team_leader_id,
    mustChangePassword: !!u.must_change_password,
    perms: { ...FALLBACK_PERMS, ...(rp?.perms || {}) },
  };
  if (callerCache.size > 400) callerCache.clear();
  callerCache.set(cacheKey, { until: now + CALLER_TTL, caller });
  return caller;
}

/** Caller for an already verified e-mail address (used by the Land Bank integration). Matches app_users case-insensitively. */
export async function callerFromEmail(email: string): Promise<Caller> {
  const e = String(email || "").trim().toLowerCase();
  if (!e || e.length > 254) throw new HttpError(403, "This account has no access to Sales Leads");
  const hit = callerCache.get("email:" + e);
  if (hit && hit.until > Date.now()) return hit.caller;
  const { data } = await admin.from("app_users").select("*").ilike("email", e.replace(/[%_\\]/g, (m) => "\\" + m)).limit(2);
  const rows = (data || []).filter((r: any) => String(r.email || "").toLowerCase() === e);
  if (rows.length !== 1) throw new HttpError(403, "This account has no access to Sales Leads");
  return await callerFromRow(rows[0], "email:" + e);
}

/** an administrator looking at the system as another person ("view as"): everything is judged with that person's role and data */
export async function viewAsCaller(admin0: Caller, targetId: string): Promise<Caller> {
  if (admin0.role !== "Admin") throw new HttpError(403, "Only an administrator can view as another user");
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) throw new HttpError(400, "Unknown user");
  const { data } = await admin.from("app_users").select("*").eq("id", targetId).maybeSingle();
  if (!data) throw new HttpError(404, "User not found");
  const hit = callerCache.get("viewas:" + targetId);
  if (hit && hit.until > Date.now()) return { ...hit.caller, mustChangePassword: false };
  return { ...(await callerFromRow({ ...data, active: true }, "viewas:" + targetId)), mustChangePassword: false };
}

export const isAdmin = (c: Caller) => c.role === "Admin";
export const can = (c: Caller, perm: string) => isAdmin(c) || c.perms[perm] === true;
export function need(c: Caller, perm: string) {
  if (!can(c, perm)) throw forbidden();
}
export function needAdmin(c: Caller) {
  if (!isAdmin(c)) throw forbidden("Administrators only");
}
// "management" = can open the admin panel (Admin, Sales Operation...)
export const isManager = (c: Caller) => can(c, "canViewAdminPanel");

export type CrmScope = "all" | "team" | "own" | "finance" | "viewall";
export function crmScope(c: Caller): CrmScope {
  if (isAdmin(c) || c.role === "Sales Operation" || c.perms.canViewSalesRules === true || c.perms.canDistributeLeads === true) return "all";
  if (c.role === "Sales Team Leader") return "team";
  if (c.perms.canConfirmCash === true) return "finance"; // accounts receivable: won deals only
  if (c.perms.canViewAllLeads === true || c.perms.canEditLeadIdentity === true) return "viewall"; // sees everything, changes only what the role allows
  return "own";
}
export function needCrm(c: Caller) {
  if (!can(c, "canViewSalesCrm")) throw forbidden();
}

// ---------------------------------------------------------------------------------------------
// rate limit, locks, secrets, logs
// ---------------------------------------------------------------------------------------------
export async function rateLimit(bucket: string, windowSec: number, limit: number) {
  const { data, error } = await admin.rpc("app_rate_hit", { p_bucket: bucket, p_window_seconds: windowSec, p_limit: limit });
  if (error) return; // never block on limiter failure
  if (data === false) throw new HttpError(429, "Too many requests, try again later");
}
export async function tryLock(name: string, seconds: number): Promise<boolean> {
  const { data } = await admin.rpc("app_try_lock", { p_name: name, p_seconds: seconds });
  return data === true;
}
export async function unlock(name: string) {
  await admin.rpc("app_unlock", { p_name: name });
}
export async function getSecret(name: string): Promise<string | null> {
  const { data } = await admin.rpc("app_get_secret", { p_name: name });
  return typeof data === "string" && data ? data : null;
}
export async function hasSecret(name: string): Promise<boolean> {
  const { data } = await admin.rpc("app_has_secret", { p_name: name });
  return data === true;
}
export async function setSecret(name: string, value: string) {
  const { error } = await admin.rpc("app_set_secret", { p_name: name, p_value: value });
  if (error) throw new HttpError(500, "Could not store the secret");
}

export async function logActivity(c: Caller | null, action: string, details: string, type = "system") {
  await admin.from("activity_logs").insert({
    user_id: c?.id ?? null,
    user_name: c?.name ?? "System",
    action: action.slice(0, 120),
    details: details.slice(0, 600),
    type,
  });
}

export async function getConfig<T = any>(key: string, fallback: T): Promise<T> {
  const { data } = await admin.from("system_config").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
export async function setConfig(key: string, value: unknown) {
  await admin.from("system_config").upsert({ key, value, updated_at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------------------------
// request body & validation
// ---------------------------------------------------------------------------------------------
export async function body(req: Request, maxBytes = 2_000_000): Promise<any> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > maxBytes) throw new HttpError(413, "Request too large");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request too large");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw bad("Invalid JSON");
  }
}
export const isObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);
export function str(v: any, max = 500): string {
  if (v === undefined || v === null) return "";
  return String(v).trim().slice(0, max);
}
export const isEmail = (s: string) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s) && s.length <= 254;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const asUuid = (v: any): string | null => (typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null);

// keys that must never be copied from client objects
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export function clean<T = any>(v: T, depth = 0): T {
  if (depth > 12) return undefined as any;
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1)) as any;
  if (v && typeof v === "object") {
    const o: any = {};
    for (const k of Object.keys(v as any)) if (!BAD_KEYS.has(k)) o[k] = clean((v as any)[k], depth + 1);
    return o;
  }
  return v;
}

export function normPhone(p: any): string {
  if (!p) return "";
  let n = String(p).trim().replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (n.startsWith("0020") && n.length === 14) n = "0" + n.slice(4);
  else if (n.startsWith("20") && n.length === 12) n = "0" + n.slice(2);
  else if (n.length === 10 && n.startsWith("1")) n = "0" + n;
  return n;
}
export const normEmail = (e: any) => (e ? String(e).trim().toLowerCase() : "");
export const normName = (n: any) => (n ? String(n).trim().toLowerCase().replace(/\s+/g, " ") : "");

export const escHtml = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const escXml = escHtml;

export const nowIso = () => new Date().toISOString();
export const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 9);

// constant-time string compare
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * The database answers at most 1000 rows per request, whatever .limit() says. This reads page after page
 * (make(from,to) builds the query for one page) so lists with thousands of rows come back complete.
 */
export async function pageAll<T = any>(make: (from: number, to: number) => any, max = 50000): Promise<T[]> {
  // the first page decides; if it is full, the next pages are read in parallel waves (was one page after another)
  const WAVE = 4;
  const read = async (from: number): Promise<T[]> => {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error("page read failed");
    return (data || []) as T[];
  };
  const rows: T[] = await read(0);
  let from = 1000;
  while (rows.length === from && from < max) {
    const starts: number[] = [];
    for (let i = 0; i < WAVE && from + i * 1000 < max; i++) starts.push(from + i * 1000);
    const pages = await Promise.all(starts.map(read));
    let short = false;
    for (const pg of pages) { rows.push(...pg); if (pg.length < 1000) short = true; }
    if (short) break;
    from += starts.length * 1000;
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// working time: workflow SLAs count WORKING hours (9 per day: 08:00-17:00 Cairo time, Sunday to Thursday), not elapsed hours
// ---------------------------------------------------------------------------------------------
export interface WorkWeek { start: number; end: number; days: number[] } // hours of the day, days 0=Sunday
export const WORK_WEEK: WorkWeek = { start: 8, end: 17, days: [0, 1, 2, 3, 4] };
const CAIRO = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function cairoParts(ms: number) {
  const p: Record<string, string> = {};
  for (const x of CAIRO.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, dow: DOW[p.weekday] ?? 0 };
}
/** the instant at which Cairo wall-clock reads y-m-d h:mi (handles the summer-time offset) */
export function cairoToMs(y: number, m: number, d: number, h: number, mi: number): number {
  const target = Date.UTC(y, m - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = cairoParts(guess);
    guess += target - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  }
  return guess;
}
/** start + N working hours, skipping nights and the weekend */
export function addWorkingHours(startMs: number, hours: number, w: WorkWeek = WORK_WEEK): number {
  let left = Math.round(hours * 60);
  let cur = startMs;
  for (let guard = 0; guard < 800 && left > 0; guard++) {
    const p = cairoParts(cur);
    const mins = p.h * 60 + p.mi, s = w.start * 60, e = w.end * 60;
    if (!w.days.includes(p.dow) || mins >= e) {
      const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
      cur = cairoToMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), w.start, 0);
      continue;
    }
    if (mins < s) { cur = cairoToMs(p.y, p.m, p.d, w.start, 0); continue; }
    const take = Math.min(left, e - mins);
    cur += take * 60000; left -= take;
    if (left > 0) {
      const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
      cur = cairoToMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), w.start, 0);
    }
  }
  return cur;
}
