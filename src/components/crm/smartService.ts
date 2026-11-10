// Server side of the Smart Assistant: a feature-use counter and the "Improve with AI" / "AI brief" buttons.
// Both are optional: when the server part is not deployed yet (404) the page works on its own rules and says so.

const sent = new Set<string>();
/** count that this person used a feature today: at most one call per feature per page session (keeps the free-plan calls low) */
export function trackFeature(feature: string) {
  if (!feature || sent.has(feature)) return;
  sent.add(feature);
  try { void fetch('/api/smart/use', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature }), keepalive: true }).catch(() => {}); } catch { /* never block the screen */ }
}

export type AiKind = 'whatsapp' | 'email' | 'brief';
export interface AiResult { ok: boolean; text?: string; subject?: string; brief?: string[]; nextStep?: string; error?: string; left?: number }

export async function askAi(leadId: string, kind: AiKind, lang: 'ar' | 'en', draft = ''): Promise<AiResult> {
  try {
    const r = await fetch('/api/smart/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId, kind, lang, draft: draft.slice(0, 3000) }) });
    if (r.status === 404) return { ok: false, error: 'The AI part is not switched on yet (server update pending).' };
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j?.error || `The AI could not answer (${r.status}).` };
    return { ok: true, ...j };
  } catch {
    return { ok: false, error: 'No connection to the server.' };
  }
}
