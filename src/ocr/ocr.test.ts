import { describe, expect, it } from "vitest";
import { parseAmount, parsePct } from "./reader";
import { agreesWithGlyphs, parseAmountText, parsePctText } from "./neural";

describe("parseo de lecturas", () => {
  it("cantidad con separadores de miles", () => {
    expect(parseAmount("221.609")).toBe(221_609);
    expect(parseAmount("1,234,567")).toBe(1_234_567);
    expect(parseAmount("412")).toBe(412);
    expect(parseAmount("22.1609")).toBeNull();
    expect(parseAmount(".609")).toBeNull();
  });
  it("porcentaje con dos decimales", () => {
    expect(parsePct("75.32%")).toBe(75.32);
    expect(parsePct("700%")).toBeNull();
    expect(parsePct("101.00%")).toBeNull();
  });
  it("texto de Tesseract tolera ruido típico", () => {
    expect(parsePctText("[54.85%]")).toBe(54.85);
    expect(parsePctText("54,85%")).toBe(54.85);
    expect(parseAmountText("234,915")).toBe(234_915);
    expect(parseAmountText("23491%4957")).toBeNull();
  });
  it("el resultado neuronal debe respetar los glifos seguros", () => {
    expect(agreesWithGlyphs("79.00%", "7?.00%")).toBe(true);
    expect(agreesWithGlyphs("29.00%", "7?.00%")).toBe(false);
    expect(agreesWithGlyphs("7.00%", "7?.00%")).toBe(true); // largos distintos: no comparable
  });
});
