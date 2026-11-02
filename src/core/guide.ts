import type { ItemSources } from "./gear";
import { guessDroppers, type Quest } from "./quests";
import { directionsTo, locationPhrase } from "./route";
import { mapsWithMob, mapsWithNpc, type MapInfo, type World } from "../data/world";

/** Un paso del recorrido, en texto plano: qué hacer y dónde. */
export interface GuideStep {
  title: string;
  lines: string[];
}

export interface GuideContext {
  world: World | null;
  itemSrc: ItemSources | null;
  byId: ReadonlyMap<string, Quest>;
  done: ReadonlySet<string>;
}

export const mapLabel = (m: Pick<MapInfo, "name" | "street">) => (m.street && m.street !== m.name ? `${m.street}: ${m.name}` : m.name);

const placeOf = (world: World | null, npcId: number) => (world && npcId ? mapsWithNpc(world, npcId, 3).map(mapLabel).join(" · ") : "");
const tokens = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Quién recibe la entrega. OSMS solo da el NPC de inicio: se usa el de la quest siguiente, o el mismo NPC (supuesto). */
export function turnInNpc(q: Quest, next: Quest | undefined): { name: string; id: number; guessed: boolean } {
  if (next?.npc) return { name: next.npc, id: next.npcId, guessed: true };
  return { name: q.npc, id: q.npcId, guessed: true };
}

/**
 * Recorrido paso a paso de una quest, armado solo con datos públicos de OSMS: dónde está cada NPC, en qué mapas viven los mobs,
 * cómo se llega a una zona (portales, NPC de transporte, ticket) y a quién se entrega.
 * Lo que no existe en los datos (precio del ticket, saltos de una jump quest) se dice tal cual, sin inventarlo.
 */
export function buildGuide(q: Quest, next: Quest | undefined, ctx: GuideContext, pending: readonly Quest[]): GuideStep[] {
  const { world, itemSrc } = ctx;
  const steps: GuideStep[] = [];

  if (pending.length) {
    steps.push({
      title: "Antes, termina estas quests",
      lines: pending.map((p, i) => `${i + 1}. ${p.name} (nv ${p.levelMin || "—"}${p.npc ? `, ${p.npc}` : ""})`),
    });
  }

  const startPlace = placeOf(world, q.npcId);
  steps.push({ title: `Habla con ${q.npc || "el NPC de la quest"}`, lines: [startPlace ? `Está en: ${startPlace}` : `Zona: ${q.region}`] });

  // Zona especial indicada en el título, p. ej. "[Construction Site B1] …"
  const phrase = locationPhrase(q.name);
  const dir = world && phrase ? directionsTo(world, phrase, mapsWithNpc(world, q.npcId, 1)[0]?.id ?? null) : null;
  if (dir && phrase) {
    const lines: string[] = [];
    if (dir.needsNpc) {
      const ticket = (itemSrc?.tickets ?? []).find((t) => {
        const have = new Set(tokens(t.name));
        return tokens(phrase).every((w) => have.has(w));
      });
      if (dir.entryHints.length) {
        for (const h of dir.entryHints) lines.push(`No se entra por portal. Ve a ${mapLabel(h.map)} y habla con ${h.npcs.join(" o con ")}.`);
      } else lines.push("No se entra por portal: se entra hablando con un NPC de transporte cerca del pueblo.");
      if (ticket) lines.push(`Necesitas: ${ticket.name}. ${ticket.description} El precio y dónde se compra exactamente no figuran en los datos públicos.`);
      lines.push(`Una vez adentro, recorre: ${dir.path.slice(1).map((m) => m.name).join(" → ") || dir.targets[0].name}.`);
    } else {
      lines.push(`Ruta por portales: ${dir.path.map((m) => m.name).join(" → ")}.`);
    }
    const last = dir.path.at(-1);
    if (dir.atTarget.length && last) lines.push(`En ${last.name} hay: ${dir.atTarget.join(", ")}. Interactúa con eso para avanzar (el detalle de los saltos no está en los datos).`);
    steps.push({ title: `Llegar a ${phrase}`, lines });
  }

  const goals: string[] = [];
  for (const m of q.mobReqs) {
    const spots = world ? mapsWithMob(world, m.id, 3) : [];
    const lv = world?.mobs.get(m.id)?.level;
    goals.push(`Mata ${m.count} × ${m.name}${lv !== undefined ? ` (nv ${lv})` : ""}${spots.length ? ` — dónde: ${spots.map((s) => `${mapLabel(s.map)} (${s.spawns})`).join(" · ")}` : ""}`);
  }
  for (const i of q.itemReqs) {
    const recipes = itemSrc?.craft.get(i.id) ?? [];
    const rewardOf = (itemSrc?.quest.get(i.id) ?? []).filter((r) => r.quest !== q.name);
    const droppers = world ? guessDroppers(i.name, world.mobs.values()) : [];
    let how: string;
    if (recipes.length) how = `se craftea (${recipes[0].discipline}): ${recipes[0].ingredients.map((x) => `${x.count}× ${x.name}`).join(", ")}`;
    else if (rewardOf.length) how = `lo da la quest ${rewardOf[0].quest}`;
    else if (droppers.length) {
      const m = droppers[0];
      const spots = world ? mapsWithMob(world, m.id, 2).map((s) => mapLabel(s.map)).join(" · ") : "";
      how = `probablemente lo suelta ${m.name} (según el nombre)${spots ? `: ${spots}` : ""}`;
    } else if (dir && dir.atTarget.length) how = `búscalo en ${phrase}`;
    else how = "sin dato público de dónde sale; mira la ficha del ítem en OSMS";
    goals.push(`Junta ${i.count} × ${i.name} — ${how}`);
  }
  if (q.other.length) goals.push(`Requisitos extra: ${q.other.join(" · ")}`);
  if (goals.length) steps.push({ title: "Objetivos", lines: goals });

  const turn = turnInNpc(q, next);
  const turnPlace = placeOf(world, turn.id);
  const reward = [q.exp ? `${q.exp.toLocaleString("es-CL")} EXP` : "", q.money ? `${q.money.toLocaleString("es-CL")} mesos` : "", q.rewardItems].filter(Boolean).join(" · ");
  steps.push({
    title: `Entrega a ${turn.name || "el NPC"} (probable)`,
    lines: [turnPlace ? `Está en: ${turnPlace}` : "", reward ? `Recompensa: ${reward}` : ""].filter(Boolean),
  });

  if (next) steps.push({ title: `Sigue: ${next.name}`, lines: [`Nivel ${next.levelMin || "—"} · ${next.npc || next.region}`] });
  return steps;
}
