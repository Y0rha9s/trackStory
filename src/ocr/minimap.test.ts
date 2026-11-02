import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { decodePrint, encodePrint, findMinimap, matchPrint, readMinimap, readTitle, similarity } from "./minimap";

const FRAME = "tools/samples/minimap.png";
const frame = () => {
  const p = PNG.sync.read(readFileSync(FRAME));
  return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
};

type Frame = ReturnType<typeof frame>;
const copy = (f: Frame): Frame => ({ ...f, data: new Uint8ClampedArray(f.data) });

describe("lector del título del minimapa", () => {
  it("ancla el minimapa por su rótulo", () => {
    expect(findMinimap(frame())).toEqual({ x: 29, y: 73 });
  });

  it("lo encuentra en otra posición de la pantalla", () => {
    const src = frame();
    const W = 900;
    const H = 700;
    const data = new Uint8ClampedArray(W * H * 4).fill(60);
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) for (let c = 0; c < 4; c++) data[((y + 200) * W + x + 400) * 4 + c] = src.data[(y * src.width + x) * 4 + c];
    expect(findMinimap({ width: W, height: H, data })).toEqual({ x: 429, y: 273 });
  });

  it("sin minimapa no inventa nada", () => {
    const blank = { width: 600, height: 400, data: new Uint8ClampedArray(600 * 400 * 4).fill(90) };
    expect(readMinimap(blank)).toEqual({ kind: "none" });
  });

  it("minimapa sin título (cerrado): lo distingue de «no hay minimapa»", () => {
    const f = copy(frame());
    for (let y = 90; y < 120; y++) for (let x = 70; x < 235; x++) for (let c = 0; c < 3; c++) f.data[(y * f.width + x) * 4 + c] = 150;
    expect(readMinimap(f)).toEqual({ kind: "closed" });
  });

  it("la huella se reconoce a sí misma, aunque haya ruido de compresión y 1 px de desplazamiento", () => {
    const f = frame();
    const a = findMinimap(f)!;
    const mask = readTitle(f, a)!;
    const fp = encodePrint(mask);
    expect(decodePrint(fp)).toEqual(mask);

    const noisy = copy(f);
    let seed = 7;
    for (let i = 0; i < noisy.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed % 17) - 8;
      for (let c = 0; c < 3; c++) noisy.data[i + c] = Math.max(0, Math.min(255, noisy.data[i + c] + n));
    }
    const fpNoisy = encodePrint(readTitle(noisy, a)!);
    expect(matchPrint(fpNoisy, [{ fp, mapId: 100000000 }])?.mapId).toBe(100000000);

    const shifted = encodePrint(readTitle(f, { x: a.x + 1, y: a.y })!);
    expect(matchPrint(shifted, [{ fp, mapId: 100000000 }])?.mapId).toBe(100000000);
  });

  it("un título distinto no coincide", () => {
    const f = frame();
    const a = findMinimap(f)!;
    const perion = readTitle(f, a)!;
    // «Victoria Road» solo (sin la segunda línea «Perion»)
    const onlyStreet = perion.slice();
    onlyStreet.fill(0, 150 * 13);
    expect(similarity(perion, onlyStreet)).toBeLessThan(0.82);
    expect(matchPrint(encodePrint(onlyStreet), [{ fp: encodePrint(perion), mapId: 1 }])).toBeNull();
  });

  it("elige la huella más parecida entre varias", () => {
    const f = frame();
    const a = findMinimap(f)!;
    const perion = encodePrint(readTitle(f, a)!);
    const other = encodePrint(readTitle(f, { x: a.x, y: a.y - 5 })!);
    expect(matchPrint(perion, [{ fp: other, mapId: 2 }, { fp: perion, mapId: 1 }])?.mapId).toBe(1);
  });
});
