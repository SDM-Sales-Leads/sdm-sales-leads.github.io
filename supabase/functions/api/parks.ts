// One alias table for the Land Bank parks: Arabic and English spellings -> the canonical park name used by the Land Bank.
// Used by mail ingestion, the Facebook sheet, imports and the project clean-up (server) and by the screens (client imports this same file).
// Matching is by whole phrase inside the text, longest alias first, after normalising (case, accents, alef/yaa/taa-marbuta,
// punctuation). An unmatched text returns "" so callers keep what the customer wrote.

export const PARKS = [
  "Industria Borg El Arab", "Industria East", "Industria New Sadat", "Industria October", "Industria Sadat", "Industria Sokhna", "Industria West",
  "Industria Asher", "Asher D75", "Al Oula", "Sokhna 360",
  "New Damietta", "El Minya", "Qantara", "Ras El Hekma", "Safaga", "Abu Rawash",
  "Egyptian Industrial City (EIC)", "Industria Alamein", "Industria Iraq", "Elsewedy Industrial City (Tanzania)",
] as const;

export const PARK_ALIASES: Record<string, string[]> = {
  "Industria Borg El Arab": ["borg el arab", "borg alarab", "borg al arab", "burg el arab", "burj el arab", "burj al arab", "burj arab", "borg elarab", "new borg el arab", "برج العرب", "برج عرب", "بورج العرب", "بورج العرب", "برج العربي"],
  "Industria East": ["industria east", "east industria", "10th of ramadan east", "tenth of ramadan east", "10th ramadan east", "العاشر من رمضان شرق", "العاشر شرق", "اندستريا ايست", "اندستريا الشرق", "انداستريا ايست", "الشرق"],
  "Industria New Sadat": ["new sadat", "new el sadat", "new sadat city", "السادات الجديده", "السادات الجديد", "نيو السادات", "نيو سادات"],
  "Industria Sadat": ["industria sadat", "sadat city", "el sadat", "al sadat", "sadat", "مدينه السادات", "السادات", "سادات"],
  "Industria October": ["industria october", "6th of october", "6 october", "6th october", "sixth of october", "october", "اكتوبر", "السادس من اكتوبر", "6 اكتوبر", "٦ اكتوبر"],
  "Industria Sokhna": ["industria sokhna", "ain sokhna", "ain el sokhna", "el sokhna", "sokhna", "السخنه", "العين السخنه", "عين السخنه", "سخنه"],
  "Industria West": ["industria west", "west industria", "اندستريا ويست", "انداستريا ويست", "اندستريا الغرب", "ويست", "الغرب"],
  // 2 Nov 2026 (owner): ONE "Industria Asher" for now; later split into "Industria Asher Plot 10" / "Industria Asher Plot 11" (names of the Land Bank portfolio).
  "Industria Asher": ["industria asher", "asher", "inustria asher", "10th of ramadan", "tenth of ramadan", "العاشر من رمضان", "عاشر", "العاشر", "اندستريا عاشر", "اندستريا العاشر", "asher plot 10", "asher p10", "asher 10", "plot 10", "p10", "عاشر قطعه 10", "العاشر قطعه 10", "قطعه 10", "10th of ramadan plot 10", "asher plot 11", "asher p11", "asher 11", "plot 11", "p11", "عاشر قطعه 11", "العاشر قطعه 11", "قطعه 11", "القطعه رقم 11", "القطعه رقم 10", "10th of ramadan plot 11"],
  "Asher D75": ["asher d75", "d75", "d 75", "d-75", "asher d 75"],
  "New Damietta": ["new damietta", "industria new damietta", "industria damietta", "damietta", "دمياط الجديده", "دمياط"],
  "El Minya": ["el minya", "minya", "el minya green park", "المنيا"],
  "Qantara": ["qantara", "el qantara", "القنطره"],
  "Ras El Hekma": ["ras el hekma", "ras al hekma", "industria ras al hekma", "رأس الحكمه", "راس الحكمه"],
  "Safaga": ["safaga", "industria safaga", "سفاجا"],
  "Abu Rawash": ["abu rawash", "abou rawash", "abu rawwash", "ابو رواش", "ابو رواس"],
  "Egyptian Industrial City (EIC)": ["egyptian industrial city", "eic"],
  "Industria Alamein": ["industria alamein", "new alamein", "industria new alamein", "alamein", "العلمين"],
  "Industria Iraq": ["industria iraq", "iraq", "العراق"],
  "Elsewedy Industrial City (Tanzania)": ["elsewedy industrial city tanzania", "elsewedy industrial city", "tanzania", "تنزانيا"],
  "Al Oula": ["al oula", "aloula", "el oula", "al ola", "el ola", "oula", "الاولي", "الاوله", "الأولى", "الاولى"],
  "Sokhna 360": ["sokhna 360", "sokhna360", "sid 360", "sid360", "sokhna three sixty", "سخنه 360", "السخنه 360", "سخنة 360", "360"],
};

/** lower case, no accents, alef/yaa/taa-marbuta folded, digits Arabic-Indic -> Latin, punctuation -> space */
export function normPark(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[ً-ٰٟـ̀-ͯ]/g, "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ").trim().replace(/\s+/g, " ");
}

const TABLE: { alias: string; park: string }[] = [];
for (const [park, list] of Object.entries(PARK_ALIASES)) {
  for (const a of list) { const n = normPark(a); if (n) TABLE.push({ alias: n, park }); }
  const n = normPark(park); if (n) TABLE.push({ alias: n, park });
}
TABLE.sort((a, b) => b.alias.length - a.alias.length);

/** every park named in the text (whole phrases, longest first, each phrase used once) */
export function parkMatches(text: string): string[] {
  let t = " " + normPark(text) + " ";
  const found: string[] = [];
  if (t.trim() === "") return found;
  for (const { alias, park } of TABLE) {
    const key = " " + alias + " ";
    if (!t.includes(key)) continue;
    if (!found.includes(park)) found.push(park);
    t = t.split(key).join(" ");
  }
  return found;
}

/** Canonical park name for a free text ("اندستريا برج العرب" -> "Industria Borg El Arab"). "" when nothing matches OR when the text names two different
 *  parks ("Industria East and West"): never guess, the caller keeps the customer's own words for a person to decide. */
export function canonicalPark(text: string): string {
  const f = parkMatches(text);
  if (f.length === 1 && f[0] === "Industria East" && /\bwest\b/i.test(String(text))) return "";   // "Industria East and West": two parks
  return f.length === 1 ? f[0] : "";
}
