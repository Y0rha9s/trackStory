import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { beforeEach, describe, expect, it } from "vitest";
import { mapWatch } from "./mapWatch";

const frame = () => {
  const p = PNG.sync.read(readFileSync("tools/samples/minimap.png"));
  return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
};

describe("mapa detectado por el minimapa", () => {
  beforeEach(() => mapWatch.reset());

  it("título desconocido: espera a que el usuario elija el mapa y lo aprende", () => {
    mapWatch.check(frame());
    expect(mapWatch.get().status).toBe("unknown");
    expect(mapWatch.get().pending).not.toBeNull();

    mapWatch.choose(102000000);
    expect(mapWatch.get()).toMatchObject({ mapId: 102000000, status: "ok", pending: null });
    expect(mapWatch.learnedCount()).toBe(1);

    // la próxima vez lo reconoce solo
    mapWatch.check(frame());
    expect(mapWatch.get()).toMatchObject({ mapId: 102000000, status: "ok" });
  });

  it("cambia de mapa solo cuando el juego cambia, no pisa lo que el usuario mira a mano", () => {
    mapWatch.check(frame());
    mapWatch.choose(102000000);
    mapWatch.choose(100000000); // el usuario curiosea otro mapa
    mapWatch.check(frame()); // sigue en Perion: no lo revierte
    expect(mapWatch.get().mapId).toBe(100000000);
  });

  it("sin pantalla o sin minimapa conserva el último mapa", () => {
    mapWatch.check(frame());
    mapWatch.choose(102000000);
    mapWatch.check(null);
    expect(mapWatch.get()).toMatchObject({ status: "noscreen", mapId: 102000000 });
    mapWatch.check({ width: 400, height: 300, data: new Uint8ClampedArray(400 * 300 * 4).fill(80) });
    expect(mapWatch.get()).toMatchObject({ status: "none", mapId: 102000000 });
  });
});
