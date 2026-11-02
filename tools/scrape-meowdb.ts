/**
 * Descarga páginas de MeowDB para uso interno (los datos NO se publican con la app).
 *
 *   npx tsx tools/scrape-meowdb.ts --contact tu@correo --permission-granted urls.txt
 *
 * urls.txt: una URL por línea (https://meowdb.com/msclassic/...); las líneas con # se ignoran.
 * Salida: data/meowdb/ (index.json + pages/*.html), carpeta ignorada por git.
 *
 * REQUISITO: permiso previo de MeowDB (contact@meowdb.com, asunto "Permission request: Maple Track").
 * Sin --permission-granted el programa no hace ninguna petición.
 */
import { readFile } from "node:fs/promises";
import { crawl, MIN_INTERVAL_MS } from "./crawler";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--contact" && args[i - 1] !== "--out");

const contact = value("--contact");
if (!flag("--permission-granted")) {
  console.error("Falta --permission-granted. MeowDB exige permiso por correo antes de usar un scraper (https://meowdb.com/reuse#tool-rules).");
  process.exit(1);
}
if (!contact || !file) {
  console.error("Uso: npx tsx tools/scrape-meowdb.ts --contact tu@correo --permission-granted urls.txt [--out data/meowdb]");
  process.exit(1);
}

const urls = (await readFile(file, "utf8"))
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

console.log(`${urls.length} URLs · 1 petición cada ${MIN_INTERVAL_MS / 1000} s · ≈ ${Math.ceil((urls.length * MIN_INTERVAL_MS) / 60000)} min como máximo`);
const result = await crawl(urls, {
  dir: value("--out") ?? "data/meowdb",
  userAgent: `Maple Track (uso interno; contacto: ${contact})`,
  log: (m) => console.log(m),
});
console.log(JSON.stringify(result));
if (result.stopped) {
  console.error(`Detenido en ${result.stopped.url}: ${result.stopped.reason}. Vuelve a ejecutar más tarde; lo ya descargado no se repite.`);
  process.exit(2);
}
