import type { Img } from "./image";
import { findExpCandidates } from "./hud";
import { readExpGlyphs, segmentExp, type TemplateSet } from "./glyphs";
import { readFrame, type FrameRead, type Regions } from "./reader";
import { agreesWithGlyphs, readNeural, type Recognize } from "./neural";

export interface PipelineRead extends FrameRead {
  source: "glyph" | "neural" | null;
}

const fmtAmount = (n: number) => n.toLocaleString("en-US").replace(/,/g, ".");

/**
 * Lectura completa de un frame:
 * 1. matcher de glifos (rápido, sin dependencias)
 * 2. si la EXP queda ambigua y hay motor neuronal: Tesseract con dos preprocesados que deben coincidir
 *    entre sí y con cada carácter que los glifos sí leyeron con confianza.
 * La validación contra la curva de EXP y la continuidad la hace después `ReadingValidator`.
 */
export async function readWithFallback(
  img: Img,
  templates: TemplateSet,
  prev?: Regions,
  recognize?: Recognize,
): Promise<PipelineRead> {
  const r = readFrame(img, templates, prev);
  if (r.pct !== null) return { ...r, source: "glyph" };
  if (!recognize) return { ...r, source: null };

  const cands = r.regions.exp ? [r.regions.exp, ...findExpCandidates(img).filter((c) => c.open.x !== r.regions.exp!.open.x)] : findExpCandidates(img);
  for (const ex of cands.slice(0, 4)) {
    const seg = segmentExp(img, ex);
    const partial = readExpGlyphs(seg, templates.exp);
    const got = await readNeural(img, ex, seg.amount[0]?.box.x ?? null, recognize);
    if (!got) continue;
    const pctTxt = `${got.pct.toFixed(2)}%`;
    const amountTxt = got.amount === null ? "" : fmtAmount(got.amount);
    if (!agreesWithGlyphs(pctTxt, partial.pctText) || !agreesWithGlyphs(amountTxt, partial.amountText)) continue;
    return {
      ...r,
      regions: { ...r.regions, exp: ex },
      expText: `${amountTxt}[${pctTxt}]`,
      amount: got.amount,
      pct: got.pct,
      source: "neural",
      debug: { ...r.debug, expBox: ex.box, expReason: null },
    };
  }
  return { ...r, source: null };
}
