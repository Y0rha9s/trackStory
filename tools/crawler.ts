/**
 * Descargador educado para uso interno (NO forma parte de la app ni se despliega).
 *
 * Cumple la política de MeowDB (https://meowdb.com/reuse#tool-rules):
 *  - una petición cada 10 s, una a la vez, nunca en paralelo
 *  - User-Agent con el nombre de la herramienta y un contacto
 *  - la misma URL no se pide dos veces (caché en disco)
 *  - se detiene al primer 429 o 403
 *  - respeta las reglas de robots.txt
 *
 * Solo debe ejecutarse con el permiso de MeowDB (contact@meowdb.com) ya concedido; el CLI lo exige.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ALLOWED_HOST = "meowdb.com";
export const MIN_INTERVAL_MS = 10_000;

export interface CrawlEntry {
  url: string;
  status: number;
  file: string | null;
  fetchedAt: string;
}

export interface CrawlOptions {
  /** carpeta donde se guardan las páginas y el índice */
  dir: string;
  /** "Maple Track (contacto: tu@correo)" */
  userAgent: string;
  /** separación mínima entre peticiones; no se puede bajar de 10 s */
  intervalMs?: number;
  fetchFn?: (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; text(): Promise<string> }>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface CrawlResult {
  fetched: number;
  cached: number;
  skipped: number;
  /** si se cortó por un 429/403 u otro error, dónde */
  stopped: { url: string; reason: string } | null;
}

const hash = (url: string) => createHash("sha1").update(url).digest("hex").slice(0, 16);

export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === ALLOWED_HOST || u.hostname === `www.${ALLOWED_HOST}`);
  } catch {
    return false;
  }
}

/** Rutas prohibidas para `User-agent: *` en un robots.txt. */
export function disallowedPaths(robots: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "user-agent") applies = m[2].trim() === "*";
    else if (key === "disallow" && applies && m[2].trim()) out.push(m[2].trim());
  }
  return out;
}

export const pathAllowed = (url: string, disallowed: readonly string[]) => {
  const { pathname } = new URL(url);
  return !disallowed.some((p) => pathname.startsWith(p));
};

async function readIndex(dir: string): Promise<Record<string, CrawlEntry>> {
  try {
    return JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
  } catch {
    return {};
  }
}

export async function crawl(urls: readonly string[], opts: CrawlOptions): Promise<CrawlResult> {
  if (!/\S+@\S+|https?:\/\/\S+/.test(opts.userAgent)) throw new Error("El User-Agent debe incluir un contacto (correo o URL)");
  const interval = Math.max(opts.intervalMs ?? MIN_INTERVAL_MS, MIN_INTERVAL_MS);
  const fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => undefined);
  const headers = { "user-agent": opts.userAgent, accept: "text/html,application/json" };

  await mkdir(join(opts.dir, "pages"), { recursive: true });
  const index = await readIndex(opts.dir);
  const result: CrawlResult = { fetched: 0, cached: 0, skipped: 0, stopped: null };
  let lastAt = -Infinity;

  const request = async (url: string) => {
    const wait = lastAt + interval - now();
    if (wait > 0) await sleep(wait);
    lastAt = now();
    return fetchFn(url, { headers });
  };

  // robots.txt primero (cuenta como una petición más).
  let disallowed: string[] = [];
  const pending = [...new Set(urls)].filter((u) => {
    if (!isAllowedUrl(u)) {
      log(`ignorada (fuera de ${ALLOWED_HOST}): ${u}`);
      result.skipped++;
      return false;
    }
    return true;
  });
  if (pending.some((u) => !index[u])) {
    const res = await request(`https://${ALLOWED_HOST}/robots.txt`);
    if (res.status === 429 || res.status === 403) return { ...result, stopped: { url: "robots.txt", reason: `HTTP ${res.status}` } };
    if (res.status === 200) disallowed = disallowedPaths(await res.text());
  }

  for (const url of pending) {
    if (index[url] && index[url].status !== 0) {
      result.cached++;
      continue;
    }
    if (!pathAllowed(url, disallowed)) {
      log(`robots.txt lo prohíbe: ${url}`);
      result.skipped++;
      continue;
    }
    let res: Awaited<ReturnType<typeof request>>;
    try {
      res = await request(url);
    } catch (e) {
      result.stopped = { url, reason: `error de red: ${e instanceof Error ? e.message : String(e)}` };
      break;
    }
    if (res.status === 429 || res.status === 403) {
      result.stopped = { url, reason: `HTTP ${res.status}` };
      log(`detenido: ${url} respondió ${res.status}`);
      break;
    }
    let file: string | null = null;
    if (res.status >= 200 && res.status < 300) {
      file = `pages/${hash(url)}.html`;
      await writeFile(join(opts.dir, file), await res.text());
    }
    index[url] = { url, status: res.status, file, fetchedAt: new Date(now()).toISOString() };
    await writeFile(join(opts.dir, "index.json"), JSON.stringify(index, null, 1));
    result.fetched++;
    log(`${res.status} ${url}`);
  }
  return result;
}

/** Contenido guardado de una URL ya descargada (para los lectores de cada tipo de página). */
export async function readPage(dir: string, url: string): Promise<string | null> {
  const entry = (await readIndex(dir))[url];
  return entry?.file ? readFile(join(dir, entry.file), "utf8") : null;
}
