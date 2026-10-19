// The sales team's WhatsApp message library (11 bilingual templates, kept word for word from the previous CRM).
// Placeholders: {rep} {project} {date} {time} {name} {company}.
import type { Lead } from './types';
import { cleanPersonName } from '../../lib/personName';

export const WA_TEMPLATES: Record<string, { ar: string; en: string }> = {
  "Initial introduction": {
    ar: "سلام عليكم باشمهندس\n\nانا {rep} من شركة السويدي للتنمية الصناعية\nحاولت اتواصل مع حضرتك بخصوص الاستفسار علي الأرض الصناعية",
    en: "Greetings,\n\nThis is {rep} from Elsewedy Industrial Development.\nI tried to reach you regarding your enquiry about the industrial land.",
  },
  "Introduction — website enquiry": {
    ar: "سلام عليكم باشمهندس\n\nانا {rep} من شركة السويدي للتنمية الصناعية\nوصلنا استفسار حضرتك عن الأرض الصناعية في {project}، وتحت أمر حضرتك في أي تفاصيل عن المساحات والمرافق والأسعار\n\nامتى يكون الوقت مناسب لحضرتك نتكلم؟",
    en: "Greetings,\n\nThis is {rep} from Elsewedy Industrial Development.\nWe received your enquiry about industrial land in {project}. I can share the available plot sizes, utilities and pricing.\n\nWhen would be a good time to speak?",
  },
  "Introduction — met at an exhibition": {
    ar: "سلام عليكم باشمهندس\n\nانا {rep} من شركة السويدي للتنمية الصناعية\nسعدت بمقابلة حضرتك في المعرض، وحابب أكمل معاك بخصوص الأرض الصناعية في {project}\n\nتحت أمر حضرتك في أي وقت مناسب",
    en: "Greetings,\n\nThis is {rep} from Elsewedy Industrial Development.\nIt was good to meet you at the exhibition. I would like to continue our conversation about industrial land in {project}.\n\nI am available whenever suits you.",
  },
  "Introduction — referred by someone": {
    ar: "سلام عليكم باشمهندس\n\nانا {rep} من شركة السويدي للتنمية الصناعية\nتم ترشيح حضرتك للتواصل معايا بخصوص الأراضي الصناعية، وحابب أعرف احتياج المشروع وأقدر أساعد حضرتك بالتفاصيل الكاملة\n\nامتى أقدر أتصل بحضرتك؟",
    en: "Greetings,\n\nThis is {rep} from Elsewedy Industrial Development.\nYou were recommended to me regarding industrial land. I would like to understand what the project needs so I can give you the full details.\n\nWhen would be a good time to call?",
  },
  "Introduction — after a long time": {
    ar: "سلام عليكم باشمهندس\n\nانا {rep} من شركة السويدي للتنمية الصناعية\nكنا اتكلمنا قبل كده بخصوص الأرض الصناعية في {project}، وحابب أطمن على مشروع حضرتك ولو لسه الموضوع قائم أقدر أوافيك بالمستجدات والأسعار الحالية",
    en: "Greetings,\n\nThis is {rep} from Elsewedy Industrial Development.\nWe spoke some time ago about industrial land in {project}. I wanted to check where your project stands, and if it is still live I can send you the current availability and pricing.",
  },
  "No answer — tried to reach you": {
    ar: "السلام عليكم ورحمة الله وبركاته\n\nمعكم {rep} من شركة السويدي للتنمية الصناعية.\nحاولت التواصل مع حضرتك بخصوص الاستفسار عن الأرض الصناعية في {project}.\n\nبرجاء إفادتي بالوقت المناسب لحضرتك لمعاودة الاتصال.",
    en: "Greetings,\n\nThis is {rep} from Elsewedy Industrial Development.\nI tried to reach you regarding your enquiry about industrial land in {project}.\n\nPlease let me know a convenient time to call you back.",
  },
  "Follow-up": {
    ar: "السلام عليكم ورحمة الله وبركاته\n\nمعكم {rep} من شركة السويدي للتنمية الصناعية، متابعةً لحديثنا بخصوص {project}.\n\nهل لدى حضرتك أي استفسار يمكنني المساعدة فيه؟",
    en: "Greetings,\n\nThis is {rep} from Elsewedy Industrial Development, following up on our conversation about {project}.\n\nIs there anything I can help clarify?",
  },
  "Offer sent": {
    ar: "السلام عليكم ورحمة الله وبركاته\n\nكما وعدت حضرتك، تم إرسال العرض الخاص بـ{project}.\nبرجاء الاطلاع عليه وإفادتي برأي حضرتك، وتحت أمركم لشرح أي تفاصيل.\n\n{rep} — السويدي للتنمية الصناعية",
    en: "Greetings,\n\nAs promised, our offer for {project} has been sent to you.\nPlease review it and let me know your thoughts. I am happy to walk you through any of the details.\n\n{rep} — Elsewedy Industrial Development",
  },
  "Meeting confirmation": {
    ar: "السلام عليكم ورحمة الله وبركاته\n\nتأكيد موعد الاجتماع يوم {date} الساعة {time} بخصوص {project}.\nفي انتظار لقاء حضرتك.\n\n{rep} — السويدي للتنمية الصناعية",
    en: "Greetings,\n\nConfirming our meeting on {date} at {time} regarding {project}.\nLooking forward to seeing you.\n\n{rep} — Elsewedy Industrial Development",
  },
  "Site visit confirmation": {
    ar: "السلام عليكم ورحمة الله وبركاته\n\nتأكيد زيارة الموقع في {project} يوم {date} الساعة {time}.\nسأكون في انتظار حضرتك هناك.\n\n{rep} — السويدي للتنمية الصناعية",
    en: "Greetings,\n\nConfirming your site visit to {project} on {date} at {time}.\nI will meet you there.\n\n{rep} — Elsewedy Industrial Development",
  },
  "Thank you after a meeting": {
    ar: "السلام عليكم ورحمة الله وبركاته\n\nشكراً لوقت حضرتك اليوم. سعدت بالتعرف على متطلبات المشروع، وسأوافيكم بكل التفاصيل المطلوبة بخصوص {project}.\n\n{rep} — السويدي للتنمية الصناعية",
    en: "Greetings,\n\nThank you for your time today. It was a pleasure understanding your project requirements, and I will send over everything discussed regarding {project}.\n\n{rep} — Elsewedy Industrial Development",
  },
};

export type WaLang = 'both' | 'ar' | 'en';
export const WA_LANGS: Record<WaLang, string> = { both: 'العربية + English', ar: 'العربية', en: 'English' };
const LANG_KEY = 'sid_wa_lang';
export function getWaLang(): WaLang {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'ar' || v === 'en' || v === 'both') return v; } catch { /* default */ }
  return 'both';
}
export function setWaLang(v: WaLang) { try { localStorage.setItem(LANG_KEY, v); } catch { /* ignore */ } }

/** Arabic first, then English, unless the rep asks for one of them alone */
export function waCompose(key: string, lang: WaLang = getWaLang()): string {
  const t = WA_TEMPLATES[key];
  if (!t) return '';
  if (lang === 'ar') return t.ar;
  if (lang === 'en') return t.en;
  return t.ar + '\n\n— — —\n\n' + t.en;
}

export function waFill(text: string, l: Partial<Lead>, rep: string, when?: { date?: string; time?: string }): string {
  return text
    .replace(/\{name\}/g, cleanPersonName(l.customerName))
    .replace(/\{company\}/g, l.companyName || 'your company')
    .replace(/\{project\}/g, l.project || 'our industrial cities')
    .replace(/\{rep\}/g, rep)
    .replace(/\{date\}/g, when?.date || '(date)')
    .replace(/\{time\}/g, when?.time || '(time)');
}

/** the template to suggest first for a lead */
export function suggestTemplate(l: Partial<Lead>): string {
  if (l.status === 'Scheduled Meeting' || l.status === 'Meeting Scheduled') return 'Meeting confirmation';
  if (l.status === 'Site Visit Scheduled') return 'Site visit confirmation';
  if (l.status === 'Offer Sent – Following Up' || l.status === 'Quotation Sent') return 'Offer sent';
  if (l.status === 'New' || l.status === 'Assigned') return /website|google|facebook|instagram|linkedin/i.test(String(l.source)) ? 'Introduction — website enquiry' : 'Initial introduction';
  if (['Sent WhatsApp', 'No Answer', 'No Answer – Sent WhatsApp', 'Out of Coverage – Sent WhatsApp'].includes(String(l.status))) return 'No answer — tried to reach you';
  return 'Follow-up';
}
