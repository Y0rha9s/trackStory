import type { Sample } from "../core/metrics";

export interface LogEntry {
  t: number;
  ok: boolean;
  text: string;
  reason?: string;
  source?: "glyph" | "neural" | "manual";
  estimated?: boolean;
}

export type CaptureStatus = "idle" | "requesting" | "sharing" | "error";

export interface SessionState {
  sessionNo: number;
  startedAt: number;
  samples: Sample[];
  log: LogEntry[];
  /** nivel actual de la sesión */
  level: number | null;
  paused: boolean;
  /** el HUD muestra otro nivel (¿cambio de personaje?) */
  conflictLevel: number | null;
  // --- no persistido ---
  capture: CaptureStatus;
  captureError: string | null;
  lastReadAt: number | null;
  nextReadAt: number | null;
  autoRead: boolean;
}

const KEY = "maple-track:session:v1";
const CHANNEL = "maple-track";
const MAX_SAMPLES = 2000;
const MAX_LOG = 60;

const fresh = (n = 1): SessionState => ({
  sessionNo: n,
  startedAt: Date.now(),
  samples: [],
  log: [],
  level: null,
  paused: false,
  conflictLevel: null,
  capture: "idle",
  captureError: null,
  lastReadAt: null,
  nextReadAt: null,
  autoRead: true,
});

function load(): SessionState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { ...fresh(), ...s, capture: "idle", captureError: null, nextReadAt: null, paused: false };
    }
  } catch {
    /* almacenamiento bloqueado o corrupto: partir de cero */
  }
  return fresh();
}

type Listener = () => void;

class Store {
  private state: SessionState = load();
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;

  constructor() {
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      // La ventana del stream card pide el estado al abrirse.
      this.channel.onmessage = (e) => {
        if (e.data?.type === "hello") this.broadcast();
      };
    } catch {
      this.channel = null;
    }
  }

  get = () => this.state;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  set(patch: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>), persist = true) {
    const p = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    if (persist) this.persist();
    this.broadcast();
    this.listeners.forEach((l) => l());
  }

  addSample(s: Sample) {
    this.set((st) => ({
      samples: [...st.samples, s].slice(-MAX_SAMPLES),
      level: s.level,
      conflictLevel: null,
    }));
  }

  log(e: LogEntry) {
    this.set((st) => ({ log: [e, ...st.log].slice(0, MAX_LOG) }));
  }

  newSession() {
    const s = this.state;
    this.state = {
      ...fresh(s.sessionNo + 1),
      capture: s.capture,
      autoRead: s.autoRead,
      nextReadAt: s.nextReadAt,
    };
    this.persist();
    this.broadcast();
    this.listeners.forEach((l) => l());
  }

  private persist() {
    try {
      const { sessionNo, startedAt, samples, log, level } = this.state;
      localStorage.setItem(KEY, JSON.stringify({ sessionNo, startedAt, samples, log, level }));
    } catch {
      /* sin almacenamiento: la sesión vive solo en memoria */
    }
  }

  private broadcast() {
    const { sessionNo, startedAt, samples, level, paused, capture, lastReadAt } = this.state;
    this.channel?.postMessage({
      type: "state",
      state: { sessionNo, startedAt, samples: samples.slice(-60), level, paused, capture, lastReadAt, sentAt: Date.now() },
    });
  }
}

export const store = new Store();
export const CHANNEL_NAME = CHANNEL;
