// deno-lint-ignore-file no-explicit-any
// Tickets and workflow templates. Visibility, ids, SLA maths and step activation are decided HERE, not in the browser.
import {
  addWorkingHours, admin, pageAll, asUuid, bad, body, can, Caller, clean, forbidden, HttpError, isAdmin, isManager, logActivity, need, notFound, nowIso, rateLimit,
  rid, str, isObj,
} from "./lib.ts";
import { route } from "./router.ts";

const PRIORITIES = ["Critical", "High", "Medium", "Low"];
const STATUSES = ["New", "In Progress", "Waiting on User", "Waiting on Vendor", "Resolved", "Closed", "Reopened"];
const PAUSING = ["Waiting on User", "Waiting on Vendor"];
const MAX_ATTACH_BYTES = 6_000_000;

export const toTicket = (r: any) => ({ ...r.data, id: Number(r.id) });

export function canSeeTicket(c: Caller, r: any): boolean {
  if (isAdmin(c)) return true;
  if (c.role === "Requester") return r.requester_id === c.id;
  if (r.requester_id === c.id || r.assigned_to === c.id) return true;
  if (!r.department) return true;
  if (r.department === c.department) return true;
  const steps = r.data?.workflowSteps;
  return Array.isArray(steps) && steps.some((s: any) => s.status === "Current" && s.responsibleRole === c.department);
}

async function slaHours(): Promise<Record<string, number>> {
  const { data } = await admin.from("sla").select("*");
  const m: Record<string, number> = { Critical: 4, High: 8, Medium: 24, Low: 48 };
  for (const r of data || []) m[r.priority] = r.hours;
  return m;
}

const cols = (d: any) => ({
  requester_id: asUuid(d.requesterId),
  assigned_to: asUuid(d.assignedTo),
  department: d.department ? String(d.department).slice(0, 80) : null,
  status: STATUSES.includes(d.status) ? d.status : "New",
});

// The list never carries file data (it burns egress on every load): each attachment becomes a short stub
// "stripped:<mime>;<chars>" so the UI can still show a paperclip and a count. GET /tickets/:id returns the full ticket.
export const ATT_STUB = "stripped:";
const stubOf = (x: any) => {
  if (typeof x !== "string" || x.startsWith(ATT_STUB)) return x;
  const m = /^data:([^;,]*)/.exec(x);
  return `${ATT_STUB}${m ? m[1] : ""};${x.length}`;
};
const stripList = (a: any) => Array.isArray(a) ? a.map(stubOf) : a;
function stripTicket(t: any) {
  const out: any = { ...t, attachments: stripList(t.attachments), attachmentsStripped: true };
  if (Array.isArray(t.history)) out.history = t.history.map((h: any) => h && Array.isArray(h.attachments) ? { ...h, attachments: stripList(h.attachments) } : h);
  return out;
}

route("GET", "/tickets", async ({ c }) => {
  const data = await pageAll((a, b) => admin.from("tickets").select("*").order("id", { ascending: false }).range(a, b));
  return (data || []).filter((r: any) => canSeeTicket(c, r)).map((r: any) => stripTicket(toTicket(r)));
});

route("GET", "/tickets/:id", async ({ c, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw bad("Invalid ticket id");
  const { data: row } = await admin.from("tickets").select("*").eq("id", id).maybeSingle();
  if (!row || !canSeeTicket(c, row)) throw notFound("Ticket not found");
  return toTicket(row);
});

function checkAttachments(a: any): string[] {
  if (a === undefined || a === null) return [];
  if (!Array.isArray(a) || a.length > 10) throw bad("At most 10 attachments");
  let total = 0;
  for (const x of a) { if (typeof x !== "string") throw bad("Invalid attachment"); total += x.length; }
  if (total > MAX_ATTACH_BYTES) throw new HttpError(413, "Attachments are too large (max about 4 MB)");
  return a;
}

route("POST", "/tickets", async ({ req, c }) => {
  need(c, "canViewTickets");
  await rateLimit(`ticket:${c.id}`, 3600, 60);
  const b = await body(req, 8_000_000);
  const title = str(b.title, 200), description = str(b.description, 10000);
  if (!title || !description) throw bad("Title and description are required");
  const now = nowIso();
  const sla = await slaHours();
  const priority = PRIORITIES.includes(b.priority) ? b.priority : "Medium";
  const t: any = {
    title, description,
    type: str(b.type, 100), subtype: str(b.subtype, 100),
    priority, status: "New",
    requesterId: c.id, requesterEmail: c.email,
    createdAt: now, updatedAt: now,
    totalPausedTime: 0,
    history: [{ id: rid(), action: "Ticket Created", actor: c.email, date: now }],
    attachments: checkAttachments(b.attachments),
    department: str(b.department, 80) || undefined,
    crmContactId: str(b.crmContactId, 60) || undefined,
    crmContactName: str(b.crmContactName, 160) || undefined,
  };
  t.slaDeadline = new Date(Date.now() + (sla[priority] || 24) * 3600_000).toISOString();

  const wfId = str(b.workflowId, 40);
  if (wfId) {
    const { data: wf } = await admin.from("workflow_requests").select("data,department").eq("id", wfId).maybeSingle();
    if (!wf) throw bad("Unknown workflow");
    const steps = (wf.data.steps || []).map((s: any) => ({
      ...s, status: !s.prerequisiteStepIds || s.prerequisiteStepIds.length === 0 ? "Current" : "Pending",
    }));
    t.workflowId = wfId;
    t.workflowSteps = steps;
    const first = steps.find((s: any) => s.status === "Current");
    t.currentStepId = first?.id || null;
    t.department = first?.responsibleRole || wf.data.department || t.department;
    const hours = (Number(wf.data.totalSLA) || 0) + (Number(wf.data.maxBufferHours) || 0);
    if (hours > 0) t.slaDeadline = new Date(addWorkingHours(Date.now(), hours)).toISOString(); // workflow hours are WORKING hours (9 a day)
  }
  const { data: idv, error: ie } = await admin.rpc("app_next_id", { p_kind: "ticket" });
  if (ie) throw new HttpError(500, "Could not allocate a ticket number");
  const id = Number(idv);
  t.id = id;
  const ins = await admin.from("tickets").insert({ id, data: t, ...cols(t) });
  if (ins.error) throw new HttpError(500, "Could not save the ticket");
  await logActivity(c, "Create Ticket", `Ticket #${id} created${wfId ? " from a workflow" : ""}: ${title}`, "ticket");
  return t;
});

// SLA clock: pause while waiting on user/vendor, extend the deadline by the paused time, recompute on priority change
function applySla(old: any, neu: any, sla: Record<string, number>) {
  const now = Date.now();
  const wasPaused = !!old.slaPausedAt;
  const nowPausing = PAUSING.includes(neu.status);
  let pausedAt = old.slaPausedAt || undefined;
  let total = Number(old.totalPausedTime) || 0;
  let deadline = old.slaDeadline;
  if (nowPausing && !wasPaused) pausedAt = new Date(now).toISOString();
  else if (!nowPausing && wasPaused) {
    const d = Math.max(0, now - new Date(old.slaPausedAt).getTime());
    total += d;
    deadline = new Date(new Date(deadline).getTime() + d).toISOString();
    pausedAt = undefined;
  }
  if (neu.priority !== old.priority && !old.workflowId) {
    deadline = new Date(new Date(old.createdAt).getTime() + (sla[neu.priority] || 24) * 3600_000 + total).toISOString();
  }
  neu.slaPausedAt = pausedAt;
  neu.totalPausedTime = total;
  neu.slaDeadline = deadline;
}

const STAFF_KEYS = ["title", "description", "type", "subtype", "priority", "status", "assignedTo", "assignedToName", "department", "feedback", "attachments", "history", "crmContactId", "crmContactName"];
const REQUESTER_KEYS = ["status", "feedback", "history", "attachments"];

route("PUT", "/tickets/:id", async ({ req, c, params }) => {
  need(c, "canViewTickets");
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw bad("Invalid ticket id");
  const b = await body(req, 8_000_000);
  const { data: row } = await admin.from("tickets").select("*").eq("id", id).maybeSingle();
  if (!row || !canSeeTicket(c, row)) throw notFound("Ticket not found");
  const isReq = row.requester_id === c.id;
  const staff = c.role !== "Requester" || isAdmin(c);
  const allowed = staff ? STAFF_KEYS : REQUESTER_KEYS;
  if (!staff && !isReq) throw forbidden();
  const old = row.data;
  const neu: any = { ...old };
  for (const k of allowed) if (b[k] !== undefined) neu[k] = clean(b[k]);

  if (neu.status !== undefined && !STATUSES.includes(neu.status)) throw bad("Unknown status");
  if (!staff && neu.status !== old.status && !["Reopened", "Closed"].includes(neu.status)) throw forbidden("Requesters can only reopen or close their ticket");
  if (neu.priority !== undefined && !PRIORITIES.includes(neu.priority)) throw bad("Unknown priority");
  if (neu.assignedTo) {
    const a = asUuid(neu.assignedTo);
    if (!a) throw bad("Invalid assignee");
    const { data: u } = await admin.from("app_users").select("name,active").eq("id", a).maybeSingle();
    if (!u || !u.active) throw bad("Unknown assignee");
    neu.assignedTo = a; neu.assignedToName = u.name;
  } else if (b.assignedTo !== undefined) { neu.assignedTo = null; neu.assignedToName = null; }
  if (b.attachments !== undefined) {
    // a stub from the list ("stripped:...") is never saved: it is put back from the stored file at the same place
    const oa = Array.isArray(old.attachments) ? old.attachments : [];
    if (Array.isArray(neu.attachments)) neu.attachments = neu.attachments.map((x: any, i: number) => typeof x === "string" && x.startsWith(ATT_STUB) ? oa[i] : x).filter((x: any) => typeof x === "string" && !x.startsWith(ATT_STUB));
    neu.attachments = checkAttachments(neu.attachments);
  }

  // history is append-only: everything old must still be there, in order
  if (b.history !== undefined) {
    const oh = Array.isArray(old.history) ? old.history : [];
    const nh = Array.isArray(neu.history) ? neu.history : [];
    const prefix = oh.every((h: any, i: number) => nh[i] && nh[i].id === h.id);
    if (!prefix || nh.length - oh.length > 20) throw bad("Ticket history cannot be rewritten");
    neu.history = nh.map((h: any, i: number) => i < oh.length ? oh[i] : {
      id: rid(), action: str(h.action, 200), actor: c.email, date: nowIso(), note: h.note ? str(h.note, 5000) : undefined,
      isInternal: staff ? !!h.isInternal : false, attachments: Array.isArray(h.attachments) ? h.attachments.filter((x: any) => !String(x).startsWith(ATT_STUB)).slice(0, 5).map((x: any) => String(x).slice(0, 2_000_000)) : undefined,
    });
  }
  const sla = await slaHours();
  applySla(old, neu, sla);
  const now = nowIso();
  neu.updatedAt = now;
  if (neu.status === "Resolved" && old.status !== "Resolved") neu.resolvedAt = now;
  else if (!["Resolved", "Closed"].includes(neu.status)) neu.resolvedAt = undefined;

  // optimistic lock: refuse if someone changed the ticket since we read it
  const upd = await admin.from("tickets").update({ data: neu, ...cols({ ...neu, requesterId: old.requesterId }) }).eq("id", id).eq("updated_at", row.updated_at).select("id");
  if (upd.error) throw new HttpError(500, "Could not save the ticket");
  if (!upd.data || upd.data.length === 0) throw new HttpError(409, "The ticket was changed by someone else. Reload and try again.");
  await logActivity(c, "Update Ticket", `Ticket #${id} ("${neu.title}") updated. Status: ${neu.status}`, "ticket");
  return { ...neu, id };
});

route("DELETE", "/tickets/:id", async ({ c, params }) => {
  if (!isAdmin(c)) throw forbidden("Only an administrator can delete tickets");
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw bad("Invalid ticket id");
  const { data } = await admin.from("tickets").delete().eq("id", id).select("data");
  await logActivity(c, "Delete Ticket", `Ticket #${id} ("${data?.[0]?.data?.title || ""}") deleted`, "ticket");
  return { success: true };
});

// Import (admin): adds or updates the given tickets. It never replaces or deletes the existing ones.
route("POST", "/tickets/bulk", async ({ req, c }) => {
  if (!isAdmin(c)) throw forbidden("Only an administrator can import tickets");
  const list = await body(req, 20_000_000);
  if (!Array.isArray(list) || list.length > 1000) throw bad("Send a list of at most 1000 tickets");
  let n = 0;
  for (const raw of list) {
    if (!isObj(raw) || !str(raw.title, 200)) continue;
    const t: any = clean(raw);
    const want = Number(t.id);
    const { data: ex } = Number.isInteger(want) ? await admin.from("tickets").select("id").eq("id", want).maybeSingle() : { data: null };
    let id = want;
    if (!ex) {
      if (!Number.isInteger(want) || want < 1) {
        const { data: nid } = await admin.rpc("app_next_id", { p_kind: "ticket" }); id = Number(nid);
      }
    }
    t.id = id;
    t.requesterId = asUuid(t.requesterId) || c.id;
    const r = await admin.from("tickets").upsert({ id, data: t, ...cols(t) });
    if (!r.error) n++;
  }
  await logActivity(c, "Import Tickets", `${n} tickets imported`, "admin");
  return { success: true, count: n };
});

const VALID_DEPTS = ["Development", "Finance", "Infrastructure", "Sales", "CRM", "PMO", "Procurement", "Community", "Business development", "GM", "CEO", "CFO", "Manager", "Director", "Finance OP", "Finance Dev", "Sales Operation", "Projects", "Legal", "Document Control", "Office Manager"];

route("POST", "/tickets/:ticketId/steps/:stepId/complete", async ({ req, c, params }) => {
  need(c, "canViewTickets");
  await rateLimit(`step:${c.id}`, 60, 40);
  const id = Number(params.ticketId);
  if (!Number.isInteger(id)) throw bad("Invalid ticket id");
  const b = await body(req, 20_000);
  const { data: row } = await admin.from("tickets").select("*").eq("id", id).maybeSingle();
  if (!row || !canSeeTicket(c, row)) throw notFound("Ticket not found");
  const t = row.data;
  if (!Array.isArray(t.workflowSteps)) throw bad("Ticket has no workflow");
  const steps = t.workflowSteps.map((s: any) => ({ ...s }));
  const i = steps.findIndex((s: any) => s.id === params.stepId);
  if (i === -1) throw notFound("Step not found");
  const step = steps[i];
  if (step.status !== "Current") throw bad("This step is not the current step");
  const mine = isAdmin(c) || row.assigned_to === c.id || step.responsibleRole === c.department || step.responsibleRole === c.role;
  if (!mine) throw forbidden("This step belongs to " + (step.responsibleRole || "another team"));

  const now = nowIso();
  step.status = "Completed"; step.completedAt = now; step.completedBy = c.name; step.note = str(b.note, 2000) || undefined;
  let activated = false;
  for (const s of steps) {
    if (s.status === "Pending" && Array.isArray(s.prerequisiteStepIds) && s.prerequisiteStepIds.includes(step.id)) {
      if (s.prerequisiteStepIds.every((pid: string) => steps.find((p: any) => p.id === pid)?.status === "Completed")) { s.status = "Current"; activated = true; }
    }
  }
  const anyPrereq = steps.some((s: any) => s.prerequisiteStepIds && s.prerequisiteStepIds.length > 0);
  if (!activated && !anyPrereq && i + 1 < steps.length && steps[i + 1].status === "Pending") { steps[i + 1].status = "Current"; activated = true; }

  const cur = steps.filter((s: any) => s.status === "Current");
  if (cur.length) {
    t.currentStepId = cur[0].id;
    if (VALID_DEPTS.includes(cur[0].responsibleRole)) { t.department = cur[0].responsibleRole; t.assignedTo = null; t.assignedToName = null; }
  } else if (steps.every((s: any) => s.status === "Completed")) {
    t.currentStepId = null; t.status = "Resolved"; t.resolvedAt = now;
  }
  t.workflowSteps = steps;
  t.updatedAt = now;
  t.history = [...(t.history || []), { id: rid(), action: `Workflow Step Completed: ${step.name}`, actor: c.email, date: now, note: `Step "${step.name}" completed by ${c.name}.` }];

  const upd = await admin.from("tickets").update({ data: t, ...cols({ ...t, requesterId: t.requesterId }) }).eq("id", id).eq("updated_at", row.updated_at).select("id");
  if (upd.error) throw new HttpError(500, "Could not save the ticket");
  if (!upd.data?.length) throw new HttpError(409, "The ticket was changed by someone else. Reload and try again.");
  await logActivity(c, "Complete Workflow Step", `Step "${step.name}" completed for ticket #${id}`, "ticket");
  return { ...t, id };
});

// ---------------------------------------------------------------------------------------------
// workflow templates
// ---------------------------------------------------------------------------------------------
const wfOut = (r: any) => ({ ...r.data, id: r.id });

route("GET", "/workflow-requests", async ({ c }) => {
  if (!can(c, "canViewTickets") && !can(c, "canViewWorkflowBuilder")) throw forbidden();
  const { data } = await admin.from("workflow_requests").select("*").order("created_at", { ascending: false });
  const canBuild = can(c, "canViewWorkflowBuilder");
  return (data || []).filter((r: any) => canBuild || !r.data?.isHidden).map(wfOut);
});

function deptAllowed(c: Caller, key: "allowedDepartmentsToCreate" | "allowedDepartmentsToApprove", dept: string) {
  if (isAdmin(c)) return true;
  const list = c.perms[key];
  return Array.isArray(list) ? list.includes(dept) : false;
}

route("POST", "/workflow-requests", async ({ req, c }) => {
  need(c, "canCreateWorkflow");
  const b = clean(await body(req, 2_000_000));
  const title = str(b.title, 200);
  const department = str(b.department, 80);
  if (!title) throw bad("Title is required");
  if (!deptAllowed(c, "allowedDepartmentsToCreate", department)) throw forbidden("You cannot create workflows for " + (department || "this department"));
  if (!Array.isArray(b.steps) || b.steps.length > 100) throw bad("Steps must be a list (max 100)");
  const now = nowIso();
  const data = { ...b, title, department, status: "Draft", createdAt: now, updatedAt: now, createdBy: c.id, createdByName: c.name };
  delete (data as any).id;
  const { data: row, error } = await admin.from("workflow_requests").insert({ data, created_by: c.id, department, status: "Draft" }).select().single();
  if (error) throw new HttpError(500, "Could not save the workflow");
  await logActivity(c, "Create Workflow", `Workflow ${row.id} created: ${title}`, "workflow");
  return wfOut(row);
});

route("PUT", "/workflow-requests/:id", async ({ req, c, params }) => {
  const b = clean(await body(req, 2_000_000));
  const { data: row } = await admin.from("workflow_requests").select("*").eq("id", params.id).maybeSingle();
  if (!row) throw notFound("Workflow not found");
  const old = row.data;
  const keys = Object.keys(b).filter((k) => !["id", "updatedBy", "updatedByName", "userId", "userName", "createdAt", "updatedAt", "createdBy", "createdByName"].includes(k));
  const onlyStatus = keys.every((k) => k === "status");
  const onlyFeedback = keys.every((k) => k === "salesFeedback");
  if (onlyFeedback) need(c, "canCommentWorkflow");
  else if (onlyStatus) {
    if (!can(c, "canApproveWorkflow") || !deptAllowed(c, "allowedDepartmentsToApprove", old.department)) throw forbidden("You cannot approve workflows of " + old.department);
    if (!["Draft", "Aligned", "Finalized"].includes(b.status)) throw bad("Unknown status");
  } else {
    need(c, "canEditWorkflow");
    if (!deptAllowed(c, "allowedDepartmentsToCreate", old.department) && !deptAllowed(c, "allowedDepartmentsToApprove", old.department)) throw forbidden();
    // a full edit may not move the workflow to a department the editor cannot create for, nor change its status without approval rights
    if (b.department !== undefined && b.department !== old.department && !deptAllowed(c, "allowedDepartmentsToCreate", str(b.department, 80))) throw forbidden("You cannot create workflows for " + (str(b.department, 80) || "this department"));
    if (b.status !== undefined && b.status !== (old.status ?? row.status ?? "Draft")) {
      if (!can(c, "canApproveWorkflow") || !deptAllowed(c, "allowedDepartmentsToApprove", old.department)) throw forbidden("You cannot approve workflows of " + old.department);
      if (!["Draft", "Aligned", "Finalized"].includes(b.status)) throw bad("Unknown status");
    }
    if (b.steps !== undefined && (!Array.isArray(b.steps) || b.steps.length > 100)) throw bad("Steps must be a list (max 100)");
  }
  const now = nowIso();
  const neu = { ...old };
  for (const k of keys) neu[k] = b[k];
  if (b.salesFeedback) neu.salesFeedback = { ...b.salesFeedback, userId: c.id, userEmail: c.email, createdAt: now };
  neu.updatedAt = now;
  const r = await admin.from("workflow_requests").update({ data: neu, department: neu.department || null, status: neu.status || null }).eq("id", params.id);
  if (r.error) throw new HttpError(500, "Could not save the workflow");
  await logActivity(c, "Update Workflow", `Workflow "${old.title}" (${params.id}) updated. Status: ${neu.status}`, "workflow");
  return { ...neu, id: params.id };
});

route("DELETE", "/workflow-requests/:id", async ({ c, params }) => {
  need(c, "canEditWorkflow");
  const { data: row } = await admin.from("workflow_requests").select("created_by,data").eq("id", params.id).maybeSingle();
  if (!row) return { success: true };
  if (!isAdmin(c) && row.created_by !== c.id) throw forbidden("Only the creator or an administrator can delete this workflow");
  await admin.from("workflow_requests").delete().eq("id", params.id);
  await logActivity(c, "Delete Workflow", `Workflow "${row.data?.title || params.id}" deleted`, "workflow");
  return { success: true };
});
