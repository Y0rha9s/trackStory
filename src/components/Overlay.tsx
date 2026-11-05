import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { computeMetrics } from "../core/metrics";
import { computeMesoMetrics } from "../core/mesos";
import { requiredExp } from "../core/expTable";
import { loadWorld } from "../data/loader";
import { useCharacters } from "../characters";
import { fmtCompact, fmtDuration, fmtEta, fmtInt, useSession } from "../hooks";
import { useMapWatch } from "../mapWatch";

/** Overlay compacto y siempre visible: nivel, EXP/hora, tiempo y mesos de la sesión. */

/** Nombre del mapa detectado (solo si ya se descargaron los datos de OSMS; no los pide por su cuenta). */
function useMapName(mapId: number | null) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let loaded = false;
    try {
      loaded = !!localStorage.getItem("maple-track:osms-auto");
    } catch {
      /* sin almacenamiento */
    }
    if (!mapId || !loaded) {
      setName(null);
      return;
    }
    loadWorld()
      .then((r) => alive && setName(r.world.maps.get(mapId)?.name ?? null))
      .catch(() => alive && setName(null));
    return () => {
      alive = false;
    };
  }, [mapId]);
  return name;
}

/** Reloj propio de la ventana flotante: los timers de la pestaña principal se frenan cuando queda oculta. */
function useNowIn(win: Window, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = win.setInterval(() => setNow(Date.now()), ms);
    return () => win.clearInterval(id);
  }, [win, ms]);
  return now;
}

function OverlayCard({ win }: { win: Window }) {
  const s = useSession();
  const now = useNowIn(win);
  const { active } = useCharacters();
  const watch = useMapWatch();
  const mapName = useMapName(watch.mapId);
  const m = computeMetrics(s.samples, now);
  const mm = computeMesoMetrics(s.mesoSamples, now);
  const lv = m.latest;
  const pct = m.pctToNext ?? 0;
  const live = s.capture === "sharing" && !s.paused;
  const eta = fmtEta(m.msToLevel);
  return (
    <main className="min-h-screen bg-[#161a23] p-3 text-[#e9edf5]">
      <div className="flex items-center justify-between gap-2 text-xs font-bold text-[#9aa6bd]">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${live ? "bg-[#6fd16a]" : "bg-[#c2412d]"}`} />
          <span className="truncate text-[#e9edf5]">{mapName ?? (watch.mapId ? `Mapa ${watch.mapId}` : "Mapa sin detectar")}</span>
        </span>
        <span>{s.paused ? "En pausa" : live ? "En vivo" : "Sin compartir"}</span>
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[#8fe08a]">+{fmtInt(m.gained)} EXP</p>
          <p className="text-4xl font-extrabold leading-none tabular-nums">{fmtDuration(m.activeMs)}</p>
        </div>
        <div className="rounded-xl border border-[#3a8f6a] bg-[#0f2a22] px-3 py-1.5 text-right">
          <p className="text-2xl font-extrabold leading-none text-[#6fe0a8] tabular-nums">{m.ratePerHour !== null ? fmtCompact(m.ratePerHour) : "–"}</p>
          <p className="text-[11px] font-bold text-[#6fe0a8]/80">EXP/h</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="font-bold">
          <span className="rounded bg-[#f08a1c] px-1.5 py-0.5 text-xs font-extrabold text-white">Lv. {lv?.level ?? "–"}</span> <span className="text-[#c9d2e3]">{active.name}</span>
        </span>
        <span className="font-bold tabular-nums text-[#c9d2e3]">{lv ? `${lv.estimated ? "~" : ""}${pct.toFixed(2)}%` : ""}</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[#2a3142]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className="h-full rounded-full bg-[#b5d334]" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-[#9aa6bd]">
        {lv && m.expToNext !== null ? `Faltan ${fmtInt(m.expToNext)} de ${fmtInt(requiredExp(lv.level))}${eta ? ` · subes en ${eta}` : ""}` : "Comparte la ventana del juego para empezar."}
      </p>

      <div className="mt-3 flex items-center justify-between rounded-xl bg-[#1f2533] px-3 py-2 text-sm">
        <span className="font-bold text-[#9aa6bd]">Mesos</span>
        {mm.current === null ? (
          <span className="text-xs text-[#9aa6bd]">Abre el inventario para medirlos</span>
        ) : (
          <span className="flex items-baseline gap-3 font-extrabold tabular-nums">
            <span className="text-[#f2c94c]">{mm.net >= 0 ? "+" : ""}{fmtInt(mm.net)}</span>
            {mm.perHour !== null && <span className="text-xs text-[#9aa6bd]">{fmtCompact(mm.perHour)}/h</span>}
          </span>
        )}
      </div>
    </main>
  );
}

/** Copia los estilos de la página a la ventana flotante para que las clases se vean igual. */
function copyStyles(from: Document, to: Document) {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
      const el = to.createElement("style");
      el.textContent = css;
      to.head.appendChild(el);
    } catch {
      if (sheet.href) {
        const link = to.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        to.head.appendChild(link);
      }
    }
  }
}

interface PipApi {
  requestWindow(o?: { width?: number; height?: number }): Promise<Window>;
}

export const overlaySupported = () => typeof window !== "undefined" && "documentPictureInPicture" in window;

let current: Window | null = null;

/** Abre el overlay como ventana flotante «siempre encima» (Document Picture-in-Picture de Chrome/Edge). */
export async function openOverlay(): Promise<string | null> {
  if (!overlaySupported()) return "Este navegador no permite ventanas flotantes. Usa Chrome o Edge 116+, o la tarjeta para OBS.";
  if (current && !current.closed) {
    current.focus();
    return null;
  }
  try {
    const api = (window as unknown as { documentPictureInPicture: PipApi }).documentPictureInPicture;
    const win = await api.requestWindow({ width: 340, height: 330 });
    current = win;
    copyStyles(document, win.document);
    win.document.title = "Maple Track";
    const root = createRoot(win.document.body);
    root.render(<OverlayCard win={win} />);
    win.addEventListener("pagehide", () => {
      root.unmount();
      current = null;
    });
    return null;
  } catch (e) {
    return `No se pudo abrir el overlay: ${String(e)}`;
  }
}

