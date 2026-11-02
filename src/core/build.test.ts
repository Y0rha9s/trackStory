import { describe, expect, it } from "vitest";
import { approxSp, effectRange, formatSteps, skillRows, skillWhy, groupAp, JOBS, jobFor, parseSkills, parseSteps, planAp, targetsAt, upcoming } from "./build";
import { classOf, type GearItem } from "./gear";

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

describe("plantillas de skills", () => {
  it("se leen y se vuelven a escribir igual", () => {
    const steps = parseSteps("33 Sword Mastery = 10\nbasura\n36 Sword Mastery = 20");
    expect(steps).toEqual([
      { at: 33, skill: "Sword Mastery", to: 10 },
      { at: 36, skill: "Sword Mastery", to: 20 },
    ]);
    expect(parseSteps(formatSteps(steps))).toEqual(steps);
  });
  it("objetivo a un nivel y próximos pasos", () => {
    const steps = parseSteps("33 A = 10\n36 A = 20\n40 B = 5");
    expect([...targetsAt(steps, 37)]).toEqual([["A", 20]]);
    expect(upcoming(steps, 37).map((s) => s.skill)).toEqual(["B"]);
  });
  it("todas las plantillas son alcanzables con los SP del nivel (con margen)", () => {
    for (const job of JOBS) {
      for (const v of job.variants) {
        const steps = parseSteps(v.text);
        for (const at of new Set(steps.map((s) => s.at))) {
          const total = [...targetsAt(steps, at).values()].reduce((a, b) => a + b, 0);
          expect(total, `${job.id}/${v.label} a nv ${at}`).toBeLessThanOrEqual(approxSp(at) + 3);
        }
      }
    }
  });
  it("job según nivel", () => {
    expect(jobFor("mage", 5).id).toBe("beginner");
    expect(jobFor("mage", 20).id).toBe("magician1");
    expect(jobFor("mage", 45, "cleric").id).toBe("cleric");
    expect(jobFor("mage", 45, "fighter").id).toBe("il");
  });
  it("skills.json por clase", () => {
    const m = parseSkills({ magician: [{ class_name: "I/L Wizard", skills: [{ name: "Cold Beam", max_level: 30, description: "[Master Level: 30]\nFrost" }] }] });
    expect(m.get("I/L Wizard")?.get("Cold Beam")).toEqual({ max: 30, description: "Frost", levels: [] });
  });
});

describe("reparto de AP", () => {
  const warrior = classOf("warrior");
  const sword = item({ id: 1, slot: "Weapon", weaponType: "1H Sword", watk: 40 });
  // Zapatos buenos que piden DEX 30: el AP se va a DEX hasta poder usarlos y luego vuelve a STR.
  const boots = item({ id: 2, slot: "Shoes", reqLevel: 35, pdd: 100, req: { str: 0, dex: 30, int: 0, luk: 0 }, bonus: { str: 5, dex: 0, int: 0, luk: 0 } });
  it("desvía AP al stat que habilita un ítem y explica por qué", () => {
    const plan = planAp(warrior, 34, { str: 100, dex: 25, int: 4, luk: 4 }, [sword, boots], { defense: 0 }, 4);
    expect(plan[0]).toMatchObject({ level: 35, put: "dex" });
    expect(plan[0].why).toContain("i2");
    expect(plan[1].put).toBe("str");
  });
  it("agrupa niveles seguidos", () => {
    expect(
      groupAp([
        { level: 41, put: "str", why: null },
        { level: 42, put: "str", why: null },
        { level: 43, put: "dex", why: "x" },
      ]),
    ).toEqual([
      { from: 41, to: 42, put: "str", why: null },
      { from: 43, to: 43, put: "dex", why: "x" },
    ]);
  });
});

describe("skills: lo que ya tienes vs el objetivo", () => {
  const targets = new Map([["Cold Beam", 20], ["MP Eater", 5]]);
  it("calcula cuántos SP faltan", () => {
    const rows = skillRows(targets, { "Cold Beam": 15, "MP Eater": 5 });
    expect(rows.map((r) => [r.name, r.have, r.missing])).toEqual([["Cold Beam", 15, 5], ["MP Eater", 5, 0]]);
  });
  it("sin anotar nada, falta todo el objetivo", () => {
    expect(skillRows(targets, {}).map((r) => r.missing)).toEqual([20, 5]);
  });
  it("efecto de subir de nivel", () => {
    const info = { max: 3, description: "", levels: ["a", "b", "c"] };
    expect(effectRange(info, 1, 3)).toEqual({ from: "b", to: "c" });
    expect(effectRange(info, 3, 3)).toBeNull();
  });
  it("explica por qué, incluso para skills sin texto propio", () => {
    expect(skillWhy("Cold Beam")).toContain("principal");
    expect(skillWhy("Axe Mastery")).toContain("Maestría");
    expect(skillWhy("Sword Booster")).toContain("Booster");
  });
});
