import { describe, expect, it } from "vitest";
import { canUse, classOf, diffBuilds, evaluate, optimize, parseGear, project, type GearItem } from "./gear";

const item = (o: Partial<GearItem> & Pick<GearItem, "id" | "slot">): GearItem => ({
  name: `i${o.id}`,
  weaponType: null,
  reqLevel: 0,
  reqJob: 0,
  req: { str: 0, dex: 0, int: 0, luk: 0 },
  bonus: { str: 0, dex: 0, int: 0, luk: 0 },
  watk: 0,
  matk: 0,
  pdd: 0,
  mdd: 0,
  mhp: 0,
  tuc: 0,
  price: null,
  ...o,
});

const warrior = classOf("warrior");
const base = { str: 100, dex: 20, int: 4, luk: 4 };
const sword = item({ id: 1, slot: "Weapon", weaponType: "1H Sword", watk: 40, reqLevel: 30 });
const spear = item({ id: 2, slot: "Weapon", weaponType: "Spear", watk: 40, reqLevel: 30 });
const shield = item({ id: 3, slot: "Shield", pdd: 20 });

describe("daño", () => {
  it("guerrero con espada 1M: ataque · (1 + (STR·1,8 + DEX)/100)", () => {
    expect(evaluate(warrior, base, { Weapon: sword }).damage).toBeCloseTo(120);
  });
  it("suma los stats del equipo", () => {
    const glove = item({ id: 4, slot: "Glove", bonus: { str: 5, dex: 0, int: 0, luk: 0 }, watk: 2 });
    expect(evaluate(warrior, base, { Weapon: sword, Glove: glove }).damage).toBeCloseTo((1 + (105 * 1.8 + 20) / 100) * 42);
  });
});

describe("daño por clase (Classic)", () => {
  it("mago: ⌊INT/2⌋ + MATK de equipo, por (1 + INT/125)", () => {
    const wand = item({ id: 20, slot: "Weapon", weaponType: "Wand", matk: 30, watk: 40 });
    expect(evaluate(classOf("mage"), { str: 4, dex: 4, int: 100, luk: 4 }, { Weapon: wand }).damage).toBeCloseTo((50 + 30) * (1 + 100 / 125));
  });
  it("ladrón: LUK principal, STR + DEX secundario (también con garra)", () => {
    const claw = item({ id: 21, slot: "Weapon", weaponType: "Claw", watk: 30 });
    expect(evaluate(classOf("thief"), { str: 10, dex: 50, int: 4, luk: 100 }, { Weapon: claw }).damage).toBeCloseTo(30 * (1 + (100 * 2.5 + 60) / 100));
  });
  it("tope de 99.999", () => {
    const big = item({ id: 22, slot: "Weapon", weaponType: "Polearm", watk: 50000 });
    expect(evaluate(warrior, base, { Weapon: big }).damage).toBe(99_999);
  });
});

describe("requisitos", () => {
  it("rechaza por nivel, clase y stats", () => {
    expect(canUse(sword, warrior, 29, base)).toBe(false);
    expect(canUse(sword, classOf("mage"), 30, base)).toBe(false);
    expect(canUse(item({ id: 5, slot: "Hat", req: { str: 200, dex: 0, int: 0, luk: 0 } }), warrior, 50, base)).toBe(false);
    expect(canUse(item({ id: 6, slot: "Hat", reqJob: 8 }), warrior, 50, base)).toBe(false);
  });
});

describe("optimizador", () => {
  it("elige el arma de más daño y no combina 2 manos con escudo", () => {
    const strongSpear = item({ ...spear, watk: 60 });
    const b = optimize(warrior, 30, base, [sword, strongSpear, shield], { defense: 0 });
    expect(b.Weapon?.id).toBe(2);
    expect(b.Shield).toBeFalsy();
  });
  it("usa escudo con arma de una mano", () => {
    const b = optimize(warrior, 30, base, [sword, shield], { defense: 0 });
    expect(b.Shield?.id).toBe(3);
  });
  it("traje completo vs arriba+abajo: gana el de más daño", () => {
    const overall = item({ id: 7, slot: "Overall", bonus: { str: 10, dex: 0, int: 0, luk: 0 } });
    const top = item({ id: 8, slot: "Top", bonus: { str: 4, dex: 0, int: 0, luk: 0 } });
    const bottom = item({ id: 9, slot: "Bottom", bonus: { str: 4, dex: 0, int: 0, luk: 0 } });
    expect(optimize(warrior, 30, base, [sword, overall, top, bottom], { defense: 0 }).Overall?.id).toBe(7);
  });
});

describe("proyección", () => {
  it("aparece el ítem nuevo en el nivel que lo permite", () => {
    const better = item({ id: 10, slot: "Weapon", weaponType: "1H Sword", watk: 70, reqLevel: 35 });
    const p = project(warrior, 30, base, [sword, better], { defense: 0 }, 10);
    expect(p[0].build.Weapon?.id).toBe(1);
    expect(p[5].build.Weapon?.id).toBe(10);
    expect(diffBuilds(p[0].build, p[5].build).map((d) => d.slot)).toEqual(["Weapon"]);
    expect(p[10].damage).toBeGreaterThan(p[0].damage);
  });
});

describe("parseGear", () => {
  it("lee equipos de OSMS", () => {
    const g = parseGear({ items: [{ id: 1302000, name: "Sword", category: "Equipment", sub_category: "Weapon", weapon_type: "1H Sword", stats: { reqLevel: 10, reqSTR: 20, incPAD: 17 } }, { id: 2000000, category: "Consumable" }] });
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ slot: "Weapon", reqLevel: 10, watk: 17, req: { str: 20 } });
  });
});

describe("origen de ítems", () => {
  it("recetas y recompensas de quest", async () => {
    const { parseCrafting, parseQuestRewards, describeItem, osmsItemUrl } = await import("./gear");
    const craft = parseCrafting({ disciplines: [{ discipline: "Tailoring", output_types: [{ levels: [{ level: 8, recipes: [{ output_id: 1072103, req_level: 8, meso_cost: 500, ingredients: [{ item_id: 1, item_name: "Screw", count: 24 }] }] }] }] }] });
    const quest = parseQuestRewards({ quests: [{ id: "1", name: "Q", level_min: 5, rewards: [{ type: "item", guaranteed: true, id: 1072103 }] }] });
    const shoes = item({ id: 1072103, slot: "Shoes", reqLevel: 40, price: 4200 });
    const text = describeItem(shoes, { craft, quest });
    expect(text).toContain("Se craftea (Tailoring nv 8): 24× Screw + 500 mesos");
    expect(text).toContain("Recompensa de quest: Q");
    expect(osmsItemUrl(shoes, classOf("mage"))).toBe("https://osmsdataexplorer.com/#equipment?class=2&type=Shoes&open=01072103");
  });
});

describe("siguiente mejora por slot", () => {
  it("encuentra el ítem de más defensa aunque no suba el daño", async () => {
    const { nextUpgrades } = await import("./gear");
    const old = item({ id: 30, slot: "Hat", reqLevel: 30, pdd: 10 });
    const newer = item({ id: 31, slot: "Hat", reqLevel: 40, pdd: 30 });
    const next = nextUpgrades(warrior, 35, base, [sword, old, newer], { defense: 1 }, { Weapon: sword, Hat: old }, 20);
    expect(next.Hat?.id).toBe(31);
    expect(nextUpgrades(warrior, 35, base, [sword, old, newer], { defense: 1 }, { Weapon: sword, Hat: old }, 3).Hat).toBeUndefined();
  });
});

describe("ítems bloqueados por stats", () => {
  it("avisa qué stat falta", async () => {
    const { blockedItems } = await import("./gear");
    const boots = item({ id: 40, slot: "Shoes", reqLevel: 40, req: { str: 70, dex: 30, int: 0, luk: 0 } });
    const b = blockedItems(warrior, 45, { str: 100, dex: 4, int: 4, luk: 4 }, [boots], {});
    expect(b.Shoes?.missing).toEqual(["DEX 30 (tienes 4)"]);
  });
});
