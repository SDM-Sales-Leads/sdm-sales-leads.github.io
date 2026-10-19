// Text size for the whole system (people found it too small). Three steps, remembered in this browser; scales the text and the
// rem-based sizes of every page, including the small fixed pixel sizes (see index.css, --ui-scale).
export type TextSize = 'normal' | 'large' | 'xlarge';
const KEY = 'sdm_text_size';
const SCALE: Record<TextSize, number> = { normal: 1, large: 1.15, xlarge: 1.3 };
export const TEXT_SIZE_LABEL: Record<TextSize, string> = { normal: 'Normal', large: 'Large', xlarge: 'Extra large' };

export function getTextSize(): TextSize {
  try { const v = localStorage.getItem(KEY) as TextSize | null; if (v && SCALE[v]) return v; } catch { /* ignore */ }
  return 'large';
}
export function applyTextSize(s: TextSize = getTextSize()) {
  const r = document.documentElement;
  r.style.setProperty('--ui-scale', String(SCALE[s]));
  r.style.fontSize = `${16 * SCALE[s]}px`;
}
export function setTextSize(s: TextSize) { try { localStorage.setItem(KEY, s); } catch { /* ignore */ } applyTextSize(s); window.dispatchEvent(new Event('sdm-text-size')); }
export const nextTextSize = (s: TextSize): TextSize => (s === 'normal' ? 'large' : s === 'large' ? 'xlarge' : 'normal');
