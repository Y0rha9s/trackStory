import { describe, expect, it } from "vitest";
import { levelsMatching, pctConsistent, requiredExp, levelStartExp } from "./expTable";
import { ReadingValidator } from "./validator";
import { computeMetrics, type Sample } from "./metrics";

describe("expTable", () => {
  it("coincide con valores conocidos del HUD", () => {
    expect(requiredExp(1)).toBe(15);
    expect(requiredExp(40)).toBe(294_216);
    expect(requiredExp(52)).toBe(789_631);
    expect(requiredExp(100)).toBe(0);
    expect(levelStartExp(2)).toBe(15);
  });
  it("lecturas reales son consistentes", () => {
    expect(pctConsistent(40, 221_609, 75.32)).toBe(true);
    expect(pctConsistent(52, 542_829, 68.74)).toBe(true);
    expect(pctConsistent(40, 221_609, 75.42)).toBe(false);
    expect(levelsMatching(221_609, 75.32)).toEqual([40]);
  });
});

const r = (o: Partial<Parameters<ReadingValidator["validate"]>[0]>) => ({
  level: 40,
  amount: 221_609,
  pct: 75.32,
  frameId: 1,
  t: 0,
  ...o,
});

describe("validator", () => {
  it("acepta una lectura limpia", () => {
    const v = new ReadingValidator();
    const res = v.validate(r({}), null, null);
    expect(res.ok).toBe(true);
  });
  it("rechaza % inconsistente", () => {
    const v = new ReadingValidator();
    expect(v.validate(r({ pct: 70.0 }), null, null).ok).toBe(false);
  });
  it("detecta dígitos de nivel en conflicto con la EXP", () => {
    const v = new ReadingValidator();
    const res = v.validate(r({ level: 46 }), null, null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/nivel 40/);
  });
  it("subir de nivel exige un segundo frame distinto", () => {
    const v = new ReadingValidator();
    const up = r({ level: 41, amount: 1000, pct: percent(41, 1000) });
    expect(v.validate(up, 40, 290_000).ok).toBe(false);
    expect(v.validate({ ...up, frameId: 1 }, 40, 290_000).ok).toBe(false); // mismo frame
    expect(v.validate({ ...up, frameId: 2, t: 10_000 }, 40, 290_000).ok).toBe(true);
  });
  it("rechaza saltos de nivel", () => {
    const v = new ReadingValidator();
    const res = v.validate(r({ level: 45, amount: 1000, pct: percent(45, 1000) }), 40, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.conflictLevel).toBe(45);
  });
  it("infiere el nivel desde la EXP con dos frames", () => {
    const v = new ReadingValidator();
    expect(v.validate(r({ level: null }), null, null).ok).toBe(false);
    const res = v.validate(r({ level: null, frameId: 2, t: 10_000 }), null, null);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.levelSource).toBe("exp");
  });
  it("modo solo-% estima y conserva la EXP previa dentro del redondeo", () => {
    const v = new ReadingValidator();
    const res = v.validate(r({ amount: null }), 40, 221_609);
    expect(res.ok && res.value.exp).toBe(221_609);
    const res2 = v.validate(r({ amount: null, pct: 80 }), 40, 221_609);
    expect(res2.ok && res2.value.estimated).toBe(true);
    expect(res2.ok && res2.value.exp).toBe(Math.round(0.8 * requiredExp(40)));
  });
});

function percent(l: number, e: number) {
  return Math.round((e / requiredExp(l)) * 10000) / 100;
}

describe("metrics", () => {
  it("calcula exp/hora en la ventana de 5 minutos", () => {
    const s: Sample[] = [];
    for (let i = 0; i <= 30; i++) s.push({ t: i * 10_000, level: 40, exp: 100_000 + i * 1000 });
    const m = computeMetrics(s, 300_000);
    // 1000 exp cada 10 s = 360.000 exp/h
    expect(Math.round(m.ratePerHour!)).toBe(360_000);
    expect(m.gained).toBe(30_000);
  });
  it("cruza subidas de nivel usando EXP total", () => {
    const req = requiredExp(40);
    const s: Sample[] = [
      { t: 0, level: 40, exp: req - 500 },
      { t: 60_000, level: 41, exp: 500 },
    ];
    expect(computeMetrics(s, 60_000).gained).toBe(1000);
  });
  it("no calcula tasa a través de una pausa", () => {
    const s: Sample[] = [
      { t: 0, level: 40, exp: 0 },
      { t: 30_000, level: 40, exp: 1000 },
      { t: 40_000, level: 40, exp: 50_000, segmentStart: true },
    ];
    expect(computeMetrics(s, 40_000).ratePerHour).toBeNull();
  });
});
