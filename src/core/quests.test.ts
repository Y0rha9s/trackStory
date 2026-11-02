import { describe, expect, it } from "vitest";
import { forMyClass, parseQuests, pendingChain, statusOf } from "./quests";

const raw = {
  quests: [
    { id: "1", name: "A", region: "Henesys", npc_name: "N", level_min: 10, rewards_exp: 100, rewards: [], requirements_list: [{ type: "mob", label: "Defeat Snail x 5" }], next_quest: "2", next_quest_name: "B" },
    { id: "2", name: "B", region: "Henesys", level_min: 10, rewards: [], requirements_list: [{ type: "quest", id: "1", name: "A" }] },
    { id: "3", name: "Job", region: "Warrior", level_min: 30, rewards: [], is_daily: true },
  ],
};

describe("quests", () => {
  const qs = parseQuests(raw);
  const known = new Set(qs.map((q) => q.id));
  it("lee requisitos, cadena y tipo", () => {
    expect(qs[0]).toMatchObject({ exp: 100, mobs: ["Defeat Snail x 5"], nextId: "2", kind: "normal" });
    expect(qs[2]).toMatchObject({ kind: "daily", forClass: "warrior" });
  });
  it("estado según nivel, prerrequisitos y progreso", () => {
    const ctx = (level: number, done: string[]) => ({ level, classId: "warrior" as const, done: new Set(done), known });
    expect(statusOf(qs[0], ctx(5, []))).toBe("locked-level");
    expect(statusOf(qs[0], ctx(10, []))).toBe("available");
    expect(statusOf(qs[1], ctx(10, []))).toBe("locked-prereq");
    expect(statusOf(qs[1], ctx(10, ["1"]))).toBe("available");
    expect(statusOf(qs[0], ctx(10, ["1"]))).toBe("done");
  });
  it("las quests de job son de una sola clase", () => {
    expect(forMyClass(qs[2], "warrior")).toBe(true);
    expect(forMyClass(qs[2], "mage")).toBe(false);
    expect(forMyClass(qs[0], "mage")).toBe(true);
  });

  it("cadena de quests previas pendientes, la más antigua primero", () => {
    const chain = parseQuests({
      quests: [
        { id: "a", name: "A", region: "X", rewards: [] },
        { id: "b", name: "B", region: "X", rewards: [], requirements_list: [{ type: "quest", id: "a", name: "A" }] },
        { id: "c", name: "C", region: "X", rewards: [], requirements_list: [{ type: "quest", id: "b", name: "B" }] },
      ],
    });
    const by = new Map(chain.map((x) => [x.id, x]));
    expect(pendingChain(by.get("c")!, by, new Set()).map((x) => x.id)).toEqual(["a", "b"]);
    expect(pendingChain(by.get("c")!, by, new Set(["a"])).map((x) => x.id)).toEqual(["b"]);
  });
});

describe("cadena y drops", () => {
  const mk = (id: string, next?: string) => parseQuests({ quests: [{ id, name: id.toUpperCase(), region: "X", rewards: [], next_quest: next }] })[0];
  it("recorre la cadena hacia atrás y hacia adelante", async () => {
    const { buildPrevMap, chainOf } = await import("./quests");
    const qs = [mk("b1", "b2"), mk("b2", "b3"), mk("b3")];
    const by = new Map(qs.map((q) => [q.id, q]));
    expect(chainOf(qs[1], by, buildPrevMap(qs)).map((q) => q.id)).toEqual(["b1", "b2", "b3"]);
    expect(chainOf(qs[2], by, buildPrevMap(qs)).map((q) => q.id)).toEqual(["b1", "b2", "b3"]);
  });
  it("sugiere el mob por el nombre del ítem, el más específico", async () => {
    const { guessDroppers } = await import("./quests");
    const mobs = [{ name: "Blue Mushroom" }, { name: "Mushroom" }, { name: "Stump" }];
    expect(guessDroppers("Blue Mushroom Cap", mobs).map((m) => m.name)).toEqual(["Blue Mushroom"]);
    expect(guessDroppers("Orange Mushroom Cap", mobs).map((m) => m.name)).toEqual([]);
  });
});
