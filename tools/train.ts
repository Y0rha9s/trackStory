/**
 * Entrena plantillas de glifos desde capturas etiquetadas y evalúa en un set separado.
 *
 *   npx tsx tools/train.ts <dir-con-labels.json> [--write]
 *
 * labels.json: [{ file, level, exp }]  (exp como "168.918[77.99%]" o "[94.65%]")
 * Con --write guarda src/ocr/templates.json entrenado con TODAS las capturas.
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import type { Img } from "../src/ocr/image";
import type { TemplateSet } from "../src/ocr/glyphs";
import { emptySamples, learnFromFrame, samplesToTemplates } from "../src/ocr/train";
import { readFrame } from "../src/ocr/reader";

interface Label {
  file: string;
  level: string | null;
  exp: string | null;
  occluded?: boolean;
}

const dir = process.argv[2];
const write = process.argv.includes("--write");
const labels: Label[] = JSON.parse(fs.readFileSync(path.join(dir, "labels.json"), "utf8"));

function load(file: string): Img {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
  return { width: png.width, height: png.height, data: png.data };
}

// Separación entrenamiento / prueba: cada grupo de fixtures aporta a ambos lados.
const isTrain = (l: Label, i: number) => i % 3 === 0;

function train(set: Label[]): TemplateSet {
  const samples = emptySamples();
  for (const l of set) if (!l.occluded) learnFromFrame(load(l.file), l.level, l.exp, samples);
  else learnFromFrame(load(l.file), l.level, null, samples);
  return samplesToTemplates(samples);
}

function evaluate(set: Label[], templates: TemplateSet) {
  let lvOk = 0, lvRej = 0, lvBad = 0, exOk = 0, exRej = 0, exBad = 0;
  const bad: string[] = [];
  for (const l of set) {
    const res = readFrame(load(l.file), templates);
    if (l.level) {
      if (res.levelText === null || res.levelText.includes("?")) lvRej++;
      else if (res.levelText === l.level) lvOk++;
      else (lvBad++, bad.push(`${l.file} level ${res.levelText} != ${l.level}`));
    }
    if (l.exp && !l.occluded) {
      const want = l.exp.replace(/,/g, ".");
      const got = res.expText;
      if (!got || got.includes("?")) (exRej++, bad.push(`${l.file} exp rechazada (${got ?? res.debug.expReason}) want ${want}`));
      else if (got === want) exOk++;
      else (exBad++, bad.push(`${l.file} exp ${got} != ${want}`));
    }
  }
  return { lvOk, lvRej, lvBad, exOk, exRej, exBad, bad };
}

const trainSet = labels.filter(isTrain);
const testSet = labels.filter((l, i) => !isTrain(l, i));
const t = train(trainSet);
console.log("chars exp:", t.exp.map((x) => x.char + x.n).join(" "));
console.log("chars level:", t.level.map((x) => x.char + x.n).join(" "));
const r = evaluate(testSet, t);
console.log(`HELD-OUT (${testSet.length}) nivel ok/rech/mal: ${r.lvOk}/${r.lvRej}/${r.lvBad}  exp ok/rech/mal: ${r.exOk}/${r.exRej}/${r.exBad}`);
for (const b of r.bad) console.log("  ", b);

if (write) {
  const all = train(labels);
  const rAll = evaluate(labels, all);
  console.log(`TODO (${labels.length}) nivel: ${rAll.lvOk}/${rAll.lvRej}/${rAll.lvBad}  exp: ${rAll.exOk}/${rAll.exRej}/${rAll.exBad}`);
  for (const b of rAll.bad) console.log("   *", b);
  fs.writeFileSync(path.join(import.meta.dirname, "../src/ocr/templates.json"), JSON.stringify(all));
  console.log("plantillas escritas");
}
