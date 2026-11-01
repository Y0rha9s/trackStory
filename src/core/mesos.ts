/** Validación y métricas de mesos. */

export interface MesoSample {
  t: number;
  amount: number;
  segmentStart?: boolean;
}

export const BIG_JUMP_ABS = 100_000;
export const BIG_JUMP_REL = 0.2;

/**
 * Los mesos cambian todo el tiempo (drops, compras), así que no se exige continuidad estricta.
 * Solo un salto grande (> 100k y > 20% del total) necesita verse en un segundo frame distinto,
 * para que un dígito mal leído no invente una fortuna.
 */
export class MesoValidator {
  private pending: { amount: number; frameId: number } | null = null;

  reset() {
    this.pending = null;
  }

  validate(amount: number, frameId: number, last: number | null): { ok: boolean; reason?: string; retry?: boolean } {
    // El punto de partida define toda la sesión: se exige verlo igual en dos frames distintos
    // (evita que un número cortado mientras se abre el inventario quede como "mesos iniciales").
    if (last === null) {
      const p = this.pending;
      if (p && p.frameId !== frameId && Math.abs(p.amount - amount) <= Math.max(1_000, amount * 0.01)) {
        this.pending = null;
        return { ok: true };
      }
      this.pending = { amount, frameId };
      return { ok: false, reason: "Confirmando los mesos iniciales", retry: true };
    }
    const delta = Math.abs(amount - last);
    if (delta <= BIG_JUMP_ABS || delta <= last * BIG_JUMP_REL) {
      this.pending = null;
      return { ok: true };
    }
    const p = this.pending;
    // Confirmar con otro frame: mismo valor (± un drop chico).
    if (p && p.frameId !== frameId && Math.abs(p.amount - amount) <= 5_000) {
      this.pending = null;
      return { ok: true };
    }
    this.pending = { amount, frameId };
    return { ok: false, reason: `Cambio grande de mesos (${last.toLocaleString("es-CL")} → ${amount.toLocaleString("es-CL")}); confirmando`, retry: true };
  }
}

export interface MesoMetrics {
  current: number | null;
  /** total al iniciar la sesión (primera lectura confirmada) */
  start: number | null;
  startAt: number | null;
  net: number;
  perHour: number | null;
  /** máximo alcanzado en la sesión */
  peak: number | null;
}

const WINDOW_MS = 5 * 60_000;
const MAX_GAP_MS = 90_000;
const MIN_ELAPSED_MS = 20_000;

export function computeMesoMetrics(samples: MesoSample[], now: number): MesoMetrics {
  if (!samples.length) return { current: null, start: null, startAt: null, net: 0, perHour: null, peak: null };
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const last = sorted.at(-1)!;
  // Tramo actual (cortado por pausas o huecos largos).
  let start = sorted.length - 1;
  while (start > 0 && !sorted[start].segmentStart && sorted[start].t - sorted[start - 1].t <= MAX_GAP_MS) start--;
  const win = sorted.slice(start).filter((s) => s.t >= now - WINDOW_MS);
  let perHour: number | null = null;
  if (win.length >= 2 && win.at(-1)!.t - win[0].t >= MIN_ELAPSED_MS) {
    perHour = ((win.at(-1)!.amount - win[0].amount) * 3_600_000) / (win.at(-1)!.t - win[0].t);
  }
  return {
    current: last.amount,
    start: sorted[0].amount,
    startAt: sorted[0].t,
    net: last.amount - sorted[0].amount,
    perHour,
    peak: Math.max(...sorted.map((s) => s.amount)),
  };
}
