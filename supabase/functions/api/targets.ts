// deno-lint-ignore-file no-explicit-any
// Sales targets per salesperson for a month, a quarter or a year. Sales Operation / Admin set anybody's; a Team Leader sets their team's.
// Every change is written to a log (from, to, who, when) kept in system_config and in the activity log.
import { admin, bad, body, Caller, crmScope, forbidden, getConfig, logActivity, needCrm, nowIso, setConfig, str } from "./lib.ts";
import { route } from "./router.ts";
import { teamIds } from "./routes_crm.ts";

const KEY = /^(Y\d{4}|Q\d{4}-[1-4]|M\d{4}-(0[1-9]|1[0-2]))$/;

async function visibleIds(c: Caller): Promise<string[] | "all"> {
  const s = crmScope(c);
  if (s === "all" || s === "viewall") return "all";
  if (s === "team") return await teamIds(c);
  return [c.id];
}
const canSet = async (c: Caller, userId: string) => {
  if (crmScope(c) === "all") return true;
  if (c.role === "Sales Team Leader") return userId !== c.id && (await teamIds(c)).includes(userId);
  return false;
};

route("GET", "/crm/targets", async ({ c }) => {
  needCrm(c);
  if (c.perms?.canViewSalesTargets !== true && crmScope(c) !== "all") throw forbidden();
  const vis = await visibleIds(c);
  const all = await getConfig<Record<string, Record<string, number>>>("sales_targets", {});
  const log = await getConfig<any[]>("sales_targets_log", []);
  const targets: Record<string, Record<string, number>> = {};
  for (const [u, v] of Object.entries(all)) if (vis === "all" || vis.includes(u)) targets[u] = v;
  const canEditAny = crmScope(c) === "all" || c.role === "Sales Team Leader";
  return { targets, log: log.filter((e) => vis === "all" || vis.includes(e.userId)).slice(0, 300), canEdit: canEditAny, editable: crmScope(c) === "all" ? "all" : c.role === "Sales Team Leader" ? (await teamIds(c)).filter((x) => x !== c.id) : [] };
});

route("POST", "/crm/targets", async ({ req, c }) => {
  needCrm(c);
  const b = await body(req, 5_000);
  const userId = str(b.userId, 60), key = str(b.key, 12);
  if (!KEY.test(key)) throw bad("Choose a month, a quarter or a year");
  const raw = b.amount;
  const amount = raw === null || raw === "" ? null : Number(raw);
  if (amount !== null && !(Number.isFinite(amount) && amount >= 0 && amount <= 1e12)) throw bad("The target must be a number (EGP), zero or more");
  if (!userId || !(await canSet(c, userId))) throw forbidden();
  const { data: u } = await admin.from("app_users").select("id,name,role,annual_target").eq("id", userId).maybeSingle();
  if (!u) throw bad("Unknown salesperson");
  const all = await getConfig<Record<string, Record<string, number>>>("sales_targets", {});
  const mine = { ...(all[userId] || {}) };
  // the year shown before this feature existed is the annual target stored on the user
  const from = mine[key] ?? (key.startsWith("Y") ? (u.annual_target ?? null) : null);
  if ((from ?? null) === amount) return { success: true, unchanged: true };
  if (amount === null) delete mine[key]; else mine[key] = amount;
  await setConfig("sales_targets", { ...all, [userId]: mine });
  if (key === `Y${new Date().getUTCFullYear()}`) await admin.from("app_users").update({ annual_target: amount }).eq("id", userId);
  const entry = { at: nowIso(), byId: c.id, byName: c.name, userId, userName: u.name, key, from, to: amount };
  const log = await getConfig<any[]>("sales_targets_log", []);
  await setConfig("sales_targets_log", [entry, ...log].slice(0, 1000));
  await logActivity(c, "Target changed", `${u.name} ${key}: ${from ?? "not set"} -> ${amount ?? "not set"} EGP`, "admin");
  return { success: true, entry };
});
