import { describe, expect, it } from "vitest";
import { DEFAULT_GEAR, parseCharacters } from "./characters";

describe("parseCharacters", () => {
  it("rellena los campos que faltan y elige un activo válido", () => {
    const r = parseCharacters({ activeId: "nope", chars: [{ id: "a", name: "Uno", createdAt: 1, gear: { level: 50 } }] });
    expect(r?.activeId).toBe("a");
    expect(r?.chars[0].gear).toMatchObject({ level: 50, classId: DEFAULT_GEAR.classId, stats: DEFAULT_GEAR.stats });
  });
  it("rechaza archivos sin personajes", () => {
    expect(parseCharacters({ chars: [] })).toBeNull();
    expect(parseCharacters(null)).toBeNull();
    expect(parseCharacters({ chars: [{ foo: 1 }] })).toBeNull();
  });
});
