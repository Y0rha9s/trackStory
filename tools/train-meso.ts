/**
 * Plantillas de dígitos de mesos: evaluación dejando-uno-fuera y escritura en templates.json.
 *   npx tsx tools/train-meso.ts <dir-con-labels.json> [--write]
 * labels.json: [{ file, mesos: "1,090,609" | null, crop: boolean }]
 *   crop=true → la imagen ya es el campo blanco; crop=false → frame completo (debe encontrar la moneda).
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import type { Glyph, TemplateSet } from "../src/ocr/glyphs";
import { findMesoFields, readMesos, segmentMeso } from "../src/ocr/meso";
import { buildTemplates } from "../src/ocr/train";

const dir = process.argv[2];
const labels: { file: string; mesos: string | null; crop: boolean }[] = JSON.parse(fs.readFileSync(path.join(dir, "labels.json"), "utf8"));
const load = (f: string) => {
  const p = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
  return { width: p.width, height: p.height, data: p.data };
};

function samplesFrom(set: typeof labels) {
  const m = new Map<string, Glyph[]>();
  for (const l of set) {
    if (!l.mesos) continue;
    const img = load(l.file);
    const field = findMesoFields(img, !l.crop)[0];
    if (!field) continue;
    const seg = segmentMeso(img, field.field);
    const chars = l.mesos.replace(/,/g, "");
    const digits = seg.glyphs.filter((_, i) => !seg.separators.has(i));
    if (digits.length !== chars.length) {
      console.log("  no calza", l.file, digits.length, chars.length);
      continue;
    }
    digits.forEach((g, i) => (m.get(chars[i]) ?? m.set(chars[i], []).get(chars[i])!).push(g));
  }
  return m;
}

let ok = 0, rej = 0, bad = 0;
for (const l of labels) {
  // Dejar fuera la imagen y también su par (recorte ↔ frame compuesto del mismo valor).
  const train = labels.filter((o) => o !== l && o.mesos !== l.mesos);
  const tpl = buildTemplates(samplesFrom(train));
  const img = load(l.file);
  const r = l.crop
    ? (() => {
        const f = findMesoFields(img, false)[0];
        return { read: f ? (readMesos(img, tpl, f).read) : null };
      })()
    : readMesos(img, tpl);
  const want = l.mesos === null ? null : Number(l.mesos.replace(/,/g, ""));
  const got = r.read?.amount ?? null;
  if (want === null) got === null ? ok++ : (bad++, console.log("FALSO POSITIVO", l.file, got));
  else if (got === null) (rej++, console.log("rechazada", l.file, r.read?.text ?? "sin campo"));
  else if (got === want) ok++;
  else (bad++, console.log("MAL", l.file, got, "!=", want));
}
console.log(`dejando-uno-fuera: ok ${ok} · rechazadas ${rej} · incorrectas ${bad}`);

if (process.argv.includes("--write")) {
  const p = new URL("../src/ocr/templates.json", import.meta.url);
  const t: TemplateSet = JSON.parse(fs.readFileSync(p, "utf8"));
  t.meso = buildTemplates(samplesFrom(labels));
  fs.writeFileSync(p, JSON.stringify(t));
  const all = readMesos(load(labels.find((l) => !l.crop && l.mesos)!.file), t.meso);
  console.log("plantillas de mesos escritas:", t.meso.map((x) => x.char + x.n).join(" "), "· prueba:", all.read?.text);
}
