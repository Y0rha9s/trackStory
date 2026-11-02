import { parseWorld, type World } from "./world";
import { parseQuests, type Quest } from "../core/quests";
import { parseSkills } from "../core/build";
import { parseCrafting, parseGear, parseQuestRewards, parseTickets, type GearItem, type ItemSources } from "../core/gear";

/**
 * Descarga los archivos de OSMS Data Explorer en el navegador (no se incluyen en el proyecto)
 * y los guarda un día en la caché del navegador.
 *
 * Orden de origenes:
 *  1. un proxy propio configurado por el usuario
 *  2. ./api/osms (función incluida para Vercel; en GitHub Pages simplemente no existe)
 *  3. directo a osmsdataexplorer.com (funciona solo si el sitio permite CORS)
 */
const FILES = ["maps.json", "monsters.json", "lookups.json"] as const;
const DIRECT = "https://osmsdataexplorer.com/data/current/";
const PROXY_KEY = "maple-track:osms-proxy";
const CACHE = "maple-track-osms-v1";
const TTL_MS = 24 * 3600_000;

export const OSMS_CREDIT = "Datos de mapas y mobs: OSMS Data Explorer (osmsdataexplorer.com)";

export function getCustomProxy(): string {
  try {
    return localStorage.getItem(PROXY_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setCustomProxy(url: string) {
  try {
    if (url.trim()) localStorage.setItem(PROXY_KEY, url.trim());
    else localStorage.removeItem(PROXY_KEY);
  } catch {
    /* ignorar */
  }
}

type Source = { label: string; url: (file: string) => string };

function sources(): Source[] {
  const custom = getCustomProxy();
  const list: Source[] = [];
  if (custom) list.push({ label: "proxy propio", url: (f) => (custom.includes("{file}") ? custom.replace("{file}", f) : custom.replace(/\/?$/, "/") + f) });
  // En `vite dev` api/osms.ts no es una función: Vite intentaría compilarla como módulo y mostraría un error.
  if (!import.meta.env.DEV) list.push({ label: "proxy del sitio", url: (f) => new URL(`./api/osms?file=${f}`, document.baseURI).href });
  list.push({ label: "OSMS directo", url: (f) => DIRECT + f });
  return list;
}

async function cachedJson(url: string): Promise<unknown | null> {
  try {
    const c = await caches.open(CACHE);
    const hit = await c.match(url);
    if (!hit) return null;
    const at = Number(hit.headers.get("x-saved-at") ?? 0);
    if (Date.now() - at > TTL_MS) return null;
    return await hit.json();
  } catch {
    return null;
  }
}

async function store(url: string, text: string) {
  try {
    const c = await caches.open(CACHE);
    await c.put(url, new Response(text, { headers: { "content-type": "application/json", "x-saved-at": String(Date.now()) } }));
  } catch {
    /* sin Cache Storage: se descargará de nuevo la próxima vez */
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const data = JSON.parse(text); // lanza si no es JSON (p. ej. un 404 en HTML)
  await store(url, text);
  return data;
}

export interface LoadResult {
  world: World;
  source: string;
}

let inflight: Promise<LoadResult> | null = null;

export function loadWorld(): Promise<LoadResult> {
  inflight ??= (async () => {
    const errors: string[] = [];
    for (const src of sources()) {
      try {
        const files = await Promise.all(
          FILES.map(async (f) => (await cachedJson(src.url(f))) ?? (f === "lookups.json" ? fetchJson(src.url(f)).catch(() => ({})) : fetchJson(src.url(f)))),
        );
        const [maps, monsters, lookups] = files as Record<string, unknown>[];
        return { world: parseWorld(maps, monsters, lookups), source: src.label };
      } catch (e) {
        errors.push(`${src.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new Error(errors.join(" · "));
  })();
  inflight.catch(() => (inflight = null));
  return inflight;
}

export function resetWorld() {
  inflight = null;
}

const fileInflight = new Map<string, Promise<unknown>>();

/** Un archivo extra de OSMS, con los mismos orígenes y caché que el mundo. */
function loadOsmsFile(file: string): Promise<unknown> {
  let p = fileInflight.get(file);
  if (!p) {
    p = (async () => {
      const errors: string[] = [];
      for (const src of sources()) {
        try {
          const url = src.url(file);
          return (await cachedJson(url)) ?? (await fetchJson(url));
        } catch (e) {
          errors.push(`${src.label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      throw new Error(errors.join(" · "));
    })();
    p.catch(() => fileInflight.delete(file));
    fileInflight.set(file, p);
  }
  return p;
}

/** items.json de OSMS (equipos con requisitos y stats). */
export const loadGear = async (): Promise<GearItem[]> => parseGear(await loadOsmsFile("items.json"));

/** De dónde sale cada ítem: recetas (crafting.json) y recompensas de quest (quests.json). Si falla, queda vacío. */
export async function loadItemSources(): Promise<ItemSources> {
  const [craft, quest, tickets] = await Promise.all([
    loadOsmsFile("crafting.json").then(parseCrafting, () => new Map()),
    loadOsmsFile("quests.json").then(parseQuestRewards, () => new Map()),
    loadOsmsFile("items.json").then(parseTickets, () => []),
  ]);
  return { craft, quest, tickets };
}

/** quests.json de OSMS (comparte descarga y caché con las fuentes de ítems). */
export const loadQuests = async (): Promise<Quest[]> => parseQuests(await loadOsmsFile("quests.json"));

/** skills.json de OSMS: skills de cada job con su nivel máximo y descripción. */
export const loadSkills = async () => parseSkills(await loadOsmsFile("skills.json"));
