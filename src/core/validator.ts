import { levelsMatching, pctConsistent, requiredExp, MAX_LEVEL } from "./expTable";

/** Lo que el OCR extrajo de un frame (antes de validar). */
export interface RawReading {
  /** Nivel leído de los tiles naranjos; null si algún dígito quedó ambiguo. */
  level: number | null;
  /** Cantidad de EXP dentro del nivel; null si el HUD solo muestra % o no se leyó. */
  amount: number | null;
  /** Porcentaje mostrado (2 decimales); null si no se leyó. */
  pct: number | null;
  /** Identificador del frame de video (para exigir frames distintos al confirmar). */
  frameId: number;
  /** Timestamp de captura (ms). */
  t: number;
  source?: "glyph" | "neural" | "manual";
  /** Texto parcial de los dígitos de nivel ("3?"): el nivel deducido debe calzar con lo que sí se leyó. */
  levelHint?: string | null;
}

export interface AcceptedReading {
  level: number;
  exp: number;
  pct: number | null;
  estimated: boolean;
  levelSource: "digits" | "exp";
}

export type ValidationResult =
  | { ok: true; value: AcceptedReading; note?: string }
  | { ok: false; reason: string; retry: boolean; conflictLevel?: number };

interface Pending {
  level: number;
  frameId: number;
  t: number;
}

const INFER_WINDOW_MS = 25_000;
const INFER_MIN_PCT = 0.5;

/**
 * Valida lecturas OCR contra la curva de EXP y la continuidad de nivel.
 * Filosofía: rechazar ante la duda; nunca aceptar un valor dudoso.
 */
export class ReadingValidator {
  private pendingLevelUp: Pending | null = null;
  private pendingInferred: Pending | null = null;

  reset() {
    this.pendingLevelUp = null;
    this.pendingInferred = null;
  }

  /**
   * @param r lectura cruda
   * @param sessionLevel nivel actual de la sesión (null si aún no hay muestras)
   * @param lastExp última exp aceptada en sessionLevel (para el modo solo-%)
   */
  validate(r: RawReading, sessionLevel: number | null, lastExp: number | null): ValidationResult {
    let level = r.level;
    let levelSource: "digits" | "exp" = "digits";

    if (r.amount === null && r.pct === null) {
      return { ok: false, reason: "No se encontró una lectura de EXP legible", retry: true };
    }

    // --- 1. Coherencia cantidad ↔ porcentaje ---------------------------------
    if (r.amount !== null && r.pct !== null) {
      const candidates = levelsMatching(r.amount, r.pct);
      if (level !== null) {
        if (!pctConsistent(level, r.amount, r.pct)) {
          if (candidates.length === 1 && candidates[0] !== level) {
            return {
              ok: false,
              reason: `Los dígitos dicen nivel ${level}, pero la EXP corresponde a nivel ${candidates[0]}`,
              retry: true,
            };
          }
          return {
            ok: false,
            reason: `Cantidad y porcentaje no cuadran para nivel ${level}`,
            retry: true,
          };
        }
      } else {
        // Nivel ilegible: inferirlo desde la EXP si hay un único candidato.
        if (candidates.length !== 1) {
          return { ok: false, reason: "Nivel ilegible y la EXP no identifica un nivel único", retry: true };
        }
        if (r.pct < INFER_MIN_PCT) {
          return { ok: false, reason: "Nivel ilegible y muy poca EXP para inferirlo", retry: false };
        }
        const cand = candidates[0];
        if (r.levelHint && !hintMatches(r.levelHint, cand)) {
          return { ok: false, reason: `Los dígitos legibles (${r.levelHint}) no calzan con el nivel ${cand} deducido de la EXP`, retry: true };
        }
        // Si coincide con el nivel de la sesión, la continuidad ya confirma: no hace falta otro frame.
        if (cand === sessionLevel) {
          this.pendingInferred = null;
          level = cand;
          levelSource = "exp";
        } else {
          const p = this.pendingInferred;
          if (!p || p.level !== cand || p.frameId === r.frameId || r.t - p.t > INFER_WINDOW_MS) {
            this.pendingInferred = { level: cand, frameId: r.frameId, t: r.t };
            return { ok: false, reason: `Nivel ${cand} deducido de la EXP; confirmando con otro frame`, retry: true };
          }
          this.pendingInferred = null;
          level = cand;
          levelSource = "exp";
        }
      }
    }

    if (level === null) {
      return { ok: false, reason: "Nivel ilegible", retry: true };
    }
    if (level < 1 || level > MAX_LEVEL) {
      return { ok: false, reason: `Nivel fuera de rango (${level})`, retry: true };
    }

    // --- 2. Continuidad de nivel ---------------------------------------------
    if (sessionLevel !== null && level !== sessionLevel) {
      if (level === sessionLevel + 1) {
        const p = this.pendingLevelUp;
        if (!p || p.level !== level || p.frameId === r.frameId) {
          this.pendingLevelUp = { level, frameId: r.frameId, t: r.t };
          return { ok: false, reason: `Posible subida a nivel ${level}; confirmando con otro frame`, retry: true };
        }
      } else {
        this.pendingLevelUp = null;
        return {
          ok: false,
          reason: `Nivel ${level} distinto al de la sesión (${sessionLevel}). Si cambiaste de personaje, inicia una sesión nueva.`,
          retry: false,
          conflictLevel: level,
        };
      }
    }
    this.pendingLevelUp = null;

    // --- 3. Resolver la EXP --------------------------------------------------
    const req = requiredExp(level);
    if (r.amount !== null) {
      if (level < MAX_LEVEL && r.amount > req) {
        return { ok: false, reason: `EXP ${r.amount} supera el requisito del nivel ${level}`, retry: true };
      }
      return { ok: true, value: { level, exp: r.amount, pct: r.pct, estimated: false, levelSource } };
    }

    // Solo porcentaje: estimar a partir de la curva.
    const pct = r.pct as number;
    if (pct < 0 || pct >= 100 || !req) {
      return { ok: false, reason: "Porcentaje fuera de rango", retry: true };
    }
    // Si la EXP previa cae en el intervalo de redondeo del %, conservarla (evita ganancias ficticias).
    const lo = ((pct - 0.005) / 100) * req;
    const hi = ((pct + 0.005) / 100) * req;
    const exp =
      lastExp !== null && sessionLevel === level && lastExp >= lo && lastExp <= hi
        ? lastExp
        : Math.round((pct / 100) * req);
    return { ok: true, value: { level, exp, pct, estimated: true, levelSource } };
  }
}

/** "3?" calza con 35; "3?" no calza con 45 ni con 5. */
export function hintMatches(hint: string, level: number): boolean {
  const s = String(level);
  if (hint.length !== s.length) return true; // tiles mal contados: no comparable
  for (let i = 0; i < s.length; i++) if (hint[i] !== "?" && hint[i] !== s[i]) return false;
  return true;
}
