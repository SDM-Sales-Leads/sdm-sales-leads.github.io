// fake supabase client: every query resolves { data: null }; app_get_secret reads globalThis.__secrets
const chain = () => { const p = new Proxy(function () {}, { get(_, k) { if (k === "then") return (res) => res({ data: null, error: null }); return () => p; }, apply() { return p; } }); return p; };
export function createClient() { return { from: () => chain(), rpc: async (fn, a) => fn === "app_get_secret" ? { data: (globalThis.__secrets || {})[a.p_name] ?? null } : { data: null }, auth: {}, storage: { from: () => chain() } }; }
export default function postgres() { throw new Error("no db"); }
