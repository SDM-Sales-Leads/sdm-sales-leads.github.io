const s=new Set(["mr","mrs","ms","miss","eng","engineer","dr","prof","sir","madam","owner","manager","director","ceo","partner","founder","chairman","sales","procurement","purchasing","factory","company","trader","businessman","السيد","السيدة","الاستاذ","الأستاذ","استاذ","أستاذ","استاذة","أستاذة","مهندس","مهندسه","مهندسة","م","دكتور","دكتوره","دكتورة","د","الدكتور","الدكتورة","الحاج","الحاجة","حاج","حاجة","صاحب","صاحبة","شركه","شركة","مصنع","مدير","مديرة","مديره","رئيس","مجلس","ادارة","إدارة","انتاج","إنتاج","مالي","تنفيذي","عام","تاجر","رجل","اعمال","أعمال","بارتنر","شريك","مسؤل","مسئول","مسؤول","تصدير","استيراد","مشتريات","مبيعات","مورد","مقاول","مستثمر","عميل","مدير","زراعى","زراعي","مالك","مؤسس","وكيل"]),o=e=>e.replace(/[.،,:;()\-_]+/g,"").toLowerCase();function u(e){let n=String(e??"").trim();if(!n)return"";const t=n.split(/[\/\\|]/).map(i=>i.trim()).filter(Boolean);t.length>1&&(n=[...t].reverse().find(c=>c.split(/\s+/).some(a=>!s.has(o(a))&&o(a)))||t[t.length-1]);const r=n.split(/\s+/).filter(Boolean);for(;r.length>1&&s.has(o(r[0]));)r.shift();return r.join(" ").trim()||n}const d=new Set(["abd","abdel","abdul","abdal","abu","abou","عبد","ابو","أبو","عبدال"]),f=e=>{const n=u(e).split(/\s+/).filter(Boolean);return n.length?n.length>1&&d.has(n[0].toLowerCase().replace(/[-.]$/,""))?`${n[0]} ${n[1]}`:n[0]:""},p={"Initial introduction":{ar:`سلام عليكم باشمهندس

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

{rep} — Elsewedy Industrial Development`}},h={both:"العربية + English",ar:"العربية",en:"English"},l="sid_wa_lang";function m(){try{const e=localStorage.getItem(l);if(e==="ar"||e==="en"||e==="both")return e}catch{}return"both"}function y(e){try{localStorage.setItem(l,e)}catch{}}function w(e,n=m()){const t=p[e];return t?n==="ar"?t.ar:n==="en"?t.en:t.ar+`

— — —

`+t.en:""}function I(e,n,t,r){return e.replace(/\{name\}/g,u(n.customerName)).replace(/\{company\}/g,n.companyName||"your company").replace(/\{project\}/g,n.project||"our industrial cities").replace(/\{rep\}/g,t).replace(/\{date\}/g,(r==null?void 0:r.date)||"(date)").replace(/\{time\}/g,(r==null?void 0:r.time)||"(time)")}function b(e){return e.status==="Scheduled Meeting"||e.status==="Meeting Scheduled"?"Meeting confirmation":e.status==="Site Visit Scheduled"?"Site visit confirmation":e.status==="Offer Sent – Following Up"||e.status==="Quotation Sent"?"Offer sent":e.status==="New"||e.status==="Assigned"?/website|google|facebook|instagram|linkedin/i.test(String(e.source))?"Introduction — website enquiry":"Initial introduction":["Sent WhatsApp","No Answer","No Answer – Sent WhatsApp","Out of Coverage – Sent WhatsApp"].includes(String(e.status))?"No answer — tried to reach you":"Follow-up"}export{p as W,w as a,h as b,y as c,u as d,f,m as g,b as s,I as w};
