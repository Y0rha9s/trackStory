import type { Img } from "./image";
import baseDigits from "./skillDigits.json";

/**
 * Lector de la ventana "SKILL INVENTORY" de MapleStory Classic (diseño fijo a escala 1:1).
 *
 * Cómo la encuentra: bajo las pestañas hay una línea roja de 3 px de ancho completo de la ventana
 * (colores 172/196/203,0,0). Todo lo demás (pestaña activa, filas, dígitos) está a posiciones fijas desde esa línea.
 * Los niveles son dígitos de 9 px que se reconocen por plantillas exactas; lo que no se reconoce devuelve null
 * (nunca se adivina) y se puede enseñar después con `learnDigits`.
 */

export interface SkillWindow {
  /** esquina izquierda de la línea roja = borde izquierdo de la ventana */
  x: number;
  /** fila superior de la línea roja */
  y: number;
  width: number;
}

export type SkillTab = "beginner" | "first" | "second";

export interface SkillRead {
  window: SkillWindow;
  /** pestaña activa; null si no se distingue */
  tab: SkillTab | null;
  /** nivel de cada una de las 6 filas visibles; null si algún dígito no se reconoce */
  levels: (number | null)[];
  /** por fila, los glifos leídos como cuadrícula de texto (para aprender los desconocidos) */
  glyphs: string[][];
}

const ROWS = 6;
const ROW_PITCH = 40;
const DIGIT_TOP = 79; // desde la fila superior de la línea roja
const DIGIT_H = 9;
const DIGIT_X0 = 42;
const DIGIT_X1 = 80;
const TAB_Y = -6;
const TAB_X = [8, 42, 72];
const MIN_WINDOW = 150;

const at = (img: Img, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]] as const;
};
const isRed = (r: number, g: number, b: number) => r >= 160 && r <= 215 && g < 25 && b < 25;
const isDark = (r: number, g: number, b: number) => r < 110 && g < 110 && b < 120;
const isPink = (r: number, g: number, b: number) => r > 200 && g > 70 && g < 130 && b > 100 && b < 160;

/** Busca la ventana por su línea roja (tres filas rojas seguidas, ≥150 px de largo). */
export function findSkillWindow(img: Img): SkillWindow | null {
  for (let y = 0; y < img.height - 2; y++) {
    let x = 0;
    while (x < img.width) {
      const [r, g, b] = at(img, x, y);
      if (!isRed(r, g, b)) {
        x++;
        continue;
      }
      let end = x;
      while (end < img.width && isRed(...at(img, end, y))) end++;
      const len = end - x;
      if (len >= MIN_WINDOW && len <= 400) {
        // las tres filas de la línea, con su degradado de rojo, y blanco justo debajo
        const mid = at(img, x + (len >> 1), y + 1);
        const low = at(img, x + (len >> 1), y + 2);
        const below = y + 3 < img.height ? at(img, x + (len >> 1), y + 3) : [0, 0, 0];
        if (isRed(...mid) && isRed(...low) && below[0] > 230 && below[1] > 230) return { x, y, width: len };
      }
      x = end;
    }
  }
  return null;
}

export function readTab(img: Img, w: SkillWindow): SkillTab | null {
  const hits = TAB_X.map((dx) => {
    const x = w.x + dx;
    const y = w.y + TAB_Y;
    return x < img.width && y >= 0 && isPink(...at(img, x, y));
  });
  if (hits.filter(Boolean).length !== 1) return null;
  return (["beginner", "first", "second"] as const)[hits.indexOf(true)];
}

/** Dígitos de una fila como cuadrículas de "#" y "." (una por glifo). */
export function rowGlyphs(img: Img, w: SkillWindow, row: number): string[] {
  const y0 = w.y + DIGIT_TOP + row * ROW_PITCH;
  const x0 = w.x + DIGIT_X0;
  const x1 = Math.min(img.width - 1, w.x + DIGIT_X1);
  if (y0 + DIGIT_H >= img.height) return [];
  const dark = (x: number, y: number) => isDark(...at(img, x, y));
  const cols: boolean[] = [];
  for (let x = x0; x <= x1; x++) {
    let any = false;
    for (let y = y0; y < y0 + DIGIT_H; y++) if (dark(x, y)) any = true;
    cols.push(any);
  }
  const out: string[] = [];
  let i = 0;
  while (i < cols.length) {
    if (!cols[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < cols.length && cols[j]) j++;
    const rowsText: string[] = [];
    for (let y = y0; y < y0 + DIGIT_H; y++) {
      let s = "";
      for (let x = x0 + i; x < x0 + j; x++) s += dark(x, y) ? "#" : ".";
      rowsText.push(s);
    }
    out.push(rowsText.join("/"));
    i = j;
  }
  return out;
}

export type DigitTemplates = Record<string, string[]>;

const classify = (glyph: string, templates: DigitTemplates): string | null => {
  for (const [digit, list] of Object.entries(templates)) if (list.includes(glyph)) return digit;
  return null;
};

export function readSkillWindow(img: Img, templates: DigitTemplates): SkillRead | null {
  const window = findSkillWindow(img);
  if (!window) return null;
  const glyphs = Array.from({ length: ROWS }, (_, r) => rowGlyphs(img, window, r));
  const levels = glyphs.map((g) => {
    if (!g.length || g.length > 2) return null;
    const digits = g.map((x) => classify(x, templates));
    return digits.some((d) => d === null) ? null : Number(digits.join(""));
  });
  return { window, tab: readTab(img, window), levels, glyphs };
}

/** Añade plantillas a partir de una fila cuyo valor real conoce el usuario. Devuelve cuántas dígitos nuevos aprendió. */
export function learnDigits(templates: DigitTemplates, glyphs: readonly string[], value: number): { templates: DigitTemplates; learned: number } {
  const text = String(value);
  if (text.length !== glyphs.length) return { templates, learned: 0 };
  const next: DigitTemplates = Object.fromEntries(Object.entries(templates).map(([k, v]) => [k, [...v]]));
  let learned = 0;
  glyphs.forEach((g, i) => {
    const d = text[i];
    if (!(next[d] ??= []).includes(g)) {
      next[d].push(g);
      learned++;
    }
  });
  return { templates: next, learned };
}

// --- Plantillas aprendidas, guardadas en el navegador ----------------------------------------------

const KEY = "maple-track:skill-digits:v1";

export function loadDigitTemplates(): DigitTemplates {
  const merged: DigitTemplates = Object.fromEntries(Object.entries(baseDigits as DigitTemplates).map(([k, v]) => [k, [...v]]));
  try {
    const extra = JSON.parse(localStorage.getItem(KEY) ?? "{}") as DigitTemplates;
    for (const [d, list] of Object.entries(extra)) merged[d] = [...new Set([...(merged[d] ?? []), ...list])];
  } catch {
    /* sin almacenamiento: solo las plantillas base */
  }
  return merged;
}

export function saveDigitTemplates(t: DigitTemplates) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* ignorar */
  }
}
