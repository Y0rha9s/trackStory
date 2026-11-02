import type { MapInfo, World } from "../data/world";

/** Guía de "cómo llegar" a un lugar de quest, armada solo con los portales y NPCs de los datos de OSMS. */
export interface Directions {
  /** mapas donde queda el objetivo (p. ej. las 3 zonas de "Construction Site B1") */
  targets: MapInfo[];
  /** recorrido de mapa en mapa por portales; si hace falta un NPC de transporte, `entry` explica cuál */
  path: MapInfo[];
  /** true si no hay portales desde el mundo hasta el lugar: se entra con un NPC */
  needsNpc: boolean;
  /** mapas cercanos con NPCs que parecen de viaje (ticket, puerta, taxi…), con sus nombres */
  entryHints: { map: MapInfo; npcs: string[] }[];
  /** NPCs presentes en el lugar (cofres, puertas de salida excluidas) */
  atTarget: string[];
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const tokens = (s: string) => norm(s).match(/[a-z0-9]+/g) ?? [];
const TRAVEL_NPC = /ticket|gate|taxi|ferry|warp|portal|entrance|captain|conductor|guide|transport/i;

/** "[Construction Site B1] Shumi's Lost Coin" → "Construction Site B1". */
export function locationPhrase(questName: string): string | null {
  return /^\s*\[([^\]]+)\]/.exec(questName)?.[1]?.trim() ?? null;
}

/** Mapas cuyo nombre (calle + mapa) contiene todas las palabras de la frase. */
export function findMaps(world: World, phrase: string): MapInfo[] {
  const want = tokens(phrase);
  if (!want.length) return [];
  return [...world.maps.values()].filter((m) => {
    const have = new Set(tokens(`${m.street} ${m.name}`));
    return want.every((t) => have.has(t));
  });
}

function bfs(world: World, from: number, goal: (id: number) => boolean, allowed?: (id: number) => boolean): number[] | null {
  const prev = new Map<number, number>([[from, from]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (goal(cur)) {
      const path = [cur];
      while (path[0] !== from) path.unshift(prev.get(path[0])!);
      return path;
    }
    for (const nxt of world.maps.get(cur)?.exits ?? []) {
      if (prev.has(nxt) || !world.maps.has(nxt) || (allowed && !allowed(nxt))) continue;
      prev.set(nxt, cur);
      queue.push(nxt);
    }
  }
  return null;
}

/**
 * Cómo llegar desde `fromMapId` (o el pueblo base del lugar) hasta los mapas de `phrase`.
 * Si no hay portales hasta ahí, entrega el recorrido interno del lugar y los NPCs de viaje cercanos.
 */
export function directionsTo(world: World, phrase: string, fromMapId: number | null): Directions | null {
  const targets = findMaps(world, phrase);
  if (!targets.length) return null;
  const town = targets[0].returnMapId;
  const start = fromMapId ?? town;
  const npcNames = (m: MapInfo) => m.npcs.map((n) => world.npcNames.get(n) ?? `NPC ${n}`);
  // Si algún mapa del lugar tiene un NPC propio (cofre, entrega…), el recorrido apunta ahí y no a la primera sala.
  const interactive = targets.filter((m) => npcNames(m).some((n) => !/^exit$/i.test(n)));
  const goal = new Set((interactive.length ? interactive : targets).map((m) => m.id));
  const atTarget = [...new Set(targets.flatMap(npcNames))].filter((n) => !/^exit$/i.test(n));

  // 1. Por portales desde donde estás.
  const direct = start !== null && world.maps.has(start) ? bfs(world, start, (id) => goal.has(id)) : null;
  if (direct) return { targets, path: direct.map((id) => world.maps.get(id)!), needsNpc: false, entryHints: [], atTarget };

  // 2. Sin portal: el lugar tiene una entrada (mapa al que nadie llega por portal) y se recorre por dentro.
  const street = targets[0].street;
  const group = [...world.maps.values()].filter((m) => m.street === street);
  const inbound = new Set(world.maps.size ? [...world.maps.values()].flatMap((m) => m.exits) : []);
  const entries = group.filter((m) => !inbound.has(m.id));
  let path: number[] = [];
  for (const e of entries) {
    const p = bfs(world, e.id, (id) => goal.has(id));
    if (p && (!path.length || p.length < path.length)) path = p;
  }

  // 3. NPCs de viaje cerca del pueblo base: mapas a un portal de distancia con NPCs de ticket, puerta, etc.
  const hints: Directions["entryHints"] = [];
  const townMap = town !== null ? world.maps.get(town) : undefined;
  for (const id of townMap?.exits ?? []) {
    const m = world.maps.get(id);
    if (!m) continue;
    const names = npcNames(m);
    if (names.some((n) => TRAVEL_NPC.test(n))) hints.push({ map: m, npcs: names });
  }
  return {
    targets,
    path: [...(townMap ? [townMap] : []), ...path.map((id) => world.maps.get(id)!)],
    needsNpc: true,
    entryHints: hints,
    atTarget,
  };
}
