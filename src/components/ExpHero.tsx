import type { Metrics } from "../core/metrics";
import { requiredExp } from "../core/expTable";
import { fmtEta, fmtInt } from "../hooks";

/** El elemento central: tile de nivel + barra de EXP grande, en el idioma visual del HUD. */
export function ExpHero({ m, compact = false }: { m: Metrics; compact?: boolean }) {
  const s = m.latest;
  const pct = m.pctToNext ?? 0;
  const est = s?.estimated ? "~" : "";
  const eta = fmtEta(m.msToLevel);
  return (
    <section aria-label="Progreso de nivel" className={compact ? "" : "py-2"}>
      <div className="flex items-stretch gap-3 sm:gap-5">
        <div
          className={`lv-tile flex shrink-0 flex-col items-center justify-center font-extrabold ${
            compact ? "h-20 w-20" : "h-24 w-24 sm:h-32 sm:w-32"
          }`}
        >
          <span className="text-xs font-bold opacity-90 sm:text-sm">Nivel</span>
          <span className={compact ? "text-4xl leading-none" : "text-5xl leading-none sm:text-6xl"}>{s?.level ?? "–"}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className={`font-extrabold leading-none ${compact ? "text-3xl" : "text-4xl sm:text-6xl"}`}>
              {s ? `${est}${pct.toFixed(2)}%` : "Sin datos"}
            </p>
            {s && (
              <p className="text-sm text-ink-soft sm:text-base">
                {est}
                {fmtInt(s.exp)} / {fmtInt(requiredExp(s.level))}
              </p>
            )}
          </div>
          <div className={`exp-rail p-1 ${compact ? "h-6" : "h-8 sm:h-10"}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <div className="exp-fill h-full" style={{ width: `${Math.min(100, Math.max(pct > 0 ? 1.5 : 0, pct))}%` }} />
          </div>
          <p className="text-sm text-ink-soft sm:text-base">
            {!s
              ? "Comparte la ventana del juego para empezar."
              : m.expToNext !== null
                ? eta
                  ? <>Faltan <b className="text-ink">{fmtInt(m.expToNext)}</b> EXP · subes en <b className="text-ink">{eta}</b> a este ritmo</>
                  : <>Faltan <b className="text-ink">{fmtInt(m.expToNext)}</b> EXP · el tiempo estimado aparece tras unas lecturas</>
                : "Nivel máximo"}
          </p>
        </div>
      </div>
    </section>
  );
}
