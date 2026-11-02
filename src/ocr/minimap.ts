import type { Img } from "./image";

/**
 * Lector del título del minimapa (arriba a la izquierda del juego): «Calle» y «Mapa» en texto blanco.
 *
 * No intenta leer letras: ancla la ventana por su rótulo «MINI MAP» (posición fija desde ahí), binariza el texto
 * blanco del título y lo compara con huellas que el usuario enseñó una vez por mapa. Una huella es solo la silueta
 * del texto, así que tolera el ruido de la compresión del video y un desplazamiento de 1 px.
 */

export interface MinimapAnchor {
  /** esquina superior izquierda del rótulo «MINI MAP» */
  x: number;
  y: number;
}

export interface Print {
  fp: string;
  mapId: number;
}

const LABEL = [
  "###.##..#.####..#....###.##...###..####.....",
  "#..#..#.#.#...#.#....#..#..#.#...#.#...#....",
  "#..#..#.#.#...#.#....#..#..#.#####.####.....",
  "#..#..#.#.#...#.#....#..#..#.#...#.#........",
  "#..#..#.#.#...#.#....#..#..#.#...#.#........",
];
const LABEL_W = LABEL[0].length;
const LABEL_MATCH = 0.9;

/** banda del título respecto al rótulo */
const BAND_X = 43 - 1;
const BAND_Y = 19;
const BAND_W = 150;
const BAND_H = 25;
const MIN_INK = 15;
const SHIFT = 1;
export const SAME_TITLE = 0.82;

const lum = (img: Img, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
};
const white = (img: Img, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return Math.min(img.data[i], img.data[i + 1], img.data[i + 2]) > 200;
};

const labelScore = (img: Img, x0: number, y0: number) => {
  let ok = 0;
  for (let y = 0; y < LABEL.length; y++) for (let x = 0; x < LABEL_W; x++) if ((lum(img, x0 + x, y0 + y) < 150) === (LABEL[y][x] === "#")) ok++;
  return ok / (LABEL.length * LABEL_W);
};

/** Busca el rótulo «MINI MAP» en la mitad superior izquierda del frame. */
export function findMinimap(img: Img): MinimapAnchor | null {
  const maxY = Math.min(img.height - LABEL.length, Math.floor(img.height * 0.7));
  const maxX = Math.min(img.width - LABEL_W, Math.floor(img.width * 0.7));
  let best: MinimapAnchor | null = null;
  let bestScore = 0;
  for (let y = 0; y < maxY; y++) {
    for (let x = 0; x < maxX; x++) {
      // la primera fila del rótulo es la más selectiva: descarta casi todo sin recorrer la plantilla
      if (lum(img, x, y) >= 150 || lum(img, x + 1, y) >= 150 || lum(img, x + 2, y) >= 150 || lum(img, x + 3, y) < 150) continue;
      const s = labelScore(img, x, y);
      if (s > bestScore) {
        bestScore = s;
        best = { x, y };
      }
    }
  }
  return bestScore >= LABEL_MATCH ? best : null;
}

/** Silueta del texto blanco del título (BAND_H filas × BAND_W columnas), o null si no hay título (minimapa cerrado). */
export function readTitle(img: Img, a: MinimapAnchor): Uint8Array | null {
  const x0 = a.x + BAND_X;
  const y0 = a.y + BAND_Y;
  if (x0 + BAND_W > img.width || y0 + BAND_H > img.height) return null;
  const mask = new Uint8Array(BAND_W * BAND_H);
  let ink = 0;
  for (let y = 0; y < BAND_H; y++)
    for (let x = 0; x < BAND_W; x++)
      if (white(img, x0 + x, y0 + y)) {
        mask[y * BAND_W + x] = 1;
        ink++;
      }
  return ink >= MIN_INK ? mask : null;
}

export const encodePrint = (mask: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < mask.length; i += 4) out += ((mask[i] << 3) | (mask[i + 1] << 2) | (mask[i + 2] << 1) | mask[i + 3]).toString(16);
  return out;
};

export const decodePrint = (fp: string): Uint8Array => {
  const mask = new Uint8Array(BAND_W * BAND_H);
  for (let i = 0; i < fp.length && i * 4 < mask.length; i++) {
    const v = parseInt(fp[i], 16) || 0;
    for (let b = 0; b < 4; b++) mask[i * 4 + b] = (v >> (3 - b)) & 1;
  }
  return mask;
};

/** Parecido entre dos siluetas (Jaccard), probando ±1 px; 1 = idénticas. */
export function similarity(a: Uint8Array, b: Uint8Array): number {
  let best = 0;
  for (let dy = -SHIFT; dy <= SHIFT; dy++)
    for (let dx = -SHIFT; dx <= SHIFT; dx++) {
      let inter = 0;
      let union = 0;
      for (let y = 0; y < BAND_H; y++) {
        const yb = y + dy;
        for (let x = 0; x < BAND_W; x++) {
          const xb = x + dx;
          const va = a[y * BAND_W + x];
          const vb = yb >= 0 && yb < BAND_H && xb >= 0 && xb < BAND_W ? b[yb * BAND_W + xb] : 0;
          if (va && vb) inter++;
          if (va || vb) union++;
        }
      }
      if (union) best = Math.max(best, inter / union);
    }
  return best;
}

/** El mapa cuya huella se parece más al título leído (null si ninguna llega al umbral). */
export function matchPrint(fp: string, prints: readonly Print[]): { mapId: number; score: number } | null {
  const mask = decodePrint(fp);
  let best: { mapId: number; score: number } | null = null;
  for (const p of prints) {
    const score = similarity(mask, decodePrint(p.fp));
    if (score >= SAME_TITLE && (!best || score > best.score)) best = { mapId: p.mapId, score };
  }
  return best;
}

/** Resultado de mirar un frame: sin minimapa visible, minimapa sin título, o la huella del título. */
export type MinimapRead = { kind: "none" } | { kind: "closed" } | { kind: "title"; fp: string };

export function readMinimap(img: Img): MinimapRead {
  const a = findMinimap(img);
  if (!a) return { kind: "none" };
  const mask = readTitle(img, a);
  return mask ? { kind: "title", fp: encodePrint(mask) } : { kind: "closed" };
}
