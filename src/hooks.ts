import { useEffect, useState, useSyncExternalStore } from "react";
import { store } from "./tracker/store";

export const useSession = () => useSyncExternalStore(store.subscribe, store.get);

/** Re-renderiza cada `ms` para relojes y cuentas regresivas. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString("es-CL");

export function fmtCompact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toLocaleString("es-CL", { maximumFractionDigits: 2 })} M`;
  if (a >= 1e4) return `${(n / 1e3).toLocaleString("es-CL", { maximumFractionDigits: 1 })} k`;
  return fmtInt(n);
}

export function fmtDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtEta(ms: number | null) {
  if (ms === null || !isFinite(ms)) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h >= 48) return `${Math.round(h / 24)} días`;
  return `${h} h ${min % 60} min`;
}
