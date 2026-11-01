/**
 * Prueba end-to-end: reemplaza getDisplayMedia por un canvas que muestra capturas reales
 * en secuencia y verifica que el tracker acepte lecturas y calcule EXP/hora.
 *   node tools/e2e.cjs <dir-dataset> <url> <out-dir> [frames...]
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const [dir, url, out, ...frames] = process.argv.slice(2);
const images = frames.map((f) => "data:image/png;base64," + fs.readFileSync(path.join(dir, f)).toString("base64"));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => console.log("[page]", m.type(), m.text()));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.addInitScript((imgs) => {
    let i = 0;
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d");
      const els = await Promise.all(
        imgs.map((src) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = src; })),
      );
      c.width = els[0].width;
      c.height = els[0].height;
      const draw = () => ctx.drawImage(els[Math.min(i, els.length - 1)], 0, 0);
      draw();
      // Avanza a la siguiente captura cada 10 s (una por lectura) y redibuja para generar frames nuevos.
      setInterval(() => (i++, draw()), 10_000);
      setInterval(draw, 200);
      return c.captureStream(5);
    };
  }, images);
  await page.goto(url);
  await page.getByRole("button", { name: "Compartir ventana del juego" }).click();
  await page.waitForTimeout(Number(process.env.WAIT || 34000));
  await page.screenshot({ path: path.join(out, "e2e-full.png"), fullPage: true });
  const log = await page.locator("section:has(h2:text('Lecturas recientes')) li").allInnerTexts();
  console.log("LOG:\n" + log.join("\n---\n"));
  const rate = await page.locator("text=EXP por hora").first().locator("..").innerText();
  console.log("RATE:", rate.replace(/\n/g, " | "));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, "e2e-mobile.png"), fullPage: true });
  await browser.close();
})();
