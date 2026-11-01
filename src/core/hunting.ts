import type { MapSummary } from "../data/world";

/**
 * Estimaciones de caza a partir de tu EXP/hora real y los mobs del mapa.
 *
 * No se ve qué mob muere: se asume que matas los mobs del mapa en la misma proporción en que
 * aparecen (sus puntos de spawn). En mapas de un solo mob la estimación es exacta; en party la
 * EXP se reparte, así que "mobs/hora" pasa a ser "mobs equivalentes" de tu parte.
 */
export interface HuntEstimate {
  /** EXP promedio por mob, ponderada por puntos de spawn (sin contar spawns con timer) */
  avgExp: number;
  killsPerHour: number | null;
  /** tu EXP/hora ÷ techo teórico en solitario del mapa */
  efficiency: number | null;
  mobsToLevel: number | null;
  /** el mob que más aparece y cuántos te faltan de solo ese */
  main: { name: string; exp: number; toLevel: number | null } | null;
}

export function estimateHunt(s: MapSummary, ratePerHour: number | null, expToNext: number | null): HuntEstimate | null {
  const regular = s.mobs.filter((m) => !m.timer && m.exp > 0);
  const pts = regular.reduce((a, m) => a + m.spawnPoints, 0);
  if (!pts) return null;
  const avgExp = regular.reduce((a, m) => a + m.exp * m.spawnPoints, 0) / pts;
  const main = regular[0];
  return {
    avgExp,
    killsPerHour: ratePerHour !== null && ratePerHour > 0 ? ratePerHour / avgExp : null,
    efficiency: ratePerHour !== null && s.solo.exp > 0 ? ratePerHour / s.solo.exp : null,
    mobsToLevel: expToNext !== null ? Math.ceil(expToNext / avgExp) : null,
    main: main ? { name: main.name, exp: main.exp, toLevel: expToNext !== null ? Math.ceil(expToNext / main.exp) : null } : null,
  };
}
