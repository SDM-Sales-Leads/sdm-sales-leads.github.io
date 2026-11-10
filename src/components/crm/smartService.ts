// Server side of the Smart Assistant: only a feature-use counter. The page itself uses NO AI (owner, 10 Nov 2026: AI only where really needed).

const sent = new Set<string>();
/** count that this person used a feature today: at most one call per feature per page session (keeps the free-plan calls low) */
export function trackFeature(feature: string) {
  if (!feature || sent.has(feature)) return;
  sent.add(feature);
  try { void fetch('/api/smart/use', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature }), keepalive: true }).catch(() => {}); } catch { /* never block the screen */ }
}
