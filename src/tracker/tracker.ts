import baseTemplates from "../ocr/templates.json";
import type { TemplateSet } from "../ocr/glyphs";
import type { Img } from "../ocr/image";
import type { Regions } from "../ocr/reader";
import { readMesosWithFallback, readWithFallback, type MesoPipelineRead, type PipelineRead } from "../ocr/pipeline";
import type { MesoRegion } from "../ocr/meso";
import { MesoValidator } from "../core/mesos";
import { emptySamples, learnFromFrame, mergeTemplates, samplesToTemplates } from "../ocr/train";
import { ReadingValidator } from "../core/validator";
import { recognizeInBrowser } from "./neuralWorker";
import { store, type LogEntry } from "./store";
import { BLANK_HELP, STALE_HELP, frameHealth, surfaceLabel } from "./health";

export const INTERVAL_MS = 10_000;
const RETRY_DELAY_MS = 250;
/** si pasa más que esto sin frames nuevos del track, la ventana no está enviando imagen */
const STALE_MS = 25_000;
/** lecturas seguidas con el video idéntico antes de avisar de que se congeló */
const FROZEN_TICKS = 6;
const HEALTH_NOTES = [BLANK_HELP, STALE_HELP];
const USER_TEMPLATES_KEY = "maple-track:templates:v1";

export interface DebugFrame {
  canvas: HTMLCanvasElement;
  read: PipelineRead | null;
  meso: MesoPipelineRead | null;
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
  private mesoValidator = new MesoValidator();
  private mesoRegion: MesoRegion | null = null;
  private mesoResume = true;
  /** último frame entregado por el track (no depende de que la pestaña esté visible) */
  private feed = document.createElement("canvas");
  private feedCount = 0;
  private feedAt = 0;
  private feedUsed = -1;
  private lastHash = -1;
  private sameHash = 0;
  private frameCounter = 0;
  private lastVideoTime = -1;
  private busy = false;
  private resumeFlag = false;
  private debugListeners = new Set<DebugListener>();
  private pendingLog: LogEntry | null = null;
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
      // Sin forzar el tipo de superficie: sirve «Ventana» y «Toda la pantalla» (el juego se busca dentro del frame).
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 10 } },
        audio: false,
      });
      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      // En el DOM (casi invisible) para que Chrome no deje de pintar el video cuando la pestaña queda detrás del juego.
      video.setAttribute("aria-hidden", "true");
      Object.assign(video.style, { position: "fixed", right: "0", bottom: "0", width: "160px", height: "90px", opacity: "0.01", pointerEvents: "none", zIndex: "-1" });
      document.body.appendChild(video);
      await video.play();
      this.video = video;
      this.feedCount = 0;
      this.feedAt = 0;
      this.feedUsed = -1;
      this.lastHash = -1;
      this.sameHash = 0;
      void this.pump(track);
      track.addEventListener("ended", () => this.stop());
      await this.firstFrame(video);
      const surface = (track.getSettings() as { displaySurface?: string }).displaySurface;
      store.set({ captureInfo: `${surfaceLabel(surface)} ${video.videoWidth}×${video.videoHeight}` }, false);
      this.regions = undefined;
      this.mesoRegion = null;
      this.resumeFlag = true;
      this.mesoResume = true;
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
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
    }
    this.video = null;
    this.feedCount = 0;
    const note = HEALTH_NOTES.includes(store.get().captureError ?? "");
    store.set({ capture: "idle", nextReadAt: null, captureInfo: null, ...(note ? { captureError: null } : {}) }, false);
  }

  pause() {
    this.clearTimer();
    store.set({ paused: true, nextReadAt: null }, false);
  }

  resume() {
    this.resumeFlag = true;
    this.mesoResume = true;
    store.set({ paused: false }, false);
    if (this.stream) {
      this.schedule();
      void this.tick();
    }
  }

  newSession() {
    this.validator.reset();
    this.mesoValidator.reset();
    this.resumeFlag = true;
    this.mesoResume = true;
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

  /** Un frame de la pantalla compartida, para lectores que se disparan a mano (p. ej. la ventana de skills). */
  snapshot(): Img | null {
    return this.grab()?.img ?? null;
  }

  /** Espera a que llegue el primer frame real (en una ventana puede tardar hasta que el contenido cambie). */
  private async firstFrame(video: HTMLVideoElement) {
    const t0 = Date.now();
    while (Date.now() - t0 < 4000 && (!video.videoWidth || (this.feedCount === 0 && video.readyState < 2))) await new Promise((r) => setTimeout(r, 100));
  }

  /**
   * Lee los frames directamente del track (Chrome/Edge): llegan aunque la pestaña esté en segundo plano,
   * que es justo lo que pasa mientras juegas. Si el navegador no lo ofrece se usa el elemento <video>.
   */
  private async pump(track: MediaStreamTrack) {
    const Processor = (window as unknown as { MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> } }).MediaStreamTrackProcessor;
    if (!Processor) return;
    const reader = new Processor({ track }).readable.getReader();
    const ctx = this.feed.getContext("2d", { willReadFrequently: true })!;
    let drawnAt = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const now = Date.now();
        // se dibuja como mucho 2 veces por segundo; los demás frames se descartan para no cargar la CPU
        if (now - drawnAt >= 500 && track.readyState === "live") {
          drawnAt = now;
          if (this.feed.width !== value.displayWidth || this.feed.height !== value.displayHeight) {
            this.feed.width = value.displayWidth;
            this.feed.height = value.displayHeight;
          }
          ctx.drawImage(value, 0, 0);
          this.feedCount++;
          this.feedAt = now;
        }
        value.close();
      }
    } catch {
      /* el track terminó o el navegador no lo soporta: queda el <video> */
    }
  }

  /** Captura el frame actual (del track si hay, si no del video). Devuelve null si aún no hay imagen. */
  private grab(): { img: Img; frameId: number } | null {
    const useFeed = this.feedCount > 0 && Date.now() - this.feedAt < STALE_MS;
    const v = this.video;
    let src: CanvasImageSource;
    let w: number;
    let h: number;
    if (useFeed) {
      src = this.feed;
      w = this.feed.width;
      h = this.feed.height;
      if (this.feedUsed !== this.feedCount) {
        this.feedUsed = this.feedCount;
        this.frameCounter++;
      }
    } else {
      if (!v || !v.videoWidth) return null;
      src = v;
      w = v.videoWidth;
      h = v.videoHeight;
      if (v.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = v.currentTime;
        this.frameCounter++;
      }
    }
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0);
    return { img: ctx.getImageData(0, 0, w, h), frameId: this.frameCounter };
  }

  /** Avisa si el video llega negro o congelado; quita el aviso cuando vuelve a llegar imagen. Devuelve false si el frame es negro. */
  private checkHealth(img: Img): boolean {
    const h = frameHealth(img);
    const stale = this.feedCount > 0 && Date.now() - this.feedAt >= STALE_MS;
    this.sameHash = h.hash === this.lastHash ? this.sameHash + 1 : 0;
    this.lastHash = h.hash;
    const problem = h.blank ? BLANK_HELP : stale || this.sameHash >= FROZEN_TICKS ? STALE_HELP : null;
    const cur = store.get().captureError;
    if (problem) store.set({ captureError: problem }, false);
    else if (cur && HEALTH_NOTES.includes(cur)) store.set({ captureError: null }, false);
    return !h.blank;
  }

  /** Una lectura (con como máximo un reintento si fue ambigua y el video avanzó). */
  async tick(manual = false) {
    if (this.busy || (!manual && store.get().paused)) return;
    this.busy = true;
    try {
      let shot = this.grab();
      if (!shot) return;
      if (!this.checkHealth(shot.img)) return;
      let outcome = await this.process(shot.img, shot.frameId);
      if (outcome === "retry") {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        const again = this.grab();
        if (again && again.frameId !== shot.frameId) {
          shot = again;
          outcome = await this.process(shot.img, shot.frameId);
        }
      }
      // Solo el resultado final del ciclo va al registro (un "confirmando…" seguido de ✓ no es un error).
      if (this.pendingLog) store.log(this.pendingLog);
      this.pendingLog = null;
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
      this.pendingLog = { t, ok: false, text: read?.expText ?? "—", reason: verdict, source: read?.source ?? undefined };
    } else {
      const v = this.validator.validate(
        { level: read.level, amount: read.amount, pct: read.pct, frameId, t, source: read.source ?? undefined, levelHint: read.levelText },
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
        // Autoaprendizaje: si los dígitos del nivel salieron ambiguos pero el nivel quedó validado por la EXP,
        // ese frame es un ejemplo etiquetado seguro → se aprenden esos dígitos para la próxima vez.
        if (v.value.levelSource === "exp" && read.levelText !== String(v.value.level)) {
          const n = this.learn(img, String(v.value.level), null).level;
          if (n) verdict += ` · aprendí los dígitos del nivel ${v.value.level}`;
        }
        this.pendingLog = {
          t,
          ok: true,
          text: `Nv ${v.value.level} · ${v.value.estimated ? "~" : ""}${v.value.exp.toLocaleString("es-CL")} (${v.value.pct?.toFixed(2) ?? "?"}%)`,
          source: read.source ?? undefined,
          estimated: v.value.estimated,
        };
        result = "ok";
      } else {
        verdict = v.reason;
        if (v.conflictLevel) store.set({ conflictLevel: v.conflictLevel }, false);
        this.pendingLog = { t, ok: false, text: `Nv ${read.levelText ?? "?"} · ${read.expText ?? "—"}`, reason: v.reason, source: read.source ?? undefined };
        result = v.retry ? "retry" : "rejected";
      }
    }
    const meso = await this.processMesos(img, frameId, t);
    const debug: DebugFrame = { canvas: this.canvas, read, meso, at: t, verdict };
    this.lastDebug = debug;
    this.debugListeners.forEach((l) => l(debug));
    return result;
  }

  /** Lectura de mesos del mismo frame (independiente de la EXP). */
  private async processMesos(img: Img, frameId: number, t: number): Promise<MesoPipelineRead | null> {
    let r: MesoPipelineRead | null = null;
    try {
      r = await readMesosWithFallback(img, this.templates, this.mesoRegion, recognizeInBrowser);
    } catch (e) {
      console.warn("[maple-track] fallo leyendo mesos", e);
      return null;
    }
    if (r.amount === null) {
      if (!r.region) this.mesoRegion = null;
      store.set({ mesoStatus: r.reason ?? "Sin lectura de mesos" }, false);
      return r;
    }
    const last = store.get().mesoSamples.at(-1)?.amount ?? null;
    const v = this.mesoValidator.validate(r.amount, frameId, last);
    if (!v.ok) {
      store.set({ mesoStatus: v.reason ?? "Lectura de mesos rechazada" }, false);
      return r;
    }
    this.mesoRegion = r.region;
    const seg = this.mesoResume;
    this.mesoResume = false;
    store.addMesoSample({ t, amount: r.amount, ...(seg ? { segmentStart: true } : {}) });
    store.set({ mesoStatus: r.source === "neural" ? "Leído con Tesseract" : "Leyendo el inventario" }, false);
    return r;
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
    return this.learn(shot.img, level || null, exp || null);
  }

  /** Agrega glifos etiquetados a las plantillas propias (guardadas en este navegador). */
  private learn(img: Img, level: string | null, exp: string | null) {
    const samples = emptySamples();
    const res = learnFromFrame(img, level, exp, samples);
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
