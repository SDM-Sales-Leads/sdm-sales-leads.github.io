// One alias table: Arabic and English spellings of the Land Bank parks -> the park name used in the plot list.
// The server mail ingestion keeps the same table (supabase/functions/api/parks.ts): keep the two consistent.
export const PARKS = [
  'Industria Borg El Arab', 'Industria East', 'Industria New Sadat', 'Industria October', 'Industria Sadat', 'Industria Sokhna',
  'Industria West', 'Industria Asher - Plot 10', 'Industria Asher - Plot 11', 'Al Oula', 'Sokhna 360',
] as const;

/** lowercase, no diacritics, Arabic letter variants unified, Arabic digits -> latin */
export function normPark(text: string): string {
  return (text || '').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
}

/** All parks a free text can mean (an ambiguous "Asher" gives both plots). Empty when nothing matches. */
export function canonicalParks(text: string): string[] {
  const t = normPark(text);
  if (!t) return [];
  const has = (re: RegExp) => re.test(t);
  if (has(/sokhna\s*360|سخنه\s*360|\b360\b/)) return ['Sokhna 360'];
  if (has(/borg\s*(el|al)?\s*arab|برج\s*(ال)?عرب/)) return ['Industria Borg El Arab'];
  if (has(/new\s*sadat|سادات\s*(ال)?جديد|(ال)?سادات\s*(ال)?جديد/)) return ['Industria New Sadat'];
  if (has(/arady|aradi|اراضي/)) return [];   // 3 Nov 2026: "Asher Arady" / "Abou Rawash Arady" are land projects of their own, not Industria Asher plots
  if (has(/asher|اشر|عاشر\s*(?!من)|10th|tenth/) && !has(/10th of ramadan|tenth of ramadan|العاشر من رمضان|عاشر من رمضان/)) {
    const m10 = has(/\b10\b|plot\s*10|ten\b|عشره|بلوت\s*10/), m11 = has(/\b11\b|plot\s*11|eleven|احد عشر|اداشر/);
    if (m10 && !m11) return ['Industria Asher - Plot 10'];
    if (m11 && !m10) return ['Industria Asher - Plot 11'];
    return ['Industria Asher - Plot 10', 'Industria Asher - Plot 11'];
  }
  if (has(/sadat|سادات/)) return ['Industria Sadat'];
  if (has(/october|اكتوبر/)) return ['Industria October'];
  if (has(/sokhna|sukhna|sokhnah|سخنه/)) return ['Industria Sokhna'];
  if (has(/\bwest\b|غرب/)) return ['Industria West'];
  if (has(/\beast\b|شرق/)) return ['Industria East'];
  if (has(/al\s*oula|aloula|\bola\b|اولي|اوله/)) return ['Al Oula'];
  return [];
}

/** The park when the text means exactly one, else ''. */
export function canonicalPark(text: string): string {
  const p = canonicalParks(text);
  return p.length === 1 ? p[0] : '';
}
