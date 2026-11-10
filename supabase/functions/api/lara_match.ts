// Lara's question matcher: NO AI. Used by the server (customer questions) and the screens (Ask Lara test box).
// A question is normalised (Arabic letter variants, diacritics, Egyptian spellings), cut into words, and every word is mapped to a
// "concept" (price, payment, utilities, size ...). A Q&A entry matches when its concepts and words overlap the question's.
// Below the threshold Lara does not guess: the question goes to "Missed questions" for a person to answer once.

export interface KbEntry { id: string; topic: string; q_ar: string; q_en: string; phrasings: string; a_ar: string; a_en: string; status?: string }
export interface Match { entry: KbEntry; score: number; concepts: string[] }

export function normText(t: string): string {
  return String(t || "").toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")                 // diacritics, tatweel
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
}

// words that carry no meaning for matching (Arabic + English, Egyptian forms included)
const STOP = new Set(("the a an is are am be do does did can could would will shall i you we they he she it me my your our of in on at to for from with and or " +
  "what how when where which who why there this that these those any some please hi hello dear sir " +
  "هل في فيه فى من عن علي على الى الي انا انت حضرتك احنا ده دي دا هو هي ايه إيه اي اية ازاي إزاي امتى إمتى فين كام ممكن ينفع عايز عاوز محتاج لو بس و او يا " +
  "عندكم عندك عندي بتاع بتاعه بتاعت المشروع لكم ليكم الموقع").split(/\s+/).map(normText));

// concept groups: any of these words means the concept (normalised spellings)
const CONCEPTS: Record<string, string[]> = {
  price: ["سعر", "اسعار", "السعر", "الاسعار", "المتر", "متر", "تكلفه", "التكلفه", "تمن", "بكام", "price", "prices", "cost", "sqm", "meter", "per"],
  payment: ["قسط", "اقسط", "يقسط", "تقسط", "قسطين", "تقسيط", "التقسيط", "اقساط", "قسط", "سداد", "السداد", "دفع", "الدفع", "انظمه", "نظام", "payment", "installment", "instalment", "installments", "instalments", "plan", "plans"],
  downpayment: ["مقدم", "المقدم", "دفعه", "اول", "down", "deposit", "advance"],
  duration: ["مده", "سنين", "سنه", "سنوات", "years", "duration", "period", "long"],
  utilities: ["واصله", "متوصل", "توصيل", "كهربا", "كهرباء", "الكهربا", "مياه", "ميه", "صرف", "غاز", "مرافق", "المرافق", "طاقه", "قدره", "ميجا", "كيلو", "electricity", "power", "water", "gas", "sewage", "utilities", "mw", "kva"],
  handover: ["استلام", "الاستلام", "تسليم", "التسليم", "امتي", "handover", "delivery", "receive", "possession"],
  documents: ["اوراق", "الاوراق", "مستندات", "ورق", "documents", "papers", "requirements"],
  reservation: ["حجزت", "حاجز", "حجز", "الحجز", "احجز", "reserve", "reservation", "booking", "book"],
  refund: ["لغيت", "لغي", "رجع", "ترجع", "بترجع", "فلوس", "فلوسي", "يترد", "استرداد", "ترجع", "الغي", "الغاء", "refund", "cancel", "refundable"],
  size: ["مساحه", "المساحه", "مساحات", "اقل", "اصغر", "اكبر", "size", "area", "minimum", "smallest", "sqm"],
  merge: ["اجمع", "دمج", "جنب", "قطعتين", "merge", "combine", "adjacent"],
  building: ["بناء", "البناء", "ارتفاع", "الارتفاع", "نسبه", "ادوار", "building", "height", "ratio", "floors", "coverage"],
  license: ["ترخيص", "تراخيص", "رخصه", "الرخصه", "التراخيص", "هيئه", "التنميه", "license", "licence", "licenses", "permit", "permits", "ida"],
  incentives: ["ضرايب", "ضريبه", "حوافز", "ذهبيه", "ضريبيه", "ضرائب", "اعفاء", "incentives", "golden", "tax", "exemption"],
  rent: ["ايجار", "الايجار", "اجار", "مخازن", "مخزن", "جاهزه", "جاهز", "rent", "lease", "rental", "warehouse", "ready", "built"],
  foreigners: ["اجانب", "الاجانب", "اجنبي", "foreign", "foreigners", "foreigner", "non"],
  activity: ["انشطه", "الانشطه", "نشاط", "صناعات", "مسموح", "المسموحه", "activities", "activity", "allowed", "industries", "zoning"],
  fees: ["صيانه", "الصيانه", "رسوم", "خدمات", "سنويه", "maintenance", "fees", "service", "charges", "annual"],
  location: ["مسافه", "المسافه", "ميناء", "طريق", "مطار", "قريب", "بعيد", "لوكيشن", "مكان", "distance", "port", "road", "airport", "location", "near", "far", "where"],
  workforce: ["عمال", "العمال", "عماله", "مواصلات", "سكن", "workers", "labour", "labor", "transport", "housing", "staff"],
  security: ["امن", "الامن", "حمايه", "حريق", "security", "fire", "safety", "guards"],
  contract: ["عقد", "العقد", "تسجيل", "التسجيل", "يتسجل", "contract", "registration", "register", "registered"],
  visit: ["زياره", "الزياره", "معاينه", "اشوف", "visit", "tour", "see"],
  discount: ["خصم", "الخصم", "تخفيض", "كاش", "discount", "cash", "reduction"],
  availability: ["متاح", "المتاح", "متاحه", "فاضي", "available", "availability", "free"],
};
const WORD_TO_CONCEPT = new Map<string, string>();
for (const [c, ws] of Object.entries(CONCEPTS)) for (const w of ws) WORD_TO_CONCEPT.set(normText(w), c);

// light Arabic stemming: Egyptian prefixes (و ف ب ل ال بال وال هي) and suffixes (ت ي ه ها ك كم نا وا ين ات)
const PRE = ["وبال", "بال", "وال", "فال", "لل", "ال", "و", "ف", "ب", "ل", "ه"];
const SUF = ["تها", "ها", "كم", "نا", "وا", "ين", "ات", "ت", "ي", "ه", "ك"];
function variants(w: string): string[] {
  const out = new Set<string>([w]);
  if (!/[\u0600-\u06FF]/.test(w)) { if (w.length > 4 && w.endsWith("s")) out.add(w.slice(0, -1)); return [...out]; }
  for (const p of PRE) if (w.startsWith(p) && w.length - p.length >= 3) out.add(w.slice(p.length));
  for (const v of [...out]) for (const x of SUF) if (v.endsWith(x) && v.length - x.length >= 3) out.add(v.slice(0, -x.length));
  return [...out];
}
const stem = (w: string) => { const v = variants(w); return v.reduce((a, b) => (b.length < a.length ? b : a), w); };

export function analyse(text: string): { words: Set<string>; concepts: Set<string> } {
  const words = new Set<string>(); const concepts = new Set<string>();
  for (const raw of normText(text).split(/\s+/)) {
    if (!raw || STOP.has(raw)) continue;
    const w = stem(raw);
    words.add(w);
    for (const v of variants(raw)) { const c = WORD_TO_CONCEPT.get(v) || WORD_TO_CONCEPT.get("ال" + v); if (c) { concepts.add(c); break; } }
  }
  return { words, concepts };
}

const cache = new Map<string, ReturnType<typeof analyse>>();
function entryProfile(e: KbEntry) {
  const k = `${e.id}|${e.q_ar}|${e.q_en}|${e.phrasings}`;
  let p = cache.get(k);
  if (!p) { p = analyse(`${e.q_ar}\n${e.q_en}\n${e.phrasings}`); cache.set(k, p); if (cache.size > 2000) cache.clear(); }
  return p;
}

/** best Q&A answers for a question, highest score first. score 0..1; THRESHOLD decides "answer" vs "missed" */
export const THRESHOLD = 0.5;
export function matchQuestion(question: string, kb: KbEntry[], limit = 3): Match[] {
  const q = analyse(question);
  if (!q.words.size && !q.concepts.size) return [];
  const out: Match[] = [];
  for (const e of kb) {
    if (e.status && e.status !== "active") continue;
    if (!e.a_ar.trim() && !e.a_en.trim()) continue;
    const p = entryProfile(e);
    let cHit = 0; for (const c of q.concepts) if (p.concepts.has(c)) cHit++;
    let wHit = 0; for (const w of q.words) if (p.words.has(w)) wHit++;
    const cScore = q.concepts.size ? cHit / q.concepts.size : 0;
    const cPrec = p.concepts.size ? cHit / p.concepts.size : 0;
    const wScore = q.words.size ? wHit / q.words.size : 0;
    // concepts weigh most; precision stops a broad entry from answering a narrow question
    const score = q.concepts.size ? 0.55 * cScore + 0.2 * cPrec + 0.25 * wScore : wScore;
    if (score > 0.15) out.push({ entry: e, score: Math.round(score * 100) / 100, concepts: [...q.concepts].filter((c) => p.concepts.has(c)) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
export const isArabic = (t: string) => /[؀-ۿ]/.test(t || "");
