// deno-lint-ignore-file no-explicit-any
// 10 Nov 2026: a DIRECT Postgres connection for the server's own bookkeeping (who is calling, permissions, settings, secrets, ids,
// rate limits, usage meter, locks). Every call through the REST gateway (supabase-js) is one line in Log Ingestion (13,400 lines a day,
// ~5 per app request before any real work). A query on this connection writes no log line at all.
// Safety: if the connection cannot be made, every helper falls back to the old gateway path, so the app never stops because of this.
import postgres from "npm:postgres@3.4.5";

declare const Deno: any;

let sql: any = null;
let downUntil = 0;

function client(): any {
  if (sql) return sql;
  const url = Deno.env.get("SUPABASE_DB_URL");
  if (!url || Date.now() < downUntil) return null;
  // one connection per server copy; prepare:false works behind the connection pooler too
  sql = postgres(url, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 5, onnotice: () => {} });
  return sql;
}

/** runs `q` on the direct connection; on a connection problem returns `fallback()` (the gateway path) instead */
export async function pg<T>(q: (sql: any) => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  const s = client();
  if (!s) return fallback();
  try {
    return await q(s);
  } catch (e: any) {
    // a query error (bad data, constraint) is a real answer: the gateway would fail the same way, so report it as before via the fallback
    const conn = /connect|ECONN|timeout|terminat|socket|closed|ENOTFOUND|password|SSL/i.test(String(e?.message || e?.code || ""));
    if (conn) { try { sql?.end?.({ timeout: 1 }); } catch { /* ignore */ } sql = null; downUntil = Date.now() + 60_000; }
    return fallback();
  }
}
