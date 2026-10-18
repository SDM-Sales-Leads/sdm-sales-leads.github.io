// deno-lint-ignore-file no-explicit-any
// Sales CRM: leads, contacts, companies, tasks, activities, mail logs, queue settings, mailbox.
//
// Saving model: the browser sends { upserts: [rows], deletes: [ids] } — only what changed. Every row carries
// `_rev` (the row's updated_at when it was loaded). A save is refused for a row that someone else changed since
// (409-style "conflicts"), so two people can no longer overwrite each other. Deleting a lead is a soft delete.
import { syncFacebook } from "./fbsheet.ts";
import { later, notifyAssigned, notifyChanged, type Assigned, type Changed } from "./notify.ts";
import {
  admin, asUuid, bad, body, pageAll, can, Caller, clean, crmScope, CrmScope, forbidden, getConfig, HttpError, isAdmin, isObj, logActivity, need,
  needAdmin, needCrm, normEmail, normName, normPhone, nowIso, rateLimit, rid, setConfig, str,
} from "./lib.ts";
import { route } from "./router.ts";
import { canonicalPark } from "./parks.ts";
import { CUSTOM_STATUSES, sanitizeLead } from "./leadrules.ts";
import { getBody, htmlToText, listFolder, loadEws } from "./ews.ts";
import { sqmOf } from "./routing_pick.ts";
import {
  channelFromMail, chooseAgent, cleanDescription, DEFAULT_QUEUE, ensureContactAndCompany, ensureContactsAndCompaniesBulk, ingestInbox, leadColumns, loadQueue, nextId, parseMail,
} from "./ingest.ts";

const ID_RE = /^[A-Za-z0-9_.:-]{1,60}$/;
const METHODS = ["Round Robin", "Least Active Leads", "Least Total Leads", "Least Open Sqm", "Balanced Sqm and Leads", "Random", "Project Based", "Required Size", "Lead Source", "Priority Based", "Working Hours", "VIP Customer Routing", "Company Industry Routing", "Manual Assignment Only"];

export async function teamIds(c: Caller): Promise<string[]> {
  const { data } = await admin.from("app_users").select("id").eq("team_leader_id", c.id);
  return [c.id, ...((data || []).map((r: any) => r.id))];
}

export interface Spec {
  table: string;
  soft: boolean;
  /** columns lifted out of the JSON for this table */
  cols: (d: any, c: Caller) => Record<string, any>;
  /** may this caller see/write the row? */
  owns: (c: Caller, scope: CrmScope, team: string[], row: any) => boolean;
  /** optional: the same rule as a database filter, so a rep's list is not read in full and then cut down */
  narrow?: (c: Caller, scope: CrmScope, team: string[]) => ((q: any) => any) | null;
  canWrite?: (c: Caller, scope: CrmScope) => boolean;
  canDelete: (c: Caller, scope: CrmScope) => boolean;
}

/** who must hear about this save: a new owner ("new lead assigned") and an owner whose lead somebody else changed */
async function leadNotifications(c: Caller, touched: { id: string; prev: string | null; next: string | null; d: any; fresh: any[] }[], auditRows: any[]) {
  const assigned: Assigned[] = [], changed: Changed[] = [];
  for (const t of touched) {
    const nm = String(t.d?.customerName || "");
    if (t.next && t.next !== t.prev) {
      if (t.next !== c.id) assigned.push({ userId: t.next, leadId: t.id, leadName: nm, company: t.d?.companyName, project: t.d?.project, source: t.d?.source, byName: c.name });
      if (t.prev && t.prev !== c.id) changed.push({ userId: t.prev, leadId: t.id, leadName: nm, byName: c.name, summary: `The lead was reassigned to ${t.d?.assignedSalespersonName || "another person"}.` });
      continue;
    }
    if (!t.next || t.next === c.id) continue;                                   // nobody to tell, or you changed your own lead
    const bits = auditRows.filter((a) => a.lead_id === t.id && a.action !== "owner" && a.action !== "delete")
      .map((a) => `${a.action}${a.from_value || a.to_value ? `: ${a.from_value ?? "—"} → ${a.to_value ?? "—"}` : ""}`);
    for (const e of t.fresh) if (e?.user && e.user !== c.name && e.type !== "Assignment" && e.title) bits.push(String(e.title) + (e.description ? ` — ${String(e.description).slice(0, 120)}` : ""));
    if (bits.length) changed.push({ userId: t.next, leadId: t.id, leadName: nm, byName: c.name, summary: bits.slice(0, 6).join("; ") });
  }
  await Promise.all([notifyAssigned(assigned), notifyChanged(changed)]);
}

export const SPECS: Record<string, Spec> = {
  leads: {
    table: "crm_leads", soft: true,
    cols: (d) => leadColumns(d),
    owns: (c, scope, team, r) => scope === "all" || scope === "viewall" || (scope === "finance" ? r.status === "Won" : r.assigned_to === c.id || r.created_by === c.id || (scope === "team" && !!r.assigned_to && team.includes(r.assigned_to))),
    canDelete: (_c, scope) => scope === "all" || scope === "team",
    narrow: (c, scope, team) => scope === "all" || scope === "viewall" ? null : scope === "finance" ? (q) => q.eq("status", "Won")
      : (q) => q.or([`assigned_to.eq.${c.id}`, `created_by.eq.${c.id}`, ...(scope === "team" && team.length ? [`assigned_to.in.(${team.join(",")})`] : [])].join(",")),
  },
  contacts: {
    table: "crm_contacts", soft: true,
    cols: (d) => ({ phone_norm: normPhone(d.phoneNumber) || null, email_norm: normEmail(d.email) || null, name_norm: normName(d.name) || null }),
    owns: () => true,
    canDelete: (_c, scope) => scope === "all" || scope === "team",
  },
  companies: {
    table: "crm_companies", soft: true,
    cols: (d) => ({ name_norm: normName(d.name) || null }),
    owns: () => true,
    canDelete: (_c, scope) => scope === "all" || scope === "team",
  },
  tasks: {
    table: "crm_tasks", soft: false,
    cols: (d) => ({ owner_id: asUuid(d.salespersonId) }),
    owns: (c, scope, team, r) => scope === "all" || (scope !== "finance" && (r.owner_id === c.id || (scope === "team" && !!r.owner_id && team.includes(r.owner_id)))),
    canDelete: (_c, scope) => scope !== "finance",
  },
  activities: {
    table: "crm_activities", soft: false,
    cols: (d) => ({ owner_id: asUuid(d.salespersonId) }),
    owns: (c, scope, team, r) => scope === "all" || (scope !== "finance" && (r.owner_id === c.id || (scope === "team" && !!r.owner_id && team.includes(r.owner_id)))),
    canDelete: (_c, scope) => scope === "all" || scope === "team",
  },
  "external-sales": {
    table: "crm_external_sales", soft: false,
    cols: (d) => ({ owner_id: asUuid(d.salespersonId) }),
    owns: (c, scope, team, r) => scope === "all" || scope === "viewall" || (scope !== "finance" && (r.owner_id === c.id || (scope === "team" && !!r.owner_id && team.includes(r.owner_id)))),
    canDelete: (_c, scope) => scope === "all",
  },
  "email-logs": {
    table: "crm_email_logs", soft: false,
    cols: (d) => ({ received_at: d.receivedTime && !isNaN(Date.parse(d.receivedTime)) ? new Date(d.receivedTime).toISOString() : null }),
    owns: (_c, scope) => scope === "all",
    canDelete: (_c, scope) => scope === "all",
  },
};

/** external sales: new = pending; only a leader/operations decides, never on their own entry; who/when come from the server */
function externalRule(d: any, old: any | null, c: Caller, scope: CrmScope): string | null {
  const amount = Number(d.amount);
  if (!(amount > 0) || amount > 1e12) return "the amount must be a positive number";
  if (!old) { d.status = "pending"; delete d.confirmedBy; delete d.confirmedDate; return null; }
  if (d.status !== old.status) {
    if (d.status !== "pending" && !(scope === "all" || scope === "team")) return "only a team leader or operations can confirm or reject a sale";
    if (d.status !== "pending" && String(d.salespersonId) === c.id && scope !== "all") return "you cannot decide on your own sale";
    if (d.status === "pending") { delete d.confirmedBy; delete d.confirmedDate; }
    else { d.confirmedBy = c.name; d.confirmedDate = nowIso().slice(0, 10); }
  } else { d.confirmedBy = old.confirmedBy; d.confirmedDate = old.confirmedDate; if (scope === "own") { d.amount = old.amount; d.salespersonId = old.salespersonId; } }
  return null;
}

const IDENTITY_FIELDS = ["customerName", "companyName", "phoneNumber", "phone2", "email", "source", "priority", "date", "project", "requiredSize", "industry", "nationality", "refNo", "description"];

/** contacts and companies: a salesperson sees the customers of the leads he or she owns, a team leader those of the team;
 *  Sales Operation, Admin, Marketing, Finance and the view-all roles see every one */
async function linkedKeys(c: Caller, scope: CrmScope, team: string[]) {
  if (scope === "all" || scope === "viewall" || scope === "finance") return null;
  const ids = [c.id, ...(scope === "team" ? team : [])];
  const rows = await pageAll((a, b) => admin.from("crm_leads").select("phone_norm,email_norm,data->companyName").in("assigned_to", ids).is("deleted_at", null).order("id").range(a, b), 50000).catch(() => []);
  const k = { phones: new Set<string>(), emails: new Set<string>(), companies: new Set<string>() };
  for (const r of rows || []) { if (r.phone_norm) k.phones.add(r.phone_norm); if (r.email_norm) k.emails.add(r.email_norm); const n = normName((r as any).companyName); if (n) k.companies.add(n); }
  return k;
}
const linkedOk = (name: string, r: any, k: { phones: Set<string>; emails: Set<string>; companies: Set<string> } | null) =>
  !k || (name === "contacts" ? !!((r.phone_norm && k.phones.has(r.phone_norm)) || (r.email_norm && k.emails.has(r.email_norm))) : name === "companies" ? !!(r.name_norm && k.companies.has(r.name_norm)) : true);
const LINKED = new Set(["contacts", "companies"]);

const out = (r: any) => ({ ...r.data, id: r.id, _rev: r.updated_at || r.created_at });

for (const [name, spec] of Object.entries(SPECS)) {
  route("GET", `/crm/${name}`, async ({ c, query }) => {
    needCrm(c);
    if (name === "email-logs" && !can(c, "canViewSalesMail") && crmScope(c) !== "all") throw forbidden();
    const scope = crmScope(c);
    const since = query.get("since");
    if (since && !isNaN(Date.parse(since))) {
      // delta: only rows changed after `since`, plus ids removed since then (cheap: one indexed query)
      const iso = new Date(since).toISOString();
      const team0 = scope === "team" ? await teamIds(c) : [];
      const lk0 = LINKED.has(name) ? await linkedKeys(c, scope, team0) : null;
      const ch = await pageAll((a, b) => admin.from(spec.table).select("*").gt("updated_at", iso).order("updated_at", { ascending: true }).order("id").range(a, b), 20000).catch(() => { throw new HttpError(500, "Could not load " + name); });
      const live = (ch || []).filter((r: any) => !r.deleted_at && spec.owns(c, scope, team0, r) && linkedOk(name, r, lk0)).map(out);
      const gone = (ch || []).filter((r: any) => r.deleted_at || !spec.owns(c, scope, team0, r) || !linkedOk(name, r, lk0)).map((r: any) => r.id);
      return { delta: true, rows: live, removed: gone, now: nowIso() };
    }
    let data: any[];
    const team = scope === "team" ? await teamIds(c) : [];
    const nar = spec.narrow?.(c, scope, team) || null;
    try {
      data = await pageAll((a, b) => {
        let p: any = admin.from(spec.table).select("*");
        if (nar) p = nar(p);
        if (spec.soft) p = p.is("deleted_at", null);
        p = name === "email-logs" ? p.order("received_at", { ascending: false, nullsFirst: false }).order("id") : p.order("created_at", { ascending: false }).order("id");
        return p.range(a, name === "email-logs" ? Math.min(b, 499) : b);
      }, name === "email-logs" ? 500 : 50000);
    } catch { throw new HttpError(500, "Could not load " + name); }
    const lk = LINKED.has(name) ? await linkedKeys(c, scope, team) : null;
    return (data || []).filter((r: any) => spec.owns(c, scope, team, r) && linkedOk(name, r, lk)).map(out);
  });

  route("POST", `/crm/${name}`, async ({ req, c }) => {
    needCrm(c);
    await rateLimit(`crmsave:${c.id}`, 60, 120);
    // "view all" roles (executives, marketing) read everything but write like a rep; marketing may also edit the
    // identity of a lead (contact data, source, project) and create unassigned leads, which operations then distribute
    const rawScope = crmScope(c);
    const mkt = rawScope === "viewall" && c.perms.canEditLeadIdentity === true;
    const scope: CrmScope = rawScope === "viewall" ? "own" : rawScope;
    const b = await body(req, 8_000_000);
    if (Array.isArray(b)) throw bad("Send { upserts, deletes } (whole-list saves are no longer accepted)");
    const upserts: any[] = Array.isArray(b.upserts) ? b.upserts : [];
    const deletes: string[] = Array.isArray(b.deletes) ? b.deletes.filter((x: any) => typeof x === "string") : [];
    if (upserts.length > 500 || deletes.length > 500) throw bad("Too many rows in one save (max 500)");
    if (name === "email-logs" && scope !== "all") throw forbidden();
    const team = scope === "team" ? await teamIds(c) : [];
    const lkw = LINKED.has(name) && rawScope !== "viewall" ? await linkedKeys(c, scope, team) : null;
    const saved: any[] = [], conflicts: string[] = [], rejected: { id: string; reason: string }[] = [], idMap: Record<string, string> = {};
    const auditRows: any[] = [];
    await refreshCustomStatuses();
    const touched: { id: string; prev: string | null; next: string | null; d: any; fresh: any[] }[] = [];   // leads whose owner or content changed (for notifications)
    const audit = (leadId: string, a: { action: string; from?: string; to?: string; note?: string }) =>
      auditRows.push({ lead_id: leadId, actor_id: c.id, actor_name: c.name, action: a.action, from_value: a.from ?? null, to_value: a.to ?? null, note: a.note ?? null });

    // one query for all existing rows instead of one per row
    const exMap = new Map<string, any>();
    const wantIds = upserts.map((u: any) => u?.id).filter((x: any) => typeof x === "string" && ID_RE.test(x));
    for (let i = 0; i < wantIds.length; i += 100) {
      const { data: rows } = await admin.from(spec.table).select("*").in("id", wantIds.slice(i, i + 100));
      (rows || []).forEach((x: any) => exMap.set(x.id, x));
    }
    const newRows: { id: string; row: any; lead?: any }[] = [];
    for (const raw of upserts) {
      if (!isObj(raw) || typeof raw.id !== "string" || !ID_RE.test(raw.id)) { rejected.push({ id: String(raw?.id ?? ""), reason: "bad id" }); continue; }
      let d: any = clean(raw);
      const rev = d._rev; delete d._rev;
      let id = d.id;
      const ex = exMap.get(id) || null;
      try {
        if (ex) {
          if (ex.deleted_at) { rejected.push({ id, reason: "was deleted" }); continue; }
          let identityOnly = false;
          if (!spec.owns(c, scope, team, ex) || (LINKED.has(name) && (scope === "finance" || !linkedOk(name, ex, lkw)))) {
            if (mkt && name === "leads") identityOnly = true; // marketing: contact details only
            else { rejected.push({ id, reason: "not yours" }); continue; }
          }
          if (!rev) { // client thinks it is new but the id is taken: give it a fresh id
            if (name === "leads" || name === "contacts" || name === "companies") {
              id = await nextId(name === "leads" ? "lead" : name === "contacts" ? "contact" : "company");
              idMap[d.id] = id; d.id = id;
              const cols = spec.cols(d, c);
              const ins = await admin.from(spec.table).insert({ id, data: d, ...cols, ...(name === "leads" ? { created_by: c.id } : {}) }).select("*").single();
              if (ins.error) throw new Error("insert");
              saved.push({ id, _rev: ins.data.updated_at });
              continue;
            }
            conflicts.push(id); continue;
          }
          if (new Date(rev).getTime() !== new Date(ex.updated_at).getTime()) { conflicts.push(id); continue; }
          if (name === "leads" && identityOnly) {
            const nd: any = { ...ex.data };
            for (const k of IDENTITY_FIELDS) if (d[k] !== undefined && String(d[k]) !== String(nd[k] ?? "")) {
              if (["source", "phoneNumber", "email", "priority"].includes(k)) audit(id, { action: k === "source" ? "source" : "edit", from: `${k}=${nd[k] ?? ""}`, to: `${k}=${d[k]}`, note: "by marketing" });
              nd[k] = d[k];
            }
            if (d.dupCleared !== undefined) nd.dupCleared = !!d.dupCleared;
            if (d.mergedInto && !nd.mergedInto) { nd.mergedInto = String(d.mergedInto).slice(0, 60); nd.status = "Duplicate"; audit(id, { action: "merge", to: nd.mergedInto }); }
            const have = new Set((nd.timeline || []).map((x: any) => x?.id));
            nd.timeline = [...(nd.timeline || []), ...(Array.isArray(d.timeline) ? d.timeline : []).filter((x: any) => x?.id && !have.has(x.id))];
            nd.lastUpdated = nowIso();
            d = nd;
          } else if (name === "leads") {
            const newAssignee = asUuid(d.assignedSalespersonId);
            let assigneeName: string | undefined;
            if ((newAssignee || null) !== (ex.assigned_to || null)) {
              if (scope === "own" || scope === "finance") { rejected.push({ id, reason: "only a team leader or operations can reassign a lead" }); continue; }
              if (scope === "team" && newAssignee && !team.includes(newAssignee)) { rejected.push({ id, reason: "that person is not in your team" }); continue; }
              if (newAssignee) {
                const { data: au } = await admin.from("app_users").select("name,active").eq("id", newAssignee).maybeSingle();
                if (!au || au.active === false) { rejected.push({ id, reason: "that user cannot receive leads" }); continue; }
                assigneeName = au.name;
              } else assigneeName = "";
            }
            if (scope === "finance") { // accounts receivable may only confirm cash, through its own call
              rejected.push({ id, reason: "accounts receivable confirms cash from the Won Deals page" }); continue;
            }
            const san = sanitizeLead(d, ex, c, scope, assigneeName);
            if (san.error) { rejected.push({ id, reason: san.error }); continue; }
            san.audits.forEach((a) => audit(id, a));
          }
          if ((name === "tasks" || name === "activities") && scope === "own" && asUuid(d.salespersonId) !== c.id) { rejected.push({ id, reason: "not yours" }); continue; }
          if (name === "external-sales") {
            const err = externalRule(d, ex.data, c, scope);
            if (err) { rejected.push({ id, reason: err }); continue; }
          }
          const u = await admin.from(spec.table).update({ data: d, ...spec.cols(d, c) }).eq("id", id).eq("updated_at", ex.updated_at).select("*");
          if (u.error) throw new Error("update");
          if (!u.data?.length) { conflicts.push(id); continue; }
          saved.push({ id, _rev: u.data[0].updated_at });
          if (name === "leads") { const had = new Set((ex.data?.timeline || []).map((x: any) => x?.id)); touched.push({ id, prev: ex.assigned_to || null, next: u.data[0].assigned_to || null, d: u.data[0].data || d, fresh: ((u.data[0].data || d).timeline || []).filter((e: any) => e?.id && !had.has(e.id)) }); }
        } else {
          // new row
          if (name === "leads") {
            const as = asUuid(d.assignedSalespersonId);
            if (scope === "own" && as && as !== c.id && !mkt) { rejected.push({ id, reason: "you can only create leads for yourself" }); continue; }
            if (scope === "team" && as && !team.includes(as)) { rejected.push({ id, reason: "that person is not in your team" }); continue; }
            if (scope === "own" && !as && !mkt) { d.assignedSalespersonId = c.id; d.assignedSalespersonName = c.name; }
            if (mkt && as) { d.assignedSalespersonId = ""; d.assignedSalespersonName = ""; } // marketing does not distribute
            if (scope === "finance") { rejected.push({ id, reason: "not allowed" }); continue; }
            const san = sanitizeLead(d, null, c, scope);
            if (san.error) { rejected.push({ id, reason: san.error }); continue; }
            san.audits.forEach((a) => audit(id, a));
          }
          if ((name === "tasks" || name === "activities") && scope === "own") { d.salespersonId = c.id; }
          if (name === "external-sales") {
            if (scope === "own") { d.salespersonId = c.id; d.salespersonName = c.name; }
            const err = externalRule(d, null, c, scope);
            if (err) { rejected.push({ id, reason: err }); continue; }
          }
          // new rows are inserted together after the loop (one query per batch)
          newRows.push({ id, row: { id, data: d, ...spec.cols(d, c), ...(name === "leads" ? { created_by: c.id } : {}) }, lead: name === "leads" ? d : undefined });
        }
      } catch {
        rejected.push({ id, reason: "could not be saved" });
      }
    }

    if (deletes.length) {
      if (!(spec.canDelete(c, scope) || (mkt && name === "leads"))) { for (const id of deletes) rejected.push({ id, reason: "you cannot delete these" }); }
      else {
        for (const id of deletes.slice(0, 500)) {
          if (!ID_RE.test(id)) continue;
          const { data: ex } = await admin.from(spec.table).select("*").eq("id", id).maybeSingle();
          if (!ex || !(spec.owns(c, scope, team, ex) || (mkt && name === "leads"))) continue;
          if (name === "leads") audit(id, { action: "delete", from: ex.data?.status, note: `${ex.data?.customerName || ""} (${ex.data?.assignedSalespersonName || "unassigned"})` });
          if (spec.soft) await admin.from(spec.table).update({ deleted_at: nowIso() }).eq("id", id);
          else await admin.from(spec.table).delete().eq("id", id);
        }
        if (deletes.length) await logActivity(c, `Delete CRM ${name}`, `${deletes.length} row(s) deleted`, "ticket");
      }
    }
    if (newRows.length) {
      const ins = await admin.from(spec.table).insert(newRows.map((n) => n.row)).select("id,updated_at,created_at");
      if (!ins.error) {
        (ins.data || []).forEach((x: any) => saved.push({ id: x.id, _rev: x.updated_at || x.created_at }));
        if (name === "leads") {
          await ensureContactsAndCompaniesBulk(newRows.map((n) => n.lead)).catch(() => {});
          for (const n of newRows) { const as = asUuid(n.lead?.assignedSalespersonId); if (as) touched.push({ id: n.id, prev: null, next: as, d: n.lead, fresh: [] }); }
        }
      } else {
        // one bad row must not sink the batch: fall back to row-by-row so the culprit is named
        for (const n of newRows) {
          const one = await admin.from(spec.table).insert(n.row).select("id,updated_at,created_at").single();
          if (one.error) rejected.push({ id: n.id, reason: name === "leads" && n.lead?.emailId ? "a lead for this e-mail already exists" : "could not be saved" });
          else { saved.push({ id: n.id, _rev: one.data.updated_at || one.data.created_at }); if (name === "leads") await ensureContactAndCompany(n.lead).catch(() => {}); }
        }
      }
    }
    if (auditRows.length) await admin.from("crm_lead_audit").insert(auditRows.slice(0, 2000));
    if (name === "leads" && touched.length) later(leadNotifications(c, touched, auditRows));
    return { success: true, saved, conflicts, rejected, idMap };
  });
}

// ids handed out in advance so the browser can create records without clashes
route("POST", "/crm/ids", async ({ req, c }) => {
  needCrm(c);
  await rateLimit(`crmids:${c.id}`, 60, 30);
  const b = await body(req, 1000);
  const kind = ["lead", "contact", "company"].includes(b.kind) ? b.kind : null;
  if (!kind) throw bad("Unknown kind");
  const n = Math.max(1, Math.min(20, Number(b.n) || 5));
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await nextId(kind));
  return { ids };
});

// ---------------------------------------------------------------------------------------------
// routing, purge, re-parse, ingestion
// ---------------------------------------------------------------------------------------------
route("POST", "/crm/leads/route", async ({ req, c }) => {
  needCrm(c);
  await rateLimit(`crmroute:${c.id}`, 60, 60);
  const b = await body(req, 2000);
  const id = str(b.leadId, 60);
  const scope = crmScope(c);
  const team = scope === "team" ? await teamIds(c) : [];
  const { data: ex } = await admin.from("crm_leads").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!ex || !SPECS.leads.owns(c, scope, team, ex)) throw new HttpError(404, "Lead not found");
  if (ex.assigned_to) return { success: true, assigned: false, lead: out(ex) }; // never re-route an assigned lead
  const q = await loadQueue();
  const agent = await chooseAgent(ex.data, q);
  if (!agent) return { success: true, assigned: false, lead: out(ex) };
  const now = nowIso();
  const d = { ...ex.data, assignedSalespersonId: agent.id, assignedSalespersonName: agent.name, assignedDate: now, lastUpdated: now };
  d.timeline = [...(d.timeline || []), { id: rid(), timestamp: now, type: "Assignment", user: "System", title: "Auto Assigned", description: `Lead assigned to ${agent.name} (${q.assignmentMethod}).` }];
  const u = await admin.from("crm_leads").update({ data: d, ...leadColumns(d) }).eq("id", id).is("assigned_to", null).select("*");
  if (!u.data?.length) return { success: true, assigned: false, lead: out(ex) };
  later(notifyAssigned([{ userId: agent.id, leadId: id, leadName: d.customerName || "", company: d.companyName, project: d.project, source: d.source, byName: "the routing rules" }]));
  return { success: true, assigned: true, lead: out(u.data[0]) };
});

route("POST", "/crm/leads/purge-all", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 1000);
  if (b.confirm !== "DELETE ALL LEADS") throw bad('Send { "confirm": "DELETE ALL LEADS" } to confirm');
  const { count } = await admin.from("crm_leads").select("id", { count: "exact", head: true }).is("deleted_at", null);
  await admin.from("crm_leads").update({ deleted_at: nowIso() }).is("deleted_at", null);
  await logActivity(c, "Purge Leads", `${count || 0} leads removed (soft delete)`, "admin");
  return { success: true, message: "All leads removed.", count: count || 0 };
});

route("POST", "/crm/reparse-lead", async ({ req, c }) => {
  needCrm(c);
  await rateLimit(`reparse:${c.id}`, 3600, 30);
  const b = await body(req, 2000);
  const id = str(b.leadId, 60);
  const scope = crmScope(c);
  const team = scope === "team" ? await teamIds(c) : [];
  const { data: ex } = await admin.from("crm_leads").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!ex || !SPECS.leads.owns(c, scope, team, ex)) throw new HttpError(404, "Lead not found");
  const lead = ex.data;
  if (!lead.emailId) throw bad("This lead has no e-mail to re-read");
  const body_ = await getBody(await loadEws(), lead.emailId);
  if (!body_.html) throw new HttpError(502, "Could not read the original e-mail from the mail server");
  const { parsed } = await parseMail(htmlToText(body_.html), await loadQueue());
  const now = nowIso();
  const d = { ...lead };
  if (parsed.customerName) d.customerName = parsed.customerName;
  if (parsed.phoneNumber) d.phoneNumber = parsed.phoneNumber;
  if (parsed.email) d.email = parsed.email;
  if (parsed.companyName) d.companyName = parsed.companyName;
  if (parsed.project) d.project = parsed.project;
  if (parsed.requiredSize) d.requiredSize = parsed.requiredSize;
  if (parsed.priority) d.priority = parsed.priority;
  if (parsed.source) d.source = parsed.source;
  if (parsed.description && !d.description) d.description = parsed.description;
  d.lastUpdated = now;
  d.timeline = [...(d.timeline || []), { id: rid(), timestamp: now, type: "Import", user: c.name, title: "Lead Data Reparsed", description: "Re-read the original e-mail and refreshed the contact details." }];
  const u = await admin.from("crm_leads").update({ data: d, ...leadColumns(d) }).eq("id", id).select("*").single();
  if (u.error) throw new HttpError(500, "Could not save the lead");
  await ensureContactAndCompany(d);
  return { success: true, lead: out(u.data) };
});

async function runIngest(c: Caller) {
  if (!(can(c, "canViewSalesMail") || crmScope(c) === "all")) throw forbidden();
  await rateLimit(`ingest:${c.id}`, 3600, 30);
  const r = await ingestInbox(40, c.name);
  await logActivity(c, "Mail Ingestion", `${r.newLeadsCount} new lead(s) from ${r.processed} mail(s)`, "system");
  return { success: true, messages: [], ...r };
}
// Facebook leads sheet: the same people who may read the mailbox may sync it; only an administrator can set a back-fill date
route("POST", "/crm/fb-sync", async ({ req, c }) => {
  needCrm(c);
  if (!(can(c, "canViewSalesMail") || crmScope(c) === "all")) throw forbidden();
  await rateLimit(`fbsync:${c.id}`, 3600, 60);
  const b = await body(req, 10_000);
  const since = crmScope(c) === "all" && b.since && !isNaN(Date.parse(b.since)) ? new Date(b.since).toISOString() : undefined;
  const r: any = await syncFacebook({ since, byUser: c.name });
  if (r.fbNew) await logActivity(c, "Facebook Sheet Sync", `${r.fbNew} new lead(s) from the Facebook sheet`, "system");
  return { success: true, ...r };
});
route("GET", "/crm/fb-sync/status", async ({ c }) => {
  needCrm(c);
  if (!(can(c, "canViewSalesMail") || crmScope(c) === "all")) throw forbidden();
  const cfg = await getConfig<any>("fb_sheet", {});
  return { enabled: cfg.enabled !== false, lastRun: cfg.lastRun || null, lastTab: cfg.lastTab || null, since: cfg.since || null };
});
route("POST", "/crm/trigger-auto-sync", async ({ c }) => { needCrm(c); return await runIngest(c); });
// one-time tidy-up of leads that came from e-mail: remove the signature / disclaimer from the description and set the channel
route("POST", "/crm/fix-mail-leads", async ({ c }) => {
  needCrm(c);
  if (crmScope(c) !== "all") throw forbidden();
  const rows = await pageAll((a, b) => admin.from("crm_leads").select("id,data,email_id").not("email_id", "is", null).is("deleted_at", null).order("id").range(a, b), 20000);
  const ids = rows.map((r: any) => r.email_id).filter(Boolean);
  const logs = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("crm_email_logs").select("id,data").in("id", ids.slice(i, i + 200));
    (data || []).forEach((l: any) => logs.set(l.id, l));
  }
  let fixed = 0;
  for (const r of rows as any[]) {
    const d = { ...r.data }; let ch = false;
    const clean = cleanDescription(String(d.description || ""));
    if (clean !== (d.description || "")) { d.description = clean; ch = true; }
    if (!d.channel) { const lg = logs.get(r.email_id); const chn = channelFromMail({ sender: lg?.data?.sender, subject: lg?.data?.subject }); if (chn) { d.channel = chn; ch = true; } }
    if (d.source === "Email") { d.source = ""; ch = true; }
    if (ch) { await admin.from("crm_leads").update({ data: d }).eq("id", r.id); fixed++; }
  }
  return { success: true, checked: rows.length, fixed };
});
// admin only: re-map the project of existing leads to the canonical Land Bank park name (the customer's own words stay in the description)
route("POST", "/crm/fix-mail-projects", async ({ c }) => {
  needAdmin(c);
  await rateLimit(`fixproj:${c.id}`, 3600, 10);
  const rows = await pageAll((a, b) => admin.from("crm_leads").select("id,data,updated_at").is("deleted_at", null).order("id").range(a, b), 50000);
  let fixed = 0;
  for (const r of rows as any[]) {
    const raw = str(r.data?.project, 120);
    const park = raw ? canonicalPark(raw) : "";
    if (!park || park === raw) continue;
    const d = { ...r.data, project: park };
    const desc = String(d.description || "");
    if (!desc.includes(raw)) d.description = `${desc}${desc ? "\n" : ""}Project (as written): ${raw}`.slice(0, 4000);
    const u = await admin.from("crm_leads").update({ data: d }).eq("id", r.id).eq("updated_at", r.updated_at).select("id");
    if (u.data?.length) { fixed++; await admin.from("crm_lead_audit").insert({ lead_id: r.id, actor_id: c.id, actor_name: c.name, action: "edit", from_value: `project=${raw}`, to_value: `project=${park}`, note: "canonical park name" }); }
  }
  await logActivity(c, "Fix lead projects", `${fixed} lead(s) mapped to park names`, "admin");
  return { success: true, checked: rows.length, fixed };
});
route("POST", "/crm/sync-inbox", async ({ c }) => { needCrm(c); return await runIngest(c); });

// shared mailbox view (inbox + sent) — only for people who may use CRM mail
const mailCache: { at: number; emails: any[] } = { at: 0, emails: [] };
route("GET", "/crm/webmail", async ({ c, query }) => {
  needCrm(c);
  if (!can(c, "canViewSalesMail")) throw forbidden();
  const force = query.get("force") === "true" || query.get("refresh") === "true";
  if (!force && Date.now() - mailCache.at < 180_000 && mailCache.emails.length) return { success: true, emails: mailCache.emails, cached: true };
  await rateLimit(`webmail:${c.id}`, 600, 30);
  const cfg = await loadEws();
  const [a, s] = await Promise.all([listFolder(cfg, "inbox", 10), listFolder(cfg, "sentitems", 10)]);
  const emails = [...a, ...s].sort((x, y) => new Date(y.receivedTime).getTime() - new Date(x.receivedTime).getTime());
  mailCache.at = Date.now(); mailCache.emails = emails;
  return { success: true, emails, cached: false };
});

// defence in depth only — the browser sanitises again before showing it
function stripActive(html: string) {
  return html
    .replace(/<(script|style|iframe|object|embed|form)\b[\s\S]*?(<\/\1>|$)/gi, "")
    .replace(/<(link|meta|base)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "$1=$2#$2");
}
route("GET", "/crm/webmail/body", async ({ c, query }) => {
  needCrm(c);
  if (!can(c, "canViewSalesMail")) throw forbidden();
  await rateLimit(`mailbody:${c.id}`, 600, 120);
  const r = await getBody(await loadEws(), str(query.get("id"), 700));
  return { success: true, body: stripActive(r.html), subject: r.subject };
});

// ---------------------------------------------------------------------------------------------
// queue settings
// ---------------------------------------------------------------------------------------------
// a dry run of the routing: who WOULD get leads of the given sizes (sqm), one after the other. Nothing is assigned or saved.
route("POST", "/crm/routing/preview", async ({ req, c }) => {
  needCrm(c);
  if (crmScope(c) !== "all") throw forbidden();
  await rateLimit(`routeprev:${c.id}`, 60, 30);
  const b = await body(req, 4000);
  const sizes = (Array.isArray(b.sizes) ? b.sizes : []).slice(0, 20).map((x: any) => sqmOf(x));
  if (!sizes.length) throw bad("Give at least one size");
  const q = { ...(await loadQueue()), ...(typeof b.method === "string" && METHODS.includes(b.method) ? { assignmentMethod: b.method } : {}) };
  const sim: any = {}; const trace: any[] = []; const steps: any[] = [];
  for (const s of sizes) { const a = await chooseAgent({ requiredSize: s || "n/a" }, q, { sim, trace: steps.length ? [] : trace }); steps.push({ sqm: s || null, to: a?.name || null }); }
  const st = sim.st;
  return { method: q.assignmentMethod, steps, people: trace.map((t) => ({ name: t.name, openBefore: t.open, sqmBefore: t.sqm, openAfter: st?.open?.[t.id] || 0, sqmAfter: st?.sqm?.[t.id] || 0, eligible: t.eligible })) };
});
// ---------------------------------------------------------------------------------------------
// dropdown lists the administrator edits in Settings (statuses, sources, projects, industries, lost reasons ...)
// ---------------------------------------------------------------------------------------------
const LIST_KEYS = ["statuses", "sources", "projects", "industries", "lostReasons", "lostCategories", "temperatures"] as const;
let customAt = 0;
async function refreshCustomStatuses() {
  if (Date.now() - customAt < 30_000) return;
  customAt = Date.now();
  const l = await getConfig<any>("dropdown_lists", {});
  CUSTOM_STATUSES.clear();
  for (const g of Array.isArray(l.statuses) ? l.statuses : []) for (const s of Array.isArray(g?.statuses) ? g.statuses : []) if (typeof s === "string") CUSTOM_STATUSES.add(s);
}
route("GET", "/crm/lists", async ({ c }) => { needCrm(c); return await getConfig<any>("dropdown_lists", {}); });
route("POST", "/crm/lists", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 100_000);
  const words = (a: any) => { const seen = new Set<string>(); for (const x of Array.isArray(a) ? a : []) { const t = str(x, 80).trim(); if (t) seen.add(t); } return [...seen].slice(0, 200); };
  const out: any = {};
  for (const k of LIST_KEYS) {
    if (b[k] === undefined) continue;
    if (k === "statuses") out.statuses = (Array.isArray(b.statuses) ? b.statuses : []).slice(0, 12).map((g: any) => ({ group: str(g?.group, 60), statuses: words(g?.statuses) })).filter((g: any) => g.group);
    else out[k] = words(b[k]);
  }
  await setConfig("dropdown_lists", { ...(await getConfig<any>("dropdown_lists", {})), ...out });
  customAt = 0; await refreshCustomStatuses();
  await logActivity(c, "Update Dropdown Lists", `Changed: ${Object.keys(out).join(", ")}`, "admin");
  return { success: true };
});

route("GET", "/crm/queue-settings", async ({ c }) => { needCrm(c); return await loadQueue(); });
route("POST", "/crm/queue-settings", async ({ req, c }) => {
  needCrm(c);
  if (crmScope(c) !== "all") throw forbidden();
  const b = clean(await body(req, 20_000));
  const s: any = {};
  for (const k of Object.keys(DEFAULT_QUEUE)) {
    if (b[k] === undefined) continue;
    const def = (DEFAULT_QUEUE as any)[k];
    if (typeof def === "boolean") s[k] = !!b[k];
    else if (typeof def === "number") { const n = Number(b[k]); s[k] = Number.isFinite(n) ? Math.max(0, Math.min(10_000_000, n)) : def; }
    else if (Array.isArray(def)) s[k] = (Array.isArray(b[k]) ? b[k] : []).slice(0, 50).map((x: any) => str(x, 80)).filter(Boolean);
    else s[k] = str(b[k], 80);
  }
  if (s.assignmentMethod && !METHODS.includes(s.assignmentMethod)) throw bad("Unknown assignment method");
  if (b.backupSalespersonId !== undefined) s.backupSalespersonId = asUuid(b.backupSalespersonId) || "";
  for (const k of ["queueOrder"]) if (b[k] !== undefined) s[k] = ["FIFO", "LIFO", "Priority"].includes(b[k]) ? b[k] : "FIFO";
  for (const k of ["businessHoursStart", "businessHoursEnd"]) if (s[k] && !/^\d{2}:\d{2}$/.test(s[k])) throw bad("Hours must look like 08:00");
  await setConfig("queue_settings", { ...(await getConfig<any>("queue_settings", {})), ...s });
  await logActivity(c, "Update Routing Rules", "Lead routing settings changed", "admin");
  return { success: true };
});
