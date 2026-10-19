// Lead names often carry a job title ("صاحب شركه/عاطف محمد سلام", "Eng. Ahmed Ali", "مدير انتاج محمد علي"). Messages must address the real person.
const TITLE = new Set([
  'mr', 'mrs', 'ms', 'miss', 'eng', 'engineer', 'dr', 'prof', 'sir', 'madam', 'owner', 'manager', 'director', 'ceo', 'partner', 'founder', 'chairman', 'sales', 'procurement', 'purchasing', 'factory', 'company', 'trader', 'businessman',
  'السيد', 'السيدة', 'الاستاذ', 'الأستاذ', 'استاذ', 'أستاذ', 'استاذة', 'أستاذة', 'مهندس', 'مهندسه', 'مهندسة', 'م', 'دكتور', 'دكتوره', 'دكتورة', 'د', 'الدكتور', 'الدكتورة', 'الحاج', 'الحاجة', 'حاج', 'حاجة',
  'صاحب', 'صاحبة', 'شركه', 'شركة', 'مصنع', 'مدير', 'مديرة', 'مديره', 'رئيس', 'مجلس', 'ادارة', 'إدارة', 'انتاج', 'إنتاج', 'مالي', 'تنفيذي', 'عام', 'تاجر', 'رجل', 'اعمال', 'أعمال', 'بارتنر', 'شريك', 'مسؤل', 'مسئول', 'مسؤول', 'تصدير', 'استيراد', 'مشتريات', 'مبيعات', 'مورد', 'مقاول', 'مستثمر', 'عميل',
  'مدير', 'زراعى', 'زراعي', 'مالك', 'مؤسس', 'وكيل',
]);
const norm = (w: string) => w.replace(/[.،,:;()\-_]+/g, '').toLowerCase();

/** the person's name without titles: the part after the last "/", then leading job-title words dropped */
export function cleanPersonName(raw?: string | null): string {
  let t = String(raw ?? '').trim();
  if (!t) return '';
  const parts = t.split(/[\/\\|]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    // "title/ name": the last segment that is not only title words
    const real = [...parts].reverse().find((p) => p.split(/\s+/).some((w) => !TITLE.has(norm(w)) && norm(w)));
    t = real || parts[parts.length - 1];
  }
  const words = t.split(/\s+/).filter(Boolean);
  while (words.length > 1 && TITLE.has(norm(words[0]))) words.shift();
  const out = words.join(' ').trim();
  return out || t;
}
export const firstNameOf = (raw?: string | null): string => cleanPersonName(raw).split(/\s+/)[0] || '';
