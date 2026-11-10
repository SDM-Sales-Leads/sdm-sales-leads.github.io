// deno-lint-ignore-file no-explicit-any
// Lara's AI, ONLY for hard questions (owner, 11 Nov 2026: "only ai start if customer asked a hard question ... the best cost efficient system").
// Order of answering is always: rules -> Land Bank data -> approved Q&A -> (only then) AI. OFF by default; a daily cap; the AI may use only the
// facts we hand it (approved answers + park availability) and must say NO_ANSWER otherwise. Every AI answer is logged and the question still
// goes to Missed questions, so the admin approves an answer and the same question never costs AI again.
import { admin, getConfig, getSecret, hasSecret, nowIso, setConfig, setSecret, str } from "./lib.ts";
import { KbEntry, matchQuestion } from "./lara_match.ts";

export interface AiCfg { enabled: boolean; model: string; dailyCap: number }
export async function aiCfg(): Promise<AiCfg & { hasKey: boolean; usedToday: number }> {
  const c = await getConfig<any>("lara_ai", {});
  const u = await getConfig<any>("lara_ai_usage", {});
  return {
    enabled: c.enabled === true, model: /^[a-z0-9.\-]{3,60}$/i.test(c.model || "") ? c.model : "gemini-2.5-flash",
    dailyCap: Math.min(500, Math.max(0, Number(c.dailyCap ?? 20))), hasKey: await hasSecret("lara_ai_key"),
    usedToday: u.day === day() ? Number(u.n) || 0 : 0,
  };
}
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
export async function saveAi(b: any, by: string) {
  const cur = await getConfig<any>("lara_ai", {});
  const next = { ...cur, enabled: b.enabled === true, model: /^[a-z0-9.\-]{3,60}$/i.test(b.model || "") ? b.model : cur.model || "gemini-2.5-flash", dailyCap: Math.min(500, Math.max(0, Number(b.dailyCap ?? cur.dailyCap ?? 20))) };
  if (typeof b.key === "string" && b.key.trim()) await setSecret("lara_ai_key", b.key.trim());
  await setConfig("lara_ai", next);
  await admin.from("lara_log").insert({ kind: "config", actor: by, text: `AI for hard questions ${next.enabled ? `ON (cap ${next.dailyCap}/day, ${next.model})` : "OFF"}` });
  return aiCfg();
}

/** try the AI for a question the rules and the approved Q&A could not answer. Returns null when off, over the cap, or no grounded answer. */
export async function aiAnswer(question: string, kb: KbEntry[], extraFacts: string[], customer: { lang: "ar" | "en"; firstName?: string }): Promise<string | null> {
  const c = await aiCfg();
  if (!c.enabled || !c.hasKey || c.usedToday >= c.dailyCap) return null;
  const key = await getSecret("lara_ai_key"); if (!key) return null;
  const near = matchQuestion(question, kb, 6).filter((m) => m.score > 0.12);
  const facts = [...near.map((m) => `Q: ${m.entry.q_en || m.entry.q_ar}\nA: ${customer.lang === "ar" ? m.entry.a_ar || m.entry.a_en : m.entry.a_en || m.entry.a_ar}`), ...extraFacts].filter(Boolean).slice(0, 10);
  if (!facts.length) return null;                                          // nothing to ground on: no AI call, no cost
  await setConfig("lara_ai_usage", { day: day(), n: c.usedToday + 1 });    // count before the call (a failed call still counts: the cap is a hard ceiling)
  const sys = `You are Lara, the digital sales assistant of Elsewedy Industrial Development (SDM), industrial land in Egyptian industrial parks.
Answer the customer's question using ONLY the FACTS below. If the facts do not answer it, reply exactly NO_ANSWER.
Never invent prices, dates, areas, discounts or promises. Never say you are human. Be short (max 4 sentences), polite and professional.
Reply in ${customer.lang === "ar" ? "Egyptian-friendly Modern Standard Arabic" : "English"}.`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${c.model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: "user", parts: [{ text: `FACTS:\n${facts.join("\n\n")}\n\nCUSTOMER QUESTION:\n${str(question, 600)}` }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 300 } }),
    });
    const j = await r.json().catch(() => ({}));
    const text = String(j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "").trim();
    const ok = r.ok && text && !/NO_ANSWER/.test(text);
    await admin.from("lara_log").insert({ kind: "ai", actor: "Lara AI", text: `${ok ? "AI answered" : "AI had no answer"}: "${question.slice(0, 120)}"`, data: { q: question.slice(0, 600), a: ok ? text.slice(0, 1500) : null, model: c.model, status: r.status, at: nowIso() } });
    return ok ? text.slice(0, 1500) : null;
  } catch (e: any) {
    await admin.from("lara_log").insert({ kind: "ai", actor: "Lara AI", text: `AI call failed: ${String(e?.message || e).slice(0, 150)}` });
    return null;
  }
}
