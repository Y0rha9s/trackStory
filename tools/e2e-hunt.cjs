/**
 * Prueba del panel de mapa y mobs con un mundo inventado en la forma de OSMS
 * (interceptando /api/osms y osmsdataexplorer.com). node tools/e2e-hunt.cjs <url> <out-dir> [dataset frames...]
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [url, out, dir, ...frames] = process.argv.slice(2);

const pos = (id, n) => Array.from({ length: n }, () => ({ id }));
const world = {
  maps: { regions: [{ maps: [
    { id: 105040300, name: "Pasillo de Hongos", street_name: "Bosque Inventado", region: "Victoria", mob_positions: [...pos(1, 20), ...pos(2, 10)] },
    { id: 105040301, name: "Cueva de Rocas", street_name: "Bosque Inventado", region: "Victoria", mob_positions: pos(3, 26) },
    { id: 105040302, name: "Pantano Gris", street_name: "Ruta Falsa", region: "Victoria", mob_positions: [...pos(4, 14), ...pos(3, 10)] },
    { id: 105040303, name: "Guarida del Jefe", street_name: "Ruta Falsa", region: "Victoria", mob_positions: [...pos(5, 1), ...pos(4, 8)] },
    { id: 100000000, name: "Pueblo", street_name: "Isla", region: "Victoria", is_town: true, mob_positions: [] },
  ] }] },
  monsters: { monsters: [
    { id: 1, name: "Hongo Azul", level: 35, hp: 900, exp: 54, maps: [{ id: 105040300, count: 20 }] },
    { id: 2, name: "Hongo Zombi", level: 37, hp: 1100, exp: 65, maps: [{ id: 105040300, count: 10 }] },
    { id: 3, name: "Golem Chico", level: 34, hp: 950, exp: 52, maps: [{ id: 105040301, count: 26 }, { id: 105040302, count: 10 }] },
    { id: 4, name: "Lagarto Gris", level: 38, hp: 1250, exp: 72, maps: [{ id: 105040302, count: 14 }, { id: 105040303, count: 8 }] },
    { id: 5, name: "Rey Lagarto", level: 45, hp: 40000, exp: 1500, maps: [{ id: 105040303, count: 1, mob_time: "600.00" }] },
  ] },
  lookups: { map_names: {}, mob_names: {} },
};
const images = frames.map((f) => "data:image/png;base64," + fs.readFileSync(path.join(dir, f)).toString("base64"));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  let hits = 0;
  await page.route(/api\/osms\?file=|osmsdataexplorer\.com/, (route) => {
    hits++;
    const f = new URL(route.request().url()).searchParams.get("file") ?? route.request().url().split("/").pop();
    const body = f === "maps.json" ? world.maps : f === "monsters.json" ? world.monsters : world.lookups;
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.addInitScript((imgs) => {
    let i = 0;
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement("canvas"), ctx = c.getContext("2d");
      const els = await Promise.all(imgs.map((src) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = src; })));
      c.width = els[0].width; c.height = els[0].height;
      const draw = () => ctx.drawImage(els[Math.min(i, els.length - 1)], 0, 0);
      draw(); setInterval(() => (i++, draw()), 10_000); setInterval(draw, 200);
      return c.captureStream(5);
    };
  }, images);
  await page.goto(url);
  if (images.length) await page.getByRole("button", { name: "Compartir ventana del juego" }).click();
  await page.waitForTimeout(Number(process.env.WAIT || 2000));
  await page.getByRole("button", { name: "Cargar mapas y mobs" }).click();
  await page.waitForTimeout(1500);
  console.log("TRAS CARGAR:", (await page.locator("section[aria-label='Mapa y mobs']").innerText()).replace(/\n/g, " | ").slice(0, 600));
  await page.getByLabel("¿Dónde estás cazando?").fill("hongo");
  await page.getByRole("button", { name: /Pasillo de Hongos/ }).first().click();
  await page.waitForTimeout(800);
  const panel = page.locator("section[aria-label='Mapa y mobs']");
  console.log("PANEL:", (await panel.innerText()).replace(/\n/g, " | "));
  console.log("requests a OSMS/proxy:", hits);
  await panel.screenshot({ path: path.join(out, "e2e-hunt.png") });
  await browser.close();
})();
