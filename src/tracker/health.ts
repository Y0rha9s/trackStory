import type { Img } from "../ocr/image";

/** Resumen barato de un frame: ¿llegó negro/vacío? y una huella para detectar que el video se congeló. */
export interface FrameHealth {
  blank: boolean;
  hash: number;
}

const GRID = 48;

export function frameHealth(img: Img): FrameHealth {
  let bright = 0;
  let hash = 2166136261;
  for (let gy = 0; gy < GRID; gy++) {
    const y = Math.min(img.height - 1, Math.floor(((gy + 0.5) * img.height) / GRID));
    for (let gx = 0; gx < GRID; gx++) {
      const x = Math.min(img.width - 1, Math.floor(((gx + 0.5) * img.width) / GRID));
      const i = (y * img.width + x) * 4;
      const r = img.data[i];
      const g = img.data[i + 1];
      const b = img.data[i + 2];
      if (Math.max(r, g, b) > 24) bright++;
      hash = Math.imul(hash ^ ((r >> 2) | ((g >> 2) << 6) | ((b >> 2) << 12)), 16777619) >>> 0;
    }
  }
  // un frame con menos de ~1% de puntos con algo de luz es una captura negra (ventana que Windows/Chrome no entrega)
  return { blank: bright < GRID * GRID * 0.01, hash };
}

export type SurfaceKind = "window" | "monitor" | "browser" | "unknown";

export const surfaceLabel = (s: SurfaceKind | string | undefined) =>
  s === "window" ? "ventana" : s === "monitor" ? "pantalla completa" : s === "browser" ? "pestaña" : "pantalla";

export const BLANK_HELP =
  "El video compartido llega negro. Pasa con algunas ventanas de juego que Chrome no puede capturar. " +
  "Comparte «Toda la pantalla» (el juego se lee igual dentro de ella) o prueba el juego en modo ventana sin pantalla completa exclusiva.";

export const STALE_HELP =
  "La ventana compartida no envía imagen nueva (¿está minimizada?). Déjala visible o comparte «Toda la pantalla».";
