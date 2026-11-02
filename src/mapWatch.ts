import { useSyncExternalStore } from "react";
import type { Img } from "./ocr/image";
import { matchPrint, readMinimap, type Print } from "./ocr/minimap";

/**
 * Mapa en el que estás, detectado cada minuto leyendo el título del minimapa de la pantalla compartida.
 * Las huellas de los títulos se aprenden una vez por mapa: cuando aparece uno desconocido, el usuario lo elige
 * en el buscador y queda guardado (solo en su navegador).
 */

const MAP_KEY = "maple-track:map:v1";
const AUTO_KEY = "maple-track:map-auto:v1";
const PRINTS_KEY = "maple-track:map-prints:v1";
export const CHECK_MS = 60_000;

export type WatchStatus =
  | "off" // detección apagada
  | "waiting" // encendida, aún sin lectura
  | "noscreen" // no se comparte la pantalla
  | "none" // no se ve el minimapa
  | "closed" // minimapa sin título (minimizado)
  | "ok" // mapa reconocido
  | "unknown"; // título nuevo: hay que elegir el mapa

export interface WatchState {
  auto: boolean;
  mapId: number | null;
  /** último mapa reconocido en el juego (para no pisar lo que el usuario mira a mano) */
  detected: number | null;
  status: WatchStatus;
  /** huella del título desconocido, a la espera de que el usuario diga qué mapa es */
  pending: string | null;
  lastCheck: number | null;
}

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignorar */
  }
};

const loadPrints = (): Print[] => {
  try {
    const v = JSON.parse(read(PRINTS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p): p is Print => typeof p?.fp === "string" && Number.isFinite(p?.mapId)) : [];
  } catch {
    return [];
  }
};

let prints: Print[] = loadPrints();
let state: WatchState = {
  auto: read(AUTO_KEY) === "1",
  mapId: Number(read(MAP_KEY)) || null,
  detected: null,
  status: read(AUTO_KEY) === "1" ? "waiting" : "off",
  pending: null,
  lastCheck: null,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<WatchState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const mapWatch = {
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  setAuto(on: boolean) {
    write(AUTO_KEY, on ? "1" : "0");
    set({ auto: on, status: on ? "waiting" : "off", pending: null });
  },

  /** Mapa elegido a mano. Si había un título desconocido a la espera, queda aprendido para ese mapa. */
  choose(id: number) {
    write(MAP_KEY, String(id));
    if (state.pending) {
      prints = [...prints.filter((p) => p.fp !== state.pending), { fp: state.pending, mapId: id }];
      write(PRINTS_KEY, JSON.stringify(prints));
      set({ mapId: id, detected: id, pending: null, status: "ok" });
    } else set({ mapId: id });
  },

  /** Cuántos títulos de mapa tiene aprendidos. */
  learnedCount: () => prints.length,

  /** Mira un frame (null = no hay pantalla compartida) y actualiza el mapa. */
  check(img: Img | null) {
    const lastCheck = Date.now();
    if (!img) return set({ status: "noscreen", lastCheck });
    const r = readMinimap(img);
    if (r.kind !== "title") return set({ status: r.kind, lastCheck });
    const hit = matchPrint(r.fp, prints);
    if (!hit) return set({ status: "unknown", pending: r.fp, lastCheck });
    if (hit.mapId !== state.detected) {
      write(MAP_KEY, String(hit.mapId));
      return set({ mapId: hit.mapId, detected: hit.mapId, status: "ok", pending: null, lastCheck });
    }
    set({ status: "ok", pending: null, lastCheck });
  },

  /** Revisa ya y luego cada minuto, hasta que se llame a lo devuelto. */
  run(snapshot: () => Img | null): () => void {
    const tick = () => mapWatch.check(snapshot());
    tick();
    const id = window.setInterval(tick, CHECK_MS);
    return () => window.clearInterval(id);
  },

  /** Solo para pruebas. */
  reset() {
    prints = [];
    state = { auto: false, mapId: null, detected: null, status: "off", pending: null, lastCheck: null };
  },
};

export const useMapWatch = () => useSyncExternalStore(mapWatch.subscribe, mapWatch.get);
