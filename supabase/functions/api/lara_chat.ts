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
const GREET_RE = /^\s*(bonjour|bonsoir|salut|merhaba|selam|你好|您好|hi|hello|hey|good (morning|evening|afternoon)|السلام عليكم|سلام|اهلا|أهلا|مرحبا|هاي|صباح الخير|مساء الخير|ازيك|إزيك)[\s!.,؟?]*$/i;
const THANKS_RE = /^\s*(merci( beaucoup)?|teşekkürler|teşekkür ederim|sağ ol|谢谢|多谢|thanks?|thank you|thx|ok(ay)?|شكرا|شكراً|متشكر|تمام|ماشي|اوك)[\s!.,؟?]*$/i;
const PLOTS_RE = /^\s*(terrains disponibles|mevcut arsalar|可售地块|available plots|الأراضي المتاحة|الاراضي المتاحة)\s*$/i;

export interface ChatCfg { enabled: boolean; callNumber: string; welcomeAr: string; welcomeEn: string; voice: boolean; record: boolean; provider: string; liveModel: string; liveVoice: string }
export async function chatCfg(): Promise<ChatCfg> {
  const c = await getConfig<any>("lara_chat", {});
  return { enabled: c.enabled === true, callNumber: String(c.callNumber || ""), welcomeAr: String(c.welcomeAr || ""), welcomeEn: String(c.welcomeEn || ""),
    voice: c.voice !== false, record: c.record !== false, provider: c.provider === "gemini-live" ? "gemini-live" : "browser", liveModel: String(c.liveModel || ""), liveVoice: String(c.liveVoice || "") };
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

const SUGGEST: Record<string, string[]> = { ar: ["الأراضي المتاحة", "طرق السداد", "عايز حد يكلمني"], en: ["Available plots", "Payment plans", "Please call me"],
  fr: ["Terrains disponibles", "Modalités de paiement", "Rappelez-moi"], tr: ["Mevcut arsalar", "Ödeme planları", "Beni arayın"], zh: ["可售地块", "付款方式", "请给我回电"] };
// French, Turkish, Chinese: Lara's own sentences (rules, no AI). Approved answers exist in Arabic/English only, so those are given in English
// (or translated by the AI when the owner switched it on).
const TR: Record<string, Record<string, string>> = {
  fr: { o: "votre conseiller", greet: "Bonjour{n}, je suis Lara, l'assistante commerciale digitale d'Elsewedy Industrial Development. Je peux vous renseigner sur les terrains disponibles et les modalités de paiement, ou demander à votre conseiller de vous appeler.",
    back: "Ravie de vous revoir{n} 👋 Souhaitez-vous reprendre là où nous nous étions arrêtés ?", hi: "Ravie de vous revoir{n} 👋\n\n", thanks: "Avec plaisir ! Je reste à votre disposition.",
    stop: "C'est noté, nous ne vous enverrons plus de messages. Nous restons à votre disposition.", call: "C'est noté — j'ai prévenu {o}, qui vous appellera dès que possible pendant les heures de travail (dimanche–jeudi). Vous pouvez indiquer ici le meilleur moment pour l'appel.",
    calltime: "C'est noté — j'ai transmis l'horaire indiqué à {o}, qui vous appellera à ce moment-là.", holding: "Bonne question — pour vous donner une réponse exacte, je l'ai transmise à {o}, qui vous répondra ici ou par téléphone.",
    more: "\n\nPuis-je vous aider pour autre chose ?", fit: "{n} terrain(s) disponible(s) actuellement à {park}{sized} ({span} m²).", sized: " proches de la surface demandée", none: "Aucun terrain disponible actuellement à {park} selon la dernière mise à jour.",
    nofit: "Pas de terrain exactement de cette surface à {park}, mais {n} terrains sont disponibles ({span} m²).", oh: "Disponible actuellement (dernière mise à jour) :", ol: "• {park} : {n} terrains ({a} – {b} m²)", ot: "Quel parc et quelle surface vous conviennent ?" },
  tr: { o: "satış temsilciniz", greet: "Merhaba{n}, ben Lara, Elsewedy Industrial Development'ın dijital satış asistanıyım. Mevcut arsalar ve ödeme planları konusunda yardımcı olabilirim ya da satış temsilcinizin sizi aramasını sağlayabilirim.",
    back: "Tekrar hoş geldiniz{n} 👋 Kaldığımız yerden devam edelim mi?", hi: "Tekrar hoş geldiniz{n} 👋\n\n", thanks: "Rica ederim! Başka sorunuz olursa buradayım.",
    stop: "Anlaşıldı, size bir daha mesaj göndermeyeceğiz. İhtiyacınız olursa buradayız.", call: "Tamam — {o} bilgilendirildi; çalışma saatlerinde (Pazar–Perşembe) en kısa sürede sizi arayacak. Size uygun saati buraya yazabilirsiniz.",
    calltime: "Not aldım — belirttiğiniz saati {o} ile paylaştım; o saatte sizi arayacak.", holding: "Güzel soru — size kesin bir yanıt verebilmek için sorunuzu {o} ile paylaştım; buradan ya da telefonla yanıt verecek.",
    more: "\n\nBaşka bir konuda yardımcı olabilir miyim?", fit: "{park} bölgesinde şu anda {n} arsa mevcut{sized} ({span} m²).", sized: ", istediğiniz büyüklüğe yakın", none: "Son güncellemeye göre {park} bölgesinde şu anda uygun arsa yok.",
    nofit: "{park} bölgesinde tam bu büyüklükte arsa yok, ancak {n} arsa mevcut ({span} m²).", oh: "Şu anda mevcut (son güncelleme):", ol: "• {park}: {n} arsa ({a} – {b} m²)", ot: "Hangi bölge ve büyüklük size uygun?" },
  zh: { o: "您的销售经理", greet: "您好{n}，我是Lara，Elsewedy Industrial Development的数字销售助理。我可以为您介绍可售地块和付款方式，或安排销售经理给您回电。",
    back: "欢迎回来{n} 👋 我们从上次的话题继续吗？", hi: "欢迎回来{n} 👋\n\n", thanks: "不客气！如有其他问题，随时告诉我。",
    stop: "好的，我们不会再给您发送消息。如有需要，随时联系我们。", call: "好的——我已通知{o}，将在工作时间（周日至周四）尽快给您回电。您可以在这里留下方便接听的时间。",
    calltime: "已记录——我已将您说的时间转告{o}，届时会给您回电。", holding: "这个问题很好——为了给您准确的答复，我已转给{o}，会在这里或通过电话回复您。",
    more: "\n\n还有什么可以帮您的吗？", fit: "{park}目前有{n}块可售地块{sized}（{span}平方米）。", sized: "，接近您需要的面积", none: "根据最新数据，{park}目前没有可售地块。",
    nofit: "{park}没有正好这个面积的地块，但有{n}块可售（{span}平方米）。", oh: "目前可售（最新数据）：", ol: "• {park}：{n}块（{a} – {b}平方米）", ot: "您需要哪个园区、多大面积？" },
};
const fill = (s: string, v: Record<string, any>) => s.replace(/\{(\w+)\}/g, (_m, k) => String(v[k] ?? ""));
async function overviewIn(L: string): Promise<string | null> {
  const { data } = await admin.from("plots_snapshot").select("data").eq("id", 1).maybeSingle();
  const by = new Map<string, number[]>();
  for (const p of (Array.isArray(data?.data) ? data!.data : []) as any[]) if (p.status === "available" && Number(p.areaSqm) > 0) { const l = by.get(p.park) || []; l.push(Number(p.areaSqm)); by.set(p.park, l); }
  if (!by.size) return null;
  const f = (n: number) => Math.round(n).toLocaleString("en-US");
  return [TR[L].oh, ...[...by.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([park, a]) => { a.sort((x, y) => x - y); return fill(TR[L].ol, { park, n: a.length, a: f(a[0]), b: f(a[a.length - 1]) }); }), TR[L].ot].join("\n");
}

/** one customer message in the web chat -> Lara's instant answer. Returns the new messages. */
export async function chatTurn(t: any, text: string, opts: { lang?: string; mode?: string } = {}): Promise<{ messages: any[]; suggest: string[] }> {
  const now = nowIso();
  const L = opts.lang && TR[opts.lang] ? opts.lang : null;                      // French / Turkish / Chinese chosen in the widget
  const ar = L ? false : opts.lang === "ar" ? true : opts.lang === "en" ? false : (isAr(text) || !/[a-z]{3,}/i.test(text));
  const CHN = opts.mode === "call" ? "call" : "web";                            // a voice call is its own channel in Interactions
  let cat = ""; let facts: any = null;
  const lead = t.visitor ? null : await leadInfo(t.lead_id);
  const o = t.visitor ? { id: null, name: "", customer: String(t.visitor?.name || "Website visitor") } : await ownerOf(t.lead_id);
  const ins = await admin.from("lara_messages").insert({ thread_id: t.id, lead_id: t.lead_id, direction: "in", kind: "chat", channel: CHN, matched_by: "chat", body: text, from_addr: "web chat", to_addr: "Lara", at: now }).select("id,direction,kind,channel,author,body,at").single();
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
    cat = "stop";
    reply = ar ? "تمام، مش هنبعت لحضرتك رسائل تانية. لو احتجت أي حاجة إحنا موجودين." : "Understood — we will not message you again. We are here if you need anything.";
  } else if (GREET_RE.test(text) && back) {
    cat = "back"; reply = back; suggest = SUGGEST[ar ? "ar" : "en"];
  } else if (GREET_RE.test(text)) {
    const first = custFirst; cat = "greet";
    reply = ar ? `أهلاً ${first ? `أ. ${first}` : "بحضرتك"}، أنا لارا المساعدة الرقمية لمبيعات السويدي للتنمية الصناعية. أقدر أساعد حضرتك في الأراضي المتاحة وطرق السداد، أو أخلي مسؤول المبيعات يكلمك.` : `Hello${first ? ` ${first}` : ""}, I'm Lara, the digital sales assistant of Elsewedy Industrial Development. I can help with available plots and payment plans, or ask your account manager to call you.`;
    suggest = SUGGEST[ar ? "ar" : "en"];
  } else if (THANKS_RE.test(text)) {
    cat = "thanks";
    reply = ar ? "العفو! لو عندك أي سؤال تاني أنا موجودة." : "You're welcome! I'm here if you have any other question.";
  } else if (HANDOVER_RE.test(text) || /please call me|عايز حد يكلمني|rappelez-moi|appelez-moi|beni arayın|beni ara|请给我回电|给我打电话/i.test(text)) {
    await admin.from("lara_threads").update({ status: "handover", note: "Customer asked for a call (chat)", updated_at: now }).eq("id", t.id);
    await notify(`${o.customer} wants a call — from the chat`, `Their words: "${text.slice(0, 300)}"`, "escalation");
    mem0.handover = now;
    const gaveTime = /\b(today|tomorrow|morning|evening|afternoon|\d{1,2}(:\d{2})?\s*(am|pm)|at \d{1,2})\b|بكره|بكرة|النهارده|الصبح|بالليل|العصر|المغرب|الساعة|الساعه|demain|aujourd|matin|soir|\d{1,2}\s?h\b|yarın|bugün|sabah|akşam|saat \d|明天|今天|上午|下午|\d点/i.test(text);
    cat = gaveTime ? "calltime" : "call";
    if (gaveTime) {
      reply = hiBack + (ar ? `تمام، بلّغت ${ownerFirst ? `أ. ${ownerFirst}` : "مسؤول المبيعات"} بالميعاد اللي حضرتك قلته وهيتصل بيك فيه إن شاء الله.` : `Noted — I've passed the time you gave to ${ownerFirst || "your account manager"}, who will call you then.`);
    } else reply = hiBack + (ar ? `تمام، بلّغت ${ownerFirst ? `أ. ${ownerFirst}` : "مسؤول المبيعات"} وهيتواصل مع حضرتك في أقرب وقت خلال مواعيد العمل (الأحد–الخميس). ممكن تكتب هنا أنسب وقت للمكالمة.` : `Done — I've told ${ownerFirst || "your account manager"}, who will call you as soon as possible in working hours (Sun–Thu). You can write here the best time to call.`);
  } else {
    // Land Bank data first (a park in the question, or the lead's own park), then the approved Q&A
    let q = text;
    if (!parksIn(text).length && lead?.project && /ارض|اراضي|أرض|أراضي|قطع|متاح|مساح|land|plot|available|size|terrain|parcelle|disponible|arsa|arazi|mevcut|地块|土地|可售/i.test(text)) q = `${text} ${canonicalParks(lead.project)[0] || ""}`;
    const overview = PLOTS_RE.test(text) && !parksIn(text).length ? await parksOverview(ar) : null;
    if (overview) { reply = overview; by = "landbank"; cat = "overview"; }
    else {
      const data = await availabilityAnswer(q).catch(() => null);
      if (data) { reply = ar ? data.ar : data.en; by = "landbank"; cat = "plots"; facts = data.f; }
      else {
        if (text.length >= 3) {
          const r = await laraAnswer(text, { record: true, source: "customer", leadId: t.visitor ? undefined : t.lead_id, by: "Web chat" });
          const best = r.matches[0];
          if (r.answered && best) { reply = (ar ? best.a_ar || best.a_en : best.a_en || best.a_ar) || ""; by = "qa"; }
        }
        if (!reply) {
          const ai = await aiAnswer(text, await activeKb(), [], { lang: L || (ar ? "ar" : "en") });
          if (ai) { reply = ai; by = "ai"; }
        }
        if (!reply) {
          await notify(`${o.customer} asked Lara something she cannot answer (chat)`, `Answer in the Interactions inbox, or add it in Lara > Missed questions: "${text.slice(0, 200)}"`, "escalation");
          reply = ar ? `سؤال مهم، وعشان أديك إجابة دقيقة بلّغت ${ownerFirst ? `أ. ${ownerFirst}` : "مسؤول المبيعات"} وهيرد على حضرتك هنا أو بمكالمة.` : `Good question — to give you an exact answer I've passed it to ${ownerFirst || "your account manager"}, who will reply here or call you.`;
          by = "holding"; cat = "holding";
        }
      }
    }
    if (by !== "holding") reply += ar ? "\n\nفي حاجة تانية أقدر أساعد فيها؟" : "\n\nAnything else I can help with?";
    reply = hiBack + reply;
    suggest = SUGGEST[ar ? "ar" : "en"];
  }
  if (L) {   // the same decision, said in the customer's language
    const T = TR[L]; const n = custFirst ? (L === "zh" ? `，${custFirst}` : ` ${custFirst}`) : ""; const o = ownerFirst || T.o;
    const hi = back && cat !== "back" && cat !== "stop" && cat !== "greet" && cat !== "thanks" ? fill(T.hi, { n }) : "";
    let x: string | null = null;
    if (cat === "plots" && facts) x = fill(T[facts.k] || T.fit, { ...facts, sized: facts.sized ? T.sized : "" }) + T.more;
    else if (cat === "overview") x = await overviewIn(L);
    else if (T[cat]) x = fill(T[cat], { n, o });
    if (x) reply = hi + x; else if (reply && by !== "holding" && cat === "") reply = reply.replace(/\n\nAnything else I can help with\?$/, T.more);
    if (suggest.length) suggest = SUGGEST[L];
  }
  await remember(t.id, mem0, { answer: by, visits: (Number(t.memory?.visits) || 0) + (fresh ? 1 : 0), lang: L || (ar ? "ar" : "en") } as any);
  const out = await admin.from("lara_messages").insert({ thread_id: t.id, lead_id: t.lead_id, direction: "out", kind: "chat", channel: CHN, author: "Lara", matched_by: by, body: reply, from_addr: "Lara", to_addr: "web chat", at: new Date(Date.now() + 5).toISOString() }).select("id,direction,kind,channel,author,body,at").single();
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
    messages: (msgs || []).reverse().map(pub), suggest: SUGGEST, lang: t.memory?.lang || null, rated: !!t.rating,
    voice: { enabled: cc.voice, record: cc.record, provider: "browser" },   // Gemini Live joins here when its key is connected
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
  const r = await chatTurn(t, text, { lang: str(b.lang, 5), mode: str(b.mode, 10) });
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
  const ch = ["email", "whatsapp", "web", "call"].includes(query.get("channel") || "") ? query.get("channel")! : "";
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
  const [msgs, drafts, enr, lead, calls] = await Promise.all([
    mq,
    before ? Promise.resolve({ data: [] }) : admin.from("lara_drafts").select("id,kind,channel,situation,status,send_status,send_error,subject,body,created_at").eq("lead_id", t.lead_id).in("status", ["shadow", "approved"]).neq("send_status", "sent").order("created_at", { ascending: false }).limit(5),
    before ? Promise.resolve({ data: null }) : admin.from("lara_enrollments").select("status,step,why,next_at,workflow_id,lara_workflows(name)").eq("lead_id", t.lead_id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    before || t.visitor ? Promise.resolve(null) : leadInfo(t.lead_id),
    before ? Promise.resolve({ data: [] }) : admin.from("lara_calls").select("id,started_at,seconds,lang,turns,audio_bytes").eq("thread_id", t.id).order("started_at", { ascending: false }).limit(10),
  ]);
  if (!before && t.unread) await admin.from("lara_threads").update({ unread: 0 }).eq("id", t.id);
  const list = (msgs.data || []).reverse();
  return { success: true, thread: { ...t, chat_key: undefined, hasChat: !!t.chat_key }, messages: list, more: (msgs.data || []).length === 40, pending: (drafts as any).data || [], workflow: (enr as any).data || null, lead, calls: (calls as any).data || [] };
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
    if (typeof b.draftId === "string") await admin.from("lara_drafts").update({ status: "expired", feedback: `Sent by ${who(c)} in the chat`, updated_at: nowIso() }).eq("id", b.draftId).eq("lead_id", t.lead_id).eq("status", "shadow");
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
  // "Use Lara's draft": the person sends Lara's prepared answer as their own reply; her draft is closed so it is never sent twice
  const usedDraft = typeof b.draftId === "string" && /^[0-9a-f-]{36}$/i.test(b.draftId) ? b.draftId : null;
  const ins = await admin.from("lara_drafts").insert({
    lead_id: t.lead_id, rule: "staff_reply", kind: "reply", situation: "reply_answer", channel: ch, lang: isAr(text) ? "ar" : "en", subject: subj, body: text, to_addr, to_phone,
    reason: `Written by ${who(c)} in the Interactions inbox`, customer: str(o.customer, 120), owner_id: o.id, owner_name: str(o.name, 80), thread_id: t.id,
    status: "approved", decided_by: who(c), decided_at: nowIso(), send_status: "queued",
  }).select("id").single();
  if (ins.error || !ins.data) throw new HttpError(500, "Could not queue the reply");
  const r = await sendDraft(ins.data.id, { sendEnabled: true, mode: "approve", maxSendPerDay: 10000, minDaysBetween: 0, maxUnanswered: 1000, sendStart: 0, sendEnd: 24 }, who(c));
  if (r.sent && usedDraft) await admin.from("lara_drafts").update({ status: "expired", feedback: `Sent by ${who(c)} from Interactions`, decided_by: who(c), decided_at: nowIso(), updated_at: nowIso() }).eq("id", usedDraft).eq("lead_id", t.lead_id).eq("status", "shadow");
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
  const next = { enabled: b.enabled === true, callNumber: str(b.callNumber, 30).replace(/[^\d+ ]/g, ""), welcomeAr: str(b.welcomeAr, 400), welcomeEn: str(b.welcomeEn, 400),
    voice: b.voice !== false, record: b.record !== false, provider: b.provider === "gemini-live" ? "gemini-live" : "browser", liveModel: str(b.liveModel, 80).replace(/[^a-z0-9.\-]/gi, ""), liveVoice: str(b.liveVoice, 40).replace(/[^a-z0-9 \-]/gi, "") };
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
// ---------------------------------------------------------------------------------------------
// voice calls with Lara (same chat page), recording, rating, insights
// ---------------------------------------------------------------------------------------------
/** the call ended: one row per call; the customer's recording (they agreed before the call) goes to private storage */
route("POST", "/chat/s/:key/call", async ({ req, params }) => {
  await rateLimit(`chatcall:${params.key}`, 3600, 12);
  const t = await threadByKey(params.key);
  if (!(await chatOpen(t))) throw new HttpError(403, "Chat is not open yet");
  const b = await body(req, 6_500_000);
  const seconds = Math.max(0, Math.min(3600, Math.round(Number(b.seconds) || 0)));
  const started = new Date(Date.now() - seconds * 1000).toISOString();
  const cc = await chatCfg();
  let path: string | null = null; let bytes = 0;
  if (cc.record && b.consent === true && typeof b.audio === "string" && b.audio.length > 200 && b.audio.length < 6_000_000) {
    const bin = Uint8Array.from(atob(b.audio), (ch) => ch.charCodeAt(0));
    const ext = /mp4|aac/.test(String(b.mime)) ? "m4a" : "webm";
    path = `${t.id}/${Date.now()}.${ext}`; bytes = bin.length;
    const up = await admin.storage.from("lara-calls").upload(path, bin, { contentType: ext === "m4a" ? "audio/mp4" : "audio/webm", upsert: false });
    if (up.error) { path = null; bytes = 0; }
  }
  const ins = await admin.from("lara_calls").insert({ thread_id: t.id, lead_id: t.lead_id, started_at: started, seconds, lang: str(b.lang, 5) || "ar", turns: Math.min(500, Number(b.turns) || 0), audio_path: path, audio_bytes: bytes }).select("id").single();
  const o = t.visitor ? { id: null, customer: String(t.visitor?.name || "Website visitor") } : await ownerOf(t.lead_id);
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  if (!t.visitor) await appendTimeline(t.lead_id, { type: "Call", title: `Customer had a voice call with Lara (${mmss})`, description: path ? "Recording and transcript are in Lara › Interactions" : "Transcript is in Lara › Interactions" }).catch(() => {});
  const to = await staffTo(o.id);
  if (to.length) await addNotifications(to.map((userId) => ({ userId, type: "changed", leadId: t.visitor ? undefined : t.lead_id, title: `${o.customer} spoke with Lara (${mmss})`, body: "Listen to the call and read the transcript in Lara › Interactions." }))).catch(() => {});
  return { success: true, id: ins.data?.id || null, recorded: !!path };
}, { public: true });

route("POST", "/chat/s/:key/rate", async ({ req, params }) => {
  await rateLimit(`chatrate:${params.key}`, 3600, 10);
  const t = await threadByKey(params.key);
  const b = await body(req, 2000);
  const stars = Math.round(Number(b.stars));
  if (!(stars >= 1 && stars <= 5)) throw bad("stars?");
  await admin.from("lara_threads").update({ rating: stars, rating_note: str(b.comment, 400) || null, rating_at: nowIso() }).eq("id", t.id);
  await log("mail", "Customer", `Rated Lara ${stars}/5 (${t.code})${b.comment ? `: ${str(b.comment, 120)}` : ""}`);
  if (stars <= 2) { const o = t.visitor ? { id: null, customer: "A website visitor" } : await ownerOf(t.lead_id); const to = await staffTo(o.id); if (to.length) await addNotifications(to.map((userId) => ({ userId, type: "escalation", leadId: t.visitor ? undefined : t.lead_id, title: `${o.customer} rated Lara ${stars}/5`, body: str(b.comment, 300) || "No comment. Read the conversation in Lara › Interactions." }))).catch(() => {}); }
  return { success: true };
}, { public: true });

/** staff: a 10-minute link to one call's recording (same visibility as the conversation) */
route("GET", "/lara/calls/:id/audio", async ({ c, params }) => {
  const w = laraWho(c);
  const { data: k } = await admin.from("lara_calls").select("audio_path,lead_id,thread_id").eq("id", params.id).maybeSingle();
  if (!k?.audio_path) throw new HttpError(404, "This call has no recording");
  if (!w.admin) await ownsLead(c, k.lead_id);
  const s = await admin.storage.from("lara-calls").createSignedUrl(k.audio_path, 600);
  if (s.error || !s.data?.signedUrl) throw new HttpError(500, "Could not open the recording");
  return { success: true, url: s.data.signedUrl };
});

/** how Lara is doing (last N days): one small query for the Control room */
route("GET", "/lara/insights", async ({ c, query }) => {
  needAdmin(c);
  const days = Math.min(90, Math.max(1, Number(query.get("days")) || 30));
  return await pg(async (q) => {
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const [m] = await q`select count(*) filter (where direction = 'in')::int as customer_msgs,
        count(distinct thread_id) filter (where direction = 'in')::int as customers,
        count(*) filter (where direction = 'out' and author = 'Lara')::int as lara_replies,
        count(*) filter (where direction = 'out' and matched_by = 'landbank')::int as by_landbank,
        count(*) filter (where direction = 'out' and matched_by = 'qa')::int as by_qa,
        count(*) filter (where direction = 'out' and matched_by = 'ai')::int as by_ai,
        count(*) filter (where direction = 'out' and matched_by = 'holding')::int as by_holding,
        count(*) filter (where direction = 'out' and kind = 'staff')::int as by_staff,
        count(*) filter (where direction = 'in' and coalesce(channel,'email') = 'email')::int as in_email,
        count(*) filter (where direction = 'in' and channel = 'whatsapp')::int as in_whatsapp,
        count(*) filter (where direction = 'in' and channel = 'web')::int as in_chat,
        count(*) filter (where direction = 'in' and channel = 'call')::int as in_call
      from lara_messages where at >= ${since} and kind in ('mail','chat','staff')`;
    const [k] = await q`select count(*)::int as calls, coalesce(sum(seconds),0)::int as call_seconds, count(*) filter (where audio_path is not null)::int as recorded from lara_calls where started_at >= ${since}`;
    const [r] = await q`select count(*) filter (where rating is not null)::int as ratings, round(avg(rating)::numeric, 1) as avg_rating, count(*) filter (where status = 'handover')::int as with_salesperson, count(*) filter (where status = 'stopped')::int as stopped from lara_threads where updated_at >= ${since}`;
    const parks = await q`select p as park, count(*)::int as n from lara_threads t, jsonb_array_elements_text(case when jsonb_typeof(t.memory->'parks') = 'array' then t.memory->'parks' else '[]'::jsonb end) p where t.updated_at >= ${since} group by 1 order by 2 desc limit 5`;
    const missed = await q`select left(question, 90) as question, asked from lara_missed where status = 'open' order by asked desc, updated_at desc limit 5`;
    return { success: true, days, ...m, ...k, ...r, parks, missed };
  }, async () => { throw new HttpError(503, "Try again in a moment"); });
});
export type { Caller };
