// deno-lint-ignore-file no-explicit-any
// A very small PDF writer (no library, no outside service): A4 pages, Helvetica / Helvetica-Bold, text, lines, filled boxes.
// Latin text only (the built-in PDF fonts have no Arabic): callers pass English text; other characters become "?".
// Used for Lara's initial offers (phase 5).

const W_HELV: Record<string, number> = {};
// Helvetica widths (1/1000 em) for the characters we use; others fall back to 556
"0123456789".split("").forEach((c) => (W_HELV[c] = 556));
Object.assign(W_HELV, { " ": 278, ",": 278, ".": 278, "-": 333, ":": 278, "/": 278, "(": 333, ")": 333, "%": 889, "&": 667, "#": 556, "+": 584, "'": 191, '"': 355, "–": 556, "—": 1000, "·": 278, "²": 333 });
for (const c of "abcdeghnopqu") W_HELV[c] = 556;
Object.assign(W_HELV, { f: 278, i: 222, j: 222, k: 500, l: 222, m: 833, r: 333, s: 500, t: 278, v: 500, w: 722, x: 500, y: 500, z: 500 });
for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") W_HELV[c] = 667;
Object.assign(W_HELV, { I: 278, J: 500, M: 833, W: 944, F: 611, L: 556, T: 611, Z: 611, O: 778, Q: 778, G: 778, C: 722, D: 722, H: 722, N: 722, R: 722, U: 722, X: 667, Y: 667 });

export const textWidth = (s: string, size: number, bold = false) => [...s].reduce((w, c) => w + (W_HELV[c] ?? 556), 0) * size / 1000 * (bold ? 1.06 : 1);

/** WinAnsi-safe text: keep Latin-1 and a few typographic marks, replace the rest */
function enc(s: string): string {
  const map: Record<string, string> = { "–": "\x96", "—": "\x97", "·": "\xb7", "²": "\xb2", "’": "\x92", "‘": "\x91", "“": "\x93", "”": "\x94", "•": "\x95" };
  let out = "";
  for (const ch of s) {
    const m = map[ch];
    const c = m || ch;
    const code = c.charCodeAt(0);
    out += code < 32 ? " " : code > 255 ? "?" : c;
  }
  return out.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
const rgb = (hex: string) => { const n = parseInt(hex.replace("#", ""), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => v.toFixed(3)).join(" "); };

export class Pdf {
  readonly W = 595.28; readonly H = 841.89;
  private pages: string[] = [];
  private cur: string[] = [];
  constructor() { this.addPage(); }
  addPage() { if (this.cur.length) this.pages.push(this.cur.join("\n")); this.cur = []; return this; }
  /** y is measured from the TOP of the page (easier to lay out) */
  text(x: number, y: number, s: string, o: { size?: number; bold?: boolean; color?: string; align?: "left" | "right" | "center" } = {}) {
    const size = o.size || 10; const bold = !!o.bold;
    let xx = x;
    if (o.align === "right") xx = x - textWidth(s, size, bold);
    if (o.align === "center") xx = x - textWidth(s, size, bold) / 2;
    this.cur.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${rgb(o.color || "#2D2926")} rg ${xx.toFixed(2)} ${(this.H - y).toFixed(2)} Td (${enc(s)}) Tj ET`);
    return this;
  }
  /** wraps text into lines that fit `width`; returns the y after the last line */
  para(x: number, y: number, width: number, s: string, o: { size?: number; bold?: boolean; color?: string; lead?: number } = {}) {
    const size = o.size || 10; const lead = o.lead || size * 1.4;
    for (const raw of s.split("\n")) {
      let line = "";
      for (const word of raw.split(/\s+/)) {
        const t = line ? `${line} ${word}` : word;
        if (textWidth(t, size, o.bold) > width && line) { this.text(x, y, line, o); y += lead; line = word; } else line = t;
      }
      this.text(x, y, line, o); y += lead;
    }
    return y;
  }
  box(x: number, y: number, w: number, h: number, fill: string) { this.cur.push(`${rgb(fill)} rg ${x.toFixed(2)} ${(this.H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); return this; }
  line(x1: number, y1: number, x2: number, y2: number, color = "#D9D9D9", width = 0.6) { this.cur.push(`${rgb(color)} RG ${width} w ${x1.toFixed(2)} ${(this.H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.H - y2).toFixed(2)} l S`); return this; }

  bytes(): Uint8Array {
    if (this.cur.length) { this.pages.push(this.cur.join("\n")); this.cur = []; }
    const objs: string[] = [];
    const add = (s: string) => { objs.push(s); return objs.length; };
    const catalog = add(""); const pagesId = add("");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids: number[] = [];
    for (const content of this.pages) {
      const data = latin1(content);
      const cs = add(`<< /Length ${data.length} >>\nstream\n${content}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cs} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(latin1(out).length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = latin1(out).length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return latin1(out);
  }
}
/** one byte per character (the content uses WinAnsi codes 0–255 only) */
function latin1(s: string): Uint8Array { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
export const toBase64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
