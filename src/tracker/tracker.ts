import baseTemplates from "../ocr/templates.json";
import type { TemplateSet } from "../ocr/glyphs";
import type { Img } from "../ocr/image";
import type { Regions } from "../ocr/reader";
import { readWithFallback, type PipelineRead } from "../ocr/pipeline";
import { emptySamples, learnFromFrame, mergeTemplates, samplesToTemplates } from "../ocr/train";
import { ReadingValidator } from "../core/validator";
import { recognizeInBrowser } from "./neuralWorker";
import { store } from "./store";

export const INTERVAL_MS = 10_000;
const RETRY_DELAY_MS = 250;
const USER_TEMPLATES_KEY = "maple-track:templates:v1";

export interface DebugFrame {
  canvas: HTMLCanvasElement;
  read: PipelineRead | null;
  at: number;
  verdict: string;
}

type DebugListener = (f: DebugFrame) => void;

function loadUserTemplates(): TemplateSet | null {
  try {
    const raw = localStorage.getItem(USER_TEMPLATES_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Motor de captura: comparte la ventana del juego, toma un frame cada 10 s, lo lee localmente
 * y guarda solo lecturas validadas. Nada se sube a ningún servidor.
 */
class Tracker {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas = document.createElement("canvas");
  private timer: number | null = null;
  private regions: Regions | undefined;
  private validator = new ReadingValidator();
  private frameCounter = 0;
  private lastVideoTime = -1;
  private busy = false;
  private resumeFlag = false;
  private debugListeners = new Set<DebugListener>();
  private userTemplates = loadUserTemplates();
  templates: TemplateSet = mergeTemplates(baseTemplates as TemplateSet, this.userTemplates);
  lastDebug: DebugFrame | null = null;

  get supported() {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
  }

  onDebug(l: DebugListener) {
    this.debugListeners.add(l);
    return () => this.debugListeners.delete(l);
  }

  async start() {
    if (!this.supported) {
      store.set({ capture: "error", captureError: "Este navegador no permite compartir pantalla. Usa Chrome o Edge de escritorio." }, false);
      return;
    }
    store.set({ capture: "requesting", captureError: null }, false);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 10 } },
        audio: false,
      });
      this.stream = stream;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      this.video = video;
      stream.getVideoTracks()[0].addEventListener("ended", () => this.stop());
      this.regions = undefined;
      this.resumeFlag = true;
      store.set({ capture: "sharing", paused: false }, false);
      // Primera lectura apenas llegue un frame.
      window.setTimeout(() => this.tick(), 600);
      this.schedule();
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "NotAllowedError" ? "Compartir pantalla fue cancelado." : `No se pudo compartir: ${String(e)}`;
      store.set({ capture: "error", captureError: msg }, false);
    }
  }

  stop() {
    this.clearTimer();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    store.set({ capture: "idle", nextReadAt: null }, false);
  }

  pause() {
    this.clearTimer();
    store.set({ paused: true, nextReadAt: null }, false);
  }

  resume() {
    this.resumeFlag = true;
    store.set({ paused: false }, false);
    if (this.stream) {
      this.schedule();
      void this.tick();
    }
  }

  newSession() {
    this.validator.reset();
    this.resumeFlag = true;
    store.newSession();
  }

  setAutoRead(on: boolean) {
    store.set({ autoRead: on }, false);
    if (on) this.schedule();
    else this.clearTimer();
  }

  private clearTimer() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule() {
    this.clearTimer();
    if (!this.stream || store.get().paused || !store.get().autoRead) return;
    store.set({ nextReadAt: Date.now() + INTERVAL_MS }, false);
    this.timer = window.setInterval(() => {
      store.set({ nextReadAt: Date.now() + INTERVAL_MS }, false);
      void this.tick();
    }, INTERVAL_MS);
  }

  /** Captura el frame actual del video. Devuelve null si no hay video. */
  private grab(): { img: Img; frameId: number } | null {
    const v = this.video;
    if (!v || !v.videoWidth) return null;
    if (v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      this.frameCounter++;
    }
    this.canvas.width = v.videoWidth;
    this.canvas.height = v.videoHeight;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0);
    const data = ctx.getImageData(0, 0, v.videoWidth, v.videoHeight);
    return { img: data, frameId: this.frameCounter };
  }

  /** Una lectura (con como máximo un reintento si fue ambigua y el video avanzó). */
  async tick(manual = false) {
    if (this.busy || (!manual && store.get().paused)) return;
    this.busy = true;
    try {
      let shot = this.grab();
      if (!shot) return;
      let outcome = await this.process(shot.img, shot.frameId);
      if (outcome === "retry") {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        const again = this.grab();
        if (again && again.frameId !== shot.frameId) {
          shot = again;
          outcome = await this.process(shot.img, shot.frameId);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async process(img: Img, frameId: number): Promise<"ok" | "retry" | "rejected"> {
    const t = Date.now();
    const st = store.get();
    let read: PipelineRead | null = null;
    try {
      read = await readWithFallback(img, this.templates, this.regions, recognizeInBrowser);
    } catch (e) {
      console.warn("[maple-track] fallo de lectura", e);
    }
    store.set({ lastReadAt: t }, false);

    const lastSample = st.samples.at(-1);
    let verdict: string;
    let result: "ok" | "retry" | "rejected";
    if (!read || (read.pct === null && read.amount === null)) {
      verdict = read?.debug.expReason ?? "Sin lectura";
      result = "retry";
      this.regions = undefined;
      store.log({ t, ok: false, text: read?.expText ?? "—", reason: verdict, source: read?.source ?? undefined });
    } else {
      const v = this.validator.validate(
        { level: read.level, amount: read.amount, pct: read.pct, frameId, t, source: read.source ?? undefined },
        st.level,
        lastSample && lastSample.level === st.level ? lastSample.exp : null,
      );
      if (v.ok) {
        this.regions = read.regions;
        const seg = this.resumeFlag;
        this.resumeFlag = false;
        store.addSample({
          t,
          level: v.value.level,
          exp: v.value.exp,
          ...(v.value.estimated ? { estimated: true, pct: v.value.pct } : {}),
          ...(seg ? { segmentStart: true } : {}),
        });
        verdict = v.note ?? (v.value.levelSource === "exp" ? "Aceptada · nivel deducido de la EXP" : "Aceptada");
        store.log({
          t,
          ok: true,
          text: `Nv ${v.value.level} · ${v.value.estimated ? "~" : ""}${v.value.exp.toLocaleString("es-CL")} (${v.value.pct?.toFixed(2) ?? "?"}%)`,
          source: read.source ?? undefined,
          estimated: v.value.estimated,
        });
        result = "ok";
      } else {
        verdict = v.reason;
        if (v.conflictLevel) store.set({ conflictLevel: v.conflictLevel }, false);
        store.log({ t, ok: false, text: `Nv ${read.levelText ?? "?"} · ${read.expText ?? "—"}`, reason: v.reason, source: read.source ?? undefined });
        result = v.retry ? "retry" : "rejected";
      }
    }
    const debug: DebugFrame = { canvas: this.canvas, read, at: t, verdict };
    this.lastDebug = debug;
    this.debugListeners.forEach((l) => l(debug));
    return result;
  }

  /** Entrada manual (corrige o reemplaza la lectura automática). */
  addManual(level: number, exp: number) {
    const t = Date.now();
    const seg = this.resumeFlag;
    this.resumeFlag = false;
    store.addSample({ t, level, exp, ...(seg ? { segmentStart: true } : {}) });
    store.log({ t, ok: true, text: `Nv ${level} · ${exp.toLocaleString("es-CL")} (manual)`, source: "manual" });
  }

  /** Aprende glifos del frame actual con la lectura correcta que indica el usuario. */
  trainFromCurrentFrame(level: string, exp: string) {
    const shot = this.grab();
    if (!shot) return { level: 0, exp: 0 };
    const samples = emptySamples();
    const res = learnFromFrame(shot.img, level || null, exp || null, samples);
    if (res.level + res.exp === 0) return res;
    const learned = samplesToTemplates(samples);
    const prev = this.userTemplates ?? { exp: [], level: [] };
    // Las plantillas nuevas van primero; se acota el total para no crecer sin límite.
    this.userTemplates = { exp: [...learned.exp, ...prev.exp].slice(0, 200), level: [...learned.level, ...prev.level].slice(0, 100) };
    try {
      localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify(this.userTemplates));
    } catch {
      /* ignorar */
    }
    this.templates = mergeTemplates(baseTemplates as TemplateSet, this.userTemplates);
    this.regions = undefined;
    return res;
  }

  clearUserTemplates() {
    this.userTemplates = null;
    try {
      localStorage.removeItem(USER_TEMPLATES_KEY);
    } catch {
      /* ignorar */
    }
    this.templates = baseTemplates as TemplateSet;
  }

  get userTemplateCount() {
    return (this.userTemplates?.exp.length ?? 0) + (this.userTemplates?.level.length ?? 0);
  }

  /** Frame actual como PNG (para descargar y reportar fallos). */
  snapshotUrl() {
    return this.grab() ? this.canvas.toDataURL("image/png") : null;
  }
}

export const tracker = new Tracker();
