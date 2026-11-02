// deno-lint-ignore-file no-explicit-any
// 3 Nov 2026: a customer name must be a person (or company contact) - never an ad name, a code, a link, an e-mail or a phone number.
// Where a bad "name" arrives (mail, call center, mobile app, website, Facebook sheet, Excel import, a typed edit) the system first tries to find the REAL name
// of the same phone / e-mail among the contacts and leads it already has; if there is none the lead is created as "Name needed" (the text stays in the
// description) so a person fills it in. Nothing is guessed from an e-mail address.
import { admin, normEmail, normPhone } from "./lib.ts";

export const NAME_NEEDED = "Name needed";

/** "" when it can be a person's name, else why not */
export function nameProblem(raw: any): string {
  const t = String(raw ?? "").trim();
  if (!t || t === NAME_NEEDED) return "";
  if (/^BO\s?#/i.test(t) || (t.match(/\|/g) || []).length >= 2 || (/#\s?\d{4,}/.test(t) && t.length > 30)) return "an ad or campaign name";
  if (/\b(campaign|ad ?set|lookalike|retarget\w*|audience|feed|stories|reels)\b/i.test(t) && t.length > 28) return "an ad or campaign name";
  if (/@/.test(t)) return "an e-mail address";
  if (/https?:\/\/|www\./i.test(t)) return "a web link";
  const digits = (t.match(/\d/g) || []).length;
  if (digits >= 6 || (digits >= 3 && digits / t.length > 0.4)) return "a number or code";
  if (t.length > 80) return "too long to be a name";
  if (/^(test|n\/a|na|none|unknown|null|undefined|no name|customer|lead|client|-+|\.+)$/i.test(t)) return "a placeholder";
  return "";
}

/** the real name of this phone / e-mail among the contacts and leads we already hold (one clear answer only) */
export async function knownName(phone: any, email: any, selfId = ""): Promise<string> {
  const ph = normPhone(phone), em = normEmail(email);
  const names = new Set<string>();
  const take = (n: any) => { const s = String(n ?? "").trim(); if (s && s !== NAME_NEEDED && !nameProblem(s)) names.add(s); };
  if (ph) {
    const c = await admin.from("crm_contacts").select("data").eq("phone_norm", ph).is("deleted_at", null).limit(5);
    (c.data || []).forEach((r: any) => take(r.data?.name));
    if (!names.size) { const l = await admin.from("crm_leads").select("id,data").eq("phone_norm", ph).is("deleted_at", null).limit(8); (l.data || []).forEach((r: any) => { if (r.id !== selfId) take(r.data?.customerName); }); }
  }
  if (!names.size && em) {
    const c = await admin.from("crm_contacts").select("data").eq("email_norm", em).is("deleted_at", null).limit(5);
    (c.data || []).forEach((r: any) => take(r.data?.name));
  }
  return names.size === 1 ? [...names][0] : "";
}

/** fixes a lead's customerName in place. Returns what happened ("" = nothing to do) */
export async function repairName(d: any): Promise<"" | "found" | "needed"> {
  const why = nameProblem(d.customerName);
  if (!why) return "";
  const written = String(d.customerName).replace(/\s+/g, " ").trim().slice(0, 200);
  const known = await knownName(d.phoneNumber, d.email, String(d.id || ""));
  const note = `Name (as written): ${written}`;
  if (!String(d.description || "").includes(written)) d.description = `${d.description ? d.description + "\n" : ""}${note}`.slice(0, 4000);
  d.customerName = known || NAME_NEEDED;
  return known ? "found" : "needed";
}
