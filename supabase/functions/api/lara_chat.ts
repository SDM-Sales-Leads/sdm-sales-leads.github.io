// deno-lint-ignore-file no-explicit-any
// Lara omnichannel (11 Nov 2026): the Interactions inbox (e-mail + WhatsApp + web chat in one place) and the customer's web chat with Lara.
// Answer order, cheapest first: rules (stop / hello / thanks / call me) -> Land Bank data -> approved Q&A -> AI (only when the owner switched it
// on, under a daily cap) -> a polite holding reply that hands the question to the salesperson. Lists are paged on the server; the inbox reads
// one summary row per conversation (kept by a database trigger), never the messages.
import { admin, bad, body, Caller, getConfig, HttpError, needAdmin, normPhone, nowIso, rateLimit, setConfig, str } from "./lib.ts";
import { route } from "./router.ts";
import { pg } from "./db.ts";
import { firstNameOf } from "../../../src/lib/personName.ts";
import { activeKb, availabilityAnswer, laraAnswer, laraConfig, laraWho, log, ownsLead, who } from "./routes_lara.ts";
import { appendTimeline, contactButtons, ensureChatKey, HANDOVER_RE, isOptedOut, ownerOf, sendDraft, STOP_RE } from "./lara_mail.ts";
import { addNotifications } from "./notify.ts";
import { aiAnswer, aiCfg, saveAi } from "./lara_ai.ts";
import { intl, waCfg } from "./lara_wa.ts";
import { canonicalParks } from "../../../src/lib/parkAliases.ts";
import { PARK_AR } from "../../../src/components/crm/smartWriter.ts";

const isAr = (t: string) => /[؀-ۿ]/.test(t || "");
const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "").split(",")[0].trim().slice(0, 60) || "unknown";
const GREET_RE = /^\s*(hi|hello|hey|good (morning|evening|afternoon)|السلام عليكم|سلام|اهلا|أهلا|مرحبا|هاي|صباح الخير|مساء الخير|ازيك|إزيك)[\s!.,؟?]*$/i;
const THANKS_RE = /^\s*(thanks?|thank you|thx|ok(ay)?|شكرا|شكراً|متشكر|تمام|ماشي|اوك)[\s!.,؟?]*$/i;
const PLOTS_RE = /^\s*(available plots|الأراضي المتاحة|الاراضي المتاحة)\s*$/i;

export interface ChatCfg { enabled: boolean; callNumber: string; welcomeAr: string; welcomeEn: string }
export async function chatCfg(): Promise<ChatCfg> {
  const c = await getConfig<any>("lara_chat", {});
  return { enabled: c.enabled === true, callNumber: String(c.callNumber || ""), welcomeAr: String(c.welcomeAr || ""), welcomeEn: String(c.welcomeEn || "") };
}

/** while the owner keeps Lara on hold, chat answers only staff (test) conversations */
async function chatOpen(t: any): Promise<boolean> {
  const cc = await chatCfg();
  if (cc.enabled && (await getConfig<any>("lara_test_lock", true)) === false) return true;
  if (t.customer_email) { const { data } = await admin.from("app_users").select("id").ilike("email", String(t.customer_email).replace(/[%_\\]/g, "")).limit(1); if (data?.length) return true; }
  if (t.wa_phone) { const w = await waCfg(); if (w.testNumbers.includes(t.wa_phone)) return true; }
  return false;
}

async function leadInfo(leadId: string) {
  const { data } = await admin.from("crm_leads").select("id,status,assigned_to,phone_norm,data->customerName,data->assignedSalespersonName,data->project,data->email,data->phoneNumber,data->requiredSize,data->budget,data->source,data->lastContactDate,data->nextFollowUpDate,data->channel").eq("id", leadId).maybeSingle();
  return data as any;
}
async function staffTo(ownerId: string | null): Promise<string[]> {
  if (ownerId) return [ownerId];
  const { data } = await admin.from("app_users").select("id").in("role", ["Admin", "Sales Operation"]).neq("active", false).limit(20);
  return (data || []).map((r: any) => r.id);
}

/** a live overview of the parks for "which plots do you have?" (Land Bank list, no AI) */
async function parksOverview(ar: boolean): Promise<string | null> {
  const { data } = await admin.from("plots_snapshot").select("data").eq("id", 1).maybeSingle();
  const all: any[] = Array.isArray(data?.data) ? data!.data : [];
  const by = new Map<string, number[]>();
  for (const p of all) if (p.status === "available" && Number(p.areaSqm) > 0) { const l = by.get(p.park) || []; l.push(Number(p.areaSqm)); by.set(p.park, l); }
  if (!by.size) return null;
  const f = (n: number) => Math.round(n).toLocaleString("en-US");
  const lines = [...by.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([park, a]) => {
    a.sort((x, y) => x - y);
    return ar ? `• ${PARK_AR[park] || park}: ${a.length} قطعة (${f(a[0])} – ${f(a[a.length - 1])} م²)` : `• ${park}: ${a.length} plots (${f(a[0])} – ${f(a[a.length - 1])} sqm)`;
  });
  return (ar ? "المتاح حالياً حسب آخر تحديث لبنك الأراضي:\n" : "Available now (latest Land Bank list):\n") + lines.join("\n") + (ar ? "\nأي منطقة ومساحة تناسبك؟" : "\nWhich park and size suit you?");
}

const SUGGEST = { ar: ["الأراضي المتاحة", "طرق السداد", "عايز حد يكلمني"], en: ["Available plots", "Payment plans", "Please call me"] };

/** one customer message in the web chat -> Lara's instant answer. Returns the new messages. */
export async function chatTurn(t: any, text: string): Promise<{ messages: any[]; suggest: string[] }> {
  const now = nowIso();
  const ar = isAr(text) || !/[a-z]{3,}/i.test(text);
  const lead = t.visitor ? null : await leadInfo(t.lead_id);
  const o = t.visitor ? { id: null, name: "", customer: String(t.visitor?.name || "Website visitor") } : await ownerOf(t.lead_id);
  const ins = await admin.from("lara_messages").insert({ thread_id: t.id, lead_id: t.lead_id, direction: "in", kind: "chat", channel: "web", matched_by: "chat", body: text, from_addr: "web chat", to_addr: "Lara", at: now }).select("id,direction,kind,channel,author,body,at").single();
  // the timeline gets one line per chat session (not one per message)
  const fresh = !t.last_in_at || Date.now() - Date.parse(t.last_in_at) > 6 * 3600e3;
  await admin.from("lara_threads").update({ last_in_at: now, unanswered: 0, updated_at: now }).eq("id", t.id);
  if (fresh && lead) await appendTimeline(t.lead_id, { type: "Comment", title: "Customer chatted with Lara (web chat)", description: text.slice(0, 400) }).catch(() => {});
  const to = await staffTo(o.id);
  const notify = async (title: string, b: string, type = "changed") => { if (to.length) await addNotifications(to.map((userId) => ({ userId, type, leadId: t.visitor ? undefined : t.lead_id, title, body: b }))).catch(() => {}); };
  if (fresh) await notify(`${o.customer} is chatting with Lara`, text.slice(0, 200));

  const ownerFirst = firstNameOf(o.name || "");
  let reply = ""; let by = "rule"; let suggest: string[] = [];
  // a salesperson answered in this chat within the last 2 hours: Lara keeps quiet and lets the person talk
  const { data: lastStaff } = await admin.from("lara_messages").select("at").eq("thread_id", t.id).eq("kind", "staff").order("at", { ascending: false }).limit(1).maybeSingle();
  if (lastStaff && Date.now() - Date.parse(lastStaff.at) < 2 * 3600e3) {
    await notify(`${o.customer} wrote in the chat`, text.slice(0, 300), "escalation");
    return { messages: [ins.data], suggest: [] };
  }
  if (STOP_RE.test(text) && text.length < 250) {
    const contact = String(t.customer_email || t.wa_phone || "").toLowerCase();
    if (contact) await admin.from("lara_optout").upsert({ contact, reason: text.slice(0, 200), lead_id: t.lead_id, by_who: "Web chat" });
    await admin.from("lara_threads").update({ status: "stopped", note: "Customer asked to stop (chat)", updated_at: now }).eq("id", t.id);
    reply = ar ? "تمام، مش هنبعت لحضرتك رسائل تانية. لو احتجت أي حاجة إحنا موجودين." : "Understood — we will not message you again. We are here if you need anything.";
  } else if (GREET_RE.test(text)) {
    const first = firstNameOf(String(lead?.customerName || t.visitor?.name || ""));
    reply = ar ? `أهلاً ${first ? `أ. ${first}` : "بحضرتك"}، أنا لارا المساعدة الرقمية لمبيعات السويدي للتنمية الصناعية. أقدر أساعد حضرتك في الأراضي المتاحة وطرق السداد، أو أخلي مسؤول المبيعات يكلمك.` : `Hello${first ? ` ${first}` : ""}, I'm Lara, the digital sales assistant of Elsewedy Industrial Development. I can help with available plots and payment plans, or ask your account manager to call you.`;
    suggest = SUGGEST[ar ? "ar" : "en"];
  } else if (THANKS_RE.test(text)) {
    reply = ar ? "العفو! لو عندك أي سؤال تاني أنا موجودة." : "You're welcome! I'm here if you have any other question.";
  } else if (HANDOVER_RE.test(text) || /please call me|عايز حد يكلمني/i.test(text)) {
    await admin.from("lara_threads").update({ status: "handover", note: "Customer asked for a call (chat)", updated_at: now }).eq("id", t.id);
    await notify(`${o.customer} wants a call — from the chat`, `Their words: "${text.slice(0, 300)}"`, "escalation");
    reply = ar ? `تمام، بلّغت ${ownerFirst ? `أ. ${ownerFirst}` : "مسؤول المبيعات"} وهيتواصل مع حضرتك في أقرب وقت خلال مواعيد العمل (الأحد–الخميس). ممكن تكتب هنا أنسب وقت للمكالمة.` : `Done — I've told ${ownerFirst || "your account manager"}, who will call you as soon as possible in working hours (Sun–Thu). You can write here the best time to call.`;
  } else {
    // Land Bank data first (a park in the question, or the lead's own park), then the approved Q&A
    let q = text;
    if (!canonicalParks(text).length && lead?.project && /ارض|اراضي|أرض|أراضي|قطع|متاح|مساح|land|plot|available|size/i.test(text)) q = `${text} ${canonicalParks(lead.project)[0] || ""}`;
    const overview = PLOTS_RE.test(text) && !canonicalParks(text).length ? await parksOverview(ar) : null;
    if (overview) { reply = overview; by = "landbank"; }
    else {
      const data = await availabilityAnswer(q).catch(() => null);
      if (data) { reply = ar ? data.ar : data.en; by = "landbank"; }
      else {
        if (text.length >= 3) {
          const r = await laraAnswer(text, { record: true, source: "customer", leadId: t.visitor ? undefined : t.lead_id, by: "Web chat" });
          const best = r.matches[0];
          if (r.answered && best) { reply = (ar ? best.a_ar || best.a_en : best.a_en || best.a_ar) || ""; by = "qa"; }
        }
        if (!reply) {
          const ai = await aiAnswer(text, await activeKb(), [], { lang: ar ? "ar" : "en" });
          if (ai) { reply = ai; by = "ai"; }
        }
        if (!reply) {
          await notify(`${o.customer} asked Lara something she cannot answer (chat)`, `Answer in the Interactions inbox, or add it in Lara > Missed questions: "${text.slice(0, 200)}"`, "escalation");
          reply = ar ? `سؤال مهم، وعشان أديك إجابة دقيقة بلّغت ${ownerFirst ? `أ. ${ownerFirst}` : "مسؤول المبيعات"} وهيرد على حضرتك هنا أو بمكالمة.` : `Good question — to give you an exact answer I've passed it to ${ownerFirst || "your account manager"}, who will reply here or call you.`;
          by = "holding";
        }
      }
    }
    if (by !== "holding") reply += ar ? "\n\nفي حاجة تانية أقدر أساعد فيها؟" : "\n\nAnything else I can help with?";
    suggest = SUGGEST[ar ? "ar" : "en"];
  }
  const out = await admin.from("lara_messages").insert({ thread_id: t.id, lead_id: t.lead_id, direction: "out", kind: "chat", channel: "web", author: "Lara", matched_by: by, body: reply, from_addr: "Lara", to_addr: "web chat", at: new Date(Date.now() + 5).toISOString() }).select("id,direction,kind,channel,author,body,at").single();
  return { messages: [ins.data, out.data].filter(Boolean), suggest };
}

const pub = (m: any) => ({ id: m.id, dir: m.direction, who: m.direction === "in" ? "you" : m.kind === "staff" ? (firstNameOf(m.author || "") || "Sales") : "Lara", channel: m.channel || "email", body: String(m.body || "").slice(0, 3000), at: m.at });
async function threadByKey(key: string) {
  if (!/^[a-z0-9]{20,40}$/.test(key)) throw new HttpError(404, "This chat link is not valid");
  const { data } = await admin.from("lara_threads").select("*").eq("chat_key", key).maybeSingle();
  if (!data) throw new HttpError(404, "This chat link is not valid");
  return data;
}

// ---------------------------------------------------------------------------------------------
// public: the customer's chat page (chat.html#k=...)
// ---------------------------------------------------------------------------------------------
route("GET", "/chat/s/:key", async ({ req, params }) => {
  await rateLimit(`chatget:${ipOf(req)}`, 3600, 600);
  const t = await threadByKey(params.key);
  const open = await chatOpen(t);
  const cfg = await laraConfig(); const cc = await chatCfg();
  const lead = t.visitor ? null : await leadInfo(t.lead_id);
  const o = t.visitor ? null : await ownerOf(t.lead_id);
  const btn = await contactButtons(t);
  const { data: msgs } = await admin.from("lara_messages").select("id,direction,kind,channel,author,body,at").eq("thread_id", t.id).in("kind", ["mail", "chat", "staff"]).order("at", { ascending: false }).limit(40);
  return {
    success: true, open, status: t.status, lara: { ar: cfg.nameAr, en: cfg.nameEn },
    customer: firstNameOf(String(lead?.customerName || t.visitor?.name || "")), owner: firstNameOf(o?.name || ""),
    call: btn.call || null, whatsapp: btn.whatsapp || null, welcome: { ar: cc.welcomeAr, en: cc.welcomeEn },
    messages: (msgs || []).reverse().map(pub), suggest: SUGGEST,
  };
}, { public: true });

route("GET", "/chat/s/:key/after", async ({ req, params, query }) => {
  await rateLimit(`chatpoll:${ipOf(req)}`, 3600, 1500);
  const t = await threadByKey(params.key);
  const after = query.get("t") || "";
  if (!/^\d{4}-\d{2}-\d{2}T/.test(after)) throw bad("t?");
  const { data } = await admin.from("lara_messages").select("id,direction,kind,channel,author,body,at").eq("thread_id", t.id).in("kind", ["mail", "chat", "staff"]).gt("at", after).order("at").limit(20);
  return { success: true, messages: (data || []).map(pub), status: t.status };
}, { public: true });

route("POST", "/chat/s/:key", async ({ req, params }) => {
  const ip = ipOf(req);
  await rateLimit(`chatsend:${ip}`, 3600, 120);
  await rateLimit(`chatkey:${params.key}`, 3600, 60);
  const t = await threadByKey(params.key);
  if (!(await chatOpen(t))) throw new HttpError(403, "Chat is not open yet");
  if (t.status === "stopped" || (t.customer_email && (await isOptedOut([t.customer_email])))) throw new HttpError(403, "This conversation was stopped at your request");
  const b = await body(req, 4000);
  const text = str(b.text, 1500).trim();
  if (!text) throw bad("Write a message");
  const r = await chatTurn(t, text);
  return { success: true, messages: r.messages.map(pub), suggest: r.suggest };
}, { public: true });

/** website visitor (no link): name + phone first; joins the lead's conversation when the phone or e-mail is known */
route("POST", "/chat/start", async ({ req }) => {
  const ip = ipOf(req);
  await rateLimit(`chatstart:${ip}`, 3600, 5);
  const cc = await chatCfg();
  if (!cc.enabled || (await getConfig<any>("lara_test_lock", true)) !== false) throw new HttpError(403, "Chat is not open yet");
  const b = await body(req, 4000);
  const name = str(b.name, 80).trim(); const phone = intl(b.phone); const email = str(b.email, 120).trim().toLowerCase();
  const text = str(b.text, 1500).trim();
  if (name.length < 2 || !phone) throw bad("Write your name and mobile number");
  if (!text) throw bad("Write your question");
  const local = normPhone(phone);
  let { data: lead } = await admin.from("crm_leads").select("id").eq("phone_norm", local).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!lead && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ({ data: lead } = await admin.from("crm_leads").select("id").ilike("data->>email", email).is("deleted_at", null).limit(1).maybeSingle());
  let t: any = null;
  if (lead) {
    t = (await admin.from("lara_threads").select("*").eq("lead_id", lead.id).maybeSingle()).data;
    if (!t) t = (await admin.from("lara_threads").insert({ lead_id: lead.id, code: `SDM-${String(lead.id).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`, customer_email: email, wa_phone: phone }).select("*").single()).data;
  } else {
    const vid = `VISIT-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    t = (await admin.from("lara_threads").insert({ lead_id: vid, code: `SDM-${vid}`, customer_email: email, wa_phone: phone, visitor: { name, phone, email, page: str(b.page, 200), at: nowIso() } }).select("*").single()).data;
    const to = await staffTo(null);
    if (to.length) await addNotifications(to.map((userId) => ({ userId, type: "escalation", leadId: undefined, title: `New website chat: ${name}`, body: `${phone}${email ? ` · ${email}` : ""} — "${text.slice(0, 160)}". Not a lead yet: add it from the Interactions inbox.` }))).catch(() => {});
  }
  if (!t) throw new HttpError(500, "Could not start the chat");
  const key = await ensureChatKey(t);
  const r = await chatTurn({ ...t, chat_key: key }, text);
  return { success: true, key, messages: r.messages.map(pub), suggest: r.suggest };
}, { public: true });

// ---------------------------------------------------------------------------------------------
// staff: the Interactions inbox (paged on the server; one summary row per conversation)
// ---------------------------------------------------------------------------------------------
const SIZES = [10, 25, 50, 100];
route("GET", "/lara/inbox", async ({ c, query }) => {
  const w = laraWho(c);
  const size = SIZES.includes(Number(query.get("size"))) ? Number(query.get("size")) : 25;
  const page = Math.max(1, Math.min(10000, Number(query.get("page")) || 1));
  const qs = str(query.get("q") || "", 80).trim();
  const ch = ["email", "whatsapp", "web"].includes(query.get("channel") || "") ? query.get("channel")! : "";
  const st = ["open", "handover", "stopped", "closed"].includes(query.get("status") || "") ? query.get("status")! : "";
  const view = ["unread", "waiting", "mine", "visitors"].includes(query.get("view") || "") ? query.get("view")! : "";
  const owner = /^[0-9a-f-]{36}$/i.test(query.get("owner") || "") ? query.get("owner")! : "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.get("from") || "") ? query.get("from")! : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.get("to") || "") ? query.get("to")! : "";
  return await pg(async (q) => {
    const scope = w.admin ? q`true` : q`l.assigned_to = ${c.id}`;
    const like = `%${qs.replace(/[%_\\]/g, "")}%`; const digits = qs.replace(/\D/g, "");
    const where = q`${scope}
      ${ch ? q`and ${ch} = any(t.channels)` : q``}
      ${st ? q`and t.status = ${st}` : q``}
      ${view === "unread" ? q`and t.unread > 0` : view === "waiting" ? q`and t.last_dir = 'in' and t.status in ('open','handover')` : view === "mine" ? q`and l.assigned_to = ${c.id}` : view === "visitors" ? q`and t.visitor is not null` : q``}
      ${owner ? q`and l.assigned_to = ${owner}` : q``}
      ${from ? q`and t.last_at >= ${from}::date` : q``}
      ${to ? q`and t.last_at < (${to}::date + 1)` : q``}
      ${qs ? q`and (coalesce(l.data->>'customerName', t.visitor->>'name', '') ilike ${like} or t.customer_email ilike ${like} or t.code ilike ${like} or t.lead_id ilike ${like}
        ${digits.length >= 4 ? q`or t.wa_phone like ${"%" + digits + "%"} or l.phone_norm like ${"%" + digits.slice(-9) + "%"}` : q``}
        or exists (select 1 from lara_messages m where m.thread_id = t.id and m.body ilike ${like}))` : q``}`;
    const rows = await q`select t.id, t.lead_id, t.code, t.status, t.customer_email, t.wa_phone, t.visitor is not null as visitor, t.last_at, t.last_dir, t.last_channel, t.last_preview, t.msg_count, t.unread, t.channels,
        coalesce(l.data->>'customerName', t.visitor->>'name', t.lead_id) as customer, l.data->>'assignedSalespersonName' as owner, l.assigned_to as owner_id, l.status as lead_status, l.data->>'project' as park,
        (select count(*)::int from lara_drafts d where d.lead_id = t.lead_id and d.status = 'shadow') as pending,
        count(*) over()::int as total
      from lara_threads t left join crm_leads l on l.id = t.lead_id
      where ${where}
      order by t.last_at desc nulls last limit ${size} offset ${(page - 1) * size}`;
    const [k] = await q`select count(*)::int as everything, count(*) filter (where t.unread > 0)::int as unread, count(*) filter (where t.last_dir = 'in' and t.status in ('open','handover'))::int as waiting,
        count(*) filter (where t.status = 'handover')::int as handover, count(*) filter (where t.visitor is not null)::int as visitors
      from lara_threads t left join crm_leads l on l.id = t.lead_id where ${scope}`;
    return { success: true, page, size, total: rows[0]?.total || 0, rows: rows.map((r: any) => { const { total: _t, ...x } = r; return x; }), counts: { all: k?.everything || 0, unread: k?.unread || 0, waiting: k?.waiting || 0, handover: k?.handover || 0, visitors: k?.visitors || 0 } };
  }, async () => { throw new HttpError(503, "The inbox is busy, try again in a moment"); });
});

route("GET", "/lara/inbox/:id", async ({ c, params, query }) => {
  const w = laraWho(c);
  const { data: t } = await admin.from("lara_threads").select("*").eq("id", params.id).maybeSingle();
  if (!t) throw new HttpError(404, "Conversation not found");
  if (!w.admin) await ownsLead(c, t.lead_id);
  const before = /^\d{4}-\d{2}-\d{2}T/.test(query.get("before") || "") ? query.get("before")! : "";
  let mq: any = admin.from("lara_messages").select("id,direction,kind,channel,author,matched_by,wa_status,subject,body,from_addr,to_addr,at").eq("thread_id", t.id).in("kind", ["mail", "chat", "staff", "auto"]).order("at", { ascending: false }).limit(40);
  if (before) mq = mq.lt("at", before);
  const [msgs, drafts, enr, lead] = await Promise.all([
    mq,
    before ? Promise.resolve({ data: [] }) : admin.from("lara_drafts").select("id,kind,channel,situation,status,send_status,send_error,subject,body,created_at").eq("lead_id", t.lead_id).in("status", ["shadow", "approved"]).neq("send_status", "sent").order("created_at", { ascending: false }).limit(5),
    before ? Promise.resolve({ data: null }) : admin.from("lara_enrollments").select("status,step,why,next_at,workflow_id,lara_workflows(name)").eq("lead_id", t.lead_id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    before || t.visitor ? Promise.resolve(null) : leadInfo(t.lead_id),
  ]);
  if (!before && t.unread) await admin.from("lara_threads").update({ unread: 0 }).eq("id", t.id);
  const list = (msgs.data || []).reverse();
  return { success: true, thread: { ...t, chat_key: undefined, hasChat: !!t.chat_key }, messages: list, more: (msgs.data || []).length === 40, pending: (drafts as any).data || [], workflow: (enr as any).data || null, lead };
});

/** a salesperson answers from the inbox: web chat = instant; e-mail / WhatsApp = sent through the same rules as Lara (test lock, opt-out, 24 h) */
route("POST", "/lara/inbox/:id/reply", async ({ req, c, params }) => {
  const w = laraWho(c);
  const { data: t } = await admin.from("lara_threads").select("*").eq("id", params.id).maybeSingle();
  if (!t) throw new HttpError(404, "Conversation not found");
  if (!w.admin) await ownsLead(c, t.lead_id);
  const b = await body(req, 8000);
  const text = str(b.text, 4000).trim(); if (!text) throw bad("Write the reply");
  const ch = ["web", "email", "whatsapp"].includes(b.channel) ? b.channel : "";
  if (!ch) throw bad("Choose the channel");
  await rateLimit(`inboxreply:${c.id}`, 3600, 200);
  if (ch === "web") {
    if (!t.chat_key) throw bad("This customer has not opened the chat");
    if (!(await chatOpen(t))) throw new HttpError(403, "Test lock: chat replies go only to staff test conversations until the owner lifts the lock");
    const m = await admin.from("lara_messages").insert({ thread_id: t.id, lead_id: t.lead_id, direction: "out", kind: "staff", channel: "web", author: who(c), body: text, from_addr: who(c), to_addr: "web chat", at: nowIso() }).select("*").single();
    await log("mail", who(c), `Answered ${t.code} in the web chat`);
    return { success: true, sent: true, message: m.data };
  }
  if (t.visitor) throw bad("A website visitor can only be answered in the chat (or add them as a lead first)");
  const o = await ownerOf(t.lead_id); const lead = await leadInfo(t.lead_id);
  const to_addr = ch === "email" ? String(lead?.email || t.customer_email || "") : null;
  const to_phone = ch === "whatsapp" ? (t.wa_phone || intl(lead?.phoneNumber)) : null;
  if (ch === "email" && !to_addr) throw bad("The lead has no e-mail address");
  if (ch === "whatsapp" && !to_phone) throw bad("The lead has no usable mobile number");
  const subj = ch === "email" ? str(b.subject, 200) || "Elsewedy Industrial Development" : "";
  const ins = await admin.from("lara_drafts").insert({
    lead_id: t.lead_id, rule: "staff_reply", kind: "reply", situation: "reply_answer", channel: ch, lang: isAr(text) ? "ar" : "en", subject: subj, body: text, to_addr, to_phone,
    reason: `Written by ${who(c)} in the Interactions inbox`, customer: str(o.customer, 120), owner_id: o.id, owner_name: str(o.name, 80), thread_id: t.id,
    status: "approved", decided_by: who(c), decided_at: nowIso(), send_status: "queued",
  }).select("id").single();
  if (ins.error || !ins.data) throw new HttpError(500, "Could not queue the reply");
  const r = await sendDraft(ins.data.id, { sendEnabled: true, mode: "approve", maxSendPerDay: 10000, minDaysBetween: 0, maxUnanswered: 1000, sendStart: 0, sendEnd: 24 }, who(c));
  return { success: true, sent: r.sent, note: r.sent ? "Sent" : r.reason };
});

// ---------------------------------------------------------------------------------------------
// settings: chat and AI (admin)
// ---------------------------------------------------------------------------------------------
route("GET", "/lara/channels", async ({ c }) => {
  needAdmin(c);
  return { success: true, chat: await chatCfg(), ai: await aiCfg(), testLock: (await getConfig<any>("lara_test_lock", true)) !== false, chatPage: "https://sdm-sales-leads.github.io/chat.html" };
});
route("POST", "/lara/chat-settings", async ({ req, c }) => {
  needAdmin(c);
  const b = await body(req, 4000);
  const locked = (await getConfig<any>("lara_test_lock", true)) !== false;
  if (b.enabled === true && locked) throw new HttpError(409, "Lara is on hold (test lock). Website chat can be opened only after the lock is lifted.");
  const next = { enabled: b.enabled === true, callNumber: str(b.callNumber, 30).replace(/[^\d+ ]/g, ""), welcomeAr: str(b.welcomeAr, 400), welcomeEn: str(b.welcomeEn, 400) };
  await setConfig("lara_chat", next);
  await log("config", who(c), `Web chat ${next.enabled ? "OPEN to customers" : "closed to customers (staff tests only)"}; call button ${next.callNumber || "none"}`);
  return { success: true, chat: next };
});
route("POST", "/lara/ai", async ({ req, c }) => { needAdmin(c); return { success: true, ai: await saveAi(await body(req, 4000), who(c)) }; });

/** staff: open the chat of a staff test conversation (to try the customer's view) */
route("POST", "/lara/inbox/:id/chat-link", async ({ c, params }) => {
  needAdmin(c);
  const { data: t } = await admin.from("lara_threads").select("*").eq("id", params.id).maybeSingle();
  if (!t) throw new HttpError(404, "Conversation not found");
  if (!(await chatOpen(t))) throw new HttpError(403, "Test lock: only conversations with a staff address can be opened in the chat");
  return { success: true, url: `https://sdm-sales-leads.github.io/chat.html#k=${await ensureChatKey(t)}` };
});
export type { Caller };
