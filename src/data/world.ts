/**
 * Mapas y mobs de MapleStory Classic desde los archivos JSON que publica OSMS Data Explorer
 * (osmsdataexplorer.com, por @ohmi). Esos archivos no tienen licencia, así que NO se incluyen
 * en el proyecto: el navegador los descarga en vivo y los guarda en caché un día.
 *
 * Este módulo solo interpreta los archivos (sin red), para poder probarlo con datos inventados.
 */

export interface MobInfo {
  id: number;
  name: string;
  level: number;
  hp: number;
  exp: number;
}

export interface MobOnMap extends MobInfo {
  spawnPoints: number;
  /** % de los puntos de spawn del mapa */
  share: number;
  /** segundos del timer si es un spawn con temporizador (jefes, mobs especiales) */
  timer: number | null;
  soloPerHour: number;
  partyPerHour: number;
}

export interface MapInfo {
  id: number;
  name: string;
  street: string;
  region: string;
  isTown: boolean;
  /** id de mob por cada punto de spawn */
  spawns: number[];
}

export interface MapSummary {
  map: MapInfo;
  mobs: MobOnMap[];
  /** techo teórico de mobs y EXP por hora (regla de MeowDB, sin Mob Rate) */
  solo: { mobs: number; exp: number };
  party: { mobs: number; exp: number };
  minLevel: number;
  maxLevel: number;
}

export interface World {
  maps: Map<number, MapInfo>;
  mobs: Map<number, MobInfo>;
  /** timers por mob y mapa: `${mobId}:${mapId}` → segundos */
  timers: Map<string, number>;
}

// Regla de MeowDB (documentada por Minerva, ADR 0008): un spawn sin timer reaparece cada 7,56 s;
// una party completa mata cada mob apenas aparece y un jugador solo logra el 75% de eso.
export const RESPAWN_SECONDS = 7.56;
export const SOLO_SHARE = 0.75;

/** "300.00" → 300; "180.00-1800.00 [720.00]" → 720 (el promedio entre corchetes). */
export function parseTimer(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = t.match(/\[([\d.]+)\]/) ?? t.match(/^\s*([\d.]+)\s*$/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

type Json = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Interpreta maps.json, monsters.json y (opcional) lookups.json. Lanza si la forma cambió. */
export function parseWorld(mapsJson: Json, monstersJson: Json, lookupsJson?: Json): World {
  const mobs = new Map<number, MobInfo>();
  const timers = new Map<string, number>();
  const monsters = monstersJson.monsters;
  if (!Array.isArray(monsters)) throw new Error("monsters.json no tiene la forma esperada");
  for (const m of monsters as Json[]) {
    const id = num(m.id);
    if (!Number.isFinite(id)) continue;
    mobs.set(id, { id, name: str(m.name), level: num(m.level) || 0, hp: num(m.hp) || 0, exp: num(m.exp) || 0 });
    for (const on of (Array.isArray(m.maps) ? m.maps : []) as Json[]) {
      const timer = parseTimer(on.mob_time as string | undefined);
      if (timer) timers.set(`${id}:${num(on.id)}`, timer);
    }
  }

  // Algunos spawns apuntan a un mob sin ficha propia que OSMS agrupa con otro del mismo nombre.
  const byName = new Map<string, number>();
  for (const m of mobs.values()) if (!byName.has(m.name)) byName.set(m.name, m.id);
  const mobNames = ((lookupsJson?.mob_names ?? {}) as Record<string, string>) || {};

  const maps = new Map<number, MapInfo>();
  const regions = mapsJson.regions;
  if (!Array.isArray(regions)) throw new Error("maps.json no tiene la forma esperada");
  for (const r of regions as Json[]) {
    for (const m of (Array.isArray(r.maps) ? r.maps : []) as Json[]) {
      const id = num(m.id);
      const name = str(m.name);
      const street = str(m.street_name);
      if (!Number.isFinite(id) || (!name && !street)) continue;
      const spawns: number[] = [];
      for (const p of (Array.isArray(m.mob_positions) ? m.mob_positions : []) as Json[]) {
        let mob = num(p.id);
        if (!mobs.has(mob)) {
          const alias = byName.get(str(mobNames[String(mob)]));
          if (alias === undefined) continue;
          mob = alias;
        }
        spawns.push(mob);
      }
      maps.set(id, { id, name, street, region: str(m.region), isTown: m.is_town === true, spawns });
    }
  }
  if (!maps.size || !mobs.size) throw new Error("Los archivos de OSMS vinieron vacíos");
  return { maps, mobs, timers };
}

export function summarize(world: World, mapId: number): MapSummary | null {
  const map = world.maps.get(mapId);
  if (!map) return null;
  const counts = new Map<number, number>();
  for (const id of map.spawns) counts.set(id, (counts.get(id) ?? 0) + 1);
  const total = map.spawns.length;
  const mobs: MobOnMap[] = [];
  for (const [id, n] of counts) {
    const mob = world.mobs.get(id);
    if (!mob) continue;
    const timer = world.timers.get(`${id}:${mapId}`) ?? null;
    const solo = timer ? 3600 / timer : (SOLO_SHARE * 3600) / RESPAWN_SECONDS;
    const party = timer ? 3600 / timer : 3600 / RESPAWN_SECONDS;
    mobs.push({ ...mob, spawnPoints: n, share: (n / total) * 100, timer, soloPerHour: n * solo, partyPerHour: n * party });
  }
  mobs.sort((a, b) => b.spawnPoints - a.spawnPoints || a.level - b.level);
  const sum = (f: (m: MobOnMap) => number) => mobs.reduce((s, m) => s + f(m), 0);
  return {
    map,
    mobs,
    solo: { mobs: sum((m) => m.soloPerHour), exp: sum((m) => m.soloPerHour * m.exp) },
    party: { mobs: sum((m) => m.partyPerHour), exp: sum((m) => m.partyPerHour * m.exp) },
    minLevel: mobs.length ? Math.min(...mobs.map((m) => m.level)) : 0,
    maxLevel: mobs.length ? Math.max(...mobs.map((m) => m.level)) : 0,
  };
}

/** Busca mapas por nombre o calle, sin importar mayúsculas ni tildes. */
export function searchMaps(world: World, q: string, limit = 12): MapInfo[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out: { m: MapInfo; score: number }[] = [];
  for (const m of world.maps.values()) {
    if (!m.spawns.length) continue;
    const hay = norm(`${m.street} ${m.name}`);
    if (!terms.every((t) => hay.includes(t))) continue;
    out.push({ m, score: norm(m.name).startsWith(terms[0]) ? 0 : 1 });
  }
  return out.sort((a, b) => a.score - b.score || a.m.name.localeCompare(b.m.name)).slice(0, limit).map((o) => o.m);
}

/**
 * Mapas recomendados para un nivel: mobs dentro de un rango razonable y ordenados por el techo
 * de EXP/hora en solitario. Es teórico (mata todo lo que aparece), pero sirve para comparar mapas.
 */
export function bestMapsFor(world: World, level: number, limit = 6): MapSummary[] {
  const out: MapSummary[] = [];
  for (const m of world.maps.values()) {
    if (m.isTown || !m.spawns.length) continue;
    const s = summarize(world, m.id);
    if (!s || !s.mobs.length || s.mobs.some((x) => x.timer)) continue;
    // Mobs mayormente entre 8 niveles abajo y 3 arriba del personaje.
    if (s.minLevel < level - 8 || s.maxLevel > level + 3) continue;
    out.push(s);
  }
  return out.sort((a, b) => b.solo.exp - a.solo.exp).slice(0, limit);
}

export const meowdbMapUrl = (id: number) => `https://meowdb.com/msclassic/maps/${String(id).padStart(9, "0")}`;
export const meowdbMobUrl = (id: number) => `https://meowdb.com/msclassic/monsters/${id}`;
