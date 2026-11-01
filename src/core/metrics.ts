import { requiredExp, totalExp } from "./expTable";

export interface Sample {
  t: number;
  level: number;
  exp: number;
  estimated?: boolean;
  pct?: number | null;
  /** Marca el inicio de un tramo (tras pausa o hueco largo): no se calcula tasa a través de él. */
  segmentStart?: boolean;
}

export const RATE_WINDOW_MS = 5 * 60_000;
/** Un hueco mayor a esto entre muestras corta el tramo (desconexión, pestaña dormida…). */
export const MAX_GAP_MS = 90_000;
const MIN_RATE_ELAPSED_MS = 20_000;

export interface Metrics {
  latest: Sample | null;
  gained: number;
  ratePerHour: number | null;
  /** Ritmo promedio de toda la sesión (tiempo activo) */
  sessionRatePerHour: number | null;
  activeMs: number;
  pctToNext: number | null;
  expToNext: number | null;
  msToLevel: number | null;
  estimated: boolean;
}

/** Divide las muestras en tramos continuos. */
export function segments(samples: Sample[]): Sample[][] {
  const out: Sample[][] = [];
  for (const s of samples) {
    const cur = out.at(-1);
    const prev = cur?.at(-1);
    if (!cur || s.segmentStart || (prev && s.t - prev.t > MAX_GAP_MS)) out.push([s]);
    else cur.push(s);
  }
  return out;
}

export function computeMetrics(samples: Sample[], now: number): Metrics {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const latest = sorted.at(-1) ?? null;
  const empty: Metrics = {
    latest,
    gained: 0,
    ratePerHour: null,
    sessionRatePerHour: null,
    activeMs: 0,
    pctToNext: null,
    expToNext: null,
    msToLevel: null,
    estimated: false,
  };
  if (!latest) return empty;

  const segs = segments(sorted);
  let gained = 0;
  let activeMs = 0;
  for (const seg of segs) {
    const a = seg[0];
    const b = seg.at(-1)!;
    gained += totalExp(b.level, b.exp) - totalExp(a.level, a.exp);
    activeMs += b.t - a.t;
  }
  // Ganancia entre tramos (ej. EXP obtenida mientras estaba en pausa) también cuenta como ganada.
  for (let i = 1; i < segs.length; i++) {
    const prev = segs[i - 1].at(-1)!;
    const next = segs[i][0];
    gained += totalExp(next.level, next.exp) - totalExp(prev.level, prev.exp);
  }

  // Tasa reciente: últimos 5 minutos del tramo actual.
  const current = segs.at(-1)!;
  const windowed = current.filter((s) => s.t >= now - RATE_WINDOW_MS);
  let ratePerHour: number | null = null;
  if (windowed.length >= 2) {
    const a = windowed[0];
    const b = windowed.at(-1)!;
    const dt = b.t - a.t;
    if (dt >= MIN_RATE_ELAPSED_MS) {
      ratePerHour = ((totalExp(b.level, b.exp) - totalExp(a.level, a.exp)) * 3_600_000) / dt;
    }
  }
  const sessionRatePerHour = activeMs >= MIN_RATE_ELAPSED_MS ? (gained * 3_600_000) / activeMs : null;

  const req = requiredExp(latest.level);
  const expToNext = req ? Math.max(0, req - latest.exp) : null;
  const pctToNext = req ? (latest.exp / req) * 100 : null;
  const msToLevel =
    expToNext !== null && ratePerHour && ratePerHour > 0 ? (expToNext / ratePerHour) * 3_600_000 : null;

  return {
    latest,
    gained,
    ratePerHour,
    sessionRatePerHour,
    activeMs,
    pctToNext,
    expToNext,
    msToLevel,
    estimated: sorted.some((s) => s.estimated),
  };
}
