// deno-lint-ignore-file no-explicit-any
// 22 Nov 2026: one set of users for sdm-sales-leads and sdm-land-bank (migration 0033, land bank web-seed sql_18 + function sid-authsync).
// This system is where users are managed. /cron/authsync runs every minute (pg_cron):
//  - a person here without a land bank login gets one (same email, same password hash, mapped role and team);
//  - a password changed in either system is copied to the other (bcrypt hash only; whichever side changed since the last sync wins;
//    on the very first sync this system's password wins);
//  - name/role/team/active are sent only when they changed HERE, so a role adjusted by hand in the land bank stays until the person
//    changes here; a person switched off here is blocked in the land bank (never deleted).
// Land bank calls back to /integration/authsync-verify to check our secret, so the secret is never copied to the land bank.
import { admin, getSecret, HttpError, safeEqual, nowIso } from "./lib.ts";
import { pg } from "./db.ts";
import { route } from "./router.ts";

const LB_FN = "https://ihjlvxmttvjcciafruya.supabase.co/functions/v1/sid-authsync";

// Sales Leads role -> land bank role (Walid, 22 Nov 2026). Anything else -> viewer.
const ROLE_MAP: Record<string, string> = {
  "Admin": "admin",
  "Sales Director": "sales-director",   // own land bank role since 22 Nov 2026 (Sales Manager + CEO, executive, demand)
  "Sales Team Leader": "sales-manager",
  "Sales Rep": "sales",
  "Sales Operation": "sales-operation",
  "Finance": "finance-dev",
  "Finance Manager": "finance-dev",
};
const TEAM_ROLES = new Set(["Sales Rep", "Sales Team Leader"]);

async function fingerprint(s: string) {
  // Web Crypto has no MD5: the fingerprint only needs to be stable, so SHA-256 of the JSON is used for the profile
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function lb(body: any) {
  const secret = await getSecret("authsync_secret");
  if (!secret) throw new Error("authsync secret missing");
  const r = await fetch(LB_FN, { method: "POST", headers: { "Content-Type": "application/json", "x-authsync-secret": secret }, body: JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`land bank ${r.status}: ${String(j?.error || "").slice(0, 150)}`);
  return j;
}

const q1 = <T>(name: string, sqlFn: (s: any) => Promise<T>, args: Record<string, unknown>) =>
  pg(sqlFn, async () => { const { data, error } = await admin.rpc(name, args); if (error) throw error; return data as T; });

/** team name in the land bank: an existing team that carries the leader's first name, else "Team <leader name>" */
function teamFor(leaderName: string | null, teams: string[]) {
  if (!leaderName) return null;
  const first = leaderName.trim().split(/\s+/)[0].toLowerCase();
  const hit = teams.find((t) => t.toLowerCase().split(/\s+/).includes(first));
  return hit || `Team ${leaderName.trim()}`;
}

export async function runAuthSync() {
  const users: any[] = await q1("app_authsync_users", (s) => s`select * from app_authsync_users()`, {});
  const states: any[] = await pg((s) => s`select email, fp, profile_fp from authsync_state`, async () => (await admin.from("authsync_state").select("email, fp, profile_fp")).data ?? []);
  const st = new Map(states.map((r: any) => [r.email, r]));
  const lbState = await lb({ action: "state", emails: users.map((u) => u.email) });
  const lbRows = new Map((lbState.rows ?? []).map((r: any) => [r.email, r]));
  const teams: string[] = lbState.teams ?? [];

  const apply: any[] = [];
  const pulled: string[] = [];
  const newState: Record<string, { fp: string; profile_fp: string }> = {};
  for (const u of users) {
    const L: any = lbRows.get(u.email);
    const S: any = st.get(u.email);
    const lbRole = ROLE_MAP[u.role] || "viewer";
    const leaderName = u.role === "Sales Team Leader" ? u.name : u.leader_name;
    const team = TEAM_ROLES.has(u.role) ? teamFor(leaderName, teams) : undefined;
    const profile = { name: u.name, role: lbRole, ...(team !== undefined ? { team } : {}), active: u.active };
    const pfp = await fingerprint(JSON.stringify(profile));
    const item: any = { email: u.email };
    let fp = u.fp;

    if (!L || !S || S.profile_fp !== pfp) Object.assign(item, profile);   // new to the land bank, first sync, or changed here
    if (!L || L.fp !== u.fp) {
      if (L && S && S.fp === u.fp && L.fp !== S.fp) {
        // only the land bank changed since the last sync -> copy its password here
        const h = await lb({ action: "hash", email: u.email });
        if (h.hash) {
          await q1("app_authsync_set_hash", (s) => s`select app_authsync_set_hash(${u.email}, ${h.hash})`, { p_email: u.email, p_hash: h.hash });
          fp = L.fp; pulled.push(u.email);
        }
      } else {
        // new person, first sync, or changed here (or both: this system wins) -> send our password hash
        item.hash = await q1("app_authsync_hash", (s) => s`select app_authsync_hash(${u.email}) as h`.then((r: any) => r[0]?.h), { p_email: u.email });
      }
    }
    if (Object.keys(item).length > 1) apply.push(item);
    newState[u.email] = { fp, profile_fp: pfp };
  }

  const results: any[] = [];
  for (let i = 0; i < apply.length; i += 25) {
    const r = await lb({ action: "apply", users: apply.slice(i, i + 25) });
    results.push(...(r.done ?? []));
  }
  const failed = new Map(results.filter((r) => !r.ok).map((r) => [r.email, r.error]));
  const rows = Object.entries(newState).map(([email, v]) => failed.has(email)
    ? { email, fp: st.get(email)?.fp ?? null, profile_fp: st.get(email)?.profile_fp ?? null, last_error: failed.get(email), synced_at: nowIso() }
    : { email, ...v, last_error: null, synced_at: nowIso() });
  if (apply.length || pulled.length || states.length !== users.length || failed.size) {
    const { error } = await admin.from("authsync_state").upsert(rows, { onConflict: "email" });
    if (error) throw error;
  }
  return {
    users: users.length, sent: apply.length, created: results.filter((r) => r.created).length,
    passwordsToLandBank: apply.filter((a) => a.hash).length, passwordsFromLandBank: pulled.length,
    failed: Object.fromEntries(failed),
  };
}

route("POST", "/cron/authsync", async ({ req }) => {
  const given = req.headers.get("x-cron-secret") || "";
  const want = await getSecret("cron_secret");
  if (!want || !safeEqual(given, want)) throw new HttpError(401, "Not allowed");
  return await runAuthSync();
}, { public: true });

// the land bank function asks: is this really our sync secret?
route("POST", "/integration/authsync-verify", async ({ req }) => {
  const given = req.headers.get("x-authsync-secret") || "";
  const want = await getSecret("authsync_secret");
  if (!want || !safeEqual(given, want)) throw new HttpError(401, "Not allowed");
  return { ok: true };
}, { public: true });
