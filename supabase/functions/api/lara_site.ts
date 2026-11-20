// deno-lint-ignore-file no-explicit-any
// Lara — the company website (elsewedydevelopment.com) as a knowledge base.
// The site is stored as a tree (branch > page > heading > passage, table lara_site, loaded by scripts/site-kb). A question is never
// compared with the whole site: the database first FILTERS (language, park), then returns only the best few passages.
//  • Semantic search (0030, owner 19 Nov 2026 "Try free semantic search"): every passage has a meaning vector (Google
//    gemini-embedding-001, made once per site load); a question gets one vector and the closest passages in meaning win, so
//    "is there water and gas?" finds the utilities section even with other words. Needs the Google key saved in Lara > Settings
//    (the same safe as the AI key; "Use AI for hard questions" can stay OFF). Capped per day.
//  • Word search (0029, no key needed): shared topics / words / heading words, scored in the database. Used when there is no key.
// The best 1–2 sentences + the page link become a SUGGESTED answer on Missed questions. The team checks it and saves it; only then
// does Lara use it with customers. Facts the website does not hold (prices, plans, handover dates, fees) never come from here.
import { admin, getSecret, hasSecret, nowIso, rateLimit } from "./lib.ts";
import { analyse, isArabic } from "./lara_match.ts";
import { parksIn } from "./lara_memory.ts";

export interface SiteHit { id: number; text: string; url: string; path: string; page: string; ord: number; score: number; how: "meaning" | "words" }
/** topics the website never answers with real figures: leave them to the Land Bank / the team, never a vague website line */
const NOT_FROM_SITE = new Set(["price", "payment", "downpayment", "duration", "discount", "refund", "fees"]);
const MODEL = "gemini-embedding-001";
const DIM = 768;
/** how close in meaning a passage must be to be shown as a suggestion (0..1, checked on the 54 real missed questions) */
export const SIM_MIN = 0.72;

function sentences(body: string): string[] {
  return String(body || "").split(/(?<=[.!?؟؛])\s+|\s+(?=• )/).map((s) => s.trim()).filter((s) => s.length > 15);
}
/** the 1–2 sentences of a passage that match the question best, in page order (no shared word: the first two) */
function bestSentences(body: string, question: string, max = 420): string {
  const words = analyse(question).words;
  const ss = sentences(body);
  const scored = ss.map((s, i) => { let h = 0; for (const w of analyse(s).words) if (words.has(w)) h++; return { s, i, h }; });
  const top = scored.filter((x) => x.h > 0).sort((a, b) => b.h - a.h || a.i - b.i).slice(0, 2).sort((a, b) => a.i - b.i);
  let t = (top.length ? top : scored.slice(0, 2)).map((x) => x.s).join(" ");
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return t;
}
const parksOf = (q: string, parks?: string[]) => (parks && parks.length ? parks : parksIn(q)).map((p) => (/^Industria Asher/.test(p) ? "Industria Asher" : p));   // one Asher page on the site

// ---------------------------------------------------------------------------------------------
// meaning vectors (Google embeddings). The key never leaves the server.
// ---------------------------------------------------------------------------------------------
export async function semanticReady(): Promise<boolean> { return await hasSecret("lara_ai_key").catch(() => false); }
let lastStatus = 0;   // Google's last answer (429 = free per-minute limit: wait a minute and go on)
async function embed(texts: string[], task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY", titles?: string[]): Promise<number[][] | null> {
  const key = await getSecret("lara_ai_key"); if (!key || !texts.length) return null;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ requests: texts.map((t, i) => ({ model: `models/${MODEL}`, content: { parts: [{ text: t.slice(0, 6000) }] }, taskType: task, ...(titles?.[i] ? { title: titles[i].slice(0, 300) } : {}), outputDimensionality: DIM })) }),
  });
  lastStatus = r.status;
  if (!r.ok) { await admin.from("lara_log").insert({ kind: "ai", actor: "Website search", text: `Embedding call refused (${r.status})` }).then(() => {}, () => {}); return null; }
  const j = await r.json().catch(() => null);
  const out = (j?.embeddings || []).map((e: any) => (Array.isArray(e?.values) ? e.values.map(Number) : null));
  return out.length === texts.length && out.every((v: any) => Array.isArray(v) && v.length === DIM) ? out : null;
}
const vecLit = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;

/** give the next passages their meaning vector (called again and again by the admin button until none is left) */
/** 20 passages per call: the free tier allows about 80–100 a minute (20 Nov 2026: 3 calls of 40 within 6 s gave 429) */
export async function embedPending(max = 20): Promise<{ done: number; left: number; ok: boolean; wait: boolean }> {
  const { data } = await admin.from("lara_site").select("id,path,body").eq("active", true).is("embedding", null).order("id").limit(Math.min(100, Math.max(1, max)));
  const rows = (data || []) as any[];
  let done = 0, ok = true;
  if (rows.length) {
    const v = await embed(rows.map((r) => r.body), "RETRIEVAL_DOCUMENT", rows.map((r) => r.path));
    if (!v) ok = false;
    else for (let i = 0; i < rows.length; i += 10) {
      await Promise.all(rows.slice(i, i + 10).map((r, k) => admin.from("lara_site").update({ embedding: vecLit(v[i + k]), emb_at: nowIso() }).eq("id", r.id)));
      done += Math.min(10, rows.length - i);
    }
  }
  const { count } = await admin.from("lara_site").select("id", { count: "exact", head: true }).eq("active", true).is("embedding", null);
  return { done, left: count || 0, ok, wait: !ok && lastStatus === 429 };
}

// ---------------------------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------------------------
/** closest passages in meaning (one vector for the question). null = semantic search not available (no key / cap / error). */
async function meaningSearch(question: string, opts: { lang?: "ar" | "en" | null; parks?: string[]; limit?: number; vec?: number[] }): Promise<SiteHit[] | null> {
  let vec = opts.vec;
  if (!vec) {
    if (!(await semanticReady())) return null;
    try { await rateLimit("lara-site-query", 86400, 300); } catch { return null; }   // at most 300 question vectors a day
    vec = (await embed([question], "RETRIEVAL_QUERY"))?.[0];
    if (!vec) return null;
  }
  const { data, error } = await admin.rpc("lara_site_semantic", { p_vec: vecLit(vec), p_lang: opts.lang ?? null, p_parks: parksOf(question, opts.parks), p_limit: opts.limit || 3 });
  if (error || !Array.isArray(data)) return null;
  return data.map((r: any) => ({ id: Number(r.id), text: bestSentences(r.body, question), url: r.url, path: r.path, page: r.page, ord: r.ord, score: Number(r.sim) || 0, how: "meaning" as const }));
}
/** word search (no key needed): shared topics / words / heading words, scored in the database */
async function wordSearch(question: string, opts: { lang?: "ar" | "en"; parks?: string[]; limit?: number }): Promise<SiteHit[]> {
  const lang = opts.lang || (isArabic(question) ? "ar" : "en");
  const a = analyse(question);
  const words = [...a.words].filter((w) => w.length >= 2);
  const concepts = [...a.concepts];
  if (!words.length && !concepts.length) return [];
  const { data, error } = await admin.rpc("lara_site_search", { p_lang: lang, p_parks: parksOf(question, opts.parks), p_words: words, p_concepts: concepts, p_limit: opts.limit || 3 });
  if (error || !Array.isArray(data)) return [];
  // sure enough: heading or topic matches + at least 2 words of the question
  return data.filter((r: any) => (r.h >= 1 || (a.concepts.size > 0 && r.c >= 1)) && r.w >= 2 && Number(r.score) >= 6)
    .map((r: any) => ({ id: Number(r.id), text: bestSentences(r.body, question), url: r.url, path: r.path, page: r.page, ord: 0, score: Number(r.score) || 0, how: "words" as const }));
}

/** the same section of the same page on the other-language site */
async function twin(h: SiteHit, ar: boolean): Promise<{ body: string; url: string } | null> {
  const url = ar ? h.url.replace("elsewedydevelopment.com/ar/", "elsewedydevelopment.com/") : h.url.replace("elsewedydevelopment.com/", "elsewedydevelopment.com/ar/");
  const { data: me } = await admin.from("lara_site").select("ord").eq("id", h.id).maybeSingle();
  if (!me) return null;
  const { data } = await admin.from("lara_site").select("body").eq("active", true).eq("url", url).eq("ord", (me as any).ord).maybeSingle();
  return data ? { body: String((data as any).body), url } : null;
}

/** a suggested answer for a missed question (both languages), for the TEAM to check and approve. Never sent to a customer as it is. */
export async function siteSuggest(question: string, vec?: number[]): Promise<any | null> {
  const a = analyse(question);
  if ([...a.concepts].some((c) => NOT_FROM_SITE.has(c))) return null;
  const ar = isArabic(question);
  const sem = await meaningSearch(question, { lang: ar ? "ar" : "en", limit: 1, vec });
  const h = sem ? sem.find((x) => x.score >= SIM_MIN) : (await wordSearch(question, { lang: ar ? "ar" : "en", limit: 1 }))[0];
  if (!h) return null;
  const tw = await twin(h, ar);
  const other = tw ? bestSentences(tw.body, question) : "";
  return {
    a_ar: ar ? h.text : other, a_en: ar ? other : h.text,
    url_ar: ar ? h.url : tw?.url || "", url_en: ar ? tw?.url || "" : h.url,
    path: h.path, score: Math.round(h.score * 1000) / 1000, how: h.how, at: nowIso(),
  };
}

/** fill the website suggestion of open missed questions (one embedding call for all of them). Returns how many got one. */
export async function suggestOpenMissed(onlyEmpty = true): Promise<{ checked: number; suggested: number; how: string }> {
  let mq: any = admin.from("lara_missed").select("id,question").eq("status", "open").order("asked", { ascending: false }).limit(100);
  if (onlyEmpty) mq = mq.is("suggest", null);
  const { data } = await mq;
  const rows = (data || []) as any[];
  if (!rows.length) return { checked: 0, suggested: 0, how: "—" };
  const vecs = (await semanticReady()) ? await embed(rows.map((r) => r.question), "RETRIEVAL_QUERY") : null;
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const s = await siteSuggest(rows[i].question, vecs?.[i]).catch(() => null);
    await admin.from("lara_missed").update({ suggest: s || { none: true, at: nowIso() } }).eq("id", rows[i].id);
    if (s) n++;
  }
  return { checked: rows.length, suggested: n, how: vecs ? "meaning" : "words" };
}

/** numbers for the settings card */
export async function siteStats() {
  const [all, emb, last] = await Promise.all([
    admin.from("lara_site").select("id", { count: "exact", head: true }).eq("active", true),
    admin.from("lara_site").select("id", { count: "exact", head: true }).eq("active", true).not("embedding", "is", null),
    admin.from("lara_site").select("batch,created_at").eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { passages: all.count || 0, withMeaning: emb.count || 0, loadedAt: (last.data as any)?.created_at || null, keySaved: await semanticReady() };
}
