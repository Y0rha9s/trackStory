/** npx tsx tools/debug.ts <png> — muestra regiones, glifos y clasificación de una captura. */
import fs from "node:fs";
import { PNG } from "pngjs";
import { findExp, findLevel } from "../src/ocr/hud";
import { classify, segmentExp, segmentLevel, GW, GH, type TemplateSet } from "../src/ocr/glyphs";

const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const img = { width: png.width, height: png.height, data: png.data };
let t: TemplateSet = { exp: [], level: [] };
try {
  t = JSON.parse(fs.readFileSync(new URL("../src/ocr/templates.json", import.meta.url), "utf8"));
} catch {}
const lv = findLevel(img);
console.log("level", JSON.stringify(lv));
if (lv)
  for (const g of segmentLevel(img, lv)) {
    console.log(" tile glyph", JSON.stringify(g.box), g.aspect.toFixed(2), JSON.stringify(classify(g, t.level)));
    show(g.grid);
  }
const ex = findExp(img);
console.log("exp", JSON.stringify(ex));
if (ex) {
  const s = segmentExp(img, ex);
  console.log("digitH", s.digitH);
  for (const [name, list] of [["inner", s.inner], ["amount", s.amount]] as const)
    for (const g of list) {
      console.log(name, JSON.stringify(g.box), "relH", g.relH.toFixed(2), "asp", g.aspect.toFixed(2), JSON.stringify(classify(g, t.exp)));
      if (process.argv.includes("-v")) show(g.grid);
    }
}
function show(grid: number[]) {
  for (let y = 0; y < GH; y++)
    console.log("   " + grid.slice(y * GW, y * GW + GW).map((v) => (v > 0.66 ? "#" : v > 0.33 ? "+" : v > 0.1 ? "." : " ")).join(""));
}
