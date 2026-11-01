import { components, type Box, type Img } from "./image";
import { classify, confident, sampleGrid, type Glyph, type InkFn, type Match, type Template } from "./glyphs";

/**
 * Lectura del total de mesos desde la fila inferior del inventario:
 *   (moneda dorada) [ caja blanca con dígitos negros alineados a la derecha ] MESOS
 * El inventario puede estar en cualquier parte de la pantalla, así que se busca en todo el frame.
 */

export const MAX_MESOS = 2_147_483_647; // int32 con signo, el tope del cliente

export interface MesoRegion {
  /** interior blanco del campo */
  field: Box;
  coin: Box | null;
}

const isWhite = (r: number, g: number, b: number) => r > 222 && g > 222 && b > 222;
const isGold = (r: number, g: number, b: number) => r > 180 && g > 120 && b < 110 && r >= g && r - b > 110;

function goldFraction(img: Img, b: Box): number {
  let on = 0, n = 0;
  for (let y = Math.max(0, Math.floor(b.y)); y < Math.min(img.height, b.y + b.h); y++)
    for (let x = Math.max(0, Math.floor(b.x)); x < Math.min(img.width, b.x + b.w); x++) {
      const i = (y * img.width + x) * 4;
      n++;
      if (isGold(img.data[i], img.data[i + 1], img.data[i + 2])) on++;
    }
  return n ? on / n : 0;
}

/**
 * Candidatos a campo de mesos: rectángulos blancos alargados.
 * Con `requireCoin` (frame completo) exige la moneda dorada a la izquierda; para recortes ya
 * centrados en el campo se desactiva.
 */
export function findMesoFields(img: Img, requireCoin = true): MesoRegion[] {
  const mask = new Uint8Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, p = 0; p < mask.length; p++, i += 4) if (isWhite(d[i], d[i + 1], d[i + 2])) mask[p] = 1;
  const out: { r: MesoRegion; score: number }[] = [];
  for (const c of components(mask, img.width, img.height, 40)) {
    if (c.h < 8 || c.h > 60) continue;
    const ratio = c.w / c.h;
    if (ratio < 3.5 || ratio > 14) continue;
    if (c.area / (c.w * c.h) < 0.6) continue; // los dígitos ocupan poco; el campo es casi todo blanco
    const coinBox: Box = { x: c.x - c.h * 1.7, y: c.y - c.h * 0.25, w: c.h * 1.6, h: c.h * 1.5 };
    const gold = goldFraction(img, coinBox);
    if (requireCoin && gold < 0.08) continue;
    out.push({ r: { field: { x: c.x, y: c.y, w: c.w, h: c.h }, coin: gold >= 0.08 ? coinBox : null }, score: gold + c.w / img.width });
  }
  return out.sort((a, b) => b.score - a.score).map((o) => o.r);
}

function darkInk(img: Img, field: Box): InkFn {
  const x0 = Math.floor(field.x), x1 = Math.ceil(field.x + field.w);
  const y0 = Math.floor(field.y), y1 = Math.ceil(field.y + field.h);
  return (x, y) => {
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return 0;
    const i = (y * img.width + x) * 4;
    const lum = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
    const v = (215 - lum) / 120; // fondo ~255 → 0, trazo ~0–60 → 1
    return v <= 0 ? 0 : v >= 1 ? 1 : v;
  };
}

export interface MesoGlyphs {
  glyphs: Glyph[];
  /** índices de glifos que son separadores (comas) */
  separators: Set<number>;
  digitH: number;
}

const ON = 0.4;

export function segmentMeso(img: Img, field: Box): MesoGlyphs {
  const ink = darkInk(img, field);
  const x0 = Math.floor(field.x), x1 = Math.ceil(field.x + field.w);
  const y0 = Math.floor(field.y), y1 = Math.ceil(field.y + field.h);
  const spans: Box[] = [];
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
            t = Math.min(t, y);
            b = Math.max(b, y + 1);
          }
      spans.push({ x: start, y: t, w: x - start, h: b - t });
      start = -1;
    }
  }
  // Descartar ruido de borde: spans que tocan el borde del campo o que llenan toda su altura.
  const real = spans.filter((s) => s.h < field.h * 0.95 && s.x > x0 && s.x + s.w < x1);
  const tall = real.filter((s) => s.h >= field.h * 0.3);
  const digitH = tall.length ? Math.max(...tall.map((s) => s.h)) : field.h * 0.5;
  const digitTop = tall.length ? Math.min(...tall.filter((s) => s.h >= digitH * 0.8).map((s) => s.y)) : y0;
  const digitBottom = digitTop + digitH;
  const glyphs: Glyph[] = [];
  const separators = new Set<number>();
  for (const s of real) {
    // Coma: glifo angosto y bajo, que parte en la mitad inferior y suele bajar de la línea base.
    const isSep = s.h < digitH * 0.65 && s.w <= digitH * 0.4 && s.y > digitTop + digitH * 0.45;
    if (!isSep && (s.y < digitTop - digitH * 0.2 || s.y + s.h > digitBottom + digitH * 0.2)) continue;
    if (isSep) separators.add(glyphs.length);
    glyphs.push({ box: s, grid: sampleGrid(ink, s), aspect: s.w / s.h, relH: s.h / digitH });
  }
  return { glyphs, separators, digitH };
}

export interface MesoRead {
  text: string;
  amount: number | null;
  confident: boolean;
  matches: Match[];
}

export function parseMesos(text: string): number | null {
  if (!/^\d{1,3}(,\d{3})*$/.test(text) && !/^\d{1,10}$/.test(text)) return null;
  const n = Number(text.replace(/,/g, ""));
  return n <= MAX_MESOS ? n : null;
}

export function readMesoGlyphs(seg: MesoGlyphs, templates: Template[]): MesoRead {
  const matches: Match[] = [];
  const text = seg.glyphs
    .map((g, i) => {
      if (seg.separators.has(i)) return ",";
      const m = classify(g, templates);
      matches.push(m);
      return confident(m) ? m.char : "?";
    })
    .join("");
  const ok = text.length > 0 && !text.includes("?");
  return { text, amount: ok ? parseMesos(text) : null, confident: ok, matches };
}

/** Busca el campo y lo lee. Reutiliza la región previa si sigue siendo un campo blanco válido. */
export function readMesos(img: Img, templates: Template[], prev?: MesoRegion | null): { region: MesoRegion | null; read: MesoRead | null } {
  const tryRegion = (r: MesoRegion) => {
    const read = readMesoGlyphs(segmentMeso(img, r.field), templates);
    return read.amount !== null ? { region: r, read } : null;
  };
  if (prev) {
    const hit = tryRegion(prev);
    if (hit) return hit;
  }
  const cands = findMesoFields(img);
  let first: { region: MesoRegion | null; read: MesoRead | null } = { region: null, read: null };
  for (const r of cands.slice(0, 4)) {
    const hit = tryRegion(r);
    if (hit) return hit;
    if (!first.region) first = { region: r, read: readMesoGlyphs(segmentMeso(img, r.field), templates) };
  }
  return first;
}
