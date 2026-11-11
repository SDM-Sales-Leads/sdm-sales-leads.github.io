import{c as w,aO as j}from"./index-DcRvdpV-.js";import{r as h,j as i}from"./vendor-react-BaJQxSAY.js";/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const S=[["path",{d:"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",key:"1r0f0z"}],["circle",{cx:"12",cy:"10",r:"3",key:"ilqhr7"}]],G=w("map-pin",S);/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const E=[["path",{d:"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384",key:"9njp5v"}]],D=w("phone",E),W=({value:e,onChange:n,disabled:r,className:a="",hide:m=[],allowEmpty:c})=>{var f;const l=j(e).map(t=>({...t,statuses:t.statuses.filter(u=>!m.includes(u))})).filter(t=>t.statuses.length),s=((f=l.find(t=>t.statuses.includes(e)))==null?void 0:f.group)||"",[d,g]=h.useState(s);h.useEffect(()=>{s&&g(s)},[s,e]);const o=l.find(t=>t.group===d);return i.jsxs("div",{className:"flex flex-col gap-1.5",children:[i.jsxs("select",{"aria-label":"Status tab",value:d,disabled:r,onChange:t=>{const u=l.find(b=>b.group===t.target.value);g(t.target.value),u&&u.statuses.length===1&&u.statuses[0]!==e&&n(u.statuses[0])},className:`${a} w-full min-w-0`,children:[c&&!d&&i.jsx("option",{value:"",children:"Tab…"}),l.map(t=>i.jsx("option",{value:t.group,children:t.group},t.group))]}),i.jsxs("select",{"aria-label":"Status",value:o!=null&&o.statuses.includes(e)?e:"",disabled:r,onChange:t=>t.target.value&&n(t.target.value),className:`${a} w-full min-w-0`,children:[!(o!=null&&o.statuses.includes(e))&&i.jsx("option",{value:"",children:"Choose…"}),((o==null?void 0:o.statuses)||[]).map(t=>i.jsx("option",{value:t,children:t},t))]})]})},y=new Set(["mr","mrs","ms","miss","eng","engineer","dr","prof","sir","madam","owner","manager","director","ceo","partner","founder","chairman","sales","procurement","purchasing","factory","company","trader","businessman","السيد","السيدة","الاستاذ","الأستاذ","استاذ","أستاذ","استاذة","أستاذة","مهندس","مهندسه","مهندسة","م","دكتور","دكتوره","دكتورة","د","الدكتور","الدكتورة","الحاج","الحاجة","حاج","حاجة","صاحب","صاحبة","شركه","شركة","مصنع","مدير","مديرة","مديره","رئيس","مجلس","ادارة","إدارة","انتاج","إنتاج","مالي","تنفيذي","عام","تاجر","رجل","اعمال","أعمال","بارتنر","شريك","مسؤل","مسئول","مسؤول","تصدير","استيراد","مشتريات","مبيعات","مورد","مقاول","مستثمر","عميل","مدير","زراعى","زراعي","مالك","مؤسس","وكيل"]),p=e=>e.replace(/[.،,:;()\-_]+/g,"").toLowerCase();function v(e){let n=String(e??"").trim();if(!n)return"";const r=n.split(/[\/\\|]/).map(c=>c.trim()).filter(Boolean);r.length>1&&(n=[...r].reverse().find(l=>l.split(/\s+/).some(s=>!y.has(p(s))&&p(s)))||r[r.length-1]);const a=n.split(/\s+/).filter(Boolean);for(;a.length>1&&y.has(p(a[0]));)a.shift();return a.join(" ").trim()||n}const k=new Set(["abd","abdel","abdul","abdal","abu","abou","عبد","ابو","أبو","عبدال"]),C=e=>{const n=v(e).split(/\s+/).filter(Boolean);return n.length?n.length>1&&k.has(n[0].toLowerCase().replace(/[-.]$/,""))?`${n[0]} ${n[1]}`:n[0]:""},x={"Initial introduction":{ar:`سلام عليكم باشمهندس

انا {rep} من شركة السويدي للتنمية الصناعية
حاولت اتواصل مع حضرتك بخصوص الاستفسار علي الأرض الصناعية`,en:`Greetings,

This is {rep} from Elsewedy Industrial Development.
I tried to reach you regarding your enquiry about the industrial land.`},"Introduction — website enquiry":{ar:`سلام عليكم باشمهندس

انا {rep} من شركة السويدي للتنمية الصناعية
وصلنا استفسار حضرتك عن الأرض الصناعية في {project}، وتحت أمر حضرتك في أي تفاصيل عن المساحات والمرافق والأسعار

امتى يكون الوقت مناسب لحضرتك نتكلم؟`,en:`Greetings,

This is {rep} from Elsewedy Industrial Development.
We received your enquiry about industrial land in {project}. I can share the available plot sizes, utilities and pricing.

When would be a good time to speak?`},"Introduction — met at an exhibition":{ar:`سلام عليكم باشمهندس

انا {rep} من شركة السويدي للتنمية الصناعية
سعدت بمقابلة حضرتك في المعرض، وحابب أكمل معاك بخصوص الأرض الصناعية في {project}

تحت أمر حضرتك في أي وقت مناسب`,en:`Greetings,

This is {rep} from Elsewedy Industrial Development.
It was good to meet you at the exhibition. I would like to continue our conversation about industrial land in {project}.

I am available whenever suits you.`},"Introduction — referred by someone":{ar:`سلام عليكم باشمهندس

انا {rep} من شركة السويدي للتنمية الصناعية
تم ترشيح حضرتك للتواصل معايا بخصوص الأراضي الصناعية، وحابب أعرف احتياج المشروع وأقدر أساعد حضرتك بالتفاصيل الكاملة

امتى أقدر أتصل بحضرتك؟`,en:`Greetings,

This is {rep} from Elsewedy Industrial Development.
You were recommended to me regarding industrial land. I would like to understand what the project needs so I can give you the full details.

When would be a good time to call?`},"Introduction — after a long time":{ar:`سلام عليكم باشمهندس

انا {rep} من شركة السويدي للتنمية الصناعية
كنا اتكلمنا قبل كده بخصوص الأرض الصناعية في {project}، وحابب أطمن على مشروع حضرتك ولو لسه الموضوع قائم أقدر أوافيك بالمستجدات والأسعار الحالية`,en:`Greetings,

This is {rep} from Elsewedy Industrial Development.
We spoke some time ago about industrial land in {project}. I wanted to check where your project stands, and if it is still live I can send you the current availability and pricing.`},"No answer — tried to reach you":{ar:`السلام عليكم ورحمة الله وبركاته

معكم {rep} من شركة السويدي للتنمية الصناعية.
حاولت التواصل مع حضرتك بخصوص الاستفسار عن الأرض الصناعية في {project}.

برجاء إفادتي بالوقت المناسب لحضرتك لمعاودة الاتصال.`,en:`Greetings,

This is {rep} from Elsewedy Industrial Development.
I tried to reach you regarding your enquiry about industrial land in {project}.

Please let me know a convenient time to call you back.`},"Follow-up":{ar:`السلام عليكم ورحمة الله وبركاته

معكم {rep} من شركة السويدي للتنمية الصناعية، متابعةً لحديثنا بخصوص {project}.

هل لدى حضرتك أي استفسار يمكنني المساعدة فيه؟`,en:`Greetings,

This is {rep} from Elsewedy Industrial Development, following up on our conversation about {project}.

Is there anything I can help clarify?`},"Offer sent":{ar:`السلام عليكم ورحمة الله وبركاته

كما وعدت حضرتك، تم إرسال العرض الخاص بـ{project}.
برجاء الاطلاع عليه وإفادتي برأي حضرتك، وتحت أمركم لشرح أي تفاصيل.

{rep} — السويدي للتنمية الصناعية`,en:`Greetings,

As promised, our offer for {project} has been sent to you.
Please review it and let me know your thoughts. I am happy to walk you through any of the details.

{rep} — Elsewedy Industrial Development`},"Meeting confirmation":{ar:`السلام عليكم ورحمة الله وبركاته

تأكيد موعد الاجتماع يوم {date} الساعة {time} بخصوص {project}.
في انتظار لقاء حضرتك.

{rep} — السويدي للتنمية الصناعية`,en:`Greetings,

Confirming our meeting on {date} at {time} regarding {project}.
Looking forward to seeing you.

{rep} — Elsewedy Industrial Development`},"Site visit confirmation":{ar:`السلام عليكم ورحمة الله وبركاته

تأكيد زيارة الموقع في {project} يوم {date} الساعة {time}.
سأكون في انتظار حضرتك هناك.

{rep} — السويدي للتنمية الصناعية`,en:`Greetings,

Confirming your site visit to {project} on {date} at {time}.
I will meet you there.

{rep} — Elsewedy Industrial Development`},"Thank you after a meeting":{ar:`السلام عليكم ورحمة الله وبركاته

شكراً لوقت حضرتك اليوم. سعدت بالتعرف على متطلبات المشروع، وسأوافيكم بكل التفاصيل المطلوبة بخصوص {project}.

{rep} — السويدي للتنمية الصناعية`,en:`Greetings,

Thank you for your time today. It was a pleasure understanding your project requirements, and I will send over everything discussed regarding {project}.

{rep} — Elsewedy Industrial Development`}},L={both:"العربية + English",ar:"العربية",en:"English"},I="sid_wa_lang";function N(){try{const e=localStorage.getItem(I);if(e==="ar"||e==="en"||e==="both")return e}catch{}return"both"}function M(e){try{localStorage.setItem(I,e)}catch{}}function _(e,n=N()){const r=x[e];return r?n==="ar"?r.ar:n==="en"?r.en:r.ar+`

— — —

`+r.en:""}function O(e,n,r,a){return e.replace(/\{name\}/g,v(n.customerName)).replace(/\{company\}/g,n.companyName||"your company").replace(/\{project\}/g,n.project||"our industrial cities").replace(/\{rep\}/g,r).replace(/\{date\}/g,(a==null?void 0:a.date)||"(date)").replace(/\{time\}/g,(a==null?void 0:a.time)||"(time)")}function P(e){return e.status==="Scheduled Meeting"||e.status==="Meeting Scheduled"?"Meeting confirmation":e.status==="Site Visit Scheduled"?"Site visit confirmation":e.status==="Offer Sent – Following Up"||e.status==="Quotation Sent"?"Offer sent":e.status==="New"||e.status==="Assigned"?/website|google|facebook|instagram|linkedin/i.test(String(e.source))?"Introduction — website enquiry":"Initial introduction":["Sent WhatsApp","No Answer","No Answer – Sent WhatsApp","Out of Coverage – Sent WhatsApp"].includes(String(e.status))?"No answer — tried to reach you":"Follow-up"}export{G as M,D as P,W as S,x as W,_ as a,L as b,M as c,v as d,C as f,N as g,P as s,O as w};
