import { useState } from "react";
import { computeMetrics } from "./core/metrics";
import { computeMesoMetrics } from "./core/mesos";
import { requiredExp } from "./core/expTable";
import { tracker } from "./tracker/tracker";
import { fmtCompact, fmtDuration, fmtInt, useNow, useSession } from "./hooks";
import { ExpHero } from "./components/ExpHero";
import { ExpChart } from "./components/ExpChart";
import { MesoChart } from "./components/MesoChart";
import { HuntPanel } from "./components/HuntPanel";
import { store } from "./tracker/store";
import { DebugPanel } from "./components/DebugPanel";

const debug = new URLSearchParams(location.search).has("debug");

export default function App() {
  const s = useSession();
  const now = useNow(1000);
  const m = computeMetrics(s.samples, now);
  const sharing = s.capture === "sharing";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-3">
          <MapleLeaf />
          <div>
            <h1 className="text-xl font-extrabold leading-tight">Maple Track</h1>
            <p className="text-sm text-ink-soft">EXP por hora para MapleStory Classic</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CaptureChip />
          {sharing ? (
            <button onClick={() => tracker.stop()} className="rounded-xl border border-line bg-panel px-3 py-2 font-bold">
              Dejar de compartir
            </button>
          ) : (
            <button onClick={() => tracker.start()} className="rounded-xl bg-tile px-4 py-2 font-extrabold text-white shadow-[inset_0_-3px_0_var(--tile-deep)]">
              Compartir ventana del juego
            </button>
          )}
          <button
            onClick={() => (s.paused ? tracker.resume() : tracker.pause())}
            disabled={!sharing}
            className="rounded-xl border border-line bg-panel px-3 py-2 font-bold disabled:opacity-40"
          >
            {s.paused ? "Reanudar" : "Pausar"}
          </button>
          <button onClick={() => confirmNew() && tracker.newSession()} className="rounded-xl border border-line bg-panel px-3 py-2 font-bold">
            Sesión nueva
          </button>
        </div>
      </header>

      {s.captureError && <Banner tone="bad">{s.captureError}</Banner>}
      {s.conflictLevel !== null && (
        <Banner tone="bad">
          El juego muestra nivel {s.conflictLevel} pero la sesión va en nivel {s.level}. Si cambiaste de personaje, inicia una sesión nueva.
        </Banner>
      )}

      <main className="space-y-5">
        <div className="rounded-3xl border border-line bg-panel p-4 sm:p-6">
          <ExpHero m={m} />
        </div>

        <section aria-label="Métricas" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="EXP por hora"
            value={m.ratePerHour !== null ? fmtCompact(m.ratePerHour) : "–"}
            hint={m.ratePerHour !== null ? "ritmo de los últimos 5 minutos" : "se calcula tras ~20 s de lecturas"}
            big
          />
          <Stat label="EXP ganada" value={`${m.estimated ? "~" : ""}${fmtCompact(m.gained)}`} hint={`en la sesión ${s.sessionNo}`} />
          <Stat
            label="Promedio de la sesión"
            value={m.sessionRatePerHour !== null ? fmtCompact(m.sessionRatePerHour) : "–"}
            hint="EXP por hora de tiempo activo"
          />
          <Stat label="Tiempo activo" value={fmtDuration(m.activeMs)} hint={m.latest ? `${s.samples.length} lecturas aceptadas` : "sin lecturas aún"} />
        </section>

        <MesoPanel />

        <HuntPanel level={m.latest?.level ?? null} ratePerHour={m.ratePerHour} expToNext={m.expToNext} />

        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
            <h2 className="text-lg font-bold">EXP ganada en el tiempo</h2>
            <ExpChart samples={s.samples} />
          </section>
          <LogPanel />
        </div>

        {!m.latest && <GettingStarted />}

        <div className="grid gap-5 lg:grid-cols-2">
          <ManualEntry />
          <StreamInfo />
        </div>

        {debug && <DebugPanel />}
        <Privacy />
      </main>
    </div>
  );
}

function confirmNew() {
  return window.confirm("¿Empezar una sesión nueva? Las lecturas de la sesión actual se borran.");
}

function CaptureChip() {
  const s = useSession();
  const now = useNow(1000);
  const label =
    s.capture === "sharing"
      ? s.paused
        ? "En pausa"
        : s.nextReadAt
          ? `Leyendo en ${Math.max(0, Math.ceil((s.nextReadAt - now) / 1000))} s`
          : "Compartiendo"
      : s.capture === "requesting"
        ? "Elige la ventana…"
        : "Sin compartir";
  const dot = s.capture === "sharing" && !s.paused ? "bg-good" : s.capture === "error" ? "bg-bad" : "bg-ink-soft";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-sm font-bold" aria-live="polite">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function Stat({ label, value, hint, big = false }: { label: string; value: string; hint: string; big?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${big ? "border-tile bg-panel" : "border-line bg-panel"}`}>
      <p className="text-sm font-bold text-ink-soft">{label}</p>
      <p className={`mt-1 font-extrabold leading-none ${big ? "text-4xl" : "text-3xl"}`}>{value}</p>
      <p className="mt-2 text-xs text-ink-soft">{hint}</p>
    </div>
  );
}

function MesoPanel() {
  const s = useSession();
  const now = useNow(1000);
  const mm = computeMesoMetrics(s.mesoSamples, now);
  const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmtInt(Math.abs(n));
  const hhmm = (t: number) => new Date(t).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false });
  const rebase = () => {
    if (window.confirm("¿Usar el total actual como mesos iniciales? Se borra el historial de mesos de esta sesión.")) store.rebaseMesos();
  };
  return (
    <section aria-label="Mesos" className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <MesoCoin /> Mesos
        </h2>
        <p className="text-sm text-ink-soft">{s.capture === "sharing" ? s.mesoStatus : "Se miden cuando el inventario está abierto"}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4 lg:grid-cols-4">
        <div>
          <p className="text-sm font-bold text-ink-soft">Al iniciar</p>
          <p className="text-2xl font-extrabold sm:text-3xl">{mm.start !== null ? fmtInt(mm.start) : "–"}</p>
          <p className="text-xs text-ink-soft">{mm.startAt !== null ? `leído a las ${hhmm(mm.startAt)}` : "primera lectura confirmada"}</p>
        </div>
        <div>
          <p className="text-sm font-bold text-ink-soft">Ahora</p>
          <p className="text-2xl font-extrabold sm:text-3xl">{mm.current !== null ? fmtInt(mm.current) : "–"}</p>
          <p className="text-xs text-ink-soft">{mm.peak !== null && mm.peak !== mm.current ? `máximo ${fmtInt(mm.peak)}` : `${s.mesoSamples.length} lecturas`}</p>
        </div>
        <div>
          <p className="text-sm font-bold text-ink-soft">Ganado en la sesión</p>
          <p className={`text-2xl font-extrabold sm:text-3xl ${mm.net < 0 ? "text-bad" : ""}`}>{mm.current !== null ? signed(mm.net) : "–"}</p>
          <p className="text-xs text-ink-soft">ahora menos al iniciar</p>
        </div>
        <div>
          <p className="text-sm font-bold text-ink-soft">Mesos por hora</p>
          <p className="text-2xl font-extrabold sm:text-3xl">{mm.perHour !== null ? (mm.perHour < 0 ? "−" : "+") + fmtCompact(Math.abs(mm.perHour)) : "–"}</p>
          <p className="text-xs text-ink-soft">últimos 5 minutos, incluye compras</p>
        </div>
      </div>
      <div className="mt-4">
        <MesoChart samples={s.mesoSamples} />
      </div>
      {mm.current !== null && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-soft">
          <p>¿El inicio no corresponde a lo que tenías? Puedes fijarlo de nuevo.</p>
          <button onClick={rebase} className="rounded-lg border border-line px-2.5 py-1 font-bold text-ink">
            Usar el total actual como inicio
          </button>
        </div>
      )}
    </section>
  );
}

/** Moneda simple (dibujo propio). */
function MesoCoin() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
      <circle cx="10" cy="10" r="8.5" fill="#f5c542" stroke="#a8740c" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="4.5" fill="none" stroke="#a8740c" strokeWidth="1.2" />
    </svg>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone: "bad" }) {
  return (
    <div role="alert" className={`mb-4 rounded-xl border-2 px-4 py-3 font-bold ${tone === "bad" ? "border-bad text-bad" : ""} bg-panel`}>
      {children}
    </div>
  );
}

function LogPanel() {
  const s = useSession();
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Lecturas recientes</h2>
        <button
          onClick={() => tracker.tick(true)}
          disabled={s.capture !== "sharing"}
          className="rounded-lg border border-line px-2.5 py-1 text-sm font-bold disabled:opacity-40"
        >
          Leer ahora
        </button>
      </div>
      {s.log.length === 0 ? (
        <p className="mt-6 text-ink-soft">Cada 10 segundos aparece aquí lo que se leyó del HUD, aceptado o no.</p>
      ) : (
        <ol className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1 text-sm">
          {s.log.map((e, i) => (
            <li key={e.t + "-" + i} className="flex gap-2">
              <span className="w-16 shrink-0 text-ink-soft">{new Date(e.t).toLocaleTimeString("es-CL", { hour12: false })}</span>
              <span className={`shrink-0 font-bold ${e.ok ? "text-good" : "text-bad"}`}>{e.ok ? "✓" : "✗"}</span>
              <span className="min-w-0">
                {e.text}
                {e.source === "neural" && <span className="text-ink-soft"> (Tesseract)</span>}
                {e.reason && <span className="block text-ink-soft">{e.reason}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function GettingStarted() {
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 sm:p-6">
      <h2 className="text-lg font-bold">Cómo empezar</h2>
      <ol className="mt-3 grid gap-4 sm:grid-cols-3">
        <li>
          <p className="font-bold">1. Comparte el juego</p>
          <p className="text-sm text-ink-soft">Presiona «Compartir ventana del juego» y elige la ventana de MapleStory. No se captura audio.</p>
        </li>
        <li>
          <p className="font-bold">2. Deja el HUD visible</p>
          <p className="text-sm text-ink-soft">
            El nivel y la EXP se ubican solos en la barra inferior. Usa la escala de HUD «Ideal» en el juego para la mejor lectura.
          </p>
        </li>
        <li>
          <p className="font-bold">3. Juega con esta pestaña abierta</p>
          <p className="text-sm text-ink-soft">Cada 10 segundos se lee un frame. Las lecturas dudosas se descartan en vez de adivinarse.</p>
        </li>
      </ol>
    </section>
  );
}

function ManualEntry() {
  const [level, setLevel] = useState("");
  const [exp, setExp] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const l = Number(level);
    const x = Number(exp.replace(/[.,\s]/g, ""));
    if (!Number.isInteger(l) || l < 1 || l > 100) return setErr("El nivel va de 1 a 100.");
    if (!Number.isInteger(x) || x < 0 || (l < 100 && x > requiredExp(l))) return setErr(`La EXP del nivel ${l} va de 0 a ${fmtInt(requiredExp(l))}.`);
    setErr(null);
    tracker.addManual(l, x);
    setExp("");
  };
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <h2 className="text-lg font-bold">Agregar lectura a mano</h2>
      <p className="mt-1 text-sm text-ink-soft">Para corregir una lectura o usar el tracker sin compartir pantalla.</p>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm font-bold">
          Nivel
          <input inputMode="numeric" value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1 block w-20 rounded-lg border border-line bg-sky px-2 py-1.5 font-normal" />
        </label>
        <label className="text-sm font-bold">
          EXP del nivel
          <input inputMode="numeric" value={exp} onChange={(e) => setExp(e.target.value)} placeholder="221.609" className="mt-1 block w-36 rounded-lg border border-line bg-sky px-2 py-1.5 font-normal" />
        </label>
        <button className="rounded-lg bg-ink px-3 py-1.5 font-bold text-sky">Agregar</button>
      </form>
      {err && <p className="mt-2 text-sm font-bold text-bad">{err}</p>}
    </section>
  );
}

function StreamInfo() {
  const open = () => window.open(`${location.pathname}?card=1`, "maple-track-card", "width=560,height=260");
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <h2 className="text-lg font-bold">Tarjeta para stream</h2>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">
        Abre una ventana compacta con nivel, EXP/hora y tiempo para subir. En OBS agrégala como «Captura de ventana» (no como fuente de
        navegador) y deja ambas ventanas abiertas en el mismo perfil del navegador.
      </p>
      <button onClick={open} className="mt-3 rounded-lg border border-line px-3 py-1.5 font-bold">
        Abrir tarjeta
      </button>
    </section>
  );
}

function Privacy() {
  return (
    <details className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <summary className="cursor-pointer font-bold">¿Es seguro?</summary>
      <div className="mt-3 max-w-prose space-y-2 text-sm text-ink-soft">
        <p>Todo corre en tu navegador. Los frames y las lecturas no se suben a ningún servidor; no hay backend, cuentas ni analítica.</p>
        <p>
          Solo se leen píxeles visibles, como mirar una captura de pantalla. No se toca la memoria ni los archivos del juego, no se inyecta
          código y no se envían teclas ni clics al juego.
        </p>
        <p>Tú eliges qué compartir en el selector del navegador, cada vez. Las sesiones quedan guardadas en este navegador.</p>
        <p>Proyecto comunitario, sin relación con Nexon.</p>
      </div>
    </details>
  );
}

/** Hoja de arce simple (dibujo propio). */
function MapleLeaf() {
  return (
    <svg viewBox="0 0 40 40" className="h-10 w-10" aria-hidden>
      <path
        d="M20 3l3.2 7.6 5.3-2.4-1.6 8.3 7.3-2.1-2.9 6.4 4.7 2.2-9.3 4.6 1.2 4.4-6.7-1.6.6 6.6h-3.6l.6-6.6-6.7 1.6 1.2-4.4-9.3-4.6 4.7-2.2-2.9-6.4 7.3 2.1-1.6-8.3 5.3 2.4z"
        fill="var(--tile)"
        stroke="var(--tile-deep)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
