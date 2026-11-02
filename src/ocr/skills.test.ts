import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { findSkillWindow, learnDigits, readSkillWindow, rowGlyphs, type DigitTemplates } from "./skills";
import baseDigits from "./skillDigits.json";

const load = (f: string) => {
  const p = PNG.sync.read(readFileSync(`tools/samples/skills/${f}.png`));
  return { width: p.width, height: p.height, data: p.data };
};

/** Pega `src` sobre un fondo gris en (ox, oy), como si la ventana estuviera en otro lugar de la pantalla. */
function place(src: ReturnType<typeof load>, ox: number, oy: number) {
  const W = 900;
  const H = 700;
  const data = new Uint8ClampedArray(W * H * 4).fill(120);
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) for (let c = 0; c < 4; c++) data[((y + oy) * W + x + ox) * 4 + c] = src.data[(y * src.width + x) * 4 + c];
  return { width: W, height: H, data };
}

describe("lector de la ventana de skills", () => {
  const tpl = baseDigits as DigitTemplates;

  it("lee el 1er job (Magician) con su pestaña y niveles", () => {
    const r = readSkillWindow(load("magician-1st-job"), tpl)!;
    expect(r.tab).toBe("first");
    expect(r.levels).toEqual([15, 15, 15, 0, 1, 15]);
  });
  it("lee el 2º job (I/L Wizard)", () => {
    const r = readSkillWindow(load("il-2nd-job"), tpl)!;
    expect(r.tab).toBe("second");
    expect(r.levels).toEqual([0, 0, 1, 0, 18, 0]);
  });
  it("encuentra la ventana en cualquier posición de la pantalla", () => {
    const r = readSkillWindow(place(load("magician-1st-job"), 333, 111), tpl)!;
    expect(r.window).toMatchObject({ x: 333, y: 111 + 39 });
    expect(r.levels).toEqual([15, 15, 15, 0, 1, 15]);
  });
  it("sin ventana abierta no inventa nada", () => {
    const empty = { width: 400, height: 300, data: new Uint8ClampedArray(400 * 300 * 4).fill(90) };
    expect(findSkillWindow(empty)).toBeNull();
  });
  it("dígitos desconocidos dan null y se aprenden con el valor real", () => {
    const img = load("il-2nd-job");
    const empty = readSkillWindow(img, {})!;
    expect(empty.levels.every((l) => l === null)).toBe(true);
    const w = findSkillWindow(img)!;
    let learned: DigitTemplates = {};
    [0, 0, 1, 0, 18, 0].forEach((v, r) => (learned = learnDigits(learned, rowGlyphs(img, w, r), v).templates));
    expect(readSkillWindow(img, learned)!.levels).toEqual([0, 0, 1, 0, 18, 0]);
    // un valor con distinta cantidad de dígitos que de glifos no enseña nada
    expect(learnDigits({}, rowGlyphs(img, w, 4), 5).learned).toBe(0);
  });
});
