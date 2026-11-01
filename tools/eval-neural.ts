/**
 * Evalúa el pipeline completo (glifos → fallback Tesseract → validador) con capturas etiquetadas.
 *   npx tsx tools/eval-neural.ts <dir-con-labels.json>
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import { createWorker, PSM } from "tesseract.js";
import type { Img } from "../src/ocr/image";
import type { TemplateSet } from "../src/ocr/glyphs";
import { type Recognize } from "../src/ocr/neural";
import { readWithFallback } from "../src/ocr/pipeline";
import { pctConsistent, requiredExp } from "../src/core/expTable";

const dir = process.argv[2];
const labels: { file: string; level: string | null; exp: string | null; occluded?: boolean }[] = JSON.parse(
  fs.readFileSync(path.join(dir, "labels.json"), "utf8"),
);
const templates: TemplateSet = JSON.parse(fs.readFileSync("src/ocr/templates.json", "utf8"));
const require = createRequire(import.meta.url);
const langPath = path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");

const worker = await createWorker("eng", 1, { langPath, gzip: true });
await worker.setParameters({ tessedit_char_whitelist: "0123456789.,[]%", tessedit_pageseg_mode: PSM.SINGLE_LINE });
const recognize: Recognize = async (img) => {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  const { data } = await worker.recognize(PNG.sync.write(png));
  return { text: data.text.trim(), confidence: data.confidence };
};

let glyph = 0, neural = 0, wrong = 0, rejected = 0;
for (const l of labels) {
  if (!l.exp || l.occluded) continue;
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, l.file)));
  const img: Img = { width: png.width, height: png.height, data: png.data };
  const want = l.exp.match(/^([\d.]*)\[([\d.]+)%\]$/)!;
  const wantAmount = want[1] ? Number(want[1].replace(/\./g, "")) : null;
  const wantPct = Number(want[2]);
  const r = await readWithFallback(img, templates, undefined, recognize);
  if (r.source === "glyph") {
    const ok = r.pct === wantPct && r.amount === wantAmount;
    ok ? glyph++ : (wrong++, console.log("GLYPH WRONG", l.file, r.expText));
    continue;
  }
  let got = r.source === "neural" ? { amount: r.amount, pct: r.pct!, text: r.expText } : null;
  // El validador exige coherencia con la curva si hay nivel.
  const lv = r.level ?? Number(l.level);
  if (got && got.amount !== null && !pctConsistent(lv, got.amount, got.pct!)) {
    console.log("  neural incoherente (rechazado por validador)", l.file, got.text);
    got = null;
  }
  if (!got) {
    rejected++;
    console.log("REJECTED", l.file, "want", l.exp);
  } else if (got.pct === wantPct && got.amount === wantAmount) {
    neural++;
    console.log("NEURAL OK", l.file, got.text);
  } else {
    wrong++;
    console.log("NEURAL WRONG", l.file, got.text, "want", l.exp, "req", requiredExp(lv));
  }
}
await worker.terminate();
console.log(`glifos ok ${glyph} · neural ok ${neural} · rechazadas ${rejected} · INCORRECTAS ${wrong}`);
