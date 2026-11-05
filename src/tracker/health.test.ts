import { describe, expect, it } from "vitest";
import { frameHealth } from "./health";

const solid = (v: number, w = 640, h = 360) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(v) });

describe("salud del frame", () => {
  it("un frame negro se marca como vacío", () => {
    expect(frameHealth(solid(0)).blank).toBe(true);
  });
  it("un frame con contenido no", () => {
    const img = solid(0);
    for (let i = 0; i < img.data.length; i += 4) img.data[i] = img.data[i + 1] = img.data[i + 2] = (i / 4) % 7 ? 120 : 20;
    expect(frameHealth(img).blank).toBe(false);
  });
  it("la huella cambia cuando cambia la imagen y se repite si no", () => {
    const a = solid(90);
    const b = solid(90);
    b.data[(180 * 640 + 320) * 4] = 250;
    b.data[(181 * 640 + 321) * 4] = 250;
    expect(frameHealth(a).hash).toBe(frameHealth(solid(90)).hash);
    const c = solid(90, 1920, 1080);
    expect(frameHealth(c).blank).toBe(false);
  });
});
