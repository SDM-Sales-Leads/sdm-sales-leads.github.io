// deno-lint-ignore-file no-explicit-any
// Lara Sales AI — phase 3: her OWN mailbox on the company Exchange, "approve first". NO AI.
// - Sending: only a draft a person approved, only when the admin switched sending on, only in working hours, within the limits
//   (per day, per lead, unanswered mails). Every subject carries the conversation code "[SDM-LD-1234-7F3K]".
// - Reading (every 10 min): a reply is matched by the code, else by the sender's address. It is stored in the conversation, written
//   on the lead's timeline and the owner is told (bell). "Stop" words end the conversation and put the address on the do-not-contact
//   list. "Call me / visit" hands the lead to the owner. A question is answered from the approved Q&A only (as a draft to approve);
//   a question without an approved answer goes to Missed questions and the owner is told.
// - Auto-replies, bounces and out-of-office mails are never answered. Unknown senders are kept for the admin (never a new lead here).
import { admin, getConfig, getSecret, HttpError, nowIso, setConfig, setSecret, str, tryLock, unlock } from "./lib.ts";
import { pg } from "./db.ts";
import { EwsConfig, getBodies, htmlToText, listFolder, loadEws, sendMail, sendMailWithAttachment, verify } from "./ews.ts";
import { recordOfferPrint } from "./lara_offer.ts";
import { inWindow, intl, waCfg, waReady, waSend } from "./lara_wa.ts";
import { normPhone } from "./lib.ts";
import { addNotifications } from "./notify.ts";
import { LARA_CODE_RE } from "./ingest.ts";
import { learn, remember, welcomeBack } from "./lara_memory.ts";
import { firstNameOf } from "../../../src/lib/personName.ts";

export interface LaraMailCfg { address: string; user: string; host: string; shared?: boolean; status?: { ok: boolean; at: string; error?: string } }

export async function laraMailCfg(): Promise<LaraMailCfg> {
  const m = await getConfig<any>("lara_mail", {});
  const main = await getConfig<any>("email_config", {});
  // shared = Lara uses the leads mailbox (mail intake): same address, same stored password
  if (m.shared) return { address: String(main.user || "").toLowerCase(), user: String(main.user || ""), host: String(main.host || ""), shared: true, status: m.status };
  return { address: String(m.address || ""), user: String(m.user || m.address || ""), host: String(m.host || main.host || ""), status: m.status };
}
async function ewsCfg(): Promise<EwsConfig> {
  const m = await laraMailCfg();
  if (m.shared) return await loadEws();
  const pass = await getSecret("lara_mail_password");
  if (!m.host || !m.user || !m.address || !pass) throw new HttpError(400, "Lara's mailbox is not set up yet (Lara > Settings & channels)");
  return { host: m.host, user: m.user, pass };
}
export async function mailboxReady(): Promise<boolean> {
  const m = await laraMailCfg();
  return !!(m.status?.ok && m.address);
}

/** admin: save the mailbox (the password is typed by the admin and goes straight to the Vault) and test it */
export async function saveMailbox(b: any, by: string) {
  const cur = await getConfig<any>("lara_mail", {});
  if (b.shared === true) {
    // the leads mailbox: nothing to type, the intake's own settings and password are used
    let status: any;
    try { await verify(await loadEws()); status = { ok: true, at: nowIso() }; } catch (e: any) { status = { ok: false, at: nowIso(), error: String(e?.message || e).slice(0, 200) }; }
    await setConfig("lara_mail", { shared: true, status });
    const m = await laraMailCfg();
    await admin.from("lara_log").insert({ kind: "config", actor: by, text: `Lara uses the leads mailbox ${m.address}: ${status.ok ? "connected" : `not connected (${status.error})`}` });
    return { address: m.address, user: m.user, host: m.host, shared: true, status };
  }
  const address = str(b.address, 160).toLowerCase();
  const user = str(b.user, 160) || address;
  const host = str(b.host, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new HttpError(400, "Write Lara's e-mail address");
  if (typeof b.password === "string" && b.password.length) {
    if (b.password.length > 200) throw new HttpError(400, "Password too long");
    await setSecret("lara_mail_password", b.password);
  }
  const next: any = { address, user, host: host || cur.host || "", shared: false };
  let status: any;
  try { await verify(await (async () => { await setConfig("lara_mail", next); return ewsCfg(); })()); status = { ok: true, at: nowIso() }; }
  catch (e: any) { status = { ok: false, at: nowIso(), error: String(e?.message || e).slice(0, 200) }; }
  await setConfig("lara_mail", { ...next, status });
  await admin.from("lara_log").insert({ kind: "config", actor: by, text: `Mailbox ${address}: ${status.ok ? "connected" : `not connected (${status.error})`}` });
  return { address, user, host: next.host, status };
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
const cairo = (d = new Date()) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value || "";
  return { hour: +g("hour"), weekday: g("weekday"), day: `${g("year")}-${g("month")}-${g("day")}` };
};
export const inSendHours = (startH: number, endH: number) => { const c = cairo(); return !["Fri", "Sat"].includes(c.weekday) && c.hour >= startH && c.hour < endH; };
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isAr = (t: string) => /[؀-ۿ]/.test(t || "");
// the customer's ways to reach us, as buttons under every Lara e-mail (owner, 11 Nov 2026): chat with Lara (web page), call, WhatsApp
export const CHAT_SITE = "https://sdm-sales-leads.github.io/chat.html";
export async function ensureChatKey(t: any): Promise<string> {
  if (t?.chat_key) return t.chat_key;
  const key = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
  await admin.from("lara_threads").update({ chat_key: key }).eq("id", t.id).is("chat_key", null);
  const { data } = await admin.from("lara_threads").select("chat_key").eq("id", t.id).maybeSingle();
  return data?.chat_key || key;
}
export interface Buttons { chat?: string; call?: string; whatsapp?: string }
export async function contactButtons(t: any): Promise<Buttons> {
  const cc = await getConfig<any>("lara_chat", {});
  const call = String(cc.callNumber || "").replace(/[^\d+]/g, "");
  const wa = await getConfig<any>("lara_wa", {});
  const waDigits = wa?.status?.ok ? String(wa.status.display || "").replace(/\D/g, "") : "";
  return { chat: `${CHAT_SITE}#k=${await ensureChatKey(t)}`, call: call.length >= 5 ? call : undefined, whatsapp: waDigits.length >= 10 ? `https://wa.me/${waDigits}` : undefined };
}
function btn(href: string, label: string, bg: string) {
  return `<td style="padding:4px"><a href="${escHtml(href)}" style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 16px;border-radius:10px">${escHtml(label)}</a></td>`;
}
function mailHtml(text: string, b: Buttons = {}) {
  const rtl = isAr(text);
  const foot = rtl ? "لو حضرتك مش حابب تستقبل رسائل تانية، رد بكلمة «إيقاف»." : "If you prefer not to receive further messages, reply STOP.";
  const cells = [
    b.chat ? btn(b.chat, rtl ? "💬 كلّم لارا الآن" : "💬 Chat with Lara now", "#B3263D") : "",
    b.call ? btn(`tel:${b.call}`, rtl ? "📞 اتصل بنا" : "📞 Call us", "#2D2926") : "",
    b.whatsapp ? btn(b.whatsapp, rtl ? "واتساب" : "WhatsApp", "#1FA855") : "",
  ].join("");
  return `<div dir="${rtl ? "rtl" : "ltr"}" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;font-size:14px;line-height:1.6;color:#2D2926">${escHtml(text).replace(/\n/g, "<br>")}`
    + (cells ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:16px"><tr>${cells}</tr></table>` : "")
    + `<p style="margin-top:18px;font-size:11px;color:#767676">${escHtml(foot)}</p></div>`;
}
const rand4 = () => Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");

export async function appendTimeline(leadId: string, ev: any) {
  const e = { id: crypto.randomUUID(), timestamp: nowIso(), user: "Lara", ...ev };
  await pg(async (q) => { await q`update crm_leads set data = jsonb_set(data, '{timeline}', coalesce(case when jsonb_typeof(data->'timeline') = 'array' then data->'timeline' end, '[]'::jsonb) || ${q.json([e])}) where id = ${leadId}`; },   // q.json: a real JSON array (a JSON string here was stored as one text item)
    async () => {
      const { data } = await admin.from("crm_leads").select("data").eq("id", leadId).maybeSingle();
      if (!data) return;
      const d = data.data || {}; d.timeline = [...(Array.isArray(d.timeline) ? d.timeline : []), e];
      await admin.from("crm_leads").update({ data: d }).eq("id", leadId);
    });
}
export async function ownerOf(leadId: string): Promise<{ id: string | null; name: string; email: string; status: string; customer: string }> {
  const { data } = await admin.from("crm_leads").select("assigned_to,status,data->assignedSalespersonName,data->customerName,data->email").eq("id", leadId).maybeSingle();
  return { id: data?.assigned_to || null, name: String((data as any)?.assignedSalespersonName || ""), email: String((data as any)?.email || ""), status: String(data?.status || ""), customer: String((data as any)?.customerName || leadId) };
}
export async function ensureThread(leadId: string, email: string) {
  const { data: t } = await admin.from("lara_threads").select("*").eq("lead_id", leadId).maybeSingle();
  if (t) { if (email && t.customer_email !== email.toLowerCase()) await admin.from("lara_threads").update({ customer_email: email.toLowerCase() }).eq("id", t.id); return t; }
  const code = `SDM-${leadId.toUpperCase()}-${rand4()}`;
  const ins = await admin.from("lara_threads").insert({ lead_id: leadId, code, customer_email: email.toLowerCase() }).select("*").single();
  if (ins.error) { const again = await admin.from("lara_threads").select("*").eq("lead_id", leadId).maybeSingle(); if (again.data) return again.data; throw new HttpError(500, "Could not open the conversation"); }
  return ins.data;
}
export async function isOptedOut(contacts: string[]): Promise<boolean> {
  const c = contacts.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
  if (!c.length) return false;
  const { data } = await admin.from("lara_optout").select("contact").in("contact", c).is("removed_at", null).limit(1);
  return !!data?.length;
}

// ---------------------------------------------------------------------------------------------
// sending (approved drafts only)
// ---------------------------------------------------------------------------------------------
export interface SendRules { sendEnabled: boolean; mode: string; maxSendPerDay: number; minDaysBetween: number; maxUnanswered: number; sendStart: number; sendEnd: number }

/** the approved Meta template linked to this kind of message (needed outside the 24-hour window) */
export async function templateFor(d: any) {
  const { data } = await admin.from("lara_wa_templates").select("name,lang,params,body").eq("status", "APPROVED").in("situation", [d.situation, "any"]).limit(20);
  const list = data || [];
  const want = d.lang === "en" ? /^en/ : /^ar/;
  return list.find((t: any) => want.test(t.lang)) || list[0] || null;
}
/** WhatsApp rules (Meta + owner): connected, quality not RED, test lock, stop list, 24-hour window or an approved template */
async function waBlocker(d: any, r: SendRules): Promise<string> {
  if (!(await waReady())) return "WhatsApp is not connected (Lara > Settings > WhatsApp)";
  const c = await waCfg();
  if (String(c.status?.quality || "").toUpperCase() === "RED") return "Meta rates the number RED: Lara pauses WhatsApp";
  const to = intl(d.to_phone);
  if (!to) return "The lead has no usable mobile number";
  if ((await getConfig<any>("lara_test_lock", true)) !== false && !c.testNumbers.includes(to)) return "Test lock: Lara may only message the test numbers until the owner lifts it";
  if (await isOptedOut([to, normPhone(to)])) return "The customer asked not to be contacted";
  const { data: t } = await admin.from("lara_threads").select("status,unanswered,last_out_at,wa_last_in,wa_consent").eq("lead_id", d.lead_id).maybeSingle();
  if (t && t.status !== "open" && d.kind === "followup") return `Conversation is ${t.status}`;
  if (t && d.kind === "followup" && t.unanswered >= r.maxUnanswered) return `${t.unanswered} messages without a reply: Lara stops`;
  if (t && d.kind === "followup" && t.last_out_at && Date.now() - Date.parse(t.last_out_at) < r.minDaysBetween * 864e5) return `Last message was less than ${r.minDaysBetween} days ago`;
  if (!inWindow(t)) {
    if (!c.consentFromEnquiry && !t?.wa_consent) return "No WhatsApp consent recorded for this customer";
    if (!(await templateFor(d))) return "Outside WhatsApp's 24-hour window and no approved Meta template is linked to this kind of message (Lara > Settings > WhatsApp)";
  }
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await admin.from("lara_messages").select("id", { count: "exact", head: true }).eq("direction", "out").gte("at", since);
  if ((count || 0) >= r.maxSendPerDay) return `Daily limit reached (${r.maxSendPerDay})`;
  return "";
}
/** sends one approved WhatsApp draft (free text inside the 24-hour window, else the linked template) */
async function sendWaDraft(d: any, by: string): Promise<{ sent: boolean; reason?: string }> {
  const to = intl(d.to_phone);
  const t = await ensureThread(d.lead_id, "");
  const { data: tt } = await admin.from("lara_threads").select("*").eq("id", t.id).single();
  let waId = "", used = "text";
  try {
    if (inWindow(tt)) waId = await waSend(to, { text: d.body });
    else {
      const tpl = await templateFor(d);
      const { data: lead } = await admin.from("crm_leads").select("data->customerName,data->project,data->assignedSalespersonName").eq("id", d.lead_id).maybeSingle();
      const vals = [String((lead as any)?.customerName || "").split(/[\/]/).pop()?.trim() || "", String((lead as any)?.project || ""), String((lead as any)?.assignedSalespersonName || "")];
      waId = await waSend(to, { template: { name: tpl!.name, lang: tpl!.lang, params: vals.slice(0, tpl!.params) } }); used = `template ${tpl!.name}`;
    }
  } catch (e: any) {
    await admin.from("lara_drafts").update({ send_status: "failed", send_error: String(e?.message || e).slice(0, 200), updated_at: nowIso() }).eq("id", d.id);
    await admin.from("lara_log").insert({ kind: "send", actor: by, text: `WhatsApp failed for ${d.customer}: ${String(e?.message || e).slice(0, 160)}` });
    return { sent: false, reason: String(e?.message || e) };
  }
  const now = nowIso();
  await admin.from("lara_messages").insert({ author: d.rule === "staff_reply" ? d.decided_by : "Lara", kind: d.rule === "staff_reply" ? "staff" : "mail", thread_id: t.id, lead_id: d.lead_id, direction: "out", channel: "whatsapp", wa_id: waId, wa_status: "sent", body: d.body, from_addr: "whatsapp", to_addr: to, draft_id: d.id, at: now });
  await admin.from("lara_threads").update({ wa_phone: to, wa_consent: tt?.wa_consent || "enquiry", out_count: (tt?.out_count || 0) + 1, unanswered: (tt?.unanswered || 0) + 1, last_out_at: now, updated_at: now }).eq("id", t.id);
  await admin.from("lara_drafts").update({ send_status: "sent", sent_at: now, send_error: null, thread_id: t.id, updated_at: now }).eq("id", d.id);
  await appendTimeline(d.lead_id, { type: "WhatsApp", title: d.kind === "reply" ? "Lara replied on WhatsApp" : "Lara sent a WhatsApp", description: `${used === "text" ? "" : `(${used}) `}${String(d.body).slice(0, 600)}` });
  await admin.from("lara_log").insert({ kind: "send", actor: by, text: `WhatsApp sent to ${d.customer} (${d.kind}, ${used}), approved by ${d.decided_by || by}` });
  return { sent: true };
}

/** why this approved draft cannot go out now ('' = it can) */
async function blocker(d: any, r: SendRules): Promise<string> {
  if (r.mode !== "approve" && r.mode !== "auto") return "Lara is not in Approve-first or Autopilot mode";
  if (!r.sendEnabled) return "Sending is switched off";
  if (d.channel === "whatsapp") return await waBlocker(d, r);
  if (!(await mailboxReady())) return "Lara's mailbox is not connected";
  // TEST LOCK (owner, 10 Nov 2026: "don't send to any real customer until I say so"): while on, Lara may e-mail ONLY staff
  // addresses (app_users). It is on unless the owner explicitly lifts it.
  if ((await getConfig<any>("lara_test_lock", true)) !== false) {
    const { data: staff } = await admin.from("app_users").select("id").ilike("email", String(d.to_addr || "").replace(/[%_\\]/g, "")).limit(1);
    if (!staff?.length) return "Test lock: Lara may only e-mail staff addresses until the owner lifts it";
  }
  if (!d.to_addr) return "The lead has no e-mail address";
  if (await isOptedOut([d.to_addr])) return "The customer asked not to be contacted";
  const { data: t } = await admin.from("lara_threads").select("status,unanswered,last_out_at").eq("lead_id", d.lead_id).maybeSingle();
  if (t && t.status !== "open" && d.kind === "followup") return `Conversation is ${t.status}`;
  if (t && d.kind === "followup" && t.unanswered >= r.maxUnanswered) return `${t.unanswered} mails without a reply: Lara stops`;
  if (t && d.kind === "followup" && t.last_out_at && Date.now() - Date.parse(t.last_out_at) < r.minDaysBetween * 864e5) return `Last mail was less than ${r.minDaysBetween} days ago`;
  if (d.kind === "offer") {
    // an offer must still be true when it leaves: every plot available today
    if (!d.offer?.plots?.length) return "The offer has no plots";
    if (!d.offer?.pdf) return "The Initial financial offer PDF is not built yet: press \"Build in Land Bank\"";
    const { data: snap } = await admin.from("plots_snapshot").select("data").eq("id", 1).maybeSingle();
    const st = new Map((Array.isArray(snap?.data) ? snap!.data : []).map((p: any) => [String(p.key), p.status]));
    const gone = d.offer.plots.filter((p: any) => st.get(String(p.key)) !== "available").map((p: any) => p.unit);
    if (gone.length) return `No longer available: ${gone.join(", ")}. Prepare a new offer.`;
  }
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await admin.from("lara_messages").select("id", { count: "exact", head: true }).eq("direction", "out").gte("at", since);
  if ((count || 0) >= r.maxSendPerDay) return `Daily limit reached (${r.maxSendPerDay})`;
  return "";
}

export async function sendDraft(draftId: string, r: SendRules, by: string): Promise<{ sent: boolean; reason?: string }> {
  const { data: d } = await admin.from("lara_drafts").select("*").eq("id", draftId).maybeSingle();
  if (!d || d.status !== "approved" || d.send_status === "sent") return { sent: false, reason: "Not an approved draft" };
  const why = await blocker(d, r);
  if (why) {
    const wait = /working hours|Daily limit|less than/.test(why);
    await admin.from("lara_drafts").update({ send_status: wait ? "queued" : "failed", send_error: why, updated_at: nowIso() }).eq("id", d.id);
    return { sent: false, reason: why };
  }
  if (!inSendHours(r.sendStart, r.sendEnd)) {
    await admin.from("lara_drafts").update({ send_status: "queued", send_error: `Waits for working hours (${r.sendStart}:00–${r.sendEnd}:00, Sun–Thu)`, updated_at: nowIso() }).eq("id", d.id);
    return { sent: false, reason: "Queued until working hours" };
  }
  if (d.channel === "whatsapp") return await sendWaDraft(d, by);
  const t = await ensureThread(d.lead_id, d.to_addr);
  const base = String(d.subject || "Elsewedy Industrial Development").replace(LARA_CODE_RE, "").trim();
  const subject = `${base} [${t.code}]`;
  const mbox = await laraMailCfg();
  try {
    if (d.kind === "offer") {
      const f = await offerFile(d.id);
      await sendMailWithAttachment(await ewsCfg(), { to: [d.to_addr], subject, html: mailHtml(d.body, await contactButtons(t)), replyTo: mbox.address }, { name: f.file_name, contentType: "application/pdf", base64: f.pdf_b64 });
    } else await sendMail(await ewsCfg(), { to: [d.to_addr], subject, html: mailHtml(d.body, await contactButtons(t)), replyTo: mbox.address });
  } catch (e: any) {
    await admin.from("lara_drafts").update({ send_status: "failed", send_error: String(e?.message || e).slice(0, 200), updated_at: nowIso() }).eq("id", d.id);
    await admin.from("lara_log").insert({ kind: "send", actor: by, text: `Send failed for ${d.customer}: ${String(e?.message || e).slice(0, 160)}` });
    return { sent: false, reason: String(e?.message || e) };
  }
  const now = nowIso();
  await admin.from("lara_messages").insert({ author: d.rule === "staff_reply" ? d.decided_by : "Lara", kind: d.rule === "staff_reply" ? "staff" : "mail", thread_id: t.id, lead_id: d.lead_id, direction: "out", subject, body: d.body, from_addr: mbox.address, to_addr: d.to_addr, draft_id: d.id, at: now });
  await admin.from("lara_threads").update({ out_count: (t.out_count || 0) + 1, unanswered: (t.unanswered || 0) + 1, last_out_at: now, updated_at: now }).eq("id", t.id);
  await admin.from("lara_drafts").update({ send_status: "sent", sent_at: now, send_error: null, thread_id: t.id, updated_at: now }).eq("id", d.id);
  await appendTimeline(d.lead_id, { type: d.kind === "offer" ? "Offer" : "Email", title: d.kind === "offer" ? `Lara sent an initial offer (PDF ${d.offer.ref})` : d.rule === "staff_reply" ? `${d.decided_by} replied by e-mail (Interactions)` : d.rule === "started_by_staff" ? `Lara wrote to the customer (handed over by ${d.decided_by})` : d.kind === "reply" ? "Lara replied by e-mail" : "Lara sent a follow-up e-mail", description: `${subject}\n\n${String(d.body).slice(0, 600)}` });
  if (d.kind === "offer") {
    const { data: lead } = await admin.from("crm_leads").select("data").eq("id", d.lead_id).maybeSingle();
    await recordOfferPrint(d.offer, lead?.data || {}, d.decided_by || by).catch(() => {});
    await remember(t.id, t.memory || {}, { offer: { ref: d.offer?.ref, at: now } });   // "your initial offer was sent N days ago" when the customer comes back
  }
  await admin.from("lara_log").insert({ kind: "send", actor: by, text: `E-mail sent to ${d.customer} (${d.kind}), approved by ${d.decided_by || by}` });
  return { sent: true };
}

/** the Initial financial offer file the Land Bank built for a draft */
async function offerFile(draftId: string) {
  const { data } = await admin.from("lara_offer_files").select("file_name,pdf_b64").eq("draft_id", draftId).maybeSingle();
  if (!data) throw new HttpError(409, "The Initial financial offer PDF is not built yet: press \"Build in Land Bank\"");
  return data;
}

/** a TEST copy of an offer to the admin who asks (their own sign-in address): same mail and PDF, nothing recorded, nobody else gets it */
export async function sendOfferTestCopy(d: any, to: string) {
  if (!(await mailboxReady())) throw new HttpError(400, "Lara's mailbox is not connected");
  const mbox = await laraMailCfg();
  await sendMailWithAttachment(await ewsCfg(), { to: [to], subject: `[TEST] ${String(d.subject || "").replace(LARA_CODE_RE, "").trim()}`, html: mailHtml(`TEST COPY — this is what the customer (${d.to_addr || "no address"}) would receive.\n\n${d.body}`), replyTo: mbox.address },
    await (async () => { const f = await offerFile(d.id); return { name: f.file_name, contentType: "application/pdf", base64: f.pdf_b64 }; })());
}

/** cron: queued drafts go out in working hours, oldest first, within the daily limit */
export async function sendQueued(r: SendRules) {
  if ((r.mode !== "approve" && r.mode !== "auto") || !r.sendEnabled || !inSendHours(r.sendStart, r.sendEnd)) return { queuedSkipped: true };
  const { data } = await admin.from("lara_drafts").select("id").eq("status", "approved").eq("send_status", "queued").order("decided_at").limit(10);
  let sent = 0;
  for (const d of data || []) { const x = await sendDraft(d.id, r, "Scheduled send"); if (x.sent) sent++; else if (/Daily limit/.test(x.reason || "")) break; }
  return { queuedSent: sent };
}

// ---------------------------------------------------------------------------------------------
// reading replies
// ---------------------------------------------------------------------------------------------
export const AUTO_RE = /(auto(matic)?[\s-]?reply|out of (the )?office|undeliverable|delivery (status|has failed)|mail delivery|returned mail|رد تلقائي|خارج المكتب|غير متواجد|لم يتم التسليم)/i;
export const AUTO_SENDER = /(mailer-daemon|postmaster|no-?reply|noreply|do-not-reply|bounce)/i;
export const STOP_RE = /(^|\s)(stop|unsubscribe|remove me|not interested)(\s|$|[.!])|ايقاف|إيقاف|الغاء الاشتراك|إلغاء الاشتراك|متبعتليش|ما تبعتليش|مش مهتم|غير مهتم|لا شكرا|لا شكراً/i;
export const HANDOVER_RE = /(call me|phone me|give me a call|meeting|site visit|visit the site|اتصل|اتصلوا|كلمني|كلموني|كلمنى|رقمي|موبايلي|تليفوني|اجتماع|ميعاد|معاينه|معاينة|زياره|زيارة)/i;

/** the customer's own new text (quoted history and signatures cut off) */
export function newPart(text: string): string {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    const t = l.trim();
    if (/^>/.test(t)) break;
    if (/^(on .{4,120} wrote:|from:\s|-----\s*original message|sent from my|في .{2,80} كتب|من:\s|________________)/i.test(t)) break;
    // phone signatures ("Get Outlook for iOS" may be split over two lines)
    if (/^(get )?outlook for (ios|android)|^sent from (my )?(iphone|ipad|android|samsung|mobile|outlook)|^تم الإرسال من|^مرسل من|^أرسلت من/i.test(t)) break;
    out.push(l);
  }
  while (out.length && /^\s*(get|--)?\s*$/i.test(out[out.length - 1])) out.pop();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000);
}

export interface ReplyHooks { answer: (q: string, leadId: string) => Promise<{ answered: boolean; source?: "landbank" | "qa" | "ai"; text?: { ar: string; en: string } }>; writeReply: (leadId: string, ar: boolean, answerText: string | null, welcome?: string | null) => Promise<{ subject: string; body: string }>; autoApprove?: () => Promise<boolean> }

export async function pollLaraInbox(hooks: ReplyHooks) {
  if (!(await mailboxReady())) return { pollSkipped: "mailbox not connected" };
  if (!(await tryLock("lara-mail", 240))) return { pollSkipped: "busy" };
  try {
    const cfg = await ewsCfg();
    const cur = await getConfig<any>("lara_mail_cursor", {});
    const since = cur.at ? new Date(Date.parse(cur.at) - 30 * 60_000).toISOString().replace(/\.\d+Z$/, "Z") : new Date(Date.now() - 2 * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
    const heads = await listFolder(cfg, "inbox", 50, since);
    if (!heads.length) return { polled: 0 };
    const { data: seen } = await admin.from("lara_messages").select("ews_id").in("ews_id", heads.map((h) => h.id));
    const known = new Set((seen || []).map((r: any) => r.ews_id));
    const mbox = await laraMailCfg();
    let fresh = heads.filter((h) => !known.has(h.id));
    if (mbox.shared) {
      // the leads mailbox is shared with mail intake: Lara takes ONLY replies to her conversations (code in the subject, or a customer
      // she is talking to); every other mail stays with the intake, is not stored here and its body is not even downloaded
      const { data: th } = await admin.from("lara_threads").select("customer_email").limit(20000);
      const mine = new Set((th || []).map((t: any) => String(t.customer_email || "").toLowerCase()).filter(Boolean));
      fresh = fresh.filter((h) => LARA_CODE_RE.test(h.subject) || mine.has(String(h.senderAddress || "").toLowerCase()));
      if (!fresh.length) { const nw = heads.reduce((m, h) => Math.max(m, Date.parse(h.receivedTime) || 0), 0); if (nw) await setConfig("lara_mail_cursor", { at: new Date(nw).toISOString() }); return { polled: 0 }; }
    }
    const bodies = await getBodies(cfg, fresh.map((h) => h.id));
    let replies = 0, auto = 0, unmatched = 0;
    for (const h of fresh.reverse()) {
      const full = htmlToText(bodies.get(h.id)?.html || "") || h.bodyPreview || "";
      const text = newPart(full);
      const from = String(h.senderAddress || "").toLowerCase();
      if (from && from === mbox.address.toLowerCase()) continue;
      const base = { ews_id: h.id, direction: "in", subject: str(h.subject, 300), body: text || str(full, 2000), from_addr: from, to_addr: mbox.address, at: h.receivedTime || nowIso() };
      if (AUTO_RE.test(h.subject) || AUTO_SENDER.test(from)) { await admin.from("lara_messages").insert({ ...base, kind: "auto" }); auto++; continue; }
      // match: code in the subject, else the sender's address
      let thread: any = null; let by = "";
      const code = h.subject.match(LARA_CODE_RE)?.[1]?.toUpperCase();
      if (code) { thread = (await admin.from("lara_threads").select("*").eq("code", code).maybeSingle()).data; by = "code"; }
      if (!thread && from) { thread = (await admin.from("lara_threads").select("*").eq("customer_email", from).order("updated_at", { ascending: false }).limit(1).maybeSingle()).data; by = "sender"; }
      if (!thread) { await admin.from("lara_messages").insert({ ...base, kind: "unmatched" }); unmatched++; continue; }
      replies++;
      await handleReply(thread, base, by, text, hooks);
    }
    const newest = heads.reduce((m, h) => Math.max(m, Date.parse(h.receivedTime) || 0), 0);
    if (newest) await setConfig("lara_mail_cursor", { at: new Date(newest).toISOString() });
    if (replies || unmatched) await admin.from("lara_log").insert({ kind: "mail", actor: "Mailbox", text: `Mailbox read: ${replies} customer replies, ${unmatched} from unknown senders, ${auto} automatic mails ignored` });
    return { polled: fresh.length, replies, auto, unmatched };
  } finally { await unlock("lara-mail"); }
}

export async function handleReply(thread: any, base: any, matchedBy: string, text: string, hooks: ReplyHooks) {
  const now = nowIso();
  const msg = await admin.from("lara_messages").insert({ ...base, thread_id: thread.id, lead_id: thread.lead_id, kind: "mail", matched_by: matchedBy }).select("id").single();
  const o = await ownerOf(thread.lead_id);
  await admin.from("lara_threads").update({ unanswered: 0, last_in_at: now, updated_at: now }).eq("id", thread.id);
  const ch = base.channel === "whatsapp" ? "whatsapp" : "email";
  // WhatsApp: the customer wrote, so the 24-hour window is open and consent is clear
  if (ch === "whatsapp") await admin.from("lara_threads").update({ wa_phone: base.from_addr, wa_last_in: base.at || now, wa_consent: "replied" }).eq("id", thread.id);
  await appendTimeline(thread.lead_id, { type: ch === "whatsapp" ? "WhatsApp" : "Email", title: `Customer replied to Lara (${ch === "whatsapp" ? "WhatsApp" : "e-mail"})`, description: text.slice(0, 600) });
  // pending follow-ups of this lead are no longer right: the customer spoke
  await admin.from("lara_drafts").update({ status: "expired", feedback: "Customer replied", updated_at: now }).eq("lead_id", thread.lead_id).eq("status", "shadow").eq("kind", "followup");
  // the owner is told; a lead without an owner goes to the admins and Sales Operation (a reply must never reach nobody)
  let to: string[] = o.id ? [o.id] : [];
  if (!to.length) { const { data: m } = await admin.from("app_users").select("id").in("role", ["Admin", "Sales Operation"]).neq("active", false).limit(20); to = (m || []).map((r: any) => r.id); }
  const notify = async (title: string, body: string, type = "changed") => { if (to.length) await addNotifications(to.map((userId) => ({ userId, type, leadId: thread.lead_id, title: o.id ? title : `${title} (no owner)`, body }))).catch(() => {}); };

  if (STOP_RE.test(text) && text.length < 250) {   // a short "stop / not interested"; a long mail that only mentions the word is read normally
    await admin.from("lara_optout").upsert({ contact: String(base.from_addr || thread.customer_email).toLowerCase(), reason: text.slice(0, 200), removed_at: null, removed_by: null, lead_id: thread.lead_id, by_who: "Customer reply" });
    await admin.from("lara_threads").update({ status: "stopped", note: "Customer asked to stop", updated_at: now }).eq("id", thread.id);
    await notify(`${o.customer} asked Lara to stop`, `Lara will not write again. Their words: "${text.slice(0, 200)}"`);
    await admin.from("lara_log").insert({ kind: "mail", actor: "Lara", text: `${o.customer} asked to stop: conversation stopped, address on the do-not-contact list` });
    return;
  }
  if (HANDOVER_RE.test(text)) {
    await admin.from("lara_threads").update({ status: "handover", note: "Customer asked for a call / meeting / visit", updated_at: now }).eq("id", thread.id);
    thread = { ...thread, status: "handover", memory: { ...(thread.memory || {}), handover: now } };
    await notify(`${o.customer} wants to talk — call them now`, `Lara handed this lead to you. Their words: "${text.slice(0, 300)}"`, "escalation");
  } else {
    await notify(`${o.customer} replied to Lara`, text.slice(0, 300));
  }
  // a reply draft (approve first): the approved answer when there is one, else a polite holding reply + Missed question
  const ans = await hooks.answer(text, thread.lead_id);
  const ar = isAr(text) || !/[a-z]{3,}/i.test(text);
  const answerText = ans.answered && ans.text ? (ar ? ans.text.ar || ans.text.en : ans.text.en || ans.text.ar) : null;
  if (!ans.answered) await notify(`${o.customer} asked something Lara cannot answer`, `Answer it in Lara > Missed questions, or reply yourself: "${text.slice(0, 200)}"`);
  // memory of THIS conversation (rules): a customer back after a week is welcomed with the last step of their own conversation
  const back = welcomeBack(thread, ar, { customer: firstNameOf(o.customer), owner: firstNameOf(o.name) }, 24 * 7, false);
  await remember(thread.id, learn(thread.memory || {}, text, ch), { answer: ans.source || "holding", ...(thread.memory?.handover ? { handover: thread.memory.handover } : {}) });
  const w = await hooks.writeReply(thread.lead_id, ar, answerText, back);
  await admin.from("lara_drafts").insert({
    lead_id: thread.lead_id, rule: "customer_reply", kind: "reply", situation: answerText ? "reply_answer" : "reply_holding", channel: ch, lang: ar ? "ar" : "en", to_phone: ch === "whatsapp" ? base.from_addr : null,
    subject: ch === "email" ? `Re: ${String(base.subject || "").replace(LARA_CODE_RE, "").replace(/^(re:\s*)+/i, "").trim()}` : "", body: w.body, to_addr: ch === "email" ? base.from_addr || thread.customer_email : null,
    reason: answerText ? (ans.source === "landbank" ? "Customer replied; answered from the Land Bank plot list" : ans.source === "ai" ? "Customer replied; AI answer built only from the approved answers (check it before approving)" : "Customer replied; answer found in the approved Q&A") : "Customer replied; no approved answer (question sent to Missed questions)",
    customer: str(o.customer, 120), owner_id: o.id, owner_name: str(o.name, 80), thread_id: thread.id, reply_to: msg.data?.id || null,
    // Autopilot (phase 7): replies go out without a person when the owner switched Lara to Autopilot with auto-replies on
    ...(ans.source !== "ai" && (await hooks.autoApprove?.().catch(() => false)) ? { status: "approved", decided_by: "Autopilot", decided_at: now, send_status: "queued" } : {}),
  });
}
