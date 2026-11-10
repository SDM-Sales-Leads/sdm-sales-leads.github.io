// deno-lint-ignore-file no-explicit-any
// Lara's memory of ONE conversation (one lead), rules only, no AI (owner, 11 Nov 2026: "if same customer interacted again, the ai or the auto reply
// remembers his last interaction and what was the last step and it welcomes him ... but don't mix history of any customer").
// Identity is proven by the channel: the chat link from Lara's own e-mail (only that mailbox has it), the subject code of a mail, or the WhatsApp
// number Meta delivers from. A website visitor is never joined to a lead's history by a typed phone number.
import { admin, nowIso } from "./lib.ts";
import { canonicalParks } from "../../../src/lib/parkAliases.ts";
import { PARK_AR } from "../../../src/components/crm/smartWriter.ts";

export interface Memory {
  parks?: string[]; size?: number; asked?: string; askedAt?: string; answer?: string;
  offer?: { ref?: string; at: string }; handover?: string; channel?: string; visits?: number; lastIn?: string;
}
const num = (t: string) => {
  const n = (t.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).match(/\d[\d,]{2,}/g) || []).map((x) => Number(x.replace(/,/g, ""))).filter((x) => x >= 300 && x <= 2_000_000);
  return n[0];
};
const QUESTION = /[?؟]|\b(how|what|when|where|which|can|is there|price|cost)\b|ازاي|إزاي|ايه|إيه|امتى|إمتى|فين|كام|هل|ممكن|سعر|تكلفة|متاح/i;

/** what this message teaches about the customer (merged into the conversation's memory) */
export function learn(mem: Memory, text: string, channel: string): Memory {
  const m: Memory = { ...(mem || {}) };
  const parks = canonicalParks(text);
  if (parks.length) m.parks = parks.slice(0, 3);
  const size = num(text); if (size) m.size = size;
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length >= 8 && QUESTION.test(t)) { m.asked = t.slice(0, 140); m.askedAt = nowIso(); }
  m.channel = channel; m.lastIn = nowIso();
  return m;
}
export async function remember(threadId: string, mem: Memory, extra: Partial<Memory> = {}) {
  await admin.from("lara_threads").update({ memory: { ...mem, ...extra } }).eq("id", threadId).then(() => {}, () => {});
}
/** Arabic "N days ago" the Egyptian way */
const arAgo = (d: number) => (d === 0 ? "النهارده" : d === 1 ? "امبارح" : d === 2 ? "من يومين" : d <= 10 ? `من ${d} أيام` : `من ${d} يوم`);
const daysAgo = (iso?: string) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5)) : null);

/** a customer who comes back after `gapHours`: a welcome that recalls the last step of THIS conversation; null for a first contact */
export function welcomeBack(t: any, ar: boolean, names: { customer?: string; owner?: string }, gapHours = 6, askToContinue = true): string | null {
  const last = t?.last_in_at;
  if (!last || Date.now() - Date.parse(last) < gapHours * 3600e3) return null;
  const m: Memory = t.memory || {};
  const d = daysAgo(last);
  const when = d === null ? "" : ar ? arAgo(d) : (d === 0 ? "earlier today" : d === 1 ? "yesterday" : `${d} days ago`);
  const f = (n: number) => Math.round(n).toLocaleString("en-US");
  const parts: string[] = [];
  if (ar) {
    parts.push(`أهلاً بيك تاني${names.customer ? ` أ. ${names.customer}` : ""} 👋`);
    if (m.parks?.length) parts.push(`آخر مرة (${when}) كنا بنتكلم عن أراضي في ${m.parks.map((p) => PARK_AR[p] || p).join(" و")}${m.size ? ` بمساحة حوالي ${f(m.size)} م²` : ""}.`);
    else if (m.asked) parts.push(`آخر سؤال لحضرتك (${when}) كان: «${m.asked}».`);
    if (m.offer?.at) parts.push(`العرض المالي المبدئي اتبعت لحضرتك ${arAgo(daysAgo(m.offer.at) || 0)}.`);
    if (t.status === "handover" && names.owner) parts.push(`أ. ${names.owner} متابع مع حضرتك.`);
    if (askToContinue) parts.push("تحب نكمل من هنا؟");
  } else {
    parts.push(`Welcome back${names.customer ? `, ${names.customer}` : ""} 👋`);
    if (m.parks?.length) parts.push(`Last time (${when}) we talked about land in ${m.parks.join(" and ")}${m.size ? ` of about ${f(m.size)} sqm` : ""}.`);
    else if (m.asked) parts.push(`Your last question (${when}) was: "${m.asked}".`);
    if (m.offer?.at) parts.push(`Your initial financial offer was sent ${daysAgo(m.offer.at) === 0 ? "today" : daysAgo(m.offer.at) === 1 ? "yesterday" : `${daysAgo(m.offer.at)} days ago`}.`);
    if (t.status === "handover" && names.owner) parts.push(`${names.owner} is following up with you.`);
    if (askToContinue) parts.push("Shall we continue from there?");
  }
  return parts.join(" ");
}
