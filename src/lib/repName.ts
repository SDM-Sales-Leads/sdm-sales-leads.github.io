// "walid.tawfik@elsewedy.com" -> "Walid Tawfik": first and second name from the e-mail address (falls back to the account name).
export function repNameFromEmail(email?: string | null, fallback = ''): string {
  const local = String(email || '').split('@')[0].trim();
  const parts = local.split(/[._\-+\s]+/).filter((p) => /^[a-zA-Z؀-ۿ]{2,}$/.test(p)).slice(0, 2);
  if (!parts.length) return fallback;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

/** every message ends with the sender's name: a trailing "Name — company" line becomes "company" + the name; otherwise the name is added */
export function signOff(text: string, name: string): string {
  if (!name) return text;
  const t = text.replace(/\s+$/, '');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = t.split('\n');
  const last = lines[lines.length - 1].trim();
  if (last === name) return t;
  if (new RegExp(`^${esc}\\s*[—–-]\\s*(.+)$`).test(last)) { lines[lines.length - 1] = last.replace(new RegExp(`^${esc}\\s*[—–-]\\s*`), ''); return lines.join('\n') + '\n' + name; }
  return t + '\n\n' + name;
}

/** a phone or tablet: the dialer, WhatsApp and the mail app can be opened straight from the page */
export const isPhoneDevice = (): boolean => {
  try { return window.matchMedia('(max-width: 767px)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); } catch { return false; }
};
