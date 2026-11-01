import { components, type Box, type Img } from "./image";

/**
 * Detección automática del HUD de MapleStory Classic.
 * - Nivel: tiles naranjos cuadrados (uno por dígito) en la parte inferior.
 * - EXP: par de corchetes verdes "[ … ]" con texto blanco entre ellos.
 * Nada de cajas fijas por porcentaje de pantalla.
 */

export const SEARCH_FROM = 0.65; // buscar en el 35% inferior

export interface LevelRegion {
  box: Box;
  tiles: Box[];
}

export interface ExpRegion {
  /** Caja que contiene cantidad + corchetes (sin el label "EXP."). La parte izquierda se acota al leer. */
  box: Box;
  open: Box;
  close: Box;
  /** Alto de los corchetes: referencia de escala del texto. */
  lineH: number;
}

const isOrange = (r: number, g: number, b: number) => r >= 150 && r - g >= 45 && r - b >= 100 && g >= 45;
const isGreen = (r: number, g: number, b: number) => g >= 55 && g - r >= 12 && g - b >= 20;

function mask(img: Img, top: number, test: (r: number, g: number, b: number) => boolean) {
  const h = img.height - top;
  const m = new Uint8Array(img.width * h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    let i = ((y + top) * img.width) * 4;
    for (let x = 0; x < img.width; x++, i += 4) if (test(d[i], d[i + 1], d[i + 2])) m[y * img.width + x] = 1;
  }
  return { m, h };
}

export function findLevel(img: Img, from = SEARCH_FROM): LevelRegion | null {
  const top = Math.floor(img.height * from);
  const { m, h } = mask(img, top, isOrange);
  const comps = components(m, img.width, h, 12).map((c) => ({ ...c, y: c.y + top }));
  // Un tile es casi cuadrado y bien relleno. Componentes anchos pueden ser 2–3 tiles fusionados.
  const tiles: Box[] = [];
  for (const c of comps) {
    if (c.h < 5 || c.h > 90) continue;
    const fill = c.area / (c.w * c.h);
    if (fill < 0.33) continue;
    const ratio = c.w / c.h;
    const n = ratio < 1.5 ? 1 : ratio < 2.5 ? 2 : ratio < 3.5 ? 3 : 0;
    if (!n || ratio / n < 0.6 || ratio / n > 1.45) continue;
    const tw = c.w / n;
    for (let k = 0; k < n; k++) tiles.push({ x: c.x + k * tw, y: c.y, w: tw, h: c.h });
  }
  // Descartar componentes contenidos en otro tile (el hueco de un "0", por ejemplo).
  const inside = (a: Box, b: Box) => a !== b && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  const real = tiles.filter((t) => !tiles.some((o) => inside(t, o)) && hasDigitInk(img, t));
  tiles.length = 0;
  tiles.push(...real);
  // Agrupar tiles alineados y contiguos.
  tiles.sort((a, b) => a.x - b.x);
  const groups: Box[][] = [];
  for (const t of tiles) {
    const g = groups.find((g) => {
      const last = g.at(-1)!;
      return (
        Math.abs(last.y - t.y) <= last.h * 0.25 &&
        Math.abs(last.h - t.h) <= last.h * 0.25 &&
        t.x - (last.x + last.w) <= last.h * 0.6 &&
        t.x - (last.x + last.w) >= -2
      );
    });
    if (g) g.push(t);
    else groups.push([t]);
  }
  let best: { g: Box[]; score: number } | null = null;
  for (const g of groups) {
    if (g.length > 3) continue;
    const t0 = g[0];
    // ¿Hay un label blanco ("LV.") a la izquierda?
    const label = whiteInk(img, { x: t0.x - t0.h * 3.2, y: t0.y, w: t0.h * 2.8, h: t0.h });
    // El label "LV." es texto blanco sobre panel oscuro: poca tinta, fondo oscuro.
    const hasLabel = label > 0.06 && label < 0.45 && darkness(img, { x: t0.x - t0.h * 3.2, y: t0.y, w: t0.h * 2.8, h: t0.h }) > 0.4;
    const score = (hasLabel ? 10 : 0) + g.length + t0.y / img.height;
    if (!best || score > best.score) best = { g, score };
  }
  if (!best) return null;
  const g = best.g;
  const x0 = g[0].x;
  const x1 = g.at(-1)!.x + g.at(-1)!.w;
  const y0 = Math.min(...g.map((t) => t.y));
  const y1 = Math.max(...g.map((t) => t.y + t.h));
  return { box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, tiles: g };
}

/** Un tile de nivel tiene un dígito crema en su interior. */
function hasDigitInk(img: Img, t: Box): boolean {
  let on = 0, n = 0;
  const pad = t.h * 0.15;
  for (let y = Math.ceil(t.y + pad); y < t.y + t.h - pad; y++)
    for (let x = Math.ceil(t.x + pad); x < t.x + t.w - pad; x++) {
      const i = (y * img.width + x) * 4;
      n++;
      if (img.data[i + 2] / Math.max(1, img.data[i]) > 0.5 && img.data[i] > 120) on++;
    }
  const f = n ? on / n : 0;
  return f > 0.06 && f < 0.8;
}

/** Fracción de píxeles oscuros en la caja. */
function darkness(img: Img, b: Box): number {
  let on = 0, n = 0;
  for (let y = Math.max(0, Math.floor(b.y)); y < Math.min(img.height, b.y + b.h); y++)
    for (let x = Math.max(0, Math.floor(b.x)); x < Math.min(img.width, b.x + b.w); x++) {
      const i = (y * img.width + x) * 4;
      n++;
      if (img.data[i] + img.data[i + 1] + img.data[i + 2] < 270) on++;
    }
  return n ? on / n : 0;
}

/** Fracción de píxeles blancos/neutros brillantes en la caja. */
function whiteInk(img: Img, b: Box): number {
  let on = 0, n = 0;
  const x0 = Math.max(0, Math.floor(b.x)), x1 = Math.min(img.width, Math.ceil(b.x + b.w));
  const y0 = Math.max(0, Math.floor(b.y)), y1 = Math.min(img.height, Math.ceil(b.y + b.h));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i], g = img.data[i + 1], bl = img.data[i + 2];
      const mn = Math.min(r, g, bl), mx = Math.max(r, g, bl);
      n++;
      if (mn > 140 && mx - mn < 70) on++;
    }
  return n ? on / n : 0;
}

export function findExp(img: Img, from = SEARCH_FROM): ExpRegion | null {
  return findExpCandidates(img, from)[0] ?? null;
}

/**
 * Todos los pares de corchetes verdes con texto entre medio (HP y MP usan el mismo verde),
 * ordenados por probabilidad. El lector decide cuál contiene un porcentaje válido.
 */
export function findExpCandidates(img: Img, from = SEARCH_FROM): ExpRegion[] {
  const top = Math.floor(img.height * from);
  const { m, h } = mask(img, top, isGreen);
  const bars = components(m, img.width, h, 4)
    .map((c) => ({ ...c, y: c.y + top }))
    .filter((c) => c.h >= 5 && c.h <= 70 && c.h >= c.w * 1.6);
  const found: { r: ExpRegion; score: number }[] = [];
  for (const a of bars)
    for (const b of bars) {
      if (b.x <= a.x) continue;
      const lh = Math.max(a.h, b.h);
      if (Math.abs(a.y - b.y) > lh * 0.25 || Math.abs(a.h - b.h) > lh * 0.3) continue;
      const span = b.x - (a.x + a.w);
      if (span < lh * 1.5 || span > lh * 12) continue;
      // Debe haber texto blanco entre corchetes y nada verde en medio.
      const inner: Box = { x: a.x + a.w, y: Math.min(a.y, b.y), w: span, h: lh };
      const ink = whiteInk(img, inner);
      if (ink < 0.05 || ink > 0.6) continue;
      if (bars.some((c) => c !== a && c !== b && c.x > a.x && c.x < b.x && Math.abs(c.y - a.y) < lh * 0.3)) continue;
      const left = lh * 14;
      const r: ExpRegion = {
        box: { x: Math.max(0, a.x - left), y: inner.y - lh * 0.15, w: b.x + b.w - (a.x - left) + 1, h: lh * 1.3 },
        open: a,
        close: b,
        lineH: lh,
      };
      // Preferir el par más a la derecha (EXP va después de HP/MP) y con corchetes parejos.
      const score = ink + a.x / img.width - Math.abs(a.h - b.h) / lh;
      found.push({ r, score });
    }
  return found.sort((p, q) => q.score - p.score).map((f) => f.r);
}
