// deno-lint-ignore-file no-explicit-any
// A very small PDF writer (no library, no outside service): A4 pages in points, Helvetica in 4 styles, text, lines, boxes, JPEG images.
// Latin text only (the built-in PDF fonts have no Arabic): callers pass English text; other characters become "?".
// Used for Lara's offers (phase 5), laid out like the Land Bank's Sales Offer.

const W_HELV: Record<string, number> = {};
"0123456789".split("").forEach((c) => (W_HELV[c] = 556));
Object.assign(W_HELV, { " ": 278, ",": 278, ".": 278, "-": 333, ":": 278, "/": 278, "(": 333, ")": 333, "%": 889, "&": 667, "#": 556, "+": 584, "'": 191, '"': 355, "–": 556, "—": 1000, "·": 278, "²": 333, "*": 389, "?": 556, "!": 278, ";": 278 });
for (const c of "abcdeghnopqu") W_HELV[c] = 556;
Object.assign(W_HELV, { f: 278, i: 222, j: 222, k: 500, l: 222, m: 833, r: 333, s: 500, t: 278, v: 500, w: 722, x: 500, y: 500, z: 500 });
for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") W_HELV[c] = 667;
Object.assign(W_HELV, { I: 278, J: 500, M: 833, W: 944, F: 611, L: 556, T: 611, Z: 611, O: 778, Q: 778, G: 778, C: 722, D: 722, H: 722, N: 722, R: 722, U: 722, X: 667, Y: 667 });

/** width in points (bold is a little wider) */
export const textWidth = (s: string, size: number, bold = false) => [...String(s)].reduce((w, c) => w + (W_HELV[c] ?? 556), 0) * size / 1000 * (bold ? 1.06 : 1);

/** WinAnsi-safe text: keep Latin-1 and a few typographic marks, replace the rest */
function enc(s: string): string {
  const map: Record<string, string> = { "–": "\x96", "—": "\x97", "·": "\xb7", "²": "\xb2", "’": "\x92", "‘": "\x91", "“": "\x93", "”": "\x94", "•": "\x95", "…": "\x85" };
  let out = "";
  for (const ch of String(s)) {
    const c = map[ch] || ch;
    const code = c.charCodeAt(0);
    out += code < 32 ? " " : code > 255 ? "?" : c;
  }
  return out.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
const col = (c: string | number[]) => {
  if (Array.isArray(c)) return c.map((v) => (v / 255).toFixed(3)).join(" ");
  const n = parseInt(String(c).replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => v.toFixed(3)).join(" ");
};
export type Color = string | number[];
export interface TextOpts { size?: number; bold?: boolean; italic?: boolean; color?: Color; align?: "left" | "right" | "center"; middle?: boolean }
export interface Jpeg { w: number; h: number; c: number; b64: string }

export class Pdf {
  readonly W = 595.28; readonly H = 841.89;
  private pages: string[] = [];
  private cur: string[] = [];
  private imgs = new Map<string, { id: string; img: Jpeg }>();
  constructor() { this.addPage(); }
  addPage() { if (this.cur.length) this.pages.push(this.cur.join("\n")); this.cur = []; return this; }
  /** y is measured from the TOP of the page; middle=true puts the text's middle on y (like jsPDF baseline "middle") */
  text(x: number, y: number, s: string, o: TextOpts = {}) {
    const size = o.size || 10; const bold = !!o.bold;
    let xx = x;
    if (o.align === "right") xx = x - textWidth(s, size, bold);
    if (o.align === "center") xx = x - textWidth(s, size, bold) / 2;
    const base = o.middle ? y + size * 0.35 : y;
    const f = bold && o.italic ? "F4" : o.italic ? "F3" : bold ? "F2" : "F1";
    this.cur.push(`BT /${f} ${size} Tf ${col(o.color || "#2D2926")} rg ${xx.toFixed(2)} ${(this.H - base).toFixed(2)} Td (${enc(s)}) Tj ET`);
    return this;
  }
  /** splits text into lines that fit `width` */
  split(s: string, width: number, size: number, bold = false): string[] {
    const out: string[] = [];
    for (const raw of String(s).split("\n")) {
      let line = "";
      for (const word of raw.split(/\s+/)) {
        const t = line ? `${line} ${word}` : word;
        if (textWidth(t, size, bold) > width && line) { out.push(line); line = word; } else line = t;
      }
      out.push(line);
    }
    return out;
  }
  /** wraps text into lines that fit `width`; returns the y after the last line */
  para(x: number, y: number, width: number, s: string, o: TextOpts & { lead?: number } = {}) {
    const size = o.size || 10; const lead = o.lead || size * 1.4;
    for (const line of this.split(s, width, size, o.bold)) { this.text(x, y, line, o); y += lead; }
    return y;
  }
  /** a rectangle: filled, outlined, or both */
  rect(x: number, y: number, w: number, h: number, o: { fill?: Color; stroke?: Color; lw?: number } = {}) {
    const p = `${x.toFixed(2)} ${(this.H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`;
    if (o.fill && o.stroke) this.cur.push(`${col(o.fill)} rg ${col(o.stroke)} RG ${o.lw ?? 0.6} w ${p} B`);
    else if (o.fill) this.cur.push(`${col(o.fill)} rg ${p} f`);
    else this.cur.push(`${col(o.stroke || [0, 0, 0])} RG ${o.lw ?? 0.6} w ${p} S`);
    return this;
  }
  box(x: number, y: number, w: number, h: number, fill: Color) { return this.rect(x, y, w, h, { fill }); }
  line(x1: number, y1: number, x2: number, y2: number, color: Color = "#D9D9D9", width = 0.6) { this.cur.push(`${col(color)} RG ${width} w ${x1.toFixed(2)} ${(this.H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.H - y2).toFixed(2)} l S`); return this; }
  /** a JPEG image (y from the top) */
  image(key: string, img: Jpeg, x: number, y: number, w: number, h: number) {
    let e = this.imgs.get(key);
    if (!e) { e = { id: `Im${this.imgs.size + 1}`, img }; this.imgs.set(key, e); }
    this.cur.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(this.H - y - h).toFixed(2)} cm /${e.id} Do Q`);
    return this;
  }

  bytes(): Uint8Array {
    if (this.cur.length) { this.pages.push(this.cur.join("\n")); this.cur = []; }
    const objs: string[] = [];
    const add = (s: string) => { objs.push(s); return objs.length; };
    const catalog = add(""); const pagesId = add("");
    const fonts = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"].map((n) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${n} /Encoding /WinAnsiEncoding >>`));
    const xo: string[] = [];
    for (const { id, img } of this.imgs.values()) {
      const raw = atob(img.b64);
      const n = add(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /${img.c === 1 ? "DeviceGray" : img.c === 4 ? "DeviceCMYK" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${raw.length} >>\nstream\n${raw}\nendstream`);
      xo.push(`/${id} ${n} 0 R`);
    }
    const res = `<< /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R /F4 ${fonts[3]} 0 R >>${xo.length ? ` /XObject << ${xo.join(" ")} >>` : ""} >>`;
    const kids: number[] = [];
    for (const content of this.pages) {
      const cs = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources ${res} /Contents ${cs} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    // every character is one byte (WinAnsi text, raw JPEG bytes): offsets = string lengths
    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return latin1(out);
  }
}
function latin1(s: string): Uint8Array { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
export const toBase64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
