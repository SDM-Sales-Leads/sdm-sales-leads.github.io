// deno-lint-ignore-file no-explicit-any
// Exchange Web Services (on-prem Exchange 2019) over HTTPS with Basic auth.
// Credentials: host + user in system_config "email_config", password in Vault ("ews_password").
// TLS is always verified (the old Express server turned certificate checks off — removed).
import { HttpError, escXml, getConfig, getSecret } from "./lib.ts";

export interface EwsConfig {
  host: string;
  user: string;
  pass: string;
}

const HOST_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export async function loadEws(): Promise<EwsConfig> {
  const cfg = await getConfig<any>("email_config", {});
  const pass = await getSecret("ews_password");
  const host = String(cfg.host || "");
  const user = String(cfg.user || "");
  if (!host || !user || !pass) throw new HttpError(400, "E-mail is not configured yet (Admin → Email)");
  if (!HOST_RE.test(host)) throw new HttpError(400, "The configured mail host is not a valid host name");
  return { host, user, pass };
}

export function validHost(h: string) {
  return HOST_RE.test(h);
}

const NS = `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"`;
const envelope = (inner: string) => `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope ${NS}>
  <soap:Header><t:RequestServerVersion Version="Exchange2016" /></soap:Header>
  <soap:Body>${inner}</soap:Body>
</soap:Envelope>`;

export const xmlDecode = (s: string) =>
  s.replace(/&#xD;/g, "\r").replace(/&#xA;/g, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

async function call(cfg: EwsConfig, soap: string, timeoutMs = 25000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://${cfg.host}/EWS/Exchange.asmx`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Authorization": "Basic " + btoa(unescape(encodeURIComponent(`${cfg.user}:${cfg.pass}`))),
      },
      body: soap,
      signal: ctl.signal,
    });
    const text = await res.text();
    if (res.status === 401) throw new HttpError(502, "The mail server rejected the mailbox user name or password");
    if (!res.ok) throw new HttpError(502, `The mail server answered HTTP ${res.status}`);
    if (text.includes('ResponseClass="Error"')) {
      const m = text.match(/<m:MessageText>([\s\S]*?)<\/m:MessageText>/);
      throw new HttpError(502, "Mail server error: " + (m ? xmlDecode(m[1]).slice(0, 200) : "unknown"));
    }
    return text;
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    if (e?.name === "AbortError") throw new HttpError(504, "The mail server did not answer in time");
    throw new HttpError(502, "Could not reach the mail server");
  } finally {
    clearTimeout(timer);
  }
}

export async function verify(cfg: EwsConfig) {
  await call(cfg, envelope(`<m:ResolveNames ReturnFullContactData="false"><m:UnresolvedEntry>${escXml(cfg.user)}</m:UnresolvedEntry></m:ResolveNames>`), 15000);
}

export async function sendMail(cfg: EwsConfig, o: { to: string[]; subject: string; html?: string; text?: string; replyTo?: string }) {
  const to = o.to.map((e) => `<t:Mailbox><t:EmailAddress>${escXml(e)}</t:EmailAddress></t:Mailbox>`).join("");
  const bodyType = o.html ? "HTML" : "Text";
  // CDATA cannot contain "]]>" — split it so user text can never break out of the section
  const bodyText = (o.html || o.text || "").replace(/\]\]>/g, "]]]]><![CDATA[>");
  await call(cfg, envelope(`<m:CreateItem MessageDisposition="SendAndSaveCopy">
      <m:SavedItemFolderId><t:DistinguishedFolderId Id="sentitems" /></m:SavedItemFolderId>
      <m:Items><t:Message>
        <t:Subject>${escXml(o.subject.replace(/[\r\n]+/g, " ").slice(0, 250))}</t:Subject>
        <t:Body BodyType="${bodyType}"><![CDATA[${bodyText}]]></t:Body>
        <t:ToRecipients>${to}</t:ToRecipients>
        ${o.replyTo ? `<t:ReplyTo><t:Mailbox><t:EmailAddress>${escXml(o.replyTo)}</t:EmailAddress></t:Mailbox></t:ReplyTo>` : ""}
      </t:Message></m:Items>
    </m:CreateItem>`));
}

/** a mail with one file attached (Lara's offer PDF): create it as a draft, attach the file, then send it (the EWS way) */
export async function sendMailWithAttachment(cfg: EwsConfig, o: { to: string[]; subject: string; html: string; replyTo?: string }, att: { name: string; contentType: string; base64: string }) {
  const to = o.to.map((e) => `<t:Mailbox><t:EmailAddress>${escXml(e)}</t:EmailAddress></t:Mailbox>`).join("");
  const bodyText = o.html.replace(/\]\]>/g, "]]]]><![CDATA[>");
  const created = await call(cfg, envelope(`<m:CreateItem MessageDisposition="SaveOnly">
      <m:SavedItemFolderId><t:DistinguishedFolderId Id="drafts" /></m:SavedItemFolderId>
      <m:Items><t:Message>
        <t:Subject>${escXml(o.subject.replace(/[\r\n]+/g, " ").slice(0, 250))}</t:Subject>
        <t:Body BodyType="HTML"><![CDATA[${bodyText}]]></t:Body>
        <t:ToRecipients>${to}</t:ToRecipients>
        ${o.replyTo ? `<t:ReplyTo><t:Mailbox><t:EmailAddress>${escXml(o.replyTo)}</t:EmailAddress></t:Mailbox></t:ReplyTo>` : ""}
      </t:Message></m:Items>
    </m:CreateItem>`));
  const item = created.match(/<t:ItemId Id="([^"]+)" ChangeKey="([^"]+)"/);
  if (!item) throw new HttpError(502, "The mail server did not create the draft");
  const attached = await call(cfg, envelope(`<m:CreateAttachment>
      <m:ParentItemId Id="${escXml(item[1])}" ChangeKey="${escXml(item[2])}" />
      <m:Attachments><t:FileAttachment><t:Name>${escXml(att.name)}</t:Name><t:ContentType>${escXml(att.contentType)}</t:ContentType><t:Content>${att.base64}</t:Content></t:FileAttachment></m:Attachments>
    </m:CreateAttachment>`), 40000);
  const root = attached.match(/RootItemChangeKey="([^"]+)"/)?.[1];
  if (!root) throw new HttpError(502, "The mail server did not attach the file");
  await call(cfg, envelope(`<m:SendItem SaveItemToFolder="true">
      <m:ItemIds><t:ItemId Id="${escXml(item[1])}" ChangeKey="${escXml(root)}" /></m:ItemIds>
      <m:SavedItemFolderId><t:DistinguishedFolderId Id="sentitems" /></m:SavedItemFolderId>
    </m:SendItem>`));
}

export interface MailHead {
  id: string;
  sender: string;
  senderAddress: string;
  subject: string;
  bodyPreview: string;
  receivedTime: string;
  folder: string;
}

export async function listFolder(cfg: EwsConfig, folder: "inbox" | "sentitems", limit: number, since?: string, offset = 0): Promise<MailHead[]> {
  // `since` (ISO time made by us) = only mail received at or after it: the mail server filters, we do not list what we already handled
  const restriction = since && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(since)
    ? `<m:Restriction><t:IsGreaterThanOrEqualTo><t:FieldURI FieldURI="item:DateTimeReceived" /><t:FieldURIOrConstant><t:Constant Value="${since}" /></t:FieldURIOrConstant></t:IsGreaterThanOrEqualTo></m:Restriction>` : "";
  const xml = await call(cfg, envelope(`<m:FindItem Traversal="Shallow">
      <m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>
        <t:FieldURI FieldURI="item:Subject" /><t:FieldURI FieldURI="item:DateTimeReceived" />
        <t:FieldURI FieldURI="message:From" /><t:FieldURI FieldURI="message:ToRecipients" /><t:FieldURI FieldURI="item:Preview" />
      </t:AdditionalProperties></m:ItemShape>
      <m:IndexedPageItemView MaxEntriesReturned="${Math.max(1, Math.min(limit, 100))}" Offset="${Math.max(0, offset)}" BasePoint="Beginning" />
      ${restriction}
      <m:SortOrder><t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived" /></t:FieldOrder></m:SortOrder>
      <m:ParentFolderIds><t:DistinguishedFolderId Id="${folder}" /></m:ParentFolderIds>
    </m:FindItem>`));
  const out: MailHead[] = [];
  const re = /<t:Message>([\s\S]*?)<\/t:Message>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const x = m[1];
    const id = x.match(/<t:ItemId Id="([^"]+)"/)?.[1];
    if (!id) continue;
    const from = x.match(/<t:From>([\s\S]*?)<\/t:From>/)?.[1] || "";
    const to = x.match(/<t:ToRecipients>([\s\S]*?)<\/t:ToRecipients>/)?.[1] || "";
    const party = folder === "sentitems" ? to : from;
    const name = party.match(/<t:Name>([\s\S]*?)<\/t:Name>/)?.[1];
    const addr = party.match(/<t:EmailAddress>([\s\S]*?)<\/t:EmailAddress>/)?.[1] || "";
    out.push({
      id,
      sender: xmlDecode(name || addr || "Unknown"),
      senderAddress: xmlDecode(addr),
      subject: xmlDecode(x.match(/<t:Subject>([\s\S]*?)<\/t:Subject>/)?.[1] || ""),
      bodyPreview: xmlDecode(x.match(/<t:Preview>([\s\S]*?)<\/t:Preview>/)?.[1] || ""),
      receivedTime: x.match(/<t:DateTimeReceived>([\s\S]*?)<\/t:DateTimeReceived>/)?.[1] || new Date().toISOString(),
      folder: folder === "sentitems" ? "sent" : "inbox",
    });
  }
  return out;
}

export async function getBody(cfg: EwsConfig, id: string): Promise<{ html: string; subject: string }> {
  // an Exchange item id is base64 text — refuse anything else so it cannot alter the XML
  if (!/^[A-Za-z0-9+/=_-]{20,600}$/.test(id)) throw new HttpError(400, "Invalid message id");
  const xml = await call(cfg, envelope(`<m:GetItem>
      <m:ItemShape><t:BaseShape>Default</t:BaseShape><t:IncludeMimeContent>false</t:IncludeMimeContent><t:BodyType>HTML</t:BodyType></m:ItemShape>
      <m:ItemIds><t:ItemId Id="${escXml(id)}" /></m:ItemIds>
    </m:GetItem>`));
  const b = xml.match(/<t:Body[^>]*>([\s\S]*?)<\/t:Body>/);
  return {
    html: b ? xmlDecode(b[1]) : "",
    subject: xmlDecode(xml.match(/<t:Subject>([\s\S]*?)<\/t:Subject>/)?.[1] || ""),
  };
}

/** bodies of several mails: 8 per request, up to 3 requests at the same time. Returns id -> body; unreadable ids are left out. */
export async function getBodies(cfg: EwsConfig, ids: string[]): Promise<Map<string, { html: string; subject: string }>> {
  const out = new Map<string, { html: string; subject: string }>();
  const ok = ids.filter((id) => /^[A-Za-z0-9+/=_-]{20,600}$/.test(id));
  const chunks: string[][] = [];
  for (let i = 0; i < ok.length; i += 8) chunks.push(ok.slice(i, i + 8));
  const doChunk = async (chunk: string[]) => {
    try {
      const xml = await call(cfg, envelope(`<m:GetItem>
      <m:ItemShape><t:BaseShape>Default</t:BaseShape><t:IncludeMimeContent>false</t:IncludeMimeContent><t:BodyType>HTML</t:BodyType></m:ItemShape>
      <m:ItemIds>${chunk.map((id) => `<t:ItemId Id="${escXml(id)}" />`).join("")}</m:ItemIds>
    </m:GetItem>`));
      xml.split(/<m:GetItemResponseMessage /).slice(1).forEach((m, k) => {
        const b = m.match(/<t:Body[^>]*>([\s\S]*?)<\/t:Body>/);
        out.set(chunk[k], { html: b ? xmlDecode(b[1]) : "", subject: xmlDecode(m.match(/<t:Subject>([\s\S]*?)<\/t:Subject>/)?.[1] || "") });
      });
    } catch (e) {
      // a refused sign-in or a server error stops everything; a single bad mail only costs this chunk (read it one by one)
      if (e instanceof HttpError && /rejected|HTTP 4|HTTP 5/.test(e.message)) throw e;
      for (const id of chunk) { try { out.set(id, await getBody(cfg, id)); } catch { /* left out */ } }
    }
  };
  for (let i = 0; i < chunks.length; i += 3) await Promise.all(chunks.slice(i, i + 3).map(doChunk));
  return out;
}

// readable text from an HTML mail body (for parsing)
export function htmlToText(html: string): string {
  if (!html) return "";
  let t = html;
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, " \t ");
  t = t.replace(/<tr[^>]*>/gi, "\n").replace(/<\/tr>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/&nbsp;/gi, " ");
  t = xmlDecode(t);
  return t.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
}
