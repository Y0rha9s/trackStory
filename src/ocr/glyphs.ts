import type { Box, Img } from "./image";
import { percentile } from "./image";
import type { ExpRegion, LevelRegion } from "./hud";

/**
 * Matcher de glifos propio.
 * Cada glifo se normaliza a una grilla GW×GH con cobertura suave (anti-aliasing incluido)
 * y se compara contra plantillas aprendidas de capturas reales etiquetadas.
 */
export const GW = 5;
export const GH = 7;

export interface Glyph {
  box: Box;
  grid: number[];
  aspect: number;
  /** alto relativo a la altura de dígito de la línea */
  relH: number;
}

export interface Template {
  char: string;
  grid: number[];
  aspect: number;
  n: number;
}

export interface TemplateSet {
  exp: Template[];
  level: Template[];
  /** dígitos negros del campo de mesos del inventario */
  meso?: Template[];
}

export interface Match {
  char: string;
  score: number;
  margin: number;
}

/** Mapa de tinta suave 0..1 sobre una caja. */
export type InkFn = (x: number, y: number) => number;

export function sampleGrid(ink: InkFn, b: Box): number[] {
  const out = new Array(GW * GH).fill(0);
  for (let gy = 0; gy < GH; gy++)
    for (let gx = 0; gx < GW; gx++) {
      // Promedio de área con 3×3 sub-muestras por celda.
      let s = 0;
      for (let sy = 0; sy < 3; sy++)
        for (let sx = 0; sx < 3; sx++) {
          const x = b.x + ((gx + (sx + 0.5) / 3) / GW) * b.w;
          const y = b.y + ((gy + (sy + 0.5) / 3) / GH) * b.h;
          s += ink(Math.floor(x), Math.floor(y));
        }
      out[gy * GW + gx] = s / 9;
    }
  // Normalizar contraste: el trazo más fuerte vale 1 (frames oscuros / desvaídos).
  const mx = Math.max(...out);
  return mx > 0.15 ? out.map((v) => Math.min(1, v / (mx * 0.9))) : out;
}

export function classify(g: Glyph, templates: Template[]): Match {
  const best = new Map<string, number>();
  for (const t of templates) {
    let d = 0;
    for (let i = 0; i < g.grid.length; i++) d += Math.abs(g.grid[i] - t.grid[i]);
    d = d / g.grid.length + 0.35 * Math.abs(Math.log(g.aspect / t.aspect));
    const prev = best.get(t.char);
    if (prev === undefined || d < prev) best.set(t.char, d);
  }
  const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]);
  if (!ranked.length) return { char: "?", score: 1, margin: 0 };
  return { char: ranked[0][0], score: ranked[0][1], margin: (ranked[1]?.[1] ?? 1) - ranked[0][1] };
}

const MAX_SCORE = 0.09;
const MIN_MARGIN = 0.05;
export const confident = (m: Match) => m.score <= MAX_SCORE && m.margin >= MIN_MARGIN;

// ---------------------------------------------------------------------------
// EXP
// ---------------------------------------------------------------------------

export interface ExpGlyphs {
  /** glifos entre corchetes (porcentaje) */
  inner: Glyph[];
  /** glifos de la cantidad (a la izquierda de "["), en orden */
  amount: Glyph[];
  digitH: number;
  ink: InkFn;
  band: Box;
}

export function expInk(img: Img, band: Box): InkFn {
  const lums: number[] = [];
  const x0 = Math.max(0, Math.floor(band.x)), x1 = Math.min(img.width, Math.ceil(band.x + band.w));
  const y0 = Math.max(0, Math.floor(band.y)), y1 = Math.min(img.height, Math.ceil(band.y + band.h));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) < 60) lums.push((r + g + b) / 3);
    }
  const lo = percentile(lums, 0.5);
  const hi = Math.max(lo + 50, percentile(lums, 0.985));
  const a = lo + (hi - lo) * 0.25;
  const span = (hi - lo) * 0.6;
  return (x, y) => {
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return 0;
    const i = (y * img.width + x) * 4;
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (sat > 70) return 0;
    const v = ((r + g + b) / 3 - a) / span;
    return v <= 0 ? 0 : v >= 1 ? 1 : v;
  };
}

const ON = 0.4;

/** Divide un rango de columnas en glifos según columnas vacías. */
function spans(ink: InkFn, x0: number, x1: number, y0: number, y1: number): Box[] {
  const out: Box[] = [];
  let start = -1;
  for (let x = x0; x <= x1; x++) {
    let on = false;
    if (x < x1) for (let y = y0; y < y1 && !on; y++) on = ink(x, y) >= ON;
    if (on && start < 0) start = x;
    else if (!on && start >= 0) {
      let t = y1, b = y0;
      for (let y = y0; y < y1; y++)
        for (let xx = start; xx < x; xx++)
          if (ink(xx, y) >= ON) {
            if (y < t) t = y;
            if (y + 1 > b) b = y + 1;
          }
      out.push({ x: start, y: t, w: x - start, h: Math.max(1, b - t) });
      start = -1;
    }
  }
  return out;
}

function toGlyph(ink: InkFn, b: Box, digitH: number): Glyph {
  return { box: b, grid: sampleGrid(ink, b), aspect: b.w / b.h, relH: b.h / digitH };
}

export function segmentExp(img: Img, r: ExpRegion): ExpGlyphs {
  const lh = r.lineH;
  const y0 = Math.floor(Math.min(r.open.y, r.close.y) - lh * 0.1);
  const y1 = Math.ceil(Math.max(r.open.y + r.open.h, r.close.y + r.close.h) + lh * 0.1);
  const band: Box = { x: r.box.x, y: y0, w: r.close.x + r.close.w - r.box.x, h: y1 - y0 };
  const ink = expInk(img, band);
  const innerSpans = spans(ink, r.open.x + r.open.w, r.close.x, y0, y1);
  const tall = innerSpans.filter((s) => s.h >= lh * 0.5);
  const digitH = tall.length ? Math.max(...tall.map((s) => s.h)) : lh * 0.85;
  const digitTop = tall.length ? Math.min(...tall.map((s) => s.y)) : y0;
  const digitBottom = digitTop + digitH;

  // Cantidad: de derecha a izquierda desde "[" hasta encontrar un hueco grande o un glifo más alto (label "EXP.").
  const left = spans(ink, Math.floor(r.box.x), r.open.x, y0, y1).reverse();
  const amount: Box[] = [];
  let edge = r.open.x;
  for (const s of left) {
    const gap = edge - (s.x + s.w);
    if (gap > digitH * 1.0) break;
    if (s.y < digitTop - digitH * 0.12 || s.y + s.h > digitBottom + digitH * 0.25) break;
    amount.unshift(s);
    edge = s.x;
  }
  // Un separador al inicio no es parte de la cantidad (suele ser el punto del label "EXP.").
  while (amount.length && amount[0].h < digitH * 0.45) amount.shift();
  return {
    inner: splitWide(innerSpans, digitH).map((b) => toGlyph(ink, b, digitH)),
    amount: splitWide(amount, digitH).map((b) => toGlyph(ink, b, digitH)),
    digitH,
    ink,
    band,
  };
}

/** Divide spans demasiado anchos (dígitos unidos por escalado) en partes de ancho de dígito. */
function splitWide(list: Box[], digitH: number): Box[] {
  const out: Box[] = [];
  const dw = digitH * 0.75;
  for (const b of list) {
    const n = Math.round(b.w / dw);
    if (b.w > digitH * 1.25 && n >= 2) {
      const w = b.w / n;
      for (let k = 0; k < n; k++) out.push({ x: b.x + k * w, y: b.y, w, h: b.h });
    } else out.push(b);
  }
  return out;
}

export interface ExpText {
  amountText: string;
  pctText: string;
  confident: boolean;
  matches: Match[];
}

export function readExpGlyphs(g: ExpGlyphs, templates: Template[]): ExpText {
  const matches: Match[] = [];
  const read = (list: Glyph[]) =>
    list
      .map((gl) => {
        if (gl.relH < 0.45) return "."; // punto / coma: glifo bajo
        const m = classify(gl, templates);
        matches.push(m);
        return confident(m) ? m.char : "?";
      })
      .join("");
  const pctText = read(g.inner);
  const amountText = read(g.amount);
  return {
    amountText,
    pctText,
    confident: !(pctText + amountText).includes("?"),
    matches,
  };
}

// ---------------------------------------------------------------------------
// Nivel
// ---------------------------------------------------------------------------

export function levelInk(img: Img): InkFn {
  // Dígitos crema sobre naranjo: el canal azul separa trazo de fondo sin umbral de brillo fijo.
  return (x, y) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
    const i = (y * img.width + x) * 4;
    const r = img.data[i], b = img.data[i + 2];
    const v = (b / Math.max(1, r) - 0.3) / 0.45;
    return v <= 0 ? 0 : v >= 1 ? 1 : v;
  };
}

export function segmentLevel(img: Img, r: LevelRegion): Glyph[] {
  const ink = levelInk(img);
  return r.tiles.map((t) => {
    // bbox del trazo dentro del tile (excluyendo el borde redondeado)
    const pad = t.h * 0.12;
    const x0 = Math.floor(t.x + pad), x1 = Math.ceil(t.x + t.w - pad);
    const y0 = Math.floor(t.y + pad), y1 = Math.ceil(t.y + t.h - pad);
    let l = x1, rr = x0, tp = y1, bt = y0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        if (ink(x, y) >= ON) {
          if (x < l) l = x;
          if (x + 1 > rr) rr = x + 1;
          if (y < tp) tp = y;
          if (y + 1 > bt) bt = y + 1;
        }
    const box = rr > l && bt > tp ? { x: l, y: tp, w: rr - l, h: bt - tp } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    return { box, grid: sampleGrid(ink, box), aspect: box.w / box.h, relH: box.h / t.h };
  });
}

export function readLevelGlyphs(glyphs: Glyph[], templates: Template[]) {
  const matches = glyphs.map((g) => classify(g, templates));
  const text = matches.map((m) => (confident(m) ? m.char : "?")).join("");
  return { text, matches, confident: !text.includes("?") && text.length > 0 };
}
