// deno-lint-ignore-file no-explicit-any
// Smart Assistant, server part (docs/LARA-SALES-AI-PLAN.md, phase 1).
//  - POST /smart/use       count that the caller used a feature today (one counter row per day, person and feature)
//  - GET  /smart/usage     admin: which features are used, by how many people (feeds the "tips from usage" later)
// No AI here (owner, 10 Nov 2026: AI only where really needed; the message writer runs in the browser without AI).
import { admin, bad, body, can, HttpError, needCrm, rateLimit, str } from "./lib.ts";
import { route } from "./router.ts";
import { pg } from "./db.ts";

const cairoDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

route("POST", "/smart/use", async ({ req, c }) => {
  needCrm(c);
  const b = await body(req, 500);
  const f = str(b?.feature, 40).replace(/[^a-z0-9_]/gi, "");
  if (!f) throw bad("feature?");
  await rateLimit(`smartuse:${c.id}`, 3600, 120);
  const day = cairoDay();
  await pg(async (q) => { await q`select feature_hit(${day}, ${c.id}, ${f})`; },
    async () => { await admin.rpc("feature_hit", { p_day: day, p_user: c.id, p_feature: f }); }).catch(() => {});
  return { success: true };
});

route("GET", "/smart/usage", async ({ c, query }) => {
  needCrm(c);
  if (!can(c, "canViewAdminPanel")) throw new HttpError(403, "Only administrators");
  const days = Math.min(90, Math.max(1, Number(query.get("days")) || 30));
  const from = cairoDay(new Date(Date.now() - days * 864e5));
  const { data, error } = await admin.from("usage_feature_daily").select("day,user_id,feature,uses").gte("day", from).limit(20000);
  if (error) throw new HttpError(500, "Could not read the feature counter");
  const by = new Map<string, { feature: string; uses: number; people: Set<string>; days: Set<string> }>();
  for (const r of data || []) {
    const e = by.get(r.feature) || { feature: r.feature, uses: 0, people: new Set(), days: new Set() };
    e.uses += r.uses; e.people.add(r.user_id); e.days.add(r.day); by.set(r.feature, e);
  }
  return { success: true, from, rows: [...by.values()].map((e) => ({ feature: e.feature, uses: e.uses, people: e.people.size, days: e.days.size })).sort((a, b) => b.uses - a.uses) };
});
