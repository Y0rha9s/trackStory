import { useEffect, useRef, useState } from "react";
import type { Box } from "../ocr/image";
import { tracker, type DebugFrame } from "../tracker/tracker";

/** Panel de diagnóstico (?debug=1): frame con regiones, recortes ampliados y calibración de glifos. */
export function DebugPanel() {
  const [frame, setFrame] = useState<DebugFrame | null>(tracker.lastDebug);
  const [level, setLevel] = useState("");
  const [exp, setExp] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const full = useRef<HTMLCanvasElement>(null);
  const lvCrop = useRef<HTMLCanvasElement>(null);
  const exCrop = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const off = tracker.onDebug(setFrame);
    return () => void off();
  }, []);

  useEffect(() => {
    if (!frame) return;
    const src = frame.canvas;
    const c = full.current;
    if (c) {
      // El 35% inferior (HUD); si el inventario está más arriba, se amplía para incluirlo.
      const mesoY = frame.meso?.region?.field.y;
      const top = Math.max(0, Math.min(Math.floor(src.height * 0.65), mesoY !== undefined ? Math.floor(mesoY - 40) : Infinity));
      const scale = Math.min(1, 1100 / src.width);
      c.width = src.width * scale;
      c.height = (src.height - top) * scale;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(src, 0, top, src.width, src.height - top, 0, 0, c.width, c.height);
      const draw = (b: Box | null | undefined, color: string) => {
        if (!b) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x * scale - 3, (b.y - top) * scale - 3, b.w * scale + 6, b.h * scale + 6);
      };
      draw(frame.read?.debug.levelBox, "#f08a1c");
      draw(frame.read?.debug.expBox, "#7fbf1f");
      draw(frame.read?.debug.amountBox, "#38a3ff");
      draw(frame.meso?.region?.field, "#e5b100");
    }
    const zoom = (target: HTMLCanvasElement | null, b: Box | null | undefined) => {
      if (!target || !b) return;
      const f = Math.max(2, Math.floor(56 / b.h));
      target.width = b.w * f;
      target.height = b.h * f;
      const ctx = target.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, target.width, target.height);
    };
    zoom(lvCrop.current, frame.read?.debug.levelBox);
    const e = frame.read?.regions.exp;
    zoom(exCrop.current, e ? { x: frame.read?.debug.amountBox?.x ?? e.open.x, y: e.open.y - 2, w: e.close.x + e.close.w - (frame.read?.debug.amountBox?.x ?? e.open.x) + 2, h: e.lineH + 4 } : null);
  }, [frame]);

  const train = () => {
    const r = tracker.trainFromCurrentFrame(level.trim(), exp.trim());
    setMsg(
      r.level + r.exp
        ? `Aprendidos ${r.level} dígitos de nivel y ${r.exp} de EXP. Se usan desde la próxima lectura.`
        : "No se pudo alinear el texto con los glifos del frame. Revisa que lo escrito sea exactamente lo que muestra el juego.",
    );
  };

  const download = () => {
    const url = tracker.snapshotUrl();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `maple-track-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    a.click();
  };

  return (
    <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <h2 className="text-lg font-bold">Diagnóstico</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Zona del frame donde se busca el HUD. En naranjo el nivel, en verde la EXP, en azul la cantidad y en amarillo los mesos.
      </p>
      {!frame ? (
        <p className="mt-4 text-ink-soft">Esperando el primer frame…</p>
      ) : (
        <>
          <canvas ref={full} className="mt-3 w-full rounded-lg border border-line" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <figure>
              <figcaption className="text-sm text-ink-soft">Recorte de nivel → «{frame.read?.levelText ?? "no encontrado"}»</figcaption>
              <canvas ref={lvCrop} className="mt-1 max-w-full [image-rendering:pixelated]" />
            </figure>
            <figure>
              <figcaption className="text-sm text-ink-soft">
                Recorte de EXP → «{frame.read?.expText ?? "no encontrado"}» {frame.read?.source === "neural" && "(Tesseract)"}
              </figcaption>
              <canvas ref={exCrop} className="mt-1 max-w-full [image-rendering:pixelated]" />
            </figure>
          </div>
          <p className="mt-3 text-sm">
            Veredicto: <b>{frame.verdict}</b>
          </p>
          <p className="mt-1 text-sm">
            Mesos (amarillo): <b>{frame.meso?.text ?? "campo no encontrado"}</b>
            {frame.meso?.source === "neural" && " (Tesseract)"}
            {frame.meso?.reason && <span className="text-ink-soft"> · {frame.meso.reason}</span>}
          </p>
        </>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="font-bold">Enseñarle a leer tu HUD</h3>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">
          Si una lectura se rechaza seguido, escribe lo que muestra el juego en este momento y presiona Aprender. Las plantillas
          quedan guardadas en este navegador ({tracker.userTemplateCount} propias).
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Nivel
            <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="40" className="mt-1 block w-20 rounded-lg border border-line bg-sky px-2 py-1.5" />
          </label>
          <label className="text-sm">
            EXP tal como se ve
            <input value={exp} onChange={(e) => setExp(e.target.value)} placeholder="221.609[75.32%]" className="mt-1 block w-52 rounded-lg border border-line bg-sky px-2 py-1.5" />
          </label>
          <button onClick={train} className="rounded-lg bg-ink px-3 py-1.5 font-bold text-sky">Aprender</button>
          <button onClick={() => { tracker.clearUserTemplates(); setMsg("Plantillas propias borradas."); }} className="rounded-lg border border-line px-3 py-1.5">
            Borrar plantillas propias
          </button>
          <button onClick={download} className="rounded-lg border border-line px-3 py-1.5">Descargar captura</button>
        </div>
        {msg && <p className="mt-2 text-sm">{msg}</p>}
      </div>
    </section>
  );
}
