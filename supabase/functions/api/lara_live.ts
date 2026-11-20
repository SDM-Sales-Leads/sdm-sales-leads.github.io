// deno-lint-ignore-file no-explicit-any
// Lara video calls with Gemini Live (owner, 20 Nov 2026: "real AI agent ... very cost efficient"). Plan: docs/LARA-AVATAR-PLAN.md.
//  • The Google key never reaches the browser: this server makes a ONE-USE, short-lived token whose session settings are LOCKED
//    (model, voice, Lara's instructions, her tools). The browser cannot change what Lara is told or what she may do.
//  • Lara answers only through her tools, all on this server: find_plot (Land Bank plot + initial offer), ask_knowledge (approved
//    Q&A; unknown = Missed questions), request_call (account manager), end_call. She never invents prices or dates.
//  • Cost guards: daily minute cap (atomic, 0031), max call length (token expires with it), one call at a time per conversation,
//    rate limits per link and per IP. Same hold rules as the chat: while Lara is on hold only staff test conversations can call.
import { admin, bad, body, getConfig, getSecret, HttpError, nowIso, rateLimit, str } from "./lib.ts";
import { route } from "./router.ts";
import { pg } from "./db.ts";
import { firstNameOf } from "../../../src/lib/personName.ts";
import { availabilityAnswer, laraAnswer, log } from "./routes_lara.ts";
import { appendTimeline, isOptedOut, ownerOf } from "./lara_mail.ts";
import { addNotifications } from "./notify.ts";
import { chatCfg, chatOpen, ipOf, keyShape, leadInfo, staffTo, threadByKey } from "./lara_chat.ts";
import { canonicalParks } from "../../../src/lib/parkAliases.ts";

const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
async function take(sec: number, capSec: number): Promise<boolean> {
  return await pg(async (q) => (await q`select lara_live_take(${day()}, ${sec}, ${capSec}) as v`)[0]?.v === true,
    async () => (await admin.rpc("lara_live_take", { p_day: day(), p_sec: sec, p_cap_sec: capSec })).data === true).catch(() => false);   // any doubt: no call
}
async function give(sec: number) {
  await pg(async (q) => { await q`select lara_live_give(${day()}, ${sec})`; }, async () => { await admin.rpc("lara_live_give", { p_day: day(), p_sec: sec }); }).catch(() => {});
}

const TOOLS = [{ functionDeclarations: [
  { name: "find_plot", description: "Find ONE available industrial plot that matches the customer, with its location and initial offer (price per sqm, cash total, instalment plan) from the live Land Bank. Use for ANY question about available land, plots, sizes or prices.",
    parameters: { type: "OBJECT", properties: { park: { type: "STRING", description: "park or city the customer named (e.g. October, Sadat, Borg El Arab, Sokhna, 10th of Ramadan); empty if not said" }, size_sqm: { type: "NUMBER", description: "size in square metres if the customer said one" }, activity: { type: "STRING", description: "the customer's industry if said (food, chemical, textile, engineering, warehouses ...)" } } } },
  { name: "ask_knowledge", description: "Get SDM's approved answer to any other question (payment terms, documents, licences, utilities, handover, visits ...). Returns NO_ANSWER when there is none.",
    parameters: { type: "OBJECT", properties: { question: { type: "STRING", description: "the customer's question in their own words" } }, required: ["question"] } },
  { name: "request_call", description: "The customer wants a human / a call / a meeting / a site visit: tell the account manager.",
    parameters: { type: "OBJECT", properties: { preferred_time: { type: "STRING" }, note: { type: "STRING" } } } },
  { name: "end_call", description: "End the call after saying goodbye (the customer said bye / stop / not interested).", parameters: { type: "OBJECT", properties: {} } },
] }];

function instructions(o: { ar: boolean; customer: string; owner: string; project: string; size: string }) {
  return `You are Lara, the digital sales assistant of Elsewedy Industrial Development (SDM), which sells industrial land in Egyptian industrial parks. You are an AI assistant, not a human; if asked, say so kindly.
You are on a live video call with ${o.customer ? `the customer ${o.customer}` : "a customer"}.${o.owner ? ` Their account manager is ${o.owner}.` : ""}${o.project ? ` They showed interest in ${o.project}${o.size ? `, about ${o.size} sqm` : ""}.` : ""}
Speak ${o.ar ? "warm, natural Egyptian Arabic (polite: حضرتك)" : "clear, friendly English"}; if the customer switches language, follow them (Arabic or English).
Rules:
- Short turns: 1 to 3 sentences, then let the customer speak. One question at a time.
- For ANY question about available land, plots, sizes, locations or prices: call find_plot, then say the result naturally. Never give stock reports or plot counts.
- For any other question: call ask_knowledge. If it returns NO_ANSWER, say you will pass the question to ${o.owner || "the account manager"}, who will answer soon.
- NEVER invent prices, dates, sizes, discounts, payment terms or promises. Only say facts that a tool returned. Prices are initial and confirmed in the official offer.
- If the customer wants a person, a call, a meeting or a site visit: call request_call and confirm.
- When the customer says goodbye or stop: say a short polite goodbye, then call end_call.
- Never ask for passwords, card numbers or ID numbers.
Start: greet the customer${o.customer ? ` by name (${o.customer})` : ""} in one short sentence and ask how you can help.`;
}

/** start a video call: checks, reserve minutes, locked one-use token */
route("POST", "/chat/s/:key/live/start", async ({ req, params }) => {
  keyShape(params.key);
  await rateLimit(`livestart:${ipOf(req)}`, 3600, 10);
  await rateLimit(`livestartk:${params.key}`, 3600, 6);
  const t = await threadByKey(params.key);
  if (!(await chatOpen(t))) throw new HttpError(403, "Calls are not open yet");
  if (t.status === "stopped" || (t.customer_email && (await isOptedOut([t.customer_email])))) throw new HttpError(403, "This conversation was stopped at your request");
  const cc = await chatCfg();
  if (cc.provider !== "gemini-live") throw new HttpError(409, "Video call is not switched on");
  const key = await getSecret("lara_ai_key");
  if (!key) throw new HttpError(409, "Video call is not set up");
  const b = await body(req, 1000);
  const ar = str(b.lang, 5) !== "en";
  // one call at a time per conversation (a second tab cannot double the minutes)
  const mem = t.memory || {};
  if (mem.liveUntil && Date.parse(mem.liveUntil) > Date.now()) throw new HttpError(409, "A call is already running in another window");
  if (!(await take(cc.liveMaxSec, cc.liveDailyMin * 60))) throw new HttpError(429, "Video calls are busy right now. Please chat by text or call us.");
  const lead = t.visitor ? null : await leadInfo(t.lead_id);
  const o = t.visitor ? { name: "", customer: String(t.visitor?.name || "") } : await ownerOf(t.lead_id);
  const now = Date.now();
  const setup = {
    model: `models/${cc.liveModel}`,
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cc.liveVoice } } } },
    systemInstruction: { parts: [{ text: instructions({ ar, customer: firstNameOf(String(lead?.customerName || t.visitor?.name || "")), owner: firstNameOf(o.name || ""), project: canonicalParks(String(lead?.project || ""))[0] || "", size: String(lead?.requiredSize || "") }) }] },
    tools: TOOLS, inputAudioTranscription: {}, outputAudioTranscription: {},
    realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 700 } },
  };
  const r = await fetch("https://generativelanguage.googleapis.com/v1alpha/auth_tokens", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ uses: 1, expireTime: new Date(now + (cc.liveMaxSec + 30) * 1000).toISOString(), newSessionExpireTime: new Date(now + 60_000).toISOString(), bidiGenerateContentSetup: setup }),
  }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok || !j.name) { await give(cc.liveMaxSec); await log("ai", "Lara call", `Video call token refused (${r?.status ?? "no answer"})`); throw new HttpError(502, "Video call could not start. Please chat by text."); }
  const until = new Date(now + (cc.liveMaxSec + 30) * 1000).toISOString();
  await admin.from("lara_threads").update({ memory: { ...mem, liveUntil: until, liveStart: new Date(now).toISOString() }, updated_at: nowIso() }).eq("id", t.id);
  return { success: true, token: j.name, model: cc.liveModel, maxSec: cc.liveMaxSec, ws: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained" };
}, { public: true });

/** Lara's tools: the only way she gets facts (no AI here: Land Bank list, approved answers, notifications) */
route("POST", "/chat/s/:key/live/tool", async ({ req, params }) => {
  keyShape(params.key);
  await rateLimit(`livetool:${params.key}`, 3600, 80);
  const t = await threadByKey(params.key);
  if (!(await chatOpen(t))) throw new HttpError(403, "Calls are not open yet");
  if (!(t.memory?.liveUntil && Date.parse(t.memory.liveUntil) > Date.now())) throw new HttpError(409, "No call is running");
  const b = await body(req, 4000);
  const name = str(b.name, 40); const a = b.args && typeof b.args === "object" ? b.args : {};
  const ar = str(b.lang, 5) !== "en";
  const lead = t.visitor ? null : await leadInfo(t.lead_id);
  if (name === "find_plot") {
    const size = Number(a.size_sqm) > 0 ? Math.round(Number(a.size_sqm)) : 0;
    let park = str(a.park, 80);
    if (!park && lead?.project) park = canonicalParks(String(lead.project))[0] || "";
    if (!park) return { success: true, result: "NO_PARK: ask which park or city the customer prefers (October, Sadat, Borg El Arab, Sokhna, 10th of Ramadan)." };
    const d = await availabilityAnswer(`${park} ارض ${size ? `${size} متر` : ""}`, { size: size || lead?.requiredSize, industry: str(a.activity, 60) || String(lead?.industry || "") }).catch(() => null);
    return { success: true, result: d ? (ar ? d.ar : d.en) : "NO_PLOT_DATA: say you will ask the account manager to send the available plots in that park." };
  }
  if (name === "ask_knowledge") {
    const q = str(a.question, 600);
    if (q.length < 3) return { success: true, result: "NO_ANSWER" };
    const r = await laraAnswer(q, { record: true, source: "customer", leadId: t.visitor ? undefined : t.lead_id, by: "Video call" });
    const best = r.matches[0];
    if (r.data) return { success: true, result: ar ? r.data.ar : r.data.en };
    if (r.answered && best) return { success: true, result: (ar ? best.a_ar || best.a_en : best.a_en || best.a_ar) || "NO_ANSWER" };
    return { success: true, result: "NO_ANSWER" };
  }
  if (name === "request_call") {
    const o = t.visitor ? { id: null, customer: String(t.visitor?.name || "Website visitor"), name: "" } : await ownerOf(t.lead_id);
    const when = str(a.preferred_time, 80); const note = str(a.note, 300);
    await admin.from("lara_threads").update({ status: "handover", note: `Customer asked for a call (video call)${when ? `: ${when}` : ""}`, updated_at: nowIso() }).eq("id", t.id);
    const to = await staffTo(o.id);
    if (to.length) await addNotifications(to.map((userId) => ({ userId, type: "escalation", leadId: t.visitor ? undefined : t.lead_id, title: `${o.customer} wants a call — from the video call with Lara`, body: [when && `Time: ${when}`, note].filter(Boolean).join(" · ") || "Call them in working hours." }))).catch(() => {});
    if (!t.visitor) await appendTimeline(t.lead_id, { type: "Comment", title: "Customer asked for a call (video call with Lara)", description: [when, note].filter(Boolean).join(" · ") }).catch(() => {});
    return { success: true, result: `OK: ${firstNameOf(o.name || "") || "the account manager"} was told and will call${when ? ` (${when})` : " in working hours (Sunday–Thursday)"}.` };
  }
  if (name === "end_call") return { success: true, result: "OK" };
  throw bad("Unknown tool");
}, { public: true });

/** one line of the live transcript (what the customer said / what Lara said), saved to the conversation like chat messages */
route("POST", "/chat/s/:key/live/say", async ({ req, params }) => {
  keyShape(params.key);
  await rateLimit(`livesay:${params.key}`, 3600, 300);
  const t = await threadByKey(params.key);
  if (!(t.memory?.liveUntil && Date.parse(t.memory.liveUntil) > Date.now() - 120_000)) throw new HttpError(409, "No call is running");
  const b = await body(req, 4000);
  const text = str(b.text, 1500).trim();
  if (!text) return { success: true };
  const out = b.dir === "out";
  const at = nowIso();
  await admin.from("lara_messages").insert({ thread_id: t.id, lead_id: t.lead_id, direction: out ? "out" : "in", kind: "chat", channel: "call", matched_by: "live",
    author: out ? "Lara" : null, body: text, from_addr: out ? "Lara" : "video call", to_addr: out ? "video call" : "Lara", at });
  await admin.from("lara_threads").update(out ? { last_out_at: at, updated_at: at } : { last_in_at: at, unanswered: 0, updated_at: at }).eq("id", t.id);
  return { success: true };
}, { public: true });

/** the call ended: give back the minutes it did not use, free the conversation for the next call */
route("POST", "/chat/s/:key/live/end", async ({ req, params }) => {
  keyShape(params.key);
  await rateLimit(`liveend:${params.key}`, 3600, 20);
  const t = await threadByKey(params.key);
  const mem = t.memory || {};
  if (!mem.liveStart) return { success: true };
  const cc = await chatCfg();
  const used = Math.max(0, Math.min(cc.liveMaxSec, Math.round((Date.now() - Date.parse(mem.liveStart)) / 1000)));   // the server's own clock, not the browser's
  if (mem.liveUntil && Date.parse(mem.liveUntil) > Date.now()) await give(Math.max(0, cc.liveMaxSec - used));
  await admin.from("lara_threads").update({ memory: { ...mem, liveUntil: null, liveStart: null, liveSec: (Number(mem.liveSec) || 0) + used }, updated_at: nowIso() }).eq("id", t.id);
  await log("ai", "Lara call", `Video call ${t.code || t.id}: ${used} s`);
  return { success: true, seconds: used };
}, { public: true });

/** settings card: today's minutes */
export async function liveUsage() {
  const u = await getConfig<any>("lara_live_usage", {});
  return { day: day(), usedSec: u.day === day() ? Number(u.sec) || 0 : 0 };
}
