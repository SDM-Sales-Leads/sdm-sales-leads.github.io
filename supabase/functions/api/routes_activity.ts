// deno-lint-ignore-file no-explicit-any
// Rep productivity: what each salesperson did between two moments (calls, WhatsApp, e-mails, meetings, status updates, notes),
// how many different customers that touched, a daily / weekly / monthly series, and when each person was last active.
// Counted from the lead timelines (the one place every action is written with who and when); "last activity" also looks at the
// edit log and the audit trail so a quiet week does not hide a person who saved a lead an hour ago.
import { admin, bad, cairoParts, cairoToMs, crmScope, forbidden, needCrm, pageAll, rateLimit, str } from "./lib.ts";
import { teamIds } from "./routes_crm.ts";
import { SALES_ROLES } from "./ingest.ts";
import { route } from "./router.ts";

const KIND: Record<string, string> = { Call: "calls", WhatsApp: "whatsapp", Email: "emails", Meeting: "meetings", "Status Change": "status", Comment: "notes", Offer: "offers" };
const CONTACT = new Set(["calls", "whatsapp", "emails", "meetings", "status"]);   // a customer counts as contacted when one of these was logged for them
const WHAT: Record<string, string> = { calls: "Call", whatsapp: "WhatsApp", emails: "E-mail", meetings: "Meeting", status: "Status update", notes: "Note", offers: "Offer" };
const nm = (s: any) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const pad = (n: number) => String(n).padStart(2, "0");

/** Cairo wall-clock "YYYY-MM-DDTHH:mm" -> instant (ms), NaN when it is not that shape */
function cairoInput(v: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  return m ? cairoToMs(+m[1], +m[2], +m[3], +m[4], +m[5]) : NaN;
}
/** the bucket an instant falls in, by Cairo time: hour "2026-10-29 14:00", day "2026-10-29", week = the Sunday that starts it, month "2026-10" */
function bucketKey(ms: number, by: string): string {
  const p = cairoParts(ms);
  if (by === "hour") return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:00`;
  if (by === "month") return `${p.y}-${pad(p.m)}`;
  if (by === "week") { const d = new Date(Date.UTC(p.y, p.m - 1, p.d - p.dow)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

route("GET", "/crm/productivity", async ({ c, query }) => {
  needCrm(c);
  const scope = crmScope(c);
  if (scope === "finance") throw forbidden();
  await rateLimit(`prod:${c.id}`, 60, 30);
  const now = Date.now();
  const cp = cairoParts(now);
  const todayStart = cairoToMs(cp.y, cp.m, cp.d, 0, 0);
  let from = cairoInput(str(query.get("from"), 16)), to = cairoInput(str(query.get("to"), 16));
  if (!Number.isFinite(from)) from = todayStart;
  if (!Number.isFinite(to)) to = now;
  if (to > now) to = now;
  if (to <= from) throw bad("The end must be after the start");
  if (to - from > 100 * 86400_000) throw bad("Pick at most 100 days at a time");
  let by = str(query.get("by"), 8);
  if (!["hour", "day", "week", "month"].includes(by)) by = "day";
  if (by === "hour" && to - from > 3 * 86400_000 + 3600_000) by = "day";   // 2,400 hourly columns help nobody

  // who is in the report: the sales people the caller may see
  let ids: string[] | null = null;
  if (scope === "team") ids = await teamIds(c);
  else if (scope === "own") ids = [c.id];
  let uq = admin.from("app_users").select("id,name,role,active,on_leave,team_leader_id").in("role", SALES_ROLES).eq("active", true);
  if (ids) uq = uq.in("id", ids);
  const { data: users } = await uq.limit(500);
  const people = new Map<string, any>();
  const byName = new Map<string, string>();
  for (const u of users || []) {
    people.set(u.id, {
      id: u.id, name: u.name, role: u.role, onLeave: !!u.on_leave,
      counts: { calls: 0, whatsapp: 0, emails: 0, meetings: 0, status: 0, notes: 0, offers: 0 },
      leads: new Set<string>(), contacted: new Set<string>(), days: new Set<string>(),
      series: new Map<string, { contacted: Set<string>; actions: number }>(), recent: [] as any[], lastAt: 0, lastWhat: "", lastLead: "",
    });
    byName.set(nm(u.name), u.id);
  }

  // every lead changed since the start of the range (a timeline event in range always moved updated_at forward; imports sit at 18 Oct)
  const fromIso = new Date(from).toISOString();
  const rows = people.size ? await pageAll((a, b) => admin.from("crm_leads").select("id,tl:data->timeline,cn:data->customerName,co:data->companyName")
    .is("deleted_at", null).gte("updated_at", fromIso).order("id").range(a, b)) : [];
  for (const r of rows as any[]) {
    for (const e of Array.isArray(r.tl) ? r.tl : []) {
      const kind = KIND[String(e?.type)];
      if (!kind) continue;
      const uid = byName.get(nm(e.user));
      if (!uid) continue;
      const ts = Date.parse(e.timestamp);
      if (!Number.isFinite(ts) || ts > now + 60_000) continue;   // a call booked for later is not done yet
      const p = people.get(uid);
      if (ts > p.lastAt) { p.lastAt = ts; p.lastWhat = WHAT[kind]; p.lastLead = r.id; }
      if (ts < from || ts > to) continue;
      p.counts[kind]++;
      p.leads.add(r.id);
      if (CONTACT.has(kind)) p.contacted.add(r.id);
      p.days.add(bucketKey(ts, "day"));
      const k = bucketKey(ts, by);
      const b = p.series.get(k) || p.series.set(k, { contacted: new Set<string>(), actions: 0 }).get(k)!;
      b.actions++;
      if (CONTACT.has(kind)) b.contacted.add(r.id);
      p.recent.push({ at: ts, what: WHAT[kind], leadId: r.id, customer: String(r.cn || r.co || "") });
    }
  }

  // last activity of any kind, whatever the range: the edit log and the audit trail
  await Promise.all([...people.keys()].map(async (uid) => {
    const p = people.get(uid);
    const [lg, au] = await Promise.all([
      admin.from("activity_logs").select("at,action").eq("user_id", uid).in("action", ["Update Lead", "Create CRM leads"]).order("at", { ascending: false }).limit(1),
      admin.from("crm_lead_audit").select("at,action,lead_id").eq("actor_id", uid).order("at", { ascending: false }).limit(1),
    ]);
    const l = lg.data?.[0], a = au.data?.[0];
    const lt = l ? Date.parse(l.at) : 0, at = a ? Date.parse(a.at) : 0;
    if (lt > p.lastAt && lt >= at) { p.lastAt = lt; p.lastWhat = "Saved a lead"; p.lastLead = ""; }
    else if (at > p.lastAt) { p.lastAt = at; p.lastWhat = a.action === "status" ? "Status update" : a.action === "owner" ? "Changed the owner" : "Updated a lead"; p.lastLead = a.lead_id || ""; }
  }));

  // the columns of the series: every bucket from the start to the end, empty ones included
  const buckets: string[] = [];
  const step = by === "hour" ? 3600_000 : 6 * 3600_000;
  for (let t = from; t <= to + step; t += step) { const k = bucketKey(Math.min(t, to), by); if (buckets[buckets.length - 1] !== k) buckets.push(k); }

  const out = [...people.values()].map((p) => {
    const actions = Object.values(p.counts as Record<string, number>).reduce((x, y) => x + y, 0);
    return {
      id: p.id, name: p.name, role: p.role, onLeave: p.onLeave,
      contacted: p.contacted.size, leadsTouched: p.leads.size, actions, activeDays: p.days.size, ...p.counts,
      lastAt: p.lastAt ? new Date(p.lastAt).toISOString() : null, lastWhat: p.lastAt ? p.lastWhat : "", lastLead: p.lastLead,
      activeToday: p.lastAt >= todayStart,
      series: buckets.map((k) => { const b = p.series.get(k); return { k, contacted: b ? b.contacted.size : 0, actions: b ? b.actions : 0 }; }),
      recent: p.recent.sort((x: any, y: any) => y.at - x.at).slice(0, 12).map((x: any) => ({ ...x, at: new Date(x.at).toISOString() })),
    };
  }).sort((x, y) => y.contacted - x.contacted || y.actions - x.actions || x.name.localeCompare(y.name));

  return {
    success: true, by, buckets, from: new Date(from).toISOString(), to: new Date(to).toISOString(), todayStart: new Date(todayStart).toISOString(), now: new Date(now).toISOString(),
    scope: scope === "own" ? "own" : scope === "team" ? "team" : "all", people: out,
  };
});

