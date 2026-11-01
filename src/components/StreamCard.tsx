import { useEffect, useState } from "react";
import { computeMetrics, type Sample } from "../core/metrics";
import { CHANNEL_NAME } from "../tracker/store";
import { fmtCompact, useNow } from "../hooks";
import { ExpHero } from "./ExpHero";

interface CardState {
  samples: Sample[];
  paused: boolean;
  capture: string;
  sentAt: number;
}

/**
 * Tarjeta compacta para OBS (Captura de ventana). Se sincroniza con el tracker por BroadcastChannel;
 * no pide acceso a la pantalla.
 */
export function StreamCard() {
  const [st, setSt] = useState<CardState | null>(null);
  const now = useNow(1000);
  useEffect(() => {
    document.title = "Maple Track · tarjeta";
    const ch = new BroadcastChannel(CHANNEL_NAME);
    ch.onmessage = (e) => e.data?.type === "state" && setSt(e.data.state);
    ch.postMessage({ type: "hello" });
    return () => ch.close();
  }, []);
  const offline = !st || now - st.sentAt > 35_000 || st.capture !== "sharing";
  const m = computeMetrics(st?.samples ?? [], now);
  return (
    <main className="min-h-screen bg-sky p-4">
      <div className="mx-auto max-w-xl rounded-2xl border border-line bg-panel p-4">
        <ExpHero m={m} compact />
        <div className="mt-3 flex items-baseline justify-between">
          <p className="text-2xl font-extrabold">
            {m.ratePerHour !== null ? fmtCompact(m.ratePerHour) : "–"} <span className="text-base font-bold text-ink-soft">EXP/hora</span>
          </p>
          <p className={`text-sm font-bold ${offline ? "text-bad" : "text-good"}`}>
            {!st ? "Abre el tracker principal" : st.paused ? "En pausa" : offline ? "Sin conexión con el tracker" : "En vivo"}
          </p>
        </div>
      </div>
    </main>
  );
}
