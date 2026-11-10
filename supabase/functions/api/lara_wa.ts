// deno-lint-ignore-file no-explicit-any
// Lara — phase 6: WhatsApp through Meta's WhatsApp Cloud API (direct, no middle company). NO AI.
// Meta rules are built in, not left to the user:
//  - a business-started message goes only to customers who enquired with us (consent = their enquiry) or wrote first;
//  - free text only within 24 hours of the customer's last message; outside it only Meta-APPROVED templates;
//  - "stop" words put the number on the do-not-contact list for every channel;
//  - "call me / visit" hands the lead to the salesperson; Lara never pretends to be a person;
//  - Lara pauses herself when Meta's quality rating for the number turns RED;
//  - TEST LOCK: while on, only the numbers in the test list can receive anything.
// Secrets (access token, app secret) live in the Vault; only ids are in system_config.lara_wa.
import { admin, getConfig, getSecret, hasSecret, HttpError, normPhone, nowIso, setConfig, setSecret, str } from "./lib.ts";

const GRAPH = "https://graph.facebook.com";
export interface WaCfg { phoneNumberId: string; wabaId: string; apiVersion: string; verifyToken: string; testNumbers: string[]; consentFromEnquiry: boolean; status?: { ok: boolean; at: string; error?: string; quality?: string; display?: string; name?: string } }

export async function waCfg(): Promise<WaCfg> {
  const c = await getConfig<any>("lara_wa", {});
  return {
    phoneNumberId: String(c.phoneNumberId || ""), wabaId: String(c.wabaId || ""), apiVersion: /^v\d+\.\d+$/.test(c.apiVersion || "") ? c.apiVersion : "v21.0",
    verifyToken: String(c.verifyToken || ""), testNumbers: Array.isArray(c.testNumbers) ? c.testNumbers.map((x: any) => intl(x)).filter(Boolean) : [],
    consentFromEnquiry: c.consentFromEnquiry !== false, status: c.status,
  };
}
export const waReady = async () => { const c = await waCfg(); return !!(c.status?.ok && c.phoneNumberId && (await hasSecret("wa_token"))); };
/** any Egyptian / international number -> digits with country code (2010…) */
export function intl(p: any): string {
  let d = String(p || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 11) d = "20" + d.slice(1);           // 010… -> 2010…
  if (d.length === 10 && d.startsWith("1")) d = "20" + d;                      // 10… -> 2010…
  return d.length >= 10 && d.length <= 15 ? d : "";
}

async function graph(path: string, init: RequestInit = {}): Promise<any> {
  const c = await waCfg(); const tok = await getSecret("wa_token");
  if (!tok) throw new HttpError(400, "WhatsApp is not set up (no access token)");
  const r = await fetch(`${GRAPH}/${c.apiVersion}/${path}`, { ...init, headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, `Meta: ${j?.error?.message || `HTTP ${r.status}`}`.slice(0, 240));
  return j;
}

/** admin: save the WhatsApp settings (token and app secret go to the Vault) and test the number */
export async function saveWa(b: any, by: string) {
  const cur = await getConfig<any>("lara_wa", {});
  const next: any = {
    ...cur,
    phoneNumberId: str(b.phoneNumberId, 40).replace(/\D/g, "") || cur.phoneNumberId || "",
    wabaId: str(b.wabaId, 40).replace(/\D/g, "") || cur.wabaId || "",
    apiVersion: /^v\d+\.\d+$/.test(b.apiVersion || "") ? b.apiVersion : cur.apiVersion || "v21.0",
    verifyToken: cur.verifyToken || crypto.randomUUID().replace(/-/g, ""),
    testNumbers: Array.isArray(b.testNumbers) ? b.testNumbers.map((x: any) => intl(x)).filter(Boolean).slice(0, 10) : cur.testNumbers || [],
    consentFromEnquiry: b.consentFromEnquiry !== false,
  };
  if (typeof b.token === "string" && b.token.trim()) await setSecret("wa_token", b.token.trim());
  if (typeof b.appSecret === "string" && b.appSecret.trim()) await setSecret("wa_app_secret", b.appSecret.trim());
  await setConfig("lara_wa", next);
  let status: any;
  try {
    if (!next.phoneNumberId) throw new HttpError(400, "Write the phone number ID");
    const p = await graph(`${next.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
    status = { ok: true, at: nowIso(), display: p.display_phone_number, name: p.verified_name, quality: p.quality_rating };
  } catch (e: any) { status = { ok: false, at: nowIso(), error: String(e?.message || e).slice(0, 200) }; }
  await setConfig("lara_wa", { ...next, status });
  await admin.from("lara_log").insert({ kind: "config", actor: by, text: `WhatsApp ${status.ok ? `connected (${status.display}, quality ${status.quality})` : `not connected: ${status.error}`}` });
  return { ...next, status, hasToken: await hasSecret("wa_token"), hasAppSecret: await hasSecret("wa_app_secret") };
}

/** approved templates from Meta (cached); the admin links a template to each Lara situation for messages outside the 24-hour window */
export async function syncTemplates() {
  const c = await waCfg();
  if (!c.wabaId) throw new HttpError(400, "Write the WhatsApp Business Account ID first");
  const j = await graph(`${c.wabaId}/message_templates?fields=name,status,language,category,components&limit=200`);
  const keep = new Map(((await admin.from("lara_wa_templates").select("name,lang,situation")).data || []).map((r: any) => [`${r.name}|${r.lang}`, r.situation]));
  const rows = (j.data || []).map((t: any) => {
    const body = (t.components || []).find((x: any) => x.type === "BODY")?.text || "";
    const params = new Set((body.match(/\{\{\d+\}\}/g) || [])).size;
    return { name: str(t.name, 120), lang: str(t.language, 20), status: str(t.status, 30), category: str(t.category, 30), body: str(body, 2000), params, situation: keep.get(`${t.name}|${t.language}`) || null, synced_at: nowIso() };
  });
  if (rows.length) await admin.from("lara_wa_templates").upsert(rows);
  return { count: rows.length, approved: rows.filter((r: any) => r.status === "APPROVED").length };
}

/** one message to one number: free text inside the 24-hour window, else an approved template */
export async function waSend(to: string, m: { text?: string; template?: { name: string; lang: string; params: string[] } }): Promise<string> {
  const c = await waCfg();
  const body: any = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (m.template) {
    body.type = "template";
    body.template = { name: m.template.name, language: { code: m.template.lang }, ...(m.template.params.length ? { components: [{ type: "body", parameters: m.template.params.map((t) => ({ type: "text", text: String(t).slice(0, 1000) })) }] } : {}) };
  } else { body.type = "text"; body.text = { preview_url: false, body: String(m.text || "").slice(0, 4096) }; }
  const j = await graph(`${c.phoneNumberId}/messages`, { method: "POST", body: JSON.stringify(body) });
  const id = j?.messages?.[0]?.id;
  if (!id) throw new HttpError(502, "Meta did not accept the message");
  return id;
}

/** Meta's webhook signature: HMAC-SHA256 of the raw body with the app secret */
export async function waSignatureOk(raw: string, header: string | null): Promise<boolean> {
  const secret = await getSecret("wa_app_secret");
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  const want = header.slice(7);
  if (hex.length !== want.length) return false;
  let d = 0; for (let i = 0; i < hex.length; i++) d |= hex.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

/** the lead and conversation of a WhatsApp number (the lead's phone, any format) */
export async function waThreadFor(phone: string) {
  const { data: t } = await admin.from("lara_threads").select("*").eq("wa_phone", phone).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (t) return t;
  const local = normPhone(phone);
  const { data: lead } = await admin.from("crm_leads").select("id,data->email").eq("phone_norm", local).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!lead) return null;
  const { data: t2 } = await admin.from("lara_threads").select("*").eq("lead_id", lead.id).maybeSingle();
  if (t2) { await admin.from("lara_threads").update({ wa_phone: phone }).eq("id", t2.id); return { ...t2, wa_phone: phone }; }
  const code = `SDM-${String(lead.id).toUpperCase()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
  const ins = await admin.from("lara_threads").insert({ lead_id: lead.id, code, customer_email: String((lead as any).email || "").toLowerCase(), wa_phone: phone }).select("*").single();
  return ins.data || null;
}

/** inside the 24-hour customer-service window? */
export const inWindow = (t: any) => !!(t?.wa_last_in && Date.now() - Date.parse(t.wa_last_in) < 24 * 3600 * 1000);
