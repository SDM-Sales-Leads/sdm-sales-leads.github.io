// deno-lint-ignore-file no-explicit-any
// 18 Nov 2026 (Walid, option 3): a customer we already know contacts us again (e.g. a Facebook lead later phones the hotline and arrives
// as a Call Center mail). The mail is never dropped silently any more. What happens depends on the state of the lead we already have:
//   open + owner still active and working it -> "Re-contact" on that same lead: timeline entry, channel added, owner + team leader alerted,
//                                               a fresh 24-hour clock (escalateRecontacts)
//   open but stale (owner gone / inactive, or no real activity for N days) -> the same, and the lead is re-routed by the routing rules
//   Won                                       -> no new sales lead; the owner + team leader are told (new unit or after-sales)
//   closed (Lost, Not Interested, Low Budget, Closed) -> a NEW lead marked "Returning", linked to the old one; old owner if still active
//   Invalid / Wrong Number                    -> nothing created; Sales Operation is told so a person decides
//   deleted on purpose                        -> nothing created (as before)
// Plain rules on status and dates, no AI.
import { admin, nowIso, normEmail, normPhone, rid, str } from "./lib.ts";
import { addNotifications, emailUser, appBase, leadLink, later } from "./notify.ts";
import type { MailHead } from "./ews.ts";
import { chooseAgent, createLeadFromParsed, leadColumns, loadQueue, logMail, SALES_ROLES, type Parsed } from "./ingest.ts";

const REAL_EVENTS = ["Call", "Email", "Meeting", "Visit", "WhatsApp", "SMS", "Comment"];
const WON = "Won";
const BAD = new Set(["Invalid", "Wrong Number"]);
const CLOSED_RETURNABLE = new Set(["Lost", "Not Interested", "Low Budget", "Closed"]);
const SAME_CHANNEL_QUIET_HOURS = 24;     // the same person sending the same form again within a day is a plain duplicate, not a re-contact
export const RECONTACT_STALE_DAYS = 30;  // open lead with no real activity for this long: re-routed when the customer comes back

export type Outcome =
  | { kind: "recontact"; leadId: string; reassignedTo?: string }
  | { kind: "won"; leadId: string }
  | { kind: "returning"; leadId: string; oldId: string }
  | { kind: "duplicate"; leadId: string; reason: string };

const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** every lead with the same phone (or e-mail) — the old findDuplicate looked at one random row only */
async function matches(parsed: Parsed, phoneFirst: boolean) {
  const phone = normPhone(parsed.phoneNumber), email = normEmail(parsed.email);
  const f: string[] = [];
  if (phone) f.push(`phone_norm.eq.${phone}`);
  if (email && !(phoneFirst && phone)) f.push(`email_norm.eq.${email.replace(/[,()]/g, "")}`);
  if (!f.length) return [];
  const { data } = await admin.from("crm_leads").select("id,status,assigned_to,deleted_at,updated_at,data").or(f.join(",")).order("updated_at", { ascending: false }).limit(20);
  return data || [];
}

/** the lead that speaks for this customer: open first, then won, then closed, then invalid, then deleted (newest first inside each) */
async function pickLead(rows: any[]): Promise<any | null> {
  const live = rows.filter((r) => !r.deleted_at);
  // a lead folded into another one ("Duplicate" + mergedInto) is represented by the lead it was merged into
  for (const r of live) {
    if (r.status === "Duplicate" && r.data?.mergedInto && !live.some((x) => x.id === r.data.mergedInto)) {
      const { data: m } = await admin.from("crm_leads").select("id,status,assigned_to,deleted_at,updated_at,data").eq("id", r.data.mergedInto).maybeSingle();
      if (m && !m.deleted_at) live.push(m);
    }
  }
  const real = live.filter((r) => r.status !== "Duplicate");
  const isOpen = (r: any) => r.status !== WON && !BAD.has(r.status) && !CLOSED_RETURNABLE.has(r.status);
  return real.find(isOpen) || real.find((r) => r.status === WON) || real.find((r) => CLOSED_RETURNABLE.has(r.status))
    || real.find((r) => BAD.has(r.status)) || live[0] || rows[0] || null;
}

const lastRealActivity = (d: any): number => {
  let t = Math.max(Date.parse(d.lastContactDate) || 0, Date.parse(d.firstContactAt) || 0);
  for (const e of Array.isArray(d.timeline) ? d.timeline : []) if (REAL_EVENTS.includes(e?.type)) t = Math.max(t, Date.parse(e.timestamp) || 0);
  return t;
};

async function salesUser(id: string | null) {
  if (!id) return null;
  const { data } = await admin.from("app_users").select("id,name,role,active,on_leave,team_leader_id").eq("id", id).maybeSingle();
  return data || null;
}
async function opsIds(): Promise<string[]> {
  const { data } = await admin.from("app_users").select("id").eq("role", "Sales Operation").neq("active", false);
  return (data || []).map((u: any) => u.id);
}

/** writes the re-contact facts on the lead (idempotent per mail id). Returns the changed data, or null when this mail was already recorded. */
function addRecontact(d: any, ev: { at: string; channel: string; source: string; mailId: string; note: string }) {
  const list: any[] = Array.isArray(d.recontacts) ? d.recontacts : [];
  if (list.some((x) => x.mailId === ev.mailId)) return null;
  const first = d.firstChannel || d.channel || "";
  const channels = Array.from(new Set([...(Array.isArray(d.channels) ? d.channels : first ? [first] : []), ev.channel].filter(Boolean)));
  return {
    ...d,
    firstChannel: first || undefined,
    lastChannel: ev.channel || d.lastChannel,
    channels,
    recontacts: [...list, ev].slice(-50),
    recontactCount: Math.min(list.length + 1, 999),
    lastRecontactAt: ev.at,
    lastUpdated: nowIso(),
  };
}

async function saveLead(id: string, prevUpdatedAt: string, d: any) {
  const u = await admin.from("crm_leads").update({ data: d, ...leadColumns(d) }).eq("id", id).eq("updated_at", prevUpdatedAt).select("id");
  if (!u.error && u.data?.length) return true;
  // somebody saved the lead at the same moment: read it again once and redo the change on the fresh copy
  return false;
}

async function tell(to: string[], leadId: string, title: string, body: string, mail?: { subject: string; html: string }) {
  const ids = Array.from(new Set(to.filter(Boolean)));
  if (!ids.length) return;
  await addNotifications(ids.map((u) => ({ userId: u, type: "recontact", leadId, title, body })));
  if (mail) for (const u of ids) later(emailUser(u, mail.subject, mail.html, "Re-contact"));
}

/**
 * Called by the mailbox and the Facebook sheet sync instead of "skip as duplicate". Returns what was done, or null when no lead matches
 * (the caller then creates a normal new lead).
 */
export async function handleKnownCustomer(parsed: Parsed, head: MailHead & { channel?: string; origin?: string }, text: string, opts: { phoneFirst?: boolean; byUser?: string; channel: string } ): Promise<Outcome | null> {
  const rows = await matches(parsed, !!opts.phoneFirst);
  if (!rows.length) return null;
  const hit = await pickLead(rows);
  if (!hit) return null;
  if (hit.deleted_at) return { kind: "duplicate", leadId: hit.id, reason: "Skipped: matches a lead that was deleted on purpose" };

  const at = head.receivedTime && !isNaN(Date.parse(head.receivedTime)) ? new Date(head.receivedTime).toISOString() : nowIso();
  const channel = opts.channel || "";
  const ev = { at, channel, source: str(parsed.source || "", 80), mailId: head.id, note: str(parsed.description || text || "", 300) };
  const d0 = hit.data || {};

  // same channel again within a day (e.g. the same Facebook form sent twice): a plain duplicate, nobody is disturbed
  const lastTouch = Math.max(Date.parse(d0.lastRecontactAt) || 0, Date.parse(d0.timeline?.[0]?.timestamp) || Date.parse(d0.date) || 0);
  const lastCh = d0.lastChannel || d0.channel || "";
  if (channel && lastCh === channel && Math.abs(Date.parse(at) - lastTouch) < SAME_CHANNEL_QUIET_HOURS * 3600_000)
    return { kind: "duplicate", leadId: hit.id, reason: `Duplicate of ${hit.id} (same ${channel} enquiry within ${SAME_CHANNEL_QUIET_HOURS} hours)` };

  const who = d0.customerName || parsed.customerName || hit.id;
  const via = channel || "another channel";
  const base = await appBase();

  // ---- Invalid / Wrong Number: a person decides ----------------------------------------------------------------
  if (BAD.has(hit.status)) {
    await tell(await opsIds(), hit.id, `A lead marked "${hit.status}" contacted us again: ${who}`, `New contact via ${via}. Nothing was created automatically — check the lead and decide.`);
    return { kind: "duplicate", leadId: hit.id, reason: `Not created: matches ${hit.id}, marked ${hit.status}. Sales Operation was told.` };
  }

  // ---- closed (Lost / Not Interested / Low Budget / Closed): a new "Returning" lead, linked ------------------
  if (CLOSED_RETURNABLE.has(hit.status)) {
    const owner = await salesUser(hit.assigned_to);
    const ownerOk = owner && owner.active !== false && !owner.on_leave && SALES_ROLES.includes(owner.role);
    const lead = await createLeadFromParsed(parsed, head as any, text, opts.byUser, {
      agent: ownerOk ? { id: owner!.id, name: owner!.name } : undefined,
      extra: { returningOf: hit.id, returningPrevStatus: hit.status, firstChannel: d0.firstChannel || d0.channel || undefined, channels: Array.from(new Set([d0.firstChannel || d0.channel, ...(d0.channels || []), channel].filter(Boolean))) },
      note: `Returning customer: earlier lead ${hit.id} was closed as "${hit.status}"${d0.lostReason ? ` (${d0.lostReason})` : ""}. Came back via ${via}.`,
    });
    const d1 = addRecontact(d0, ev);
    if (d1) {
      d1.returnedAs = [...(Array.isArray(d0.returnedAs) ? d0.returnedAs : []), lead.id].slice(-20);
      d1.timeline = [...(d0.timeline || []), { id: rid(), timestamp: at, type: "Re-contact", user: "System", title: "Customer came back", description: `Contacted us again via ${via}. New lead ${lead.id} was opened (this lead stays ${hit.status}).` }];
      if (!(await saveLead(hit.id, hit.updated_at, d1))) { /* the old lead changed at the same moment: the new lead already carries the link */ }
    }
    return { kind: "returning", leadId: lead.id, oldId: hit.id };
  }

  // ---- open or won: recorded on the same lead --------------------------------------------------------------
  const owner = await salesUser(hit.assigned_to);
  const tl = owner?.team_leader_id || null;
  if (hit.status === WON) {
    const d1 = addRecontact(d0, ev);
    if (!d1) return { kind: "duplicate", leadId: hit.id, reason: `Already recorded on ${hit.id}` };
    d1.timeline = [...(d0.timeline || []), { id: rid(), timestamp: at, type: "Re-contact", user: "System", title: "Won customer contacted us again", description: `Via ${via}. Probably a new unit or an after-sales question — no new lead was created.` }];
    await saveLead(hit.id, hit.updated_at, d1);
    await tell([hit.assigned_to, tl].filter(Boolean) as string[], hit.id, `Won customer contacted us again: ${who}`, `Via ${via}. Call them back: new unit or after-sales?`);
    return { kind: "won", leadId: hit.id };
  }

  // open
  const q = await loadQueue();
  const days = Number(q.recontactStaleDays) > 0 ? Number(q.recontactStaleDays) : RECONTACT_STALE_DAYS;
  const ownerGone = !owner || owner.active === false || !SALES_ROLES.includes(owner.role);
  const lastAct = lastRealActivity(d0) || Date.parse(d0.assignedDate) || Date.parse(d0.date) || 0;
  const stale = !!hit.assigned_to && (ownerGone || Date.now() - lastAct > days * 86400_000);
  let d1 = addRecontact(d0, ev);
  if (!d1) return { kind: "duplicate", leadId: hit.id, reason: `Already recorded on ${hit.id}` };
  const tlEv: any[] = [{ id: rid(), timestamp: at, type: "Re-contact", user: "System", title: `Customer contacted us again (${via})`, description: ev.note ? `“${ev.note.slice(0, 200)}”` : `New enquiry via ${via}.` }];
  let reassignedTo: string | undefined;
  if (stale || !hit.assigned_to) {
    const agent = await chooseAgent({ ...d1, assignedSalespersonId: "" }, q);
    if (agent && agent.id !== hit.assigned_to) {
      d1 = { ...d1, assignedSalespersonId: agent.id, assignedSalespersonName: agent.name, assignedDate: nowIso(), reassignCount: (Number(d1.reassignCount) || 0) + 1 };
      tlEv.push({ id: rid(), timestamp: nowIso(), type: "Assignment", user: "System", title: "Re-routed on re-contact", description: `${owner?.name || "No owner"} → ${agent.name}: ${ownerGone ? "the previous owner is no longer active" : !hit.assigned_to ? "the lead had no owner" : `no activity for more than ${days} days`}.` });
      reassignedTo = agent.id;
    }
  }
  d1.timeline = [...(d0.timeline || []), ...tlEv];
  if (!(await saveLead(hit.id, hit.updated_at, d1))) {
    // lost a race with a person saving the lead: one more try on the fresh copy (without re-routing)
    const { data: fresh } = await admin.from("crm_leads").select("id,updated_at,data").eq("id", hit.id).maybeSingle();
    const d2 = fresh && addRecontact(fresh.data || {}, ev);
    if (!d2) return { kind: "recontact", leadId: hit.id };
    d2.timeline = [...(fresh.data?.timeline || []), tlEv[0]];
    await saveLead(hit.id, fresh.updated_at, d2);
    reassignedTo = undefined;
  }
  const ownerNow = reassignedTo || hit.assigned_to;
  const tlNow = reassignedTo ? (await salesUser(reassignedTo))?.team_leader_id : tl;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#333"><p style="color:#A6192E;font-weight:700">${esc(who)} contacted us again via ${esc(via)}.</p>
<p>This customer is already lead <b>${esc(hit.id)}</b>${d0.channel ? ` (first came from ${esc(d0.channel)})` : ""}. A repeat contact is a strong buying signal: please call back within 24 hours.</p>
${ev.note ? `<p style="color:#555">“${esc(ev.note.slice(0, 300))}”</p>` : ""}<p><a href="${esc(leadLink(base, hit.id))}" style="color:#A6192E;font-weight:700">Open lead ${esc(hit.id)}</a></p></div>`;
  if (ownerNow) await tell([ownerNow], hit.id, `🔥 ${who} contacted us again (${via})`, reassignedTo ? "This lead was re-routed to you. Call back within 24 hours." : "Call back within 24 hours.", { subject: `Customer contacted us again: ${who}`, html });
  await tell([tlNow || "", ...(ownerNow ? [] : await opsIds())].filter(Boolean), hit.id, `${who} contacted us again (${via})`, `Lead ${hit.id}, owner: ${d1.assignedSalespersonName || "none"}.`);
  return { kind: "recontact", leadId: hit.id, reassignedTo };
}

/** mail-log line for an outcome (the caller writes it) */
export async function logOutcome(base: any, o: Outcome, extra: Record<string, any> = {}) {
  if (o.kind === "duplicate") return logMail(base, "Duplicate", { ...base, ...extra, parsedLeadId: o.leadId, error: o.reason });
  if (o.kind === "returning") return logMail(base, "Success", { ...base, ...extra, parsedLeadId: o.leadId, note: `Returning customer (earlier lead ${o.oldId})`, returningOf: o.oldId });
  return logMail(base, "Re-contact", { ...base, ...extra, parsedLeadId: o.leadId, note: o.kind === "won" ? `Won customer contacted again: recorded on ${o.leadId}` : `Customer contacted again: recorded on ${o.leadId}${o.reassignedTo ? " and re-routed" : ""}` });
}

// ---------------------------------------------------------------------------------------------
// the 24-hour clock after a re-contact (scheduler, every 30 minutes with the call-center check)
// ---------------------------------------------------------------------------------------------
export async function escalateRecontacts() {
  const now = Date.now();
  const since = new Date(now - 73 * 3600_000).toISOString();
  const { data } = await admin.from("crm_leads").select("id,assigned_to,status,j_at:data->>lastRecontactAt,j_tl:data->timeline,j_name:data->>customerName,j_owner:data->>assignedSalespersonName,j_ch:data->>lastChannel")
    .is("deleted_at", null).gte("data->>lastRecontactAt", since).limit(500);
  const late = (data || []).slice(0, 500).filter((r: any) => {
    if (!r.assigned_to || ["Won", "Lost", "Not Interested", "Low Budget", "Wrong Number", "Duplicate", "Invalid", "Closed"].includes(r.status)) return false;
    const at = Date.parse(r.j_at) || 0, hrs = (now - at) / 3600_000;
    if (hrs < 24 || hrs > 72) return false;
    return !(Array.isArray(r.j_tl) ? r.j_tl : []).some((e: any) => REAL_EVENTS.includes(e?.type) && (Date.parse(e.timestamp) || 0) >= at);
  });
  if (!late.length) return { rcLate: 0 };
  const keys = late.slice(0, 100).map((r: any) => `rc24:${r.id}:${r.j_at}`);
  const { data: seenRows } = await admin.from("crm_reminders_sent").select("key").in("key", keys);
  const seen = new Set((seenRows || []).map((x: any) => x.key));
  const fresh = late.slice(0, 100).filter((r: any) => !seen.has(`rc24:${r.id}:${r.j_at}`)).slice(0, 30);
  if (!fresh.length) return { rcLate: late.length, rcSent: 0 };
  await admin.from("crm_reminders_sent").upsert(fresh.map((r: any) => ({ key: `rc24:${r.id}:${r.j_at}` })));
  const ops = await opsIds();
  for (const r of fresh) {
    const tl = (await salesUser(r.assigned_to))?.team_leader_id;
    const who = r.j_name || r.id;
    await addNotifications([
      { userId: r.assigned_to, type: "escalation", leadId: r.id, title: `Re-contacted customer still waiting after 24 hours: ${who}`, body: "The customer contacted us again and has not been called back. Contact them now and log it." },
      ...(tl ? [tl] : ops).map((u: string) => ({ userId: u, type: "escalation", leadId: r.id, title: `Re-contact not answered for 24 hours: ${who}`, body: `Owner: ${r.j_owner || "—"}. Came back via ${r.j_ch || "—"}.` })),
    ]);
  }
  return { rcLate: late.length, rcSent: fresh.length };
}
