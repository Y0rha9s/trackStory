/**
 * Curva de EXP de MapleStory Classic (pre-Big Bang).
 * Niveles 1–5 y 6–50 usan fórmulas cerradas; 51–89 crecen ×1.0548 por nivel
 * y 90–99 ×2.1. Nivel 100 es el tope.
 */
export const MAX_LEVEL = 100;

const cache = new Map<number, number>();

export function requiredExp(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level >= MAX_LEVEL) return 0;
  const hit = cache.get(level);
  if (hit !== undefined) return hit;
  let v: number;
  if (level <= 5) v = (Math.floor((level * level) / 2) + 15) * level;
  else if (level <= 50) {
    const q = Math.floor((level * level) / 3);
    v = (q + 19) * q;
  } else if (level <= 89) v = Math.floor((requiredExp(level - 1) * 10548) / 10000);
  else v = Math.floor((requiredExp(level - 1) * 21) / 10);
  cache.set(level, v);
  return v;
}

/** EXP total acumulada al comenzar `level`. */
export function levelStartExp(level: number): number {
  let total = 0;
  for (let n = 1; n < level; n++) total += requiredExp(n);
  return total;
}

/** EXP total (acumulada desde nivel 1) para una lectura nivel + exp dentro del nivel. */
export function totalExp(level: number, exp: number): number {
  return levelStartExp(level) + exp;
}

/** Porcentaje que el HUD mostraría para `exp` en `level`. */
export function percentFor(level: number, exp: number): number {
  const req = requiredExp(level);
  return req ? (exp / req) * 100 : 0;
}

/** ¿El % mostrado es consistente con la cantidad para ese nivel? (HUD redondea a 2 decimales) */
export function pctConsistent(level: number, exp: number, pct: number, tolerance = 0.03): boolean {
  const req = requiredExp(level);
  if (!req || exp < 0 || exp > req) return false;
  return Math.abs(percentFor(level, exp) - pct) <= tolerance;
}

/** Niveles cuyo requisito hace consistente el par cantidad/porcentaje. */
export function levelsMatching(exp: number, pct: number, tolerance = 0.03): number[] {
  const out: number[] = [];
  for (let l = 1; l < MAX_LEVEL; l++) if (pctConsistent(l, exp, pct, tolerance)) out.push(l);
  return out;
}
