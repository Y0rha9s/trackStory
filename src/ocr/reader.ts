import type { Box, Img } from "./image";
import { findExpCandidates, findLevel, type ExpRegion, type LevelRegion } from "./hud";
import { readExpGlyphs, readLevelGlyphs, segmentExp, segmentLevel, type TemplateSet } from "./glyphs";

export interface Regions {
  level: LevelRegion | null;
  exp: ExpRegion | null;
}

export interface FrameRead {
  /** texto del nivel ("40", "4?" si hay un dígito ambiguo, null si no se encontró) */
  levelText: string | null;
  level: number | null;
  /** texto normalizado "221.609[75.32%]" / "[94.65%]" (null si no se encontró) */
  expText: string | null;
  amount: number | null;
  pct: number | null;
  regions: Regions;
  /** cajas útiles para depurar / recortes para el fallback neuronal */
  debug: {
    levelBox: Box | null;
    expBox: Box | null;
    amountBox: Box | null;
    expReason: string | null;
  };
}

const AMOUNT_RE = /^\d{1,3}(\.\d{3})*$/;
const PCT_RE = /^(\d{1,3})\.(\d{2})%$/;

export function parseAmount(text: string): number | null {
  const t = text.replace(/,/g, ".");
  if (!AMOUNT_RE.test(t)) return null;
  return Number(t.replace(/\./g, ""));
}

export function parsePct(text: string): number | null {
  const m = text.match(PCT_RE);
  if (!m) return null;
  const v = Number(`${m[1]}.${m[2]}`);
  return v <= 100 ? v : null;
}

/**
 * Lee un frame completo. Si `prev` trae regiones válidas se reutilizan (rápido);
 * si la lectura falla se vuelven a buscar.
 */
export function readFrame(img: Img, templates: TemplateSet, prev?: Regions): FrameRead {
  const attempt = (regions: Regions): FrameRead => {
    const out: FrameRead = {
      levelText: null,
      level: null,
      expText: null,
      amount: null,
      pct: null,
      regions,
      debug: { levelBox: regions.level?.box ?? null, expBox: regions.exp?.box ?? null, amountBox: null, expReason: null },
    };
    if (regions.level) {
      const r = readLevelGlyphs(segmentLevel(img, regions.level), templates.level);
      out.levelText = r.text;
      out.level = r.confident ? Number(r.text) : null;
    }
    if (regions.exp) {
      const seg = segmentExp(img, regions.exp);
      const t = readExpGlyphs(seg, templates.exp);
      out.expText = `${t.amountText}[${t.pctText}]`;
      if (seg.amount.length) {
        const a = seg.amount[0].box;
        out.debug.amountBox = { x: a.x, y: seg.band.y, w: regions.exp.open.x - a.x, h: seg.band.h };
      }
      if (!t.confident) out.debug.expReason = "Caracteres de EXP ambiguos";
      else {
        out.pct = parsePct(t.pctText);
        out.amount = t.amountText ? parseAmount(t.amountText) : null;
        if (out.pct === null) out.debug.expReason = `Porcentaje con formato inválido (${t.pctText})`;
        else if (t.amountText && out.amount === null) out.debug.expReason = `Cantidad con formato inválido (${t.amountText})`;
      }
    } else out.debug.expReason = "No se encontró el indicador de EXP";
    return out;
  };

  if (prev && (prev.level || prev.exp)) {
    const r = attempt(prev);
    if (r.pct !== null && (r.level !== null || !prev.level)) return r;
  }
  const level = findLevel(img);
  const cands = findExpCandidates(img);
  let first: FrameRead | null = null;
  for (const exp of cands.slice(0, 6)) {
    const r = attempt({ level, exp });
    if (r.pct !== null) return r;
    // Guardar el primer candidato con aspecto de porcentaje para mostrar el error más útil.
    if (!first || (r.expText?.endsWith("%]") && !first.expText?.endsWith("%]"))) first = r;
  }
  return first ?? attempt({ level, exp: null });
}
