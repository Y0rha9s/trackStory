import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crawl, disallowedPaths, isAllowedUrl, pathAllowed, readPage } from "./crawler";

const UA = "Maple Track (contacto: yo@example.com)";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "crawler-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** Reloj falso: `sleep` adelanta la hora, así se mide la separación entre peticiones sin esperar. */
function fakeEnv(responses: Record<string, number | string> = {}) {
  let t = 1_000_000;
  const calls: { url: string; at: number; headers: Record<string, string> }[] = [];
  return {
    calls,
    opts: {
      dir,
      userAgent: UA,
      now: () => t,
      sleep: async (ms: number) => void (t += ms),
      fetchFn: async (url: string, init: { headers: Record<string, string> }) => {
        calls.push({ url, at: t, headers: init.headers });
        t += 5; // la petición tarda un poco
        const r = responses[url] ?? 200;
        const status = typeof r === "number" ? r : 200;
        return { status, text: async () => (typeof r === "string" ? r : `<html>${url}</html>`) };
      },
    },
  };
}

const U = (p: string) => `https://meowdb.com/msclassic/${p}`;

describe("descargador de MeowDB", () => {
  it("espera al menos 10 s entre peticiones y manda el User-Agent con contacto", async () => {
    const env = fakeEnv();
    const r = await crawl([U("a"), U("b"), U("c")], env.opts);
    expect(r).toMatchObject({ fetched: 3, cached: 0, stopped: null });
    const times = env.calls.map((c) => c.at);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(10_000);
    expect(env.calls.every((c) => c.headers["user-agent"] === UA)).toBe(true);
    expect(env.calls[0].url).toBe("https://meowdb.com/robots.txt");
  });

  it("no baja el intervalo de 10 s aunque se pida menos", async () => {
    const env = fakeEnv();
    await crawl([U("a"), U("b")], { ...env.opts, intervalMs: 100 });
    expect(env.calls[2].at - env.calls[1].at).toBeGreaterThanOrEqual(10_000);
  });

  it("no repite URLs ya descargadas", async () => {
    const first = fakeEnv();
    await crawl([U("a"), U("b")], first.opts);
    const second = fakeEnv();
    const r = await crawl([U("a"), U("b")], second.opts);
    expect(r).toMatchObject({ fetched: 0, cached: 2 });
    expect(second.calls).toHaveLength(0);
    expect(await readPage(dir, U("a"))).toContain("meowdb.com/msclassic/a");
  });

  it("se detiene al primer 429 o 403 y conserva lo ya bajado", async () => {
    const env = fakeEnv({ [U("b")]: 429 });
    const r = await crawl([U("a"), U("b"), U("c")], env.opts);
    expect(r.stopped).toEqual({ url: U("b"), reason: "HTTP 429" });
    expect(r.fetched).toBe(1);
    expect(env.calls.some((c) => c.url === U("c"))).toBe(false);
    expect(JSON.parse(await readFile(join(dir, "index.json"), "utf8"))[U("a")].status).toBe(200);
  });

  it("respeta robots.txt", async () => {
    const env = fakeEnv({ "https://meowdb.com/robots.txt": "User-agent: *\nDisallow: /msclassic/private\n" });
    const r = await crawl([U("private/x"), U("ok")], env.opts);
    expect(r).toMatchObject({ fetched: 1, skipped: 1 });
    expect(env.calls.some((c) => c.url === U("private/x"))).toBe(false);
  });

  it("solo acepta https://meowdb.com y exige contacto", async () => {
    expect(isAllowedUrl("https://meowdb.com/x")).toBe(true);
    expect(isAllowedUrl("http://meowdb.com/x")).toBe(false);
    expect(isAllowedUrl("https://evil.com/x")).toBe(false);
    const env = fakeEnv();
    const r = await crawl(["https://evil.com/x"], env.opts);
    expect(r.skipped).toBe(1);
    expect(env.calls).toHaveLength(0);
    await expect(crawl([U("a")], { ...env.opts, userAgent: "Maple Track" })).rejects.toThrow(/contacto/);
  });

  it("lee las reglas de robots.txt para *", () => {
    const rules = disallowedPaths("User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /api/ # comentario\nDisallow:\n");
    expect(rules).toEqual(["/api/"]);
    expect(pathAllowed("https://meowdb.com/api/x", rules)).toBe(false);
    expect(pathAllowed("https://meowdb.com/msclassic/x", rules)).toBe(true);
  });
});
