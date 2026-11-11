// deno-lint-ignore-file no-explicit-any
// Lara omnichannel (11 Nov 2026): the Interactions inbox (e-mail + WhatsApp + web chat in one place) and the customer's web chat with Lara.
// Answer order, cheapest first: rules (stop / hello / thanks / call me) -> Land Bank data -> approved Q&A -> AI (only when the owner switched it
// on, under a daily cap) -> a polite holding reply that hands the question to the salesperson. Lists are paged on the server; the inbox reads
// one summary row per conversation (kept by a database trigger), never the messages.
import { admin, bad, body, Caller, getConfig, HttpError, needAdmin, normPhone, nowIso, rateLimit, setConfig, str } from "./lib.ts";
import { route } from "./router.ts";
import { pg } from "./db.ts";
import { firstNameOf } from "../../../src/lib/personName.ts";
import { activeKb, availabilityAnswer, canSeeOwner, laraAnswer, laraConfig, laraOwners, laraWho, log, ownsLead, who } from "./routes_lara.ts";
import { appendTimeline, contactButtons, ensureChatKey, ensureThread, HANDOVER_RE, isOptedOut, ownerOf, sendDraft, STOP_RE } from "./lara_mail.ts";
import { addNotifications } from "./notify.ts";
import { learn, parksIn, remember, welcomeBack } from "./lara_memory.ts";
import { graphOf, nextOf } from "../../../src/components/lara/flow/graph.ts";
import { aiAnswer, aiCfg, saveAi } from "./lara_ai.ts";
import { intl, waCfg, waReady } from "./lara_wa.ts";
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
  const custFirst = firstNameOf(String(lead?.customerName || t.visitor?.name || ""));
  // a returning customer (this same conversation, 6 h+ since their last message) is welcomed with the last step of THEIR conversation
  const back = welcomeBack(t, ar, { customer: custFirst, owner: ownerFirst });
  const hiBack = back ? (ar ? `أهلاً بيك تاني${custFirst ? ` أ. ${custFirst}` : ""} 👋\n\n` : `Welcome back${custFirst ? `, ${custFirst}` : ""} 👋\n\n`) : "";
  const mem0 = learn(t.memory || {}, text, "web");
  let reply = ""; let by = "rule"; let suggest: string[] = [];
  // a salesperson answered in this chat within the last 2 hours: Lara keeps quiet and lets the person talk
  const { data: lastStaff } = await admin.from("lara_messages").select("at").eq("thread_id", t.id).eq("kind", "staff").eq("channel", "web").order("at", { ascending: false }).limit(1).maybeSingle();   // only a salesperson IN the chat pauses her
  const backAt = Date.parse(t.memory?.backAt || "") || 0;
  if (lastStaff && Date.now() - Date.parse(lastStaff.at) < 2 * 3600e3 && Date.parse(lastStaff.at) > backAt) {
    // the salesperson is in the chat: one bell per 10 minutes, not one per message
    if (!t.last_in_at || Date.now() - Date.parse(t.last_in_at) > 10 * 60e3) await notify(`${o.customer} wrote in the chat`, text.slice(0, 300), "escalation");
    await remember(t.id, mem0, { visits: (Number(t.memory?.visits) || 0) + (fresh ? 1 : 0) });
    return { messages: [ins.data], suggest: [] };
  }
  if (STOP_RE.test(text) && text.length < 250) {
    const contact = String(t.customer_email || t.wa_phone || "").toLowerCase();
    if (contact) await admin.from("lara_optout").upsert({ contact, reason: text.slice(0, 200), lead_id: t.lead_id, by_who: "Web chat", removed_at: null, removed_by: null });
    await admin.from("lara_threads").update({ status: "stopped", note: "Customer asked to stop (chat)", updated_at: now }).eq("id", t.id);
    reply = ar ? "تمام، مش هنبعت لحضرتك رسائل تانية. لو احتجت أي حاجة إحنا موجودين." : "Understood — we will not message you again. We are here if you need anything.";
  } else if (GREET_RE.test(text) && back) {
    reply = back; suggest = SUGGEST[ar ? "ar" : "en"];
  } else if (GREET_RE.test(text)) {
    const first = custFirst;
    reply = ar ? `أهلاً ${first ? `أ. ${first}` : "بحضرتك"}، أنا لارا المساعدة الرقمية لمبيعات السويدي للتنمية الصناعية. أقدر أساعد حضرتك في الأراضي المتاحة وطرق السداد، أو أخلي مسؤول المبيعات يكلمك.` : `Hello${first ? ` ${first}` : ""}, I'm Lara, the digital sales assistant of Elsewedy Industrial Development. I can help with available plots and payment plans, or ask your account manager to call you.`;
    suggest = SUGGEST[ar ? "ar" : "en"];
  } else if (THANKS_RE.test(text)) {
    reply = ar ? "العفو! لو عندك أي سؤال تاني أنا موجودة." : "You're welcome! I'm here if you have any other question.";
  } else if (HANDOVER_RE.test(text) || /please call me|عايز حد يكلمني/i.test(text)) {
    await admin.from("lara_threads").update({ status: "handover", note: "Customer asked for a call (chat)", updated_at: now }).eq("id", t.id);
    await notify(`${o.customer} wants a call — from the chat`, `Their words: "${text.slice(0, 300)}"`, "escalation");
    mem0.handover = now;
    const gaveTime = /\b(today|tomorrow|morning|evening|afternoon|\d{1,2}(:\d{2})?\s*(am|pm)|at \d{1,2})\b|بكره|بكرة|النهارده|الصبح|بالليل|العصر|المغرب|الساعة|الساعه/i.test(text);
    if (gaveTime) {
      reply = hiBack + (ar ? `تمام، بلّغت ${ownerFirst ? `أ. ${ownerFirst}` : "مسؤول المبيعات"} بالميعاد اللي حضرتك قلته وهيتصل بيك فيه إن شاء الله.` : `Noted — I've passed the time you gave to ${ownerFirst || "your account manager"}, who will call you then.`);
    } else reply = hiBack + (ar ? `تمام، بلّغت ${ownerFirst ? `أ. ${ownerFirst}` : "مسؤول المبيعات"} وهيتواصل مع حضرتك في أقرب وقت خلال مواعيد العمل (الأحد–الخميس). ممكن تكتب هنا أنسب وقت للمكالمة.` : `Done — I've told ${ownerFirst || "your account manager"}, who will call you as soon as possible in working hours (Sun–Thu). You can write here the best time to call.`);
  } else {
    // Land Bank data first (a park in the question, or the lead's own park), then the approved Q&A
    let q = text;
    if (!parksIn(text).length && lead?.project && /ارض|اراضي|أرض|أراضي|قطع|متاح|مساح|land|plot|available|size/i.test(text)) q = `${text} ${canonicalParks(lead.project)[0] || ""}`;
    const overview = PLOTS_RE.test(text) && !parksIn(text).length ? await parksOverview(ar) : null;
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
    reply = hiBack + reply;
    suggest = SUGGEST[ar ? "ar" : "en"];
  }
  await remember(t.id, mem0, { answer: by, visits: (Number(t.memory?.visits) || 0) + (fresh ? 1 : 0) });
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
    back: open ? { ar: welcomeBack(t, true, { customer: firstNameOf(String(lead?.customerName || t.visitor?.name || "")), owner: firstNameOf(o?.name || "") }), en: welcomeBack(t, false, { customer: firstNameOf(String(lead?.customerName || t.visitor?.name || "")), owner: firstNameOf(o?.name || "") }) } : null,
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
  // a typed mobile / e-mail proves nothing: the visitor gets their OWN conversation (never a lead's history); a possible match is only a hint
  // for staff, who link it in Interactions after checking (owner, 11 Nov 2026: "don't mix history of any customer")
  const local = normPhone(phone);
  let { data: lead } = await admin.from("crm_leads").select("id").eq("phone_norm", local).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!lead && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ({ data: lead } = await admin.from("crm_leads").select("id").ilike("data->>email", email).is("deleted_at", null).limit(1).maybeSingle());
  const vid = `VISIT-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const t: any = (await admin.from("lara_threads").insert({ lead_id: vid, code: `SDM-${vid}`, customer_email: email, wa_phone: phone, match_lead_id: lead?.id || null, visitor: { name, phone, email, page: str(b.page, 200), at: nowIso() } }).select("*").single()).data;
  const to = await staffTo(null);
  if (to.length) await addNotifications(to.map((userId) => ({ userId, type: "escalation", leadId: undefined, title: `New website chat: ${name}`, body: `${phone}${email ? ` · ${email}` : ""} — "${text.slice(0, 160)}".${lead ? ` Same mobile/e-mail as ${lead.id}: check and link it in Interactions.` : " Not a lead yet."}` }))).catch(() => {});
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
  const owners = await laraOwners(c);
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
    const scope = owners === null ? q`true` : q`l.assigned_to::text = any(${owners})`;   // the CRM's rule: all / team / own; visitors only for "all"
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
    if (t.status === "open") await admin.from("lara_threads").update({ status: "handover", note: `${who(c)} took over the chat`, updated_at: nowIso() }).eq("id", t.id);   // Lara pauses until "Give back to Lara"
    await log("mail", who(c), `Answered ${t.code} in the web chat`);
    return { success: true, sent: true, message: m.data };
  }
  if (t.visitor) throw bad("A website visitor can only be answered in the chat (or add them as a lead first)");
  const o = await ownerOf(t.lead_id); const lead = await leadInfo(t.lead_id);
  const to_addr = ch === "email" ? String(lead?.email || t.customer_email || "") : null;
  const to_phone = ch === "whatsapp" ? (t.wa_phone || intl(lead?.phoneNumber)) : null;
  if (ch === "email" && !to_addr) throw bad("The lead has no e-mail address");
  if (ch === "whatsapp" && !to_phone) throw bad("The lead has no usable mobile number");
  if (ch === "whatsapp" && !(await waReady())) throw new HttpError(409, "WhatsApp is not connected yet (Lara › Settings & channels). Use the lead's WhatsApp button to send it from your phone.");
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
// ---------------------------------------------------------------------------------------------
// 360: Lara's history inside the lead and the customer pages; "Start with Lara"; link a website visitor to a lead
// ---------------------------------------------------------------------------------------------
/** one lead's conversation with Lara (all channels), newest 40 messages; same visibility as the lead itself */
route("GET", "/lara/lead/:id", async ({ c, params, query }) => {
  const w = laraWho(c);
  const id = str(params.id, 40).toUpperCase();
  if (!w.admin) await ownsLead(c, id);
  const { data: t } = await admin.from("lara_threads").select("id,lead_id,code,status,customer_email,wa_phone,last_at,last_channel,msg_count,unread,channels,memory,started_by,chat_key,created_at").eq("lead_id", id).maybeSingle();
  const [enr, drafts] = await Promise.all([
    admin.from("lara_enrollments").select("status,why,next_at,node,started_at,workflow_id,lara_workflows(name)").eq("lead_id", id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("lara_drafts").select("id,kind,channel,situation,status,send_status,send_error,created_at").eq("lead_id", id).in("status", ["shadow", "approved"]).neq("send_status", "sent").order("created_at", { ascending: false }).limit(5),
  ]);
  if (!t) return { success: true, thread: null, messages: [], workflow: enr.data || null, pending: drafts.data || [] };
  const before = /^\d{4}-\d{2}-\d{2}T/.test(query.get("before") || "") ? query.get("before")! : "";
  let mq: any = admin.from("lara_messages").select("id,direction,kind,channel,author,matched_by,wa_status,subject,body,at").eq("thread_id", t.id).in("kind", ["mail", "chat", "staff", "auto"]).order("at", { ascending: false }).limit(40);
  if (before) mq = mq.lt("at", before);
  const { data: msgs } = await mq;
  return { success: true, thread: { ...t, chat_key: undefined, hasChat: !!t.chat_key }, messages: (msgs || []).reverse(), more: (msgs || []).length === 40, workflow: enr.data || null, pending: drafts.data || [] };
});

/** a customer (contact) has several leads: their conversations, only the leads this person may see */
route("GET", "/lara/contact", async ({ c, query }) => {
  laraWho(c);
  const ids = String(query.get("leads") || "").split(",").map((x) => str(x, 40).toUpperCase()).filter((x) => /^[A-Z0-9-]{2,40}$/.test(x)).slice(0, 50);
  if (!ids.length) return { success: true, rows: [] };
  const owners = await laraOwners(c);
  let lq: any = admin.from("crm_leads").select("id,assigned_to,status,data->project,data->assignedSalespersonName").in("id", ids);
  if (owners) lq = lq.in("assigned_to", owners);
  const { data: leads } = await lq;
  const ok = (leads || []).map((l: any) => l.id);
  if (!ok.length) return { success: true, rows: [] };
  const { data: th } = await admin.from("lara_threads").select("id,lead_id,code,status,last_at,last_dir,last_channel,last_preview,msg_count,channels").in("lead_id", ok).order("last_at", { ascending: false, nullsFirst: false });
  const lm = new Map((leads || []).map((l: any) => [l.id, l]));
  return { success: true, rows: (th || []).map((t: any) => ({ ...t, project: (lm.get(t.lead_id) as any)?.project || "", owner: (lm.get(t.lead_id) as any)?.assignedSalespersonName || "", leadStatus: (lm.get(t.lead_id) as any)?.status || "" })) };
});

/** find a lead to start with (number, name, mobile or e-mail), only within this person's leads */
route("GET", "/lara/lead-search", async ({ c, query }) => {
  laraWho(c);
  await rateLimit(`larasearch:${c.id}`, 60, 60);
  const q0 = str(query.get("q") || "", 60).trim();
  if (q0.length < 2) return { success: true, rows: [] };
  const owners = await laraOwners(c);
  const qs = q0.replace(/[%_\\,()]/g, " ").trim();
  const digits = q0.replace(/\D/g, "");
  let lq: any = admin.from("crm_leads").select("id,status,assigned_to,phone_norm,data->customerName,data->email,data->phoneNumber,data->project,data->assignedSalespersonName").is("deleted_at", null);
  if (owners) lq = lq.in("assigned_to", owners);
  const ors = [`id.ilike.%${qs}%`, `data->>customerName.ilike.%${qs}%`, `data->>email.ilike.%${qs}%`];
  if (digits.length >= 6) ors.push(`phone_norm.like.%${digits.slice(-9)}%`);
  const { data } = await lq.or(ors.join(",")).order("updated_at", { ascending: false }).limit(10);
  const ids = (data || []).map((l: any) => l.id);
  const th = ids.length ? (await admin.from("lara_threads").select("lead_id,status,last_at").in("lead_id", ids)).data || [] : [];
  const tm = new Map(th.map((t: any) => [t.lead_id, t]));
  return { success: true, rows: (data || []).map((l: any) => ({ id: l.id, name: l.customerName, email: l.email || "", phone: l.phoneNumber || "", status: l.status, project: l.project || "", owner: l.assignedSalespersonName || "", lara: tm.get(l.id) || null })) };
});

/** "Start with Lara": a person hands a lead to Lara — a first message now (they approve it by sending) or a workflow from its first box */
route("POST", "/lara/start", async ({ req, c }) => {
  const w = laraWho(c);
  const b = await body(req, 10000);
  const leadId = str(b.leadId, 40).toUpperCase();
  if (!/^[A-Z0-9-]{2,40}$/.test(leadId)) throw bad("Choose a lead");
  if (!w.admin) await ownsLead(c, leadId);
  await rateLimit(`larastart:${c.id}`, 3600, 120);
  const lead = await leadInfo(leadId);
  if (!lead) throw new HttpError(404, "Lead not found");
  const mode = b.mode === "workflow" ? "workflow" : "send";
  const ch = b.channel === "whatsapp" ? "whatsapp" : "email";
  const email = String(lead.email || "").trim().toLowerCase();
  const phone = intl(lead.phoneNumber);
  if (await isOptedOut([email, phone].filter(Boolean))) throw new HttpError(409, "This customer asked not to be contacted");
  const t = await ensureThread(leadId, email);
  await admin.from("lara_threads").update({ status: "open", started_by: who(c), wa_phone: t.wa_phone || phone || null, note: null, updated_at: nowIso() }).eq("id", t.id);
  const o = await ownerOf(leadId);
  if (mode === "workflow") {
    // Lara's workflows work on behalf of the lead's salesperson (the daily run only takes leads with an owner)
    if (!lead.assigned_to) throw new HttpError(409, "Assign a salesperson first: workflows run only for leads with an owner (\"Lara writes now\" works without one)");
    const { data: wf } = await admin.from("lara_workflows").select("*").eq("id", str(b.workflowId, 60)).eq("status", "active").maybeSingle();
    if (!wf) throw bad("Choose a workflow");
    const g = graphOf(wf); const trig = g.nodes.find((n: any) => n.type === "trigger");
    const start = trig ? nextOf(g, trig.id) : null;
    if (!start) throw bad("This workflow has no first step");
    await admin.from("lara_enrollments").update({ status: "stopped", stop_reason: `Moved to "${wf.name}" by ${who(c)}`, updated_at: nowIso() }).eq("lead_id", leadId).eq("status", "active");
    const ins = await admin.from("lara_enrollments").insert({ workflow_id: wf.id, lead_id: leadId, why: `Started by ${who(c)}`, node: start, next_at: nowIso() }).select("id").single();
    if (ins.error) throw new HttpError(500, "Could not start the workflow");
    await appendTimeline(leadId, { type: "Comment", title: `Handed to Lara by ${who(c)}`, description: `Workflow "${wf.name}" (next run of Lara, 09:00 Sun–Thu)` }).catch(() => {});
    await log("run", who(c), `${o.customer} (${leadId}) put in workflow "${wf.name}"`);
    return { success: true, started: "workflow", note: `In "${wf.name}". Lara takes the first step at her next run.` };
  }
  const text = str(b.text, 4000).trim();
  if (!text) throw bad("Write the first message");
  if (ch === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("The lead has no e-mail address");
  if (ch === "whatsapp" && !phone) throw bad("The lead has no usable mobile number");
  if (ch === "whatsapp" && !(await waReady())) throw new HttpError(409, "WhatsApp is not connected yet (Lara › Settings & channels). Choose E-mail, or send it from the lead's WhatsApp button.");
  const subject = ch === "email" ? (str(b.subject, 200) || "Elsewedy Industrial Development") : "";
  const d = await admin.from("lara_drafts").insert({
    lead_id: leadId, rule: "started_by_staff", kind: "followup", situation: str(b.situation, 40) || "any", channel: ch, lang: isAr(text) ? "ar" : "en", subject, body: text,
    to_addr: ch === "email" ? email : null, to_phone: ch === "whatsapp" ? phone : null, reason: `Handed to Lara by ${who(c)}`, customer: str(o.customer, 120), owner_id: o.id, owner_name: str(o.name, 80), thread_id: t.id,
    status: "approved", decided_by: who(c), decided_at: nowIso(), send_status: "queued",
  }).select("id").single();
  if (d.error || !d.data) throw new HttpError(409, /one_open/.test(d.error?.message || "") ? "A Lara draft for this lead already waits in Drafts: approve or reject it first" : "Could not start");
  const r = await sendDraft(d.data.id, { sendEnabled: true, mode: "approve", maxSendPerDay: 10000, minDaysBetween: 0, maxUnanswered: 1000, sendStart: 0, sendEnd: 24 }, who(c));
  if (!r.sent) await appendTimeline(leadId, { type: "Comment", title: `Handed to Lara by ${who(c)} (${ch === "whatsapp" ? "WhatsApp" : "e-mail"})`, description: `Not sent yet: ${r.reason}` }).catch(() => {});
  await log("mail", who(c), `${o.customer} (${leadId}) handed to Lara by ${ch}: ${r.sent ? "sent" : r.reason}`);
  return { success: true, started: "message", sent: r.sent, note: r.sent ? "Sent. Lara now answers this customer." : r.reason, threadId: t.id };
});

/** a website visitor checked by staff and linked to the lead: the chat moves into that lead's conversation (nothing is deleted) */
route("POST", "/lara/inbox/:id/link-lead", async ({ req, c, params }) => {
  const w = laraWho(c);
  if (!w.admin) throw new HttpError(403, "Only people who see every lead (admin, Sales Operation) link website chats");
  const b = await body(req, 500);
  const leadId = str(b.leadId, 40).toUpperCase();
  const { data: v } = await admin.from("lara_threads").select("*").eq("id", params.id).maybeSingle();
  if (!v?.visitor) throw bad("Only a website visitor's chat can be linked");
  const lead = await leadInfo(leadId);
  if (!lead) throw new HttpError(404, "Lead not found");
  const t = await ensureThread(leadId, String(lead.email || v.customer_email || ""));
  await admin.from("lara_messages").update({ thread_id: t.id, lead_id: leadId }).eq("thread_id", v.id);
  await pg(async (q) => {
    await q`update lara_threads t set last_at = s.last_at, last_dir = s.last_dir, last_channel = s.last_channel, last_preview = s.last_preview, msg_count = s.n, channels = s.chs,
        chat_key = coalesce(t.chat_key, ${v.chat_key}), unread = t.unread + ${v.unread || 0}, wa_phone = coalesce(t.wa_phone, ${v.wa_phone}), last_in_at = greatest(t.last_in_at, ${v.last_in_at})
      from (select count(*)::int n, max(at) last_at, (array_agg(direction order by at desc))[1] last_dir, (array_agg(coalesce(channel,'email') order by at desc))[1] last_channel,
                   (array_agg(left(regexp_replace(coalesce(body,''), '\s+', ' ', 'g'), 160) order by at desc))[1] last_preview, array_agg(distinct coalesce(channel,'email')) chs
            from lara_messages where thread_id = ${t.id} and kind not in ('unmatched','ignored')) s where t.id = ${t.id}`;
    await q`update lara_threads set status = 'closed', chat_key = null, msg_count = 0, note = ${`Linked to ${leadId} by ${who(c)}`}, updated_at = now() where id = ${v.id}`;
  }, async () => { throw new HttpError(503, "Try again in a moment"); });
  await appendTimeline(leadId, { type: "Comment", title: `Website chat linked by ${who(c)}`, description: `${v.visitor?.name || ""} ${v.visitor?.phone ? `+${v.visitor.phone}` : ""}`.trim() }).catch(() => {});
  await log("mail", who(c), `Website chat of ${v.visitor?.name || "a visitor"} linked to ${leadId}`);
  return { success: true, threadId: t.id };
});
export type { Caller };
