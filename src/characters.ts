import { useSyncExternalStore } from "react";
import type { ClassDef, SlotKey, Stats } from "./core/gear";

/** Lo que se guarda de la calculadora de equipo, por personaje. */
export interface GearForm {
  classId: ClassDef["id"];
  level: number;
  stats: Stats;
  extraAtk: number;
  equipped: Partial<Record<SlotKey, number>>;
  balanced: boolean;
  apToPrimary: boolean;
  /** ítems que el usuario marcó como inexistentes en Classic */
  hidden: number[];
}

export const DEFAULT_GEAR: GearForm = {
  classId: "warrior",
  level: 30,
  stats: { str: 4, dex: 4, int: 4, luk: 4 },
  extraAtk: 0,
  equipped: {},
  balanced: true,
  apToPrimary: true,
  hidden: [],
};

export interface Character {
  id: string;
  name: string;
  createdAt: number;
  gear: GearForm;
  /** ids de quests completadas */
  questsDone: string[];
  /** el nivel se actualiza solo con lo que lee el tracker */
  autoLevel: boolean;
  /** pestaña Build: 2º job elegido, variante de la plantilla y plantillas editadas ("jobId:variante" → texto) */
  build: { job: string; variant: number; custom: Record<string, string>; /** niveles de skill que el usuario ya tiene subidos */ skills: Record<string, number> };
}

export interface CharactersState {
  activeId: string;
  chars: Character[];
}

const KEY = "maple-track:characters:v1";
const OLD_GEAR_KEY = "maple-track:gear:v1";

const uid = () => Math.random().toString(36).slice(2, 10);
const newChar = (name: string, gear?: Partial<GearForm>): Character => ({ id: uid(), name, createdAt: Date.now(), gear: { ...DEFAULT_GEAR, ...gear }, questsDone: [], autoLevel: true, build: { job: "", variant: 0, custom: {}, skills: {} } });

function read(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

/** Valida lo leído del almacenamiento o de un archivo importado; descarta lo que no sirva. */
export function parseCharacters(raw: unknown): CharactersState | null {
  const o = raw as Partial<CharactersState> | null;
  if (!o || !Array.isArray(o.chars)) return null;
  const chars = o.chars
    .filter((c): c is Character => !!c && typeof c.id === "string" && typeof c.name === "string")
    .map((c) => ({ ...c, autoLevel: c.autoLevel !== false, build: { job: c.build?.job ?? "", variant: c.build?.variant ?? 0, custom: c.build?.custom ?? {}, skills: c.build?.skills ?? {} }, questsDone: Array.isArray(c.questsDone) ? c.questsDone.map(String) : [], createdAt: Number(c.createdAt) || Date.now(), gear: { ...DEFAULT_GEAR, ...c.gear, stats: { ...DEFAULT_GEAR.stats, ...c.gear?.stats } } }));
  if (!chars.length) return null;
  return { chars, activeId: chars.some((c) => c.id === o.activeId) ? (o.activeId as string) : chars[0].id };
}

function initial(): CharactersState {
  try {
    const saved = parseCharacters(JSON.parse(read(KEY) ?? "null"));
    if (saved) return saved;
  } catch {
    /* datos corruptos: se parte de cero */
  }
  // Migración: la calculadora de equipo guardaba un solo formulario.
  let old: Partial<GearForm> | undefined;
  try {
    old = JSON.parse(read(OLD_GEAR_KEY) ?? "null") ?? undefined;
  } catch {
    old = undefined;
  }
  const first = newChar("Personaje 1", old);
  return { activeId: first.id, chars: [first] };
}

class CharacterStore {
  private state = initial();
  private listeners = new Set<() => void>();

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  get = () => this.state;
  active = () => this.state.chars.find((c) => c.id === this.state.activeId) ?? this.state.chars[0];

  private set(next: CharactersState) {
    this.state = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* sin almacenamiento: queda en memoria */
    }
    this.listeners.forEach((l) => l());
  }

  select(id: string) {
    if (this.state.chars.some((c) => c.id === id)) this.set({ ...this.state, activeId: id });
  }
  create(name: string, copyFromActive = false) {
    const c = newChar(name.trim() || `Personaje ${this.state.chars.length + 1}`, copyFromActive ? this.active().gear : undefined);
    this.set({ activeId: c.id, chars: [...this.state.chars, c] });
  }
  rename(id: string, name: string) {
    const n = name.trim();
    if (n) this.set({ ...this.state, chars: this.state.chars.map((c) => (c.id === id ? { ...c, name: n } : c)) });
  }
  remove(id: string) {
    if (this.state.chars.length <= 1) return;
    const chars = this.state.chars.filter((c) => c.id !== id);
    this.set({ chars, activeId: this.state.activeId === id ? chars[0].id : this.state.activeId });
  }
  updateGear(patch: Partial<GearForm>) {
    const id = this.state.activeId;
    this.set({ ...this.state, chars: this.state.chars.map((c) => (c.id === id ? { ...c, gear: { ...c.gear, ...patch } } : c)) });
  }
  setAutoLevel(on: boolean) {
    const id = this.state.activeId;
    this.set({ ...this.state, chars: this.state.chars.map((c) => (c.id === id ? { ...c, autoLevel: on } : c)) });
  }
  updateBuild(patch: Partial<Character["build"]>) {
    const id = this.state.activeId;
    this.set({ ...this.state, chars: this.state.chars.map((c) => (c.id === id ? { ...c, build: { ...c.build, ...patch } } : c)) });
  }
  toggleQuest(id: string) {
    const aid = this.state.activeId;
    this.set({
      ...this.state,
      chars: this.state.chars.map((c) => (c.id === aid ? { ...c, questsDone: c.questsDone.includes(id) ? c.questsDone.filter((q) => q !== id) : [...c.questsDone, id] } : c)),
    });
  }
  exportJson() {
    return JSON.stringify({ app: "maple-track", version: 1, ...this.state }, null, 2);
  }
  /** Reemplaza todos los personajes por los del archivo. Devuelve false si el archivo no sirve. */
  importJson(text: string) {
    try {
      const parsed = parseCharacters(JSON.parse(text));
      if (!parsed) return false;
      this.set(parsed);
      return true;
    } catch {
      return false;
    }
  }
}

export const characters = new CharacterStore();

export function useCharacters() {
  const state = useSyncExternalStore(characters.subscribe, characters.get);
  const active = state.chars.find((c) => c.id === state.activeId) ?? state.chars[0];
  return { ...state, active };
}
