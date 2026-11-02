import { describe, expect, it } from "vitest";
import { parseWorld } from "../data/world";
import { directionsTo, findMaps, locationPhrase } from "./route";

const map = (id: number, street: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, street_name: street, region: "V", ...extra });
const maps = {
  regions: [
    {
      maps: [
        map(1, "Victoria Road", "Town", { exits: [2], npcs: [10] }),
        map(2, "Victoria Road", "Ticket Booth", { exits: [1], npcs: [11, 12], return_map_id: 1 }),
        // Zona sin portal desde el mundo: se entra con un NPC.
        map(100, "Line 3 Site", "B1 <Area 1>", { exits: [101], npcs: [13], return_map_id: 1 }),
        map(101, "Line 3 Site", "B1 <Depot>", { npcs: [14], return_map_id: 1 }),
        // Zona alcanzable por portal.
        map(3, "Victoria Road", "Forest", { exits: [4], return_map_id: 1 }),
        map(4, "Victoria Road", "Cave", { return_map_id: 1 }),
      ].map((m) => (m.id === 1 ? { ...m, exits: [2, 3] } : m)),
    },
  ],
};
const monsters = { monsters: [{ id: 1, name: "Snail", level: 1, hp: 1, exp: 1 }] };
const lookups = { npc_names: { "10": "Mayor", "11": "Jake", "12": "The Ticket Gate", "13": "Exit", "14": "Treasure Chest" } };

describe("cómo llegar", () => {
  const w = parseWorld(maps, monsters, lookups);
  it("saca el lugar del título de la quest", () => {
    expect(locationPhrase("[Construction Site B1] Shumi's Lost Coin")).toBe("Construction Site B1");
    expect(locationPhrase("Olaf's Training")).toBeNull();
  });
  it("encuentra los mapas por sus palabras", () => {
    expect(findMaps(w, "Site B1").map((m) => m.id)).toEqual([100, 101]);
  });
  it("ruta por portales cuando existe", () => {
    const d = directionsTo(w, "Cave", 1)!;
    expect(d.needsNpc).toBe(false);
    expect(d.path.map((m) => m.name)).toEqual(["Town", "Forest", "Cave"]);
  });
  it("sin portales: recorrido interno, NPC de viaje cercano y qué hay en el destino", () => {
    const d = directionsTo(w, "Site B1", 1)!;
    expect(d.needsNpc).toBe(true);
    expect(d.path.map((m) => m.name)).toEqual(["Town", "B1 <Area 1>", "B1 <Depot>"]);
    expect(d.entryHints[0].map.name).toBe("Ticket Booth");
    expect(d.entryHints[0].npcs).toEqual(["Jake", "The Ticket Gate"]);
    expect(d.atTarget).toEqual(["Treasure Chest"]);
  });
  it("lugar desconocido", () => {
    expect(directionsTo(w, "Nowhere Land", 1)).toBeNull();
  });
});
