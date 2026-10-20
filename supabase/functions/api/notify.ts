// deno-lint-ignore-file no-explicit-any
// Notifications: stored per user on the server (bell in the app) + e-mail from the system mailbox (the same no-reply account
// the mail ingestion uses). Used by: lead assignment, changes on an assigned lead, reminders (follow-up / meeting / task).
import { admin, escHtml, getConfig, nowIso, pageAll, setConfig, str } from "./lib.ts";
import { loadEws, sendMail } from "./ews.ts";

declare const EdgeRuntime: any;
/** keep working after the HTTP answer has been sent (Supabase edge runtime); plain fire-and-forget elsewhere */
export const later = (p: Promise<any>) => { const q = p.catch(() => {}); try { EdgeRuntime?.waitUntil?.(q); } catch { /* ignore */ } };

const SITE = "https://sdm-sales-leads.github.io/";
/** the address every e-mail link points to. A setting or APP_URL secret is only used when it is the sales site itself: a wrong value
 *  (it once held the Land Bank address) must never reach a customer or a colleague. */
export async function appBase(): Promise<string> {
  const u = String((await getConfig<any>("app", {})).url || Deno.env.get("APP_URL") || SITE);
  const ok = /^https:\/\/sdm-sales-leads\.github\.io(\/|$)/i.test(u) ? u : SITE;
  return ok.replace(/\/?(index\.html)?$/, "/");
}
/** opens the lead itself after sign-in (the app reads #lead=...) */
export const leadLink = (base: string, id: string) => `${base}#lead=${encodeURIComponent(id)}`;

const shell = (head: string, inner: string) => `<div style="font-family:Segoe UI,Tahoma,Arial,sans-serif;background:#f6f6f6;padding:0;margin:0">
<div style="max-width:600px;margin:20px auto;background:#fff;border:1px solid #e1e1e1;border-radius:8px;overflow:hidden">
<div style="background:#A6192E;padding:16px 22px"><span style="color:#fff;font-size:18px;font-weight:600">SDM Sales Leads</span></div>
<div style="padding:24px;color:#333;line-height:1.6;font-size:15px"><h2 style="color:#A6192E;margin:0 0 12px;font-size:18px">${escHtml(head)}</h2>${inner}</div>
<div style="background:#f1f1f1;padding:10px;text-align:center;font-size:12px;color:#888">Automated message from the sales system. Please do not reply.</div>
</div></div>`;
const btn = (href: string, text: string) => `<p style="margin:18px 0"><a href="${escHtml(href)}" style="color:#A6192E;font-weight:700">${escHtml(text)}</a></p>`;
const row = (k: string, v?: string | number | null) => (v === undefined || v === null || v === "" ? "" : `<tr><td style="padding:3px 14px 3px 0;color:#777;vertical-align:top">${escHtml(k)}</td><td style="padding:3px 0"><b>${escHtml(String(v))}</b></td></tr>`);

/** The hold switch (system_config "notify_hold"). ON unless the value is false: while it is on, the in-system bell still works but NO e-mail is sent. */
let holdAt = 0, holdVal = true;
export async function notifyOnHold(): Promise<boolean> {
  if (Date.now() - holdAt > 15_000) { holdVal = (await getConfig<any>("notify_hold", true)) !== false; holdAt = Date.now(); }
  return holdVal;
}
export const resetHoldCache = () => { holdAt = 0; };

export async function addNotifications(rows: { userId: string; type: string; leadId?: string; title: string; body?: string }[]) {
  if (!rows.length) return;
  await admin.from("crm_notifications").insert(rows.map((r) => ({ user_id: r.userId, type: r.type, lead_id: r.leadId || null, title: str(r.title, 200), body: str(r.body || "", 1500) })));
}

/** one mail per person, from the system mailbox; never throws (a mail problem must not break saving a lead) */
export async function emailUser(userId: string, subject: string, html: string, kind: string) {
  try {
    if (await notifyOnHold()) return;
    const { data: u } = await admin.from("app_users").select("email,active").eq("id", userId).maybeSingle();
    if (!u?.email || u.active === false) return;
    let cfg; try { cfg = await loadEws(); } catch { return; }       // mailbox not set up: in-app notification only
    await sendMail(cfg, { to: [String(u.email)], subject: str(subject, 150).replace(/[\r\n]+/g, " "), html });
    await admin.from("notification_logs").insert({ to_email: u.email, subject, status: "success", type: kind });
  } catch (e: any) {
    await admin.from("notification_logs").insert({ to_email: "", subject, status: "error", error: String(e?.message || "failed").slice(0, 300), type: kind }).then(() => {}, () => {});
  }
}

// ---------------------------------------------------------------------------------------------
// assignment: "you got a new lead"
// ---------------------------------------------------------------------------------------------
export interface Assigned { userId: string; leadId: string; leadName: string; company?: string; project?: string; source?: string; byName?: string }
export async function notifyAssigned(items: Assigned[]) {
  if (!items.length) return;
  const base = await appBase();
  const by = new Map<string, Assigned[]>();
  for (const i of items) by.set(i.userId, [...(by.get(i.userId) || []), i]);
  await addNotifications(items.map((i) => ({ userId: i.userId, type: "assigned", leadId: i.leadId, title: `New lead assigned: ${i.leadName || "(no name)"}`, body: [i.company, i.project, i.byName ? `Assigned by ${i.byName}` : ""].filter(Boolean).join(" · ") })));
  // no e-mail per lead: the bell is instant, the e-mail comes as one table at 09:30, 12:30 and 15:30 (see sendAssignDigest)
  void by; void base;
}

const DIGEST_SLOTS = ["09:30", "12:30", "15:30"];
/** One e-mail per person with every lead assigned since the previous digest. Runs from the 5-minute scheduler; sends Sunday to Thursday
 *  at 09:30, 12:30 and 15:30 Cairo time (Friday and Saturday are off days: the leads wait for Sunday's first mail). Nothing is sent to a person
 *  who got no new lead. Reminders, due dates and meeting alerts are separate and stay immediate. */
export async function sendAssignDigest() {
  const now = new Date();
  const cur = await getConfig<any>("assign_digest", {});
  if (!cur.at) { await setConfig("assign_digest", { at: now.toISOString(), slot: "" }); return { digest: "started" }; }
  const p: any = CAIRO_PARTS(now);
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", weekday: "short" }).format(now);
  if (wd === "Fri" || wd === "Sat") return { digest: "off day" };
  const mins = +p.hour * 60 + +p.minute;
  const due = DIGEST_SLOTS.filter((t) => mins >= +t.slice(0, 2) * 60 + +t.slice(3)).pop();
  if (!due) return { digest: "not yet" };
  const slot = `${p.year}-${p.month}-${p.day}@${due}`;
  if (cur.slot === slot) return { digest: "already sent" };
  await setConfig("assign_digest", { at: now.toISOString(), slot });       // first: a slow mail run must not send twice
  const rows = await pageAll((a, b) => admin.from("crm_leads").select("id,assigned_to,status,data->customerName,data->companyName,data->project,data->source,data->channel,data->assignedDate,data->legacyId")
    .is("deleted_at", null).not("assigned_to", "is", null).gte("data->>assignedDate", String(cur.at)).lte("data->>assignedDate", now.toISOString()).order("id").range(a, b), 5000);
  const by = new Map<string, any[]>();
  for (const r of rows || []) { by.set(r.assigned_to as string, [...(by.get(r.assigned_to as string) || []), r]); }
  const base = await appBase();
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  let sent = 0;
  for (const [uid, list] of by) {
    list.sort((x, y) => String(x.assignedDate).localeCompare(String(y.assignedDate)));
    const th = (t: string) => `<th style="text-align:left;padding:6px 8px;background:#f1f1f1;border-bottom:1px solid #ddd">${t}</th>`;
    const td = (t: string) => `<td style="padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top">${escHtml(t || "—")}</td>`;
    const body = list.slice(0, 200).map((r) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee"><a href="${escHtml(leadLink(base, r.id))}" style="color:#A6192E;font-weight:700">${escHtml(r.id)}</a></td>${td(r.customerName || r.companyName)}${td(r.project)}${td(r.channel || r.source)}${td(r.assignedDate ? when(r.assignedDate) : "")}</tr>`).join("");
    await emailUser(uid, `${list.length} new lead${list.length === 1 ? "" : "s"} assigned to you`, shell(`${list.length} new lead${list.length === 1 ? "" : "s"} assigned to you`,
      `<p>These leads were assigned to you since the last update (times are Cairo time).</p><table style="border-collapse:collapse;width:100%;font-size:13px"><tr>${th("Lead")}${th("Customer")}${th("Project")}${th("Source")}${th("Assigned")}</tr>${body}</table>${list.length > 200 ? `<p>…and ${list.length - 200} more. Open the system to see all of them.</p>` : ""}${btn(base, "Open the sales system")}`), "Lead Digest");
    sent++;
  }
  return { digest: "sent", people: sent, leads: (rows || []).length };
}

// ---------------------------------------------------------------------------------------------
// a change made by somebody else on a lead you own
// ---------------------------------------------------------------------------------------------
export interface Changed { userId: string; leadId: string; leadName: string; summary: string; byName: string }
export async function notifyChanged(items: Changed[]) {
  if (!items.length) return;
  await addNotifications(items.map((i) => ({ userId: i.userId, type: "changed", leadId: i.leadId, title: `${i.leadName || i.leadId} was changed by ${i.byName}`, body: i.summary })));
}

// ---------------------------------------------------------------------------------------------
// reminders (called every 5 minutes by the scheduler; acts between 07:00 and 23:00 Cairo time)
// ---------------------------------------------------------------------------------------------
const CAIRO_PARTS = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
/** an instant from a Cairo wall-clock date + time (the offset changes with summer time, so it is found from the clock itself) */
export function cairoInstant(date: string, time = "09:00"): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || ""); if (!m) return null;
  const t = /^(\d{1,2}):(\d{2})/.exec(time || "") || ["", "9", "00"];
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  for (const off of [3, 2]) {            // Egypt is UTC+3 in summer time, UTC+2 otherwise
    const d = new Date(guess - off * 3600_000), p: any = CAIRO_PARTS(d);
    if (+p.hour === +t[1] && +p.minute === +t[2] && +p.day === +m[3]) return d;
  }
  return new Date(guess - 2 * 3600_000);
}
const whenText = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d) + " (Cairo time)";

interface Due { key: string; userId: string; kind: string; title: string; when: Date; leadId?: string; details: [string, string | undefined][] }

export async function runReminders() {
  const now = new Date();
  const hour = +(CAIRO_PARTS(now) as any).hour;
  if (hour < 7 || hour >= 23) return { skipped: "outside 07:00-23:00 Cairo" };
  const horizon = now.getTime() + 15 * 60_000, floor = now.getTime() - 12 * 3600_000;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const d0 = iso(now.getTime() - 24 * 3600_000), d1 = iso(now.getTime() + 24 * 3600_000);
  const due: Due[] = [];

  // tasks: due date (with a time when the task has one; a plain date means 09:00)
  const { data: tasks } = await admin.from("crm_tasks").select("id,owner_id,data").neq("data->>status", "Completed").gte("data->>dueDate", d0).lte("data->>dueDate", d1 + "T99").limit(500);
  for (const t of tasks || []) {
    const d = t.data || {}; const s = String(d.dueDate || ""); if (!t.owner_id || !s) continue;
    const when = s.length > 10 ? new Date(s) : cairoInstant(s, "09:00");
    if (!when || isNaN(when.getTime())) continue;
    due.push({ key: `task:${t.id}:${s}`, userId: t.owner_id, kind: "Task", title: d.title || "Task", when, leadId: d.leadId, details: [["Task", d.title], ["Details", d.description], ["Priority", d.priority]] });
  }
  // leads: meeting / site visit slot and the next follow-up date
  const base = admin.from("crm_leads").select("id,assigned_to,data").is("deleted_at", null).not("assigned_to", "is", null);
  const [mt, fu] = await Promise.all([
    base.gte("data->>meetingDate", d0).lte("data->>meetingDate", d1).limit(500),
    admin.from("crm_leads").select("id,assigned_to,data").is("deleted_at", null).not("assigned_to", "is", null).gte("data->>nextFollowUpDate", d0).lte("data->>nextFollowUpDate", d1).limit(500),
  ]);
  const closed = new Set(["Won", "Lost", "Not Interested", "Low Budget", "Duplicate", "Closed", "Invalid"]);
  const leadDetails = (l: any): [string, string | undefined][] => [["Lead", l.data?.customerName], ["Company", l.data?.companyName], ["Phone", l.data?.phoneNumber], ["Project", l.data?.project], ["Status", l.data?.status]];
  for (const l of mt.data || []) {
    if (closed.has(l.data?.status)) continue;
    const when = cairoInstant(l.data.meetingDate, l.data.meetingTime || "09:00"); if (!when) continue;
    due.push({ key: `meet:${l.id}:${l.data.meetingDate}T${l.data.meetingTime || ""}`, userId: l.assigned_to, kind: "Meeting / site visit", title: `Meeting or site visit with ${l.data.customerName || l.id}`, when, leadId: l.id, details: leadDetails(l) });
  }
  for (const l of fu.data || []) {
    if (closed.has(l.data?.status)) continue;
    const when = cairoInstant(l.data.nextFollowUpDate, "09:00"); if (!when) continue;
    due.push({ key: `fu:${l.id}:${l.data.nextFollowUpDate}`, userId: l.assigned_to, kind: "Follow-up", title: `Follow up with ${l.data.customerName || l.id}`, when, leadId: l.id, details: leadDetails(l) });
  }

  const ready = due.filter((x) => x.when.getTime() <= horizon && x.when.getTime() >= floor);
  if (!ready.length) return { checked: due.length, sent: 0 };
  const sentKeys = new Set<string>();
  for (let i = 0; i < ready.length; i += 100) {
    const { data } = await admin.from("crm_reminders_sent").select("key").in("key", ready.slice(i, i + 100).map((r) => r.key));
    (data || []).forEach((r: any) => sentKeys.add(r.key));
  }
  const fresh = ready.filter((r) => !sentKeys.has(r.key)).slice(0, 400);
  if (!fresh.length) return { checked: due.length, sent: 0 };
  const baseUrl = await appBase();
  await admin.from("crm_reminders_sent").upsert(fresh.map((r) => ({ key: r.key })));
  // one person with several reminders due at the same time (every follow-up of a day falls at 09:00) gets ONE bell entry and ONE e-mail
  // with a table of links, not one of each per lead
  const byUser = new Map<string, Due[]>();
  for (const r of fresh) byUser.set(r.userId, [...(byUser.get(r.userId) || []), r]);
  const bells: { userId: string; type: string; leadId?: string; title: string; body?: string }[] = [];
  for (const [uid, list] of byUser) {
    if (list.length <= 2) {
      for (const r of list) {
        bells.push({ userId: uid, type: "reminder", leadId: r.leadId, title: `${r.kind}: ${r.title}`, body: whenText(r.when) });
        await emailUser(uid, `Reminder: ${r.title}`, shell(`Reminder: ${r.kind}`,
          `<p><b>${escHtml(r.title)}</b></p><table>${row("When", whenText(r.when))}${r.details.map(([k, v]) => row(k, v)).join("")}</table>${r.leadId ? btn(leadLink(baseUrl, r.leadId), `Open the lead: ${r.leadId}`) : ""}`), "Reminder");
      }
      continue;
    }
    bells.push({ userId: uid, type: "reminder", title: `${list.length} reminders due now`, body: list.slice(0, 3).map((r) => r.title).join(" · ") + (list.length > 3 ? " …" : "") });
    const td = (t: string) => `<td style="padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top">${escHtml(t || "—")}</td>`;
    const rowsHtml = list.slice(0, 100).map((r) => `<tr>${td(r.kind)}<td style="padding:6px 8px;border-bottom:1px solid #eee">${r.leadId ? `<a href="${escHtml(leadLink(baseUrl, r.leadId))}" style="color:#A6192E;font-weight:700">${escHtml(r.leadId)}</a>` : "—"}</td>${td(r.title.replace(/^(Follow up with|Meeting or site visit with)\s*/i, ""))}${td(whenText(r.when))}</tr>`).join("");
    await emailUser(uid, `${list.length} reminders due now`, shell(`${list.length} reminders due now`,
      `<table style="border-collapse:collapse;width:100%;font-size:13px"><tr><th style="text-align:left;padding:6px 8px;background:#f1f1f1">Type</th><th style="text-align:left;padding:6px 8px;background:#f1f1f1">Lead</th><th style="text-align:left;padding:6px 8px;background:#f1f1f1">Customer</th><th style="text-align:left;padding:6px 8px;background:#f1f1f1">When</th></tr>${rowsHtml}</table>${list.length > 100 ? `<p>…and ${list.length - 100} more. Open the system to see all of them.</p>` : ""}${btn(baseUrl, "Open the sales system")}`), "Reminder");
  }
  await addNotifications(bells);
  return { checked: due.length, sent: fresh.length };
}

// ---------------------------------------------------------------------------------------------
// call center leads: the first contact must happen within 24 hours. Past that, the team leader is told (bell + e-mail), once per lead.
// The clock starts when the lead has both arrived and been given to its owner (the later of the two).
// ---------------------------------------------------------------------------------------------
const CC_CLOSED = new Set(["Won", "Lost", "Not Interested", "Low Budget", "Wrong Number", "Duplicate", "Invalid", "Closed"]);
const REAL_EVENTS = ["Call", "Email", "Meeting", "Visit", "WhatsApp", "SMS", "Comment"];
export const isEngagedRow = (d: any): boolean => {
  if (d?.firstContactAt || d?.lastContactDate || d?.offerSent || d?.meetingDate) return true;
  if (d?.status && d.status !== "New" && d.status !== "Assigned") return true;
  return Array.isArray(d?.timeline) && d.timeline.some((t: any) => REAL_EVENTS.includes(t?.type));
};

export async function escalateCallCenter() {
  const now = Date.now();
  const hour = +(CAIRO_PARTS(new Date(now)) as any).hour;
  if (hour < 7 || hour >= 23) return { ccSkipped: "outside 07:00-23:00 Cairo" };
  const { data } = await admin.from("crm_leads").select("id,assigned_to,data").is("deleted_at", null).not("assigned_to", "is", null).ilike("data->>channel", "call center").limit(800);
  const late: any[] = [];
  for (const l of data || []) {
    const d = l.data || {};
    if (CC_CLOSED.has(d.status) || isEngagedRow(d)) continue;
    const start = Math.max(Date.parse(d.date) || 0, Date.parse(d.assignedDate) || 0);
    if (!start) continue;
    const hrs = (now - start) / 3600_000;
    if (hrs >= 24 && hrs <= 72) late.push({ l, d, hrs, start });         // older than 3 days = history, never alerted
  }
  // call center leads nobody owns yet: Sales Operation is told after 4 hours, so the owner still has time inside the 24
  const { data: orphans } = await admin.from("crm_leads").select("id,data").is("deleted_at", null).is("assigned_to", null).ilike("data->>channel", "call center").limit(300);
  const lonely = (orphans || []).filter((l: any) => !CC_CLOSED.has(l.data?.status) && !isEngagedRow(l.data) && (() => { const h = (now - (Date.parse(l.data?.date) || 0)) / 3600_000; return h >= 4 && h <= 72; })());
  if (lonely.length) {
    const lk = lonely.map((l: any) => `ccun:${l.id}`); const seenL = new Set<string>();
    for (let i = 0; i < lk.length; i += 100) { const { data: r } = await admin.from("crm_reminders_sent").select("key").in("key", lk.slice(i, i + 100)); (r || []).forEach((x: any) => seenL.add(x.key)); }
    const newL = lonely.filter((l: any) => !seenL.has(`ccun:${l.id}`)).slice(0, 30);
    if (newL.length) {
      await admin.from("crm_reminders_sent").upsert(newL.map((l: any) => ({ key: `ccun:${l.id}` })));
      const { data: opsU } = await admin.from("app_users").select("id").eq("role", "Sales Operation").neq("active", false);
      const base0 = await appBase();
      for (const u of (opsU || [])) {
        await addNotifications(newL.map((l: any) => ({ userId: u.id, type: "escalation", leadId: l.id, title: `Call center lead has no owner: ${l.data?.customerName || l.id}`, body: "Assign it now: the customer is waiting for a call back." })));
        await emailUser(u.id, `Call center leads without an owner (${newL.length})`, shell("Call center leads waiting for an owner",
          `<p>These call center leads have no salesperson yet. The customers phoned us and wait for a call back within 24 hours.</p><ul style="padding-left:18px">${newL.slice(0, 25).map((l: any) => `<li>${escHtml(l.data?.customerName || "—")} — <a href="${escHtml(leadLink(base0, l.id))}" style="color:#A6192E;font-weight:700">${escHtml(l.id)}</a></li>`).join("")}</ul>`), "Escalation");
      }
    }
  }
  // second step: the team leader had 24 more hours; still no contact after 48 hours -> Sales Operation is told too (once per lead)
  const late48 = late.filter((x) => x.hrs >= 48);
  if (late48.length) {
    const k48 = late48.map((x) => `cc48:${x.l.id}`); const seen48 = new Set<string>();
    for (let i = 0; i < k48.length; i += 100) { const { data: r } = await admin.from("crm_reminders_sent").select("key").in("key", k48.slice(i, i + 100)); (r || []).forEach((y: any) => seen48.add(y.key)); }
    const f48 = late48.filter((x) => !seen48.has(`cc48:${x.l.id}`)).slice(0, 30);
    if (f48.length) {
      await admin.from("crm_reminders_sent").upsert(f48.map((x) => ({ key: `cc48:${x.l.id}` })));
      const { data: ops48 } = await admin.from("app_users").select("id").eq("role", "Sales Operation").neq("active", false);
      const base48 = await appBase();
      for (const u of (ops48 || [])) {
        await addNotifications(f48.map((x) => ({ userId: u.id, type: "escalation", leadId: x.l.id, title: `Call center lead still not contacted after 48 hours: ${x.d.customerName || x.l.id}`, body: `Owner: ${x.d.assignedSalespersonName || "—"}. The team leader was alerted 24 hours ago.` })));
        await emailUser(u.id, `Call center leads still waiting after 48 hours (${f48.length})`, shell("Call center leads: no contact after 48 hours",
          `<ul style="padding-left:18px">${f48.slice(0, 25).map((x) => `<li>${escHtml(x.d.customerName || "—")} (${escHtml(x.d.assignedSalespersonName || "—")}) — <a href="${escHtml(leadLink(base48, x.l.id))}" style="color:#A6192E;font-weight:700">${escHtml(x.l.id)}</a></li>`).join("")}</ul>`), "Escalation");
      }
    }
  }
  if (!late.length) return { ccLate: 0, ccUnowned: lonely.length };
  const keys = late.map((x) => `cc24:${x.l.id}`);
  const seen = new Set<string>();
  for (let i = 0; i < keys.length; i += 100) { const { data: r } = await admin.from("crm_reminders_sent").select("key").in("key", keys.slice(i, i + 100)); (r || []).forEach((x: any) => seen.add(x.key)); }
  const fresh = late.filter((x) => !seen.has(`cc24:${x.l.id}`)).slice(0, 30);
  if (!fresh.length) return { ccLate: late.length, ccSent: 0 };
  await admin.from("crm_reminders_sent").upsert(fresh.map((x) => ({ key: `cc24:${x.l.id}` })));
  const ownerIds = [...new Set(fresh.map((x) => x.l.assigned_to))];
  const { data: owners } = await admin.from("app_users").select("id,name,team_leader_id").in("id", ownerIds);
  const om = new Map((owners || []).map((u: any) => [u.id, u]));
  const { data: ops } = await admin.from("app_users").select("id").eq("role", "Sales Operation").neq("active", false);
  const baseUrl = await appBase();
  for (const x of fresh) {
    const owner: any = om.get(x.l.assigned_to);
    const to = owner?.team_leader_id ? [owner.team_leader_id] : (ops || []).map((u: any) => u.id);   // no team leader: Sales Operation hears about it
    const name = x.d.customerName || x.l.id, hrs = Math.floor(x.hrs);
    const title = `Call center lead passed 24 hours without contact: ${name}`;
    const body = `${owner?.name || "The owner"} has not contacted this lead for ${hrs} hours.`;
    await addNotifications([...to.map((u: string) => ({ userId: u, type: "escalation", leadId: x.l.id, title, body })), { userId: x.l.assigned_to, type: "escalation", leadId: x.l.id, title: `Your call center lead passed 24 hours: ${name}`, body: "Contact the customer now (call, WhatsApp or e-mail) and log it." }]);
    for (const u of to) {
      await emailUser(u, `ALERT: call center lead passed 24 hours - ${name}`, shell("Call center lead: no contact after 24 hours",
        `<p style="color:#A6192E;font-weight:700">This call center lead has had no first contact for ${hrs} hours.</p>
         <table>${row("Lead", name)}${row("Phone", x.d.phoneNumber)}${row("Project", x.d.project)}${row("Owner", owner?.name)}${row("Arrived / assigned", whenText(new Date(x.start)))}${row("Hours without contact", hrs)}</table>
         ${btn(leadLink(baseUrl, x.l.id), `Open the lead: ${x.l.id}`)}`), "Escalation");
    }
  }
  return { ccLate: late.length, ccSent: fresh.length };
}

export { nowIso };
