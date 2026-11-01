import { describe, expect, it } from "vitest";
import { MesoValidator, computeMesoMetrics } from "./mesos";
import { parseMesos } from "../ocr/meso";

describe("mesos", () => {
  it("parsea con comas y respeta el tope int32", () => {
    expect(parseMesos("1,090,609")).toBe(1_090_609);
    expect(parseMesos("5")).toBe(5);
    expect(parseMesos("1,09,609")).toBeNull();
    expect(parseMesos("2,147,483,648")).toBeNull();
  });
  it("cambios chicos se aceptan directo", () => {
    const v = new MesoValidator();
    expect(v.validate(1_000_500, 1, 1_000_000).ok).toBe(true);
  });
  it("un salto grande necesita un segundo frame", () => {
    const v = new MesoValidator();
    expect(v.validate(7_000_000, 1, 1_000_000).ok).toBe(false);
    expect(v.validate(7_000_000, 1, 1_000_000).ok).toBe(false); // mismo frame
    expect(v.validate(7_000_100, 2, 1_000_000).ok).toBe(true);
  });
  it("mesos por hora en ventana de 5 minutos", () => {
    const s = Array.from({ length: 31 }, (_, i) => ({ t: i * 10_000, amount: 1_000_000 + i * 500 }));
    const m = computeMesoMetrics(s, 300_000);
    expect(Math.round(m.perHour!)).toBe(180_000);
    expect(m.net).toBe(15_000);
  });
});
