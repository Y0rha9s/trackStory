import type { Box, Img } from "./image";
import type { ExpRegion } from "./hud";
import { parseAmount, parsePct } from "./reader";

/**
 * Fallback neuronal (Tesseract LSTM) para cuando el matcher de glifos no está seguro.
 * Este módulo es agnóstico de plataforma: prepara la imagen y parsea el texto;
 * el motor (`Recognize`) se inyecta (Web Worker en el navegador, Node en los tests).
 */
export type Recognize = (img: Img) => Promise<{ text: string; confidence: number }>;

/** Recortes a ampliar: la cantidad (entre el inicio y "[") y el porcentaje (entre corchetes). */
export function neuralBoxes(r: ExpRegion, amountStartX: number | null): { amount: Box | null; pct: Box } {
  const lh = r.lineH;
  const y0 = Math.min(r.open.y, r.close.y) - lh * 0.3;
  const h = lh * 1.6;
  const pct: Box = { x: r.open.x + r.open.w, y: y0, w: r.close.x - (r.open.x + r.open.w), h };
  const amount =
    amountStartX !== null && amountStartX < r.open.x - lh * 0.3
      ? { x: amountStartX - lh * 0.3, y: y0, w: r.open.x - amountStartX, h }
      : null;
  return { amount, pct };
}

/**
 * Amplía con interpolación bilineal hasta ~56 px de alto y deja texto oscuro sobre blanco.
 * `mode` controla el preprocesado: "gray" conserva el anti-aliasing, "sharp" binariza.
 */
export function prepare(img: Img, b: Box, mode: "gray" | "sharp"): Img {
  const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
  const w = Math.min(img.width - x0, Math.ceil(b.w)), h = Math.min(img.height - y0, Math.ceil(b.h));
  const f = Math.max(2, Math.round(56 / h));
  const W = w * f, H = h * f;
  // Luminancia "de texto": blanco y verde (corchetes) cuentan como tinta.
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * img.width + x0 + x) * 4;
      const r = img.data[i], g = img.data[i + 1], bl = img.data[i + 2];
      lum[y * w + x] = Math.max((r + g + bl) / 3, g * 0.9);
    }
  const sorted = Array.from(lum).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.4)];
  const hi = Math.max(lo + 40, sorted[Math.floor(sorted.length * 0.99)]);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      const sx = Math.min(w - 1.001, Math.max(0, (X + 0.5) / f - 0.5));
      const sy = Math.min(h - 1.001, Math.max(0, (Y + 0.5) / f - 0.5));
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      const v =
        lum[iy * w + ix] * (1 - fx) * (1 - fy) +
        lum[iy * w + ix + 1] * fx * (1 - fy) +
        lum[(iy + 1) * w + ix] * (1 - fx) * fy +
        lum[(iy + 1) * w + ix + 1] * fx * fy;
      let t = (v - lo) / (hi - lo);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (mode === "sharp") t = Math.pow(t, 0.6); // realza trazos finos sin binarizar duro
      const o = 255 - Math.round(t * 255);
      const k = (Y * W + X) * 4;
      out[k] = out[k + 1] = out[k + 2] = o;
      out[k + 3] = 255;
    }
  // Margen blanco: Tesseract rinde mejor con aire alrededor.
  return pad({ width: W, height: H, data: out }, 12);
}

function pad(img: Img, p: number): Img {
  const W = img.width + p * 2, H = img.height + p * 2;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + p) * W + p) * 4);
  return { width: W, height: H, data };
}

const clean = (raw: string) => raw.replace(/\s+/g, "").replace(/[lI|]/g, "1").replace(/[oO]/g, "0");

export function parsePctText(raw: string): number | null {
  const m = clean(raw).replace(/[\[\]]/g, "").match(/^(\d{1,3})[.,](\d{2})%?$/);
  return m ? parsePct(`${m[1]}.${m[2]}%`) : null;
}

export function parseAmountText(raw: string): number | null {
  return parseAmount(clean(raw).replace(/[\[\]%]/g, ""));
}

export interface NeuralRead {
  amount: number | null;
  pct: number;
  text: string;
}

/**
 * Lee cantidad y porcentaje por separado con dos preprocesados distintos.
 * Ambos deben coincidir exactamente; si no, se rechaza (nunca se adivina).
 */
export async function readNeural(
  img: Img,
  r: ExpRegion,
  amountStartX: number | null,
  recognize: Recognize,
): Promise<NeuralRead | null> {
  const boxes = neuralBoxes(r, amountStartX);
  const pcts: (number | null)[] = [];
  const amounts: (number | null)[] = [];
  for (const mode of ["gray", "sharp"] as const) {
    pcts.push(parsePctText((await recognize(prepare(img, boxes.pct, mode))).text));
    if (pcts.at(-1) === null) return null;
    if (boxes.amount) {
      amounts.push(parseAmountText((await recognize(prepare(img, boxes.amount, mode))).text));
      if (amounts.at(-1) === null) return null;
    }
  }
  if (pcts[0] !== pcts[1]) return null;
  if (boxes.amount && amounts[0] !== amounts[1]) return null;
  const amount = boxes.amount ? amounts[0] : null;
  const pct = pcts[0] as number;
  return { amount, pct, text: `${amount ?? ""}[${pct.toFixed(2)}%]` };
}

/**
 * El resultado neuronal debe coincidir con todos los caracteres que el matcher de glifos
 * sí leyó con confianza ("7?.00%" acepta "79.00%" pero no "29.00%").
 * Si la segmentación de glifos tiene otro largo, no se puede comparar y se acepta.
 */
export function agreesWithGlyphs(neural: string, glyphs: string): boolean {
  if (!glyphs || neural.length !== glyphs.length) return true;
  for (let i = 0; i < glyphs.length; i++) if (glyphs[i] !== "?" && glyphs[i] !== neural[i]) return false;
  return true;
}
