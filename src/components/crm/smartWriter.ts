// Smart message writer: NO AI, no server call, no cost.
// It reads where the lead stands (status, attempts, offer, meeting, silence, the plot they asked for) and the Land Bank plot list,
// then writes the message a good sales director would send: the customer's name, their park and size, real available plots,
// one clear next step. Arabic (Egyptian business tone, the team's style) and English. Three versions per situation.
// Facts come only from the lead and the plot list; a missing fact is asked for, never invented. No prices in messages.
import type { Lead } from './types';
import type { Plot } from '../../lib/plotsService';
import { canonicalParks } from '../../lib/parkAliases';
import { firstNameOf } from '../../lib/personName';
import { ACTIVE_EXCLUDE } from './leadConfig';
import { dayOf, daysBetween, fmtDay, offerAwaiting, todayISO } from './leadMetrics';
import { PlotFit, sizeRange } from './smartEngine';

export type Situation =
  | 'first' | 'noanswer' | 'noanswer_last' | 'callback' | 'followup' | 'study' | 'offer' | 'negotiation'
  | 'meeting' | 'visit' | 'cold' | 'plotgone' | 'won';
export const SITUATION_LABEL: Record<Situation, string> = {
  first: 'First contact', noanswer: 'No answer — try again', noanswer_last: 'No answer — last try', callback: 'They asked for a call back',
  followup: 'Follow-up', study: 'They are studying our offer', offer: 'Offer follow-up', negotiation: 'Negotiation', meeting: 'Confirm the meeting',
  visit: 'Confirm the site visit', cold: 'Wake up a quiet lead', plotgone: 'Their plot is gone: offer an alternative', won: 'Thank you / next steps',
};
export interface Draft { situation: Situation; version: number; ar: string; en: string; subjectAr: string; subjectEn: string }
export interface WriterCtx { rep: string; fit: PlotFit | null; byKey?: Map<string, Plot>; now?: number }

const PARK_AR: Record<string, string> = {
  'Industria October': 'إندستريا أكتوبر', 'Industria New Sadat': 'إندستريا السادات الجديدة', 'Industria Sadat': 'إندستريا السادات',
  'Industria Borg El Arab': 'إندستريا برج العرب', 'Industria Sokhna': 'إندستريا السخنة', 'Sokhna 360': 'سخنة 360',
  'Industria East': 'إندستريا إيست', 'Industria West': 'إندستريا ويست', 'Industria Asher - Plot 10': 'إندستريا عاشر',
  'Industria Asher - Plot 11': 'إندستريا عاشر', 'Al Oula': 'الأولى',
};
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const IND_AR: Record<string, string> = {
  Engineering: 'الصناعات الهندسية', Pharmaceutical: 'الأدوية', Textile: 'النسيج', Chemical: 'الكيماويات', 'Food & Beverage (F&B)': 'الأغذية والمشروبات',
  Logistics: 'اللوجستيات', 'Heavy Industry': 'الصناعات الثقيلة', Services: 'الخدمات', Automotive: 'السيارات', Warehouse: 'المخازن', Plastic: 'البلاستيك', Plastics: 'البلاستيك',
};
/** "من يوم / يومين / 3 أيام / 12 يوم" */
const daysAr = (d: number) => (d <= 1 ? 'من يوم' : d === 2 ? 'من يومين' : d <= 10 ? `من ${d} أيام` : `من ${d} يوم`);
const hasArabic = (s: string) => /[؀-ۿ]/.test(s);
const ATTEMPT_TYPES = new Set(['Call', 'WhatsApp', 'Email', 'SMS']);
const NO_ANS = ['No Answer – Sent WhatsApp', 'Out of Coverage – Sent WhatsApp', 'Sent WhatsApp', 'No Answer'];

/** customer's own language: Arabic when the name or message is written in Arabic */
export const preferredLang = (l: Lead): 'ar' | 'en' => (hasArabic(`${l.customerName || ''} ${l.description || ''}`) || !/[a-z]/i.test(l.customerName || '') ? 'ar' : 'en');

/** tries since the last real conversation (the last status that moved forward) */
function attemptsSinceProgress(l: Lead): number {
  const tl = l.timeline || [];
  let n = 0;
  for (let i = tl.length - 1; i >= 0; i--) {
    const e = tl[i];
    if (e.type === 'Status Change' && !NO_ANS.some((s) => String(e.description || e.title || '').endsWith(s))) break;
    if (ATTEMPT_TYPES.has(e.type)) n++;
  }
  return n;
}

export function situationOf(l: Lead, ctx: WriterCtx): Situation {
  const today = todayISO();
  if (l.status === 'Won') return 'won';
  const gone = (l.assignedPlots || []).some((a) => { const p = ctx.byKey?.get(a.key); return p && p.status !== 'available'; });
  if (gone) return 'plotgone';
  const meet = dayOf(l.meetingDate);
  if (meet && meet >= today) return l.status === 'Site Visit Scheduled' ? 'visit' : 'meeting';
  if (l.status === 'Call Back' || l.status === 'Client Will Call Back') return 'callback';
  if (l.status === 'Negotiation') return 'negotiation';
  if (l.status === 'Need Time to Study Our Offer') return 'study';
  if (offerAwaiting(l)) return 'offer';
  if (NO_ANS.includes(l.status)) return attemptsSinceProgress(l) >= 3 ? 'noanswer_last' : 'noanswer';
  if (l.status === 'New' || l.status === 'Assigned') return 'first';
  const last = dayOf(l.lastContactDate) || dayOf(l.firstContactAt);
  if (last && daysBetween(last, today) >= 21) return 'cold';
  return 'followup';
}

interface Facts { nameAr: string; nameEn: string; parkAr: string; parkEn: string; sizeAr: string; sizeEn: string; fitAr: string; fitEn: string; industryAr: string; industryEn: string; company: string; when: string; whenEn: string; days: number | null; goneUnits: string }

function factsOf(l: Lead, ctx: WriterCtx): Facts {
  const first = firstNameOf(l.customerName);
  const park = canonicalParks(l.project || '')[0] || '';
  const parkEn = park || (l.project || '').trim();
  const parkAr = PARK_AR[park] || parkEn;
  const r = sizeRange(l.requiredSize);
  const size = r ? (r[0] === r[1] ? n0(r[0]) : `${n0(r[0])}–${n0(r[1])}`) : '';
  const f = ctx.fit;
  let fitAr = '', fitEn = '';
  if (f && f.count > 0 && parkEn) {
    const areas = f.best.map((p) => p.areaSqM);
    const lo = Math.min(...areas), hi = Math.max(...areas);
    const span = lo === hi ? `${n0(lo)} م²` : `من ${n0(lo)} إلى ${n0(hi)} م²`;
    const spanEn = lo === hi ? `${n0(lo)} sqm` : `${n0(lo)} to ${n0(hi)} sqm`;
    fitAr = f.count === 1 ? `متاح حالياً قطعة مناسبة جداً في ${parkAr} بمساحة ${span}` : `متاح حالياً ${f.count} قطع مناسبة في ${parkAr}، أقربها لطلب حضرتك ${span}`;
    fitEn = f.count === 1 ? `one plot that fits your request is available now in ${parkEn} (${spanEn})` : `${f.count} plots that fit your request are available now in ${parkEn}; the closest are ${spanEn}`;
  } else if (f && f.count === 0 && size && parkEn) {
    fitAr = `المساحة دي بالظبط مش متاحة حالياً في ${parkAr}، لكن عندنا بدائل قريبة أقدر أعرضها على حضرتك`;
    fitEn = `that exact size is not free in ${parkEn} right now, but I have close alternatives to show you`;
  }
  const meet = dayOf(l.meetingDate);
  const gone = (l.assignedPlots || []).filter((a) => { const p = ctx.byKey?.get(a.key); return p && p.status !== 'available'; }).map((a) => a.unit).join(', ');
  const ref = dayOf(l.offerDate) || dayOf(l.lastContactDate) || dayOf(l.firstContactAt);
  return {
    nameAr: first ? `أستاذ ${first}` : 'حضرتك', nameEn: first && !hasArabic(first) ? first : '',
    parkAr: parkAr || 'مدننا الصناعية', parkEn: parkEn || 'our industrial parks',
    sizeAr: size ? `${size} م²` : '', sizeEn: size ? `${size} sqm` : '',
    fitAr, fitEn,
    industryAr: l.industry ? (IND_AR[l.industry] ? ` لنشاط ${IND_AR[l.industry]}` : hasArabic(l.industry) ? ` لنشاط ${l.industry}` : '') : '', industryEn: l.industry ? ` for your ${l.industry} activity` : '',
    company: (l.companyName || '').trim(),
    when: meet ? `${fmtDay(meet)}${l.meetingTime ? ` الساعة ${l.meetingTime}` : ''}` : '', whenEn: meet ? `${fmtDay(meet)}${l.meetingTime ? ` at ${l.meetingTime}` : ''}` : '',
    days: ref ? Math.max(0, Math.round(daysBetween(ref, todayISO()))) : null,
    goneUnits: gone,
  };
}

const sigAr = (rep: string) => `\n\n${rep}\nالسويدي للتنمية الصناعية`;
const sigEn = (rep: string) => `\n\nBest regards,\n${rep}\nElsewedy Industrial Development`;
const helloAr = (x: Facts) => (x.nameAr === 'حضرتك' ? 'السلام عليكم،' : `السلام عليكم ${x.nameAr}،`);
const helloEn = (x: Facts) => (x.nameEn ? `Dear ${x.nameEn},` : 'Good day,');
const join = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join('\n');

/** three versions of the message for this situation: [standard, value-led, short] */
function build(s: Situation, x: Facts, rep: string): { ar: string; en: string }[] {
  const needAr = x.sizeAr ? `أرض صناعية بمساحة حوالي ${x.sizeAr} في ${x.parkAr}${x.industryAr}` : `أرض صناعية في ${x.parkAr}${x.industryAr}`;
  const needEn = x.sizeEn ? `industrial land of about ${x.sizeEn} in ${x.parkEn}${x.industryEn}` : `industrial land in ${x.parkEn}${x.industryEn}`;
  const askSizeAr = x.sizeAr ? '' : 'ممكن أعرف المساحة المطلوبة ونوع النشاط عشان أرشح لحضرتك الأنسب؟';
  const askSizeEn = x.sizeEn ? '' : 'Could you share the land size you need and your activity, so I can shortlist the right plots?';
  const fitLineAr = x.fitAr ? `${x.fitAr}.` : '';
  const fitLineEn = x.fitEn ? `${x.fitEn[0].toUpperCase()}${x.fitEn.slice(1)}.` : '';
  const A = (body: string) => `${helloAr(x)}\n\n${body}${sigAr(rep)}`;
  const E = (body: string) => `${helloEn(x)}\n\n${body}${sigEn(rep)}`;
  switch (s) {
    case 'first': return [
      { ar: A(join(`معك ${rep} من السويدي للتنمية الصناعية، وصلنا طلب حضرتك بخصوص ${needAr}.`, fitLineAr, askSizeAr || 'إمتى يكون وقت مناسب لمكالمة قصيرة أعرض فيها على حضرتك الاختيارات المتاحة؟')),
        en: E(join(`This is ${rep} from Elsewedy Industrial Development. We received your enquiry about ${needEn}.`, fitLineEn, askSizeEn || 'When would be a good time for a short call to walk you through the options?')) },
      { ar: A(join(`شكراً لاهتمام حضرتك بالسويدي للتنمية الصناعية.`, fitLineAr || `عندنا اختيارات كتير في ${x.parkAr} بمرافق كاملة وجاهزة للبناء.`, 'أقدر أرتب لحضرتك زيارة للموقع الأسبوع ده، أي يوم يناسبك؟')),
        en: E(join('Thank you for your interest in Elsewedy Industrial Development.', fitLineEn || `We have serviced, ready-to-build plots in ${x.parkEn}.`, 'I can arrange a site visit this week. Which day suits you?')) },
      { ar: A(`معك ${rep} من السويدي للتنمية الصناعية بخصوص طلب حضرتك في ${x.parkAr}. أتصل بحضرتك إمتى؟`),
        en: E(`This is ${rep} from Elsewedy Industrial Development about your enquiry for ${x.parkEn}. When can I call you?`) },
    ];
    case 'noanswer': return [
      { ar: A(join(`حاولت أتواصل مع حضرتك تليفونياً بخصوص طلب ${needAr} ولم أتمكن من الوصول لحضرتك.`, fitLineAr, 'ياريت تبلغني بوقت مناسب أتصل فيه، أو ترد هنا وأبعت لحضرتك التفاصيل.')),
        en: E(join(`I tried to call you about your request for ${needEn} but could not reach you.`, fitLineEn, 'Please let me know a convenient time to call, or reply here and I will send you the details.')) },
      { ar: A(join(fitLineAr || `عندي تفاصيل الأراضي المتاحة في ${x.parkAr} جاهزة لحضرتك.`, 'أبعتها لحضرتك هنا على الواتساب ولا تحب نتكلم في مكالمة قصيرة؟')),
        en: E(join(fitLineEn || `I have the details of the available plots in ${x.parkEn} ready for you.`, 'Shall I send them here, or would you prefer a short call?')) },
      { ar: A(`حاولت أكلم حضرتك بخصوص ${x.parkAr}. إمتى أقدر أتصل؟`), en: E(`I tried to call you about ${x.parkEn}. When is a good time to call?`) },
    ];
    case 'noanswer_last': return [
      { ar: A(join(`حاولت أتواصل مع حضرتك أكتر من مرة بخصوص ${needAr}.`, 'مش عايز أزعج حضرتك، فلو الطلب لسه قائم ابعتلي كلمة "نعم" وأنا هتصل بحضرتك في الوقت اللي يناسبك، ولو اتأجل بلغني وهحتفظ بطلبك.')),
        en: E(join(`I have tried to reach you a few times about ${needEn}.`, 'I do not want to disturb you: if the request is still active, just reply "yes" and I will call at a time that suits you. If it is on hold, tell me and I will keep your file open.')) },
      { ar: A(join(fitLineAr || `عندي تفاصيل المتاح حالياً في ${x.parkAr}.`, 'لو حابب أرتب لحضرتك ميعاد معاينة، رد عليا بأنسب يوم.')),
        en: E(join(fitLineEn || `I have the details of what is available now in ${x.parkEn}.`, 'If you would like a viewing, reply with the day that suits you.')) },
      { ar: A('آخر محاولة مني عشان ما أزعجش حضرتك: الطلب لسه قائم؟'), en: E('My last try so I do not disturb you: is your request still active?') },
    ];
    case 'callback': return [
      { ar: A(join(`زي ما اتفقنا، كنت هتواصل مع حضرتك بخصوص ${needAr}.`, fitLineAr, 'أتصل بحضرتك إمتى النهارده أو بكرة؟')),
        en: E(join(`As agreed, I am getting back to you about ${needEn}.`, fitLineEn, 'When can I call you today or tomorrow?')) },
      { ar: A(join('حضرت لحضرتك الاختيارات المناسبة قبل المكالمة.', fitLineAr, 'قولي الوقت اللي يناسبك وأكلمك فوراً.')), en: E(join('I have prepared the matching options before our call.', fitLineEn, 'Tell me the time that suits you and I will call.')) },
      { ar: A('مستني إشارة من حضرتك عشان أتصل، أنسب وقت إمتى؟'), en: E('Waiting for your signal to call. What time suits you best?') },
    ];
    case 'study': return [
      { ar: A(join(`أتمنى تكون حضرتك اطلعت على العرض الخاص بـ${x.parkAr}.`, 'لو فيه أي نقطة محتاجة توضيح (المساحة، المرافق، طريقة السداد) أنا تحت أمرك، وممكن نرتب مكالمة قصيرة نراجع فيها كل التفاصيل سوا.')),
        en: E(join(`I hope you had the chance to review our offer for ${x.parkEn}.`, 'If any point needs clarifying (size, utilities, payment terms), I am happy to go through it together on a short call.')) },
      { ar: A(join('عشان أساعد حضرتك في القرار: أقدر أرتب زيارة للموقع تشوف فيها القطعة والمرافق على الطبيعة.', 'أي يوم يناسبك الأسبوع ده؟')), en: E(join('To help with your decision, I can arrange a site visit so you see the plot and utilities in person.', 'Which day this week suits you?')) },
      { ar: A('فيه أي سؤال في العرض أقدر أجاوبه لحضرتك؟'), en: E('Is there any question on the offer I can answer for you?') },
    ];
    case 'offer': return [
      { ar: A(join(`متابعة للعرض اللي بعتناه لحضرتك${x.days != null ? ` ${daysAr(x.days)}` : ''} بخصوص ${x.parkAr}.`, 'حابب أعرف رأي حضرتك، وتحت أمرك لأي تعديل في المساحة أو طريقة السداد.')),
        en: E(join(`Following up on the offer we sent you${x.days != null ? ` ${x.days} days ago` : ''} for ${x.parkEn}.`, 'I would value your feedback, and I am open to adjusting the size or the payment plan.')) },
      { ar: A(join('المتاح في الأراضي بيتغير من أسبوع للتاني.', 'لو حضرتك مهتم أقدر أطلب حجز مبدئي لفترة قصيرة لحد ما ناخد القرار. نتكلم إمتى؟')), en: E(join('Availability changes from week to week.', 'If you are interested I can request a short provisional hold while you decide. When can we talk?')) },
      { ar: A('وصل العرض لحضرتك؟ فيه أي استفسار؟'), en: E('Did you receive the offer? Any questions?') },
    ];
    case 'negotiation': return [
      { ar: A(join(`حابب نكمل خطوتنا الجاية بخصوص ${x.parkAr}.`, 'أقترح مكالمة أو اجتماع قصير نقفل فيه النقاط المتبقية. يناسب حضرتك إمتى؟')), en: E(join(`I would like to take our next step on ${x.parkEn}.`, 'I suggest a short call or meeting to close the open points. When suits you?')) },
      { ar: A(join('حابب أراجع مع حضرتك النقاط المفتوحة عشان نقدر نقفل الاتفاق.', 'وقتك يسمح بمكالمة النهارده؟')), en: E(join('I would like to review the open points with you so we can close the agreement.', 'Do you have time for a call today?')) },
      { ar: A('نكمل كلامنا إمتى؟'), en: E('When can we continue our discussion?') },
    ];
    case 'meeting': case 'visit': {
      const what = s === 'visit' ? `زيارة الموقع في ${x.parkAr}` : `اجتماعنا بخصوص ${x.parkAr}`;
      const whatEn = s === 'visit' ? `your site visit to ${x.parkEn}` : `our meeting about ${x.parkEn}`;
      return [
        { ar: A(join(`تأكيد ${what}${x.when ? ` يوم ${x.when}` : ''}.`, s === 'visit' ? 'هبعت لحضرتك اللوكيشن، وهكون في انتظارك عند البوابة.' : 'لو فيه أي تغيير في الميعاد بلغني.')), en: E(join(`Confirming ${whatEn}${x.whenEn ? ` on ${x.whenEn}` : ''}.`, s === 'visit' ? 'I will send you the location pin and meet you at the gate.' : 'Let me know if anything changes.')) },
        { ar: A(join(`في انتظار ${what}${x.when ? ` يوم ${x.when}` : ''}.`, fitLineAr || 'هكون مجهز الاختيارات المناسبة لطلب حضرتك.')), en: E(join(`Looking forward to ${whatEn}${x.whenEn ? ` on ${x.whenEn}` : ''}.`, fitLineEn || 'I will have the matching options ready.')) },
        { ar: A(`تأكيد ميعادنا${x.when ? ` ${x.when}` : ''}. في انتظار حضرتك.`), en: E(`Confirming our appointment${x.whenEn ? ` on ${x.whenEn}` : ''}. See you then.`) },
      ];
    }
    case 'cold': return [
      { ar: A(join(`اتكلمنا قبل كده بخصوص ${needAr}، وحبيت أطمن على مشروع حضرتك.`, fitLineAr, 'لو الطلب لسه قائم أقدر أبعت لحضرتك المتاح حالياً.')),
        en: E(join(`We spoke a while ago about ${needEn}, and I wanted to check how your project is going.`, fitLineEn, 'If it is still on your plans I can send you what is available now.')) },
      { ar: A(join(fitLineAr || `عندي تفاصيل المتاح حالياً في ${x.parkAr}.`, 'أبعتلك التفاصيل؟')), en: E(join(fitLineEn || `I have the details of what is available now in ${x.parkEn}.`, 'Shall I send them?')) },
      { ar: A('مشروع حضرتك لسه قائم؟ أقدر أبعتلك المتاح حالياً.'), en: E('Is your project still on? I can send you what is available now.') },
    ];
    case 'plotgone': return [
      { ar: A(join(`حبيت أبلغ حضرتك قبل أي حد إن القطعة${x.goneUnits ? ` (${x.goneUnits})` : ''} في ${x.parkAr} اتحجزت.`, fitLineAr ? `الخبر الحلو: ${x.fitAr}.` : 'لكن عندي بدائل قريبة جداً من نفس المواصفات.', 'أبعت لحضرتك البدائل النهارده؟')),
        en: E(join(`I wanted you to hear it from me first: plot${x.goneUnits ? ` ${x.goneUnits}` : ''} in ${x.parkEn} has been taken.`, fitLineEn ? `The good news: ${x.fitEn}.` : 'I have close alternatives with the same specifications.', 'Shall I send you the alternatives today?')) },
      { ar: A(join(fitLineAr || 'عندي بدائل بنفس المواصفات تقريباً.', 'لو حابب أقدر أطلب حجز مبدئي لحضرتك عشان ما يتكررش الموقف. نتكلم إمتى؟')), en: E(join(fitLineEn || 'I have alternatives with nearly the same specifications.', 'If you wish I can request a provisional hold so this does not happen again. When can we talk?')) },
      { ar: A('القطعة اللي اخترتها اتحجزت، وعندي بديل مناسب. أكلمك إمتى؟'), en: E('The plot you chose has been taken, and I have a good alternative. When can I call?') },
    ];
    case 'won': return [
      { ar: A(join(`ألف مبروك ${x.company ? `لـ${x.company} ` : ''}على أرض ${x.parkAr}، وسعداء بثقة حضرتك.`, 'هتابع مع حضرتك خطوات العقد والاستلام خطوة بخطوة، وأنا تحت أمرك في أي وقت.')), en: E(join(`Congratulations${x.company ? ` to ${x.company}` : ''} on your land in ${x.parkEn}, and thank you for your trust.`, 'I will guide you through the contract and handover step by step. I am at your service anytime.')) },
      { ar: A(join('شكراً لثقة حضرتك.', 'لو فيه شركاء أو معارف بيدوروا على أرض صناعية، يسعدنا نخدمهم بنفس الاهتمام.')), en: E(join('Thank you for your trust.', 'If partners or friends are looking for industrial land, we would be glad to serve them with the same care.')) },
      { ar: A('مبروك وشكراً لثقة حضرتك. أي خدمة أنا موجود.'), en: E('Congratulations and thank you. I am here for anything you need.') },
    ];
    default: return [
      { ar: A(join(`متابعة لكلامنا بخصوص ${needAr}.`, fitLineAr, askSizeAr || 'فيه أي جديد أقدر أساعد حضرتك فيه؟ تحب نرتب زيارة للموقع؟')), en: E(join(`Following up on our conversation about ${needEn}.`, fitLineEn, askSizeEn || 'Anything new I can help with? Would you like to arrange a site visit?')) },
      { ar: A(join(fitLineAr || `فيه اختيارات مناسبة لحضرتك في ${x.parkAr}.`, 'أقدر أبعت التفاصيل أو نرتب مكالمة قصيرة، اللي يريح حضرتك.')), en: E(join(fitLineEn || `There are suitable options for you in ${x.parkEn}.`, 'I can send the details or we can have a short call, whichever you prefer.')) },
      { ar: A('أي جديد في مشروع حضرتك؟ أنا تحت أمرك.'), en: E('Any update on your project? I am at your service.') },
    ];
  }
}

/** all versions of the best message for this lead (and its situation) */
export function writeFor(l: Lead, ctx: WriterCtx, situation?: Situation): Draft[] {
  const s = situation || situationOf(l, ctx);
  const x = factsOf(l, ctx);
  const subjectEn = s === 'meeting' || s === 'visit' ? `Confirmation — ${x.parkEn}` : s === 'offer' || s === 'study' ? `Your offer — ${x.parkEn}` : s === 'plotgone' ? `Alternatives for your plot — ${x.parkEn}` : `Industrial land in ${x.parkEn}${x.company ? ` — ${x.company}` : ''}`;
  const subjectAr = s === 'meeting' || s === 'visit' ? `تأكيد الموعد — ${x.parkAr}` : s === 'offer' || s === 'study' ? `العرض الخاص بحضرتك — ${x.parkAr}` : s === 'plotgone' ? `بدائل للقطعة — ${x.parkAr}` : `أرض صناعية في ${x.parkAr}`;
  return build(s, x, ctx.rep).map((v, i) => ({ situation: s, version: i, ar: v.ar, en: v.en, subjectAr, subjectEn }));
}
/** situations worth offering for this lead (the detected one first) */
export function situationsFor(l: Lead, ctx: WriterCtx): Situation[] {
  const main = situationOf(l, ctx);
  const open = !ACTIVE_EXCLUDE.includes(l.status);
  const list: Situation[] = [main];
  const add = (s: Situation) => { if (!list.includes(s)) list.push(s); };
  if (open) { add('followup'); if (main !== 'first') add('cold'); if (dayOf(l.meetingDate)) add(l.status === 'Site Visit Scheduled' ? 'visit' : 'meeting'); if (l.offerSent) add('offer'); add('noanswer'); }
  return list.slice(0, 5);
}
