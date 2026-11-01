import { describe, expect, it } from "vitest";
import { bestMapsFor, parseTimer, parseWorld, searchMaps, summarize } from "./world";
import { estimateHunt } from "../core/hunting";

// Mundo inventado con la forma de los archivos de OSMS (no se incluyen datos reales).
const maps = {
  regions: [
    {
      maps: [
        { id: 10003110, name: "The Swamp I", street_name: "Hidden Street", region: "Victoria", mob_positions: [...Array(16).fill({ id: 1 }), ...Array(17).fill({ id: 2 })] },
        { id: 100000000, name: "Town", street_name: "Victoria", region: "Victoria", is_town: true, mob_positions: [] },
        { id: 20000000, name: "Boss Field", street_name: "Somewhere", region: "Victoria", mob_positions: [{ id: 3 }, { id: 1 }] },
        { id: 30000000, name: "Alias Field", street_name: "Somewhere", region: "Victoria", mob_positions: [{ id: 99 }, { id: 99 }] },
      ],
    },
  ],
};
const monsters = {
  monsters: [
    { id: 1, name: "Swamp Snake", level: 21, hp: 272, exp: 39, maps: [{ id: 10003110, count: 16 }] },
    { id: 2, name: "Gator", level: 31, hp: 853, exp: 58, maps: [{ id: 10003110, count: 17 }] },
    { id: 3, name: "Big Boss", level: 40, hp: 9000, exp: 900, maps: [{ id: 20000000, count: 1, mob_time: "180.00-1800.00 [720.00]" }] },
  ],
};
const lookups = { mob_names: { "99": "Gator" } };

describe("mundo de OSMS", () => {
  const w = parseWorld(maps, monsters, lookups);

  it("timers", () => {
    expect(parseTimer("300.00")).toBe(300);
    expect(parseTimer("180.00-1800.00 [720.00]")).toBe(720);
    expect(parseTimer(null)).toBeNull();
  });

  it("resume un mapa con la regla de respawn", () => {
    const s = summarize(w, 10003110)!;
    expect(s.mobs.map((m) => [m.name, m.spawnPoints])).toEqual([["Gator", 17], ["Swamp Snake", 16]]);
    // 33 puntos × 3600/7,56 × 0,75 ≈ 11.786 mobs/h en solitario
    expect(Math.round(s.solo.mobs)).toBe(11786);
    expect(Math.round(s.party.mobs)).toBe(15714);
    expect(s.minLevel).toBe(21);
  });

  it("los spawns con timer usan el promedio y no cambian entre solo y party", () => {
    const s = summarize(w, 20000000)!;
    const boss = s.mobs.find((m) => m.name === "Big Boss")!;
    expect(boss.timer).toBe(720);
    expect(boss.soloPerHour).toBe(5);
    expect(boss.partyPerHour).toBe(5);
  });

  it("agrupa mobs sin ficha con su homónimo", () => {
    expect(summarize(w, 30000000)!.mobs[0]).toMatchObject({ name: "Gator", spawnPoints: 2 });
  });

  it("busca y recomienda mapas", () => {
    expect(searchMaps(w, "swamp").map((m) => m.id)).toEqual([10003110]);
    expect(bestMapsFor(w, 28).map((s) => s.map.id)).toContain(10003110);
    expect(bestMapsFor(w, 28).map((s) => s.map.id)).not.toContain(20000000); // mapas con jefe se excluyen
  });

  it("estima kills y eficiencia", () => {
    const s = summarize(w, 10003110)!;
    const e = estimateHunt(s, 300_000, 10_000)!;
    // EXP promedio = (39×16 + 58×17) / 33 ≈ 48,8
    expect(e.avgExp).toBeCloseTo(48.79, 1);
    expect(Math.round(e.killsPerHour!)).toBe(6149);
    expect(e.efficiency!).toBeCloseTo(300_000 / s.solo.exp, 5);
    expect(e.main).toMatchObject({ name: "Gator", toLevel: 173 });
  });
});
