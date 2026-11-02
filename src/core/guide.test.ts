import { describe, expect, it } from "vitest";
import { parseWorld } from "../data/world";
import { buildGuide, turnInNpc } from "./guide";
import { parseQuests } from "./quests";

const map = (id: number, street: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, street_name: street, region: "V", ...extra });
const world = parseWorld(
  {
    regions: [
      {
        maps: [
          map(1, "Victoria Road", "Kerning City", { exits: [2], npcs: [10] }),
          map(2, "Victoria Road", "Ticket Booth", { exits: [1], npcs: [11, 12], return_map_id: 1 }),
          map(100, "Line 3 Site", "B1 <Area 1>", { exits: [101], npcs: [13], return_map_id: 1 }),
          map(101, "Line 3 Site", "B1 <Depot>", { npcs: [14], return_map_id: 1, mob_positions: [{ id: 1 }] }),
        ],
      },
    ],
  },
  { monsters: [{ id: 1, name: "Stirge", level: 20, hp: 1, exp: 1 }] },
  { npc_names: { "10": "Shumi", "11": "Jake", "12": "The Ticket Gate", "13": "Exit", "14": "Treasure Chest" } },
);
const quests = parseQuests({
  quests: [
    { id: "1", name: "[Site B1] Shumi's Lost Coin", region: "Kerning City", npc_id: 10, npc_name: "Shumi", level_min: 35, rewards: [], requirements_list: [{ type: "item", id: 99, name: "Shumi's Coin", count: 1, label: "Shumi's Coin x1" }], next_quest: "2", next_quest_name: "B2" },
    { id: "2", name: "[Site B2] Next", region: "Kerning City", npc_id: 12, npc_name: "Other", rewards: [] },
  ],
});
const by = new Map(quests.map((q) => [q.id, q]));
const tickets = [{ id: 5, name: "Ticket to Site B1", description: "A ticket that allows you to enter Site B1." }];

describe("guía paso a paso", () => {
  const steps = buildGuide(quests[0], quests[1], { world, itemSrc: { craft: new Map(), quest: new Map(), tickets }, byId: by, done: new Set() }, []);
  const text = steps.map((s) => `${s.title}\n${s.lines.join("\n")}`).join("\n");
  it("NPC de inicio con su mapa", () => expect(text).toContain("Habla con Shumi\nEstá en: Victoria Road: Kerning City"));
  it("entrada por NPC, ticket y recorrido interno", () => {
    expect(text).toContain("habla con Jake o con The Ticket Gate");
    expect(text).toContain("Necesitas: Ticket to Site B1");
    expect(text).toContain("B1 <Area 1> → B1 <Depot>");
    expect(text).toContain("Treasure Chest");
  });
  it("el ítem sin fuente apunta a la zona", () => expect(text).toContain("Junta 1 × Shumi's Coin — búscalo en Site B1"));
  it("la entrega usa el NPC de la quest siguiente", () => {
    expect(turnInNpc(quests[0], quests[1])).toMatchObject({ name: "Other", guessed: true });
    expect(text).toContain("Entrega a Other (probable)");
  });
});
