import type { Img } from "./image";
import { findExpCandidates, findLevel } from "./hud";
import { segmentExp, segmentLevel, type Glyph, type Template, type TemplateSet } from "./glyphs";

/** Muestras de glifos etiquetadas, agrupadas por carácter. */
export interface Samples {
  exp: Map<string, Glyph[]>;
  level: Map<string, Glyph[]>;
}

export const emptySamples = (): Samples => ({ exp: new Map(), level: new Map() });

const push = (m: Map<string, Glyph[]>, c: string, g: Glyph) => {
  if (!m.has(c)) m.set(c, []);
  m.get(c)!.push(g);
};

/**
 * Extrae glifos de un frame cuya lectura correcta se conoce.
 * @param level texto del nivel, ej. "40"
 * @param exp   texto como "221.609[75.32%]" o "[94.65%]"
 * @returns cuántos glifos se aprendieron de cada tipo (0 si la segmentación no calzó con la etiqueta)
 */
export function learnFromFrame(img: Img, level: string | null, exp: string | null, into: Samples) {
  let lv = 0, ex = 0;
  const lvRegion = findLevel(img);
  if (lvRegion && level && lvRegion.tiles.length === level.length) {
    segmentLevel(img, lvRegion).forEach((g, i) => push(into.level, level[i], g));
    lv = level.length;
  }
  const m = exp?.replace(/,/g, ".").replace(/\s/g, "").match(/^([\d.]*)\[([\d.]+%)\]$/);
  if (m) {
    const tall = (gs: Glyph[]) => gs.filter((g) => g.relH >= 0.45);
    const chars = (t: string) => t.replace(/[.,]/g, "").split("");
    // Elegir el par de corchetes cuyo contenido calza con la etiqueta (HP/MP usan el mismo verde).
    for (const region of findExpCandidates(img)) {
      const seg = segmentExp(img, region);
      if (tall(seg.inner).length !== chars(m[2]).length) continue;
      if (m[1] ? tall(seg.amount).length !== chars(m[1]).length : seg.amount.length > 0) continue;
      tall(seg.inner).forEach((g, i) => push(into.exp, chars(m[2])[i], g));
      if (m[1]) tall(seg.amount).forEach((g, i) => push(into.exp, chars(m[1])[i], g));
      ex = chars(m[2]).length + (m[1] ? chars(m[1]).length : 0);
      break;
    }
  }
  return { level: lv, exp: ex };
}

const dist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

/**
 * Prototipos por agrupamiento voraz: muestras casi idénticas se promedian; distintas escalas
 * o anti-aliasing generan prototipos propios. Así una plantilla nítida no se "emborrona".
 */
export function buildTemplates(m: Map<string, Glyph[]>, maxPerChar = 12): Template[] {
  const out: Template[] = [];
  for (const [char, gs] of m) {
    const protos: { grid: number[]; aspect: number; n: number }[] = [];
    for (const g of gs) {
      const p = protos.find((p) => dist(p.grid, g.grid) < 0.05 && Math.abs(Math.log(p.aspect / g.aspect)) < 0.15);
      if (p) {
        p.grid = p.grid.map((v, i) => (v * p.n + g.grid[i]) / (p.n + 1));
        p.aspect = (p.aspect * p.n + g.aspect) / (p.n + 1);
        p.n++;
      } else protos.push({ grid: [...g.grid], aspect: g.aspect, n: 1 });
    }
    protos.sort((a, b) => b.n - a.n);
    for (const p of protos.slice(0, maxPerChar))
      out.push({ char, grid: p.grid.map((v) => +v.toFixed(3)), aspect: +p.aspect.toFixed(3), n: p.n });
  }
  return out.sort((a, b) => a.char.localeCompare(b.char));
}

export const samplesToTemplates = (s: Samples): TemplateSet => ({
  exp: buildTemplates(s.exp),
  level: buildTemplates(s.level),
});

/** Une plantillas base con las aprendidas por el usuario (las del usuario primero). */
export function mergeTemplates(base: TemplateSet, extra: TemplateSet | null): TemplateSet {
  if (!extra) return base;
  return { exp: [...extra.exp, ...base.exp], level: [...extra.level, ...base.level] };
}
