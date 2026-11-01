import { useEffect, useMemo, useState } from "react";
import { bestMapsFor, meowdbMapUrl, meowdbMobUrl, searchMaps, summarize, type MapSummary, type World } from "../data/world";
import { getCustomProxy, loadWorld, OSMS_CREDIT, resetWorld, setCustomProxy } from "../data/loader";
import { estimateHunt } from "../core/hunting";
import { fmtCompact, fmtInt } from "../hooks";

const MAP_KEY = "maple-track:map:v1";
const AUTO_KEY = "maple-track:osms-auto";

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignorar */
  }
};

/** Mapa actual, sus mobs (nivel, HP, EXP) y estimaciones de caza con tu EXP/hora real. */
export function HuntPanel({ level, ratePerHour, expToNext }: { level: number | null; ratePerHour: number | null; expToNext: number | null }) {
  const [world, setWorld] = useState<World | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [mapId, setMapId] = useState<number | null>(() => Number(read(MAP_KEY)) || null);

  const load = () => {
    setStatus("loading");
    loadWorld()
      .then((r) => {
        setWorld(r.world);
        setStatus("idle");
        write(AUTO_KEY, "1");
      })
      .catch((e: Error) => {
        setError(e.message);
        setStatus("error");
      });
  };
  useEffect(() => {
    if (read(AUTO_KEY)) load();
  }, []);

  const choose = (id: number) => {
    setMapId(id);
    write(MAP_KEY, String(id));
    setQuery("");
  };

  const summary = useMemo(() => (world && mapId ? summarize(world, mapId) : null), [world, mapId]);
  const results = useMemo(() => (world && query.trim().length >= 2 ? searchMaps(world, query) : []), [world, query]);
  const best = useMemo(() => (world && level ? bestMapsFor(world, level) : []), [world, level]);
  const est = summary ? estimateHunt(summary, ratePerHour, expToNext) : null;

  return (
    <section aria-label="Mapa y mobs" className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Mapa y mobs</h2>
        {summary && (
          <a href={meowdbMapUrl(summary.map.id)} target="_blank" rel="noreferrer" className="text-sm font-bold underline decoration-line underline-offset-4">
            Ver {summary.map.name} en NiaMeowDB
          </a>
        )}
      </div>

      {!world ? (
        <div className="mt-3">
          <p className="max-w-prose text-sm text-ink-soft">
            Elige el mapa donde estás cazando para ver sus mobs y estimar cuántos matas por hora. Los datos se descargan de OSMS Data
            Explorer en tu navegador y quedan guardados un día.
          </p>
          <button onClick={load} disabled={status === "loading"} className="mt-3 rounded-lg bg-ink px-3 py-1.5 font-bold text-sky disabled:opacity-50">
            {status === "loading" ? "Descargando mapas y mobs…" : "Cargar mapas y mobs"}
          </button>
          {status === "error" && (
            <p className="mt-3 text-sm text-bad">
              No se pudieron descargar los datos ({error}). Si el navegador bloquea el acceso directo, despliega el proyecto en Vercel
              (incluye un proxy en <code>/api/osms</code>) o configura un proxy abajo.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="relative mt-3">
            <label className="text-sm font-bold" htmlFor="map-search">
              {summary ? "Cambiar de mapa" : "¿Dónde estás cazando?"}
            </label>
            <input
              id="map-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nombre del mapa, ej. Ant Tunnel"
              className="mt-1 block w-full max-w-md rounded-lg border border-line bg-sky px-3 py-2"
              autoComplete="off"
            />
            {results.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-72 w-full max-w-md overflow-y-auto rounded-lg border border-line bg-panel shadow-lg">
                {results.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => choose(m.id)} className="block w-full px-3 py-2 text-left hover:bg-sky">
                      <span className="font-bold">{m.name}</span> <span className="text-sm text-ink-soft">{m.street}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {summary && <MapDetail s={summary} est={est} ratePerHour={ratePerHour} />}

          {best.length > 0 && (
            <div className="mt-5">
              <h3 className="font-bold">Mapas para nivel {level}</h3>
              <p className="text-sm text-ink-soft">Ordenados por EXP/hora máxima en solitario (matando todo lo que aparece).</p>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {best.map((b) => (
                  <li key={b.map.id}>
                    <button
                      onClick={() => choose(b.map.id)}
                      className={`w-full rounded-xl border px-3 py-2 text-left ${b.map.id === mapId ? "border-tile" : "border-line"} hover:bg-sky`}
                    >
                      <span className="block font-bold">{b.map.name}</span>
                      <span className="block text-sm text-ink-soft">
                        {b.mobs.map((m) => m.name).join(", ")} · nv {b.minLevel}
                        {b.maxLevel !== b.minLevel ? `–${b.maxLevel}` : ""}
                      </span>
                      <span className="block text-sm font-bold">hasta {fmtCompact(b.solo.exp)} EXP/h</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-soft">
        <p>
          {OSMS_CREDIT}. Enlaces: NiaMeowDB (meowdb.com). Techo por mapa calculado con la regla de MeowDB.
        </p>
        <ProxySetting
          onChange={() => {
            resetWorld();
            setWorld(null);
            load();
          }}
        />
      </div>
    </section>
  );
}

function MapDetail({ s, est, ratePerHour }: { s: MapSummary; est: ReturnType<typeof estimateHunt>; ratePerHour: number | null }) {
  const eff = est?.efficiency ?? null;
  return (
    <div className="mt-4">
      <p className="text-xl font-extrabold">
        {s.map.name} <span className="text-base font-bold text-ink-soft">{s.map.street}</span>
      </p>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4 lg:grid-cols-4">
        <Fig label="Mobs por hora" value={est?.killsPerHour != null ? `~${fmtInt(est.killsPerHour)}` : "–"} hint={ratePerHour ? "según tu EXP/hora" : "falta tu EXP/hora"} />
        <Fig label="Mobs para subir" value={est?.mobsToLevel != null ? `~${fmtInt(est.mobsToLevel)}` : "–"} hint={est?.main?.toLevel != null ? `o ${fmtInt(est.main.toLevel)} ${est.main.name}` : "mezcla según spawns"} />
        <Fig label="EXP por mob" value={est ? `~${fmtInt(est.avgExp)}` : "–"} hint="promedio según spawns" />
        <Fig
          label="Aprovechamiento del mapa"
          value={eff !== null ? `${Math.round(eff * 100)}%` : "–"}
          hint={`de ${fmtCompact(s.solo.exp)} EXP/h máx. en solitario`}
        />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="text-ink-soft">
            <tr>
              <th className="py-1.5 pr-3 font-bold">Mob</th>
              <th className="py-1.5 pr-3 text-right font-bold">Nivel</th>
              <th className="py-1.5 pr-3 text-right font-bold">HP</th>
              <th className="py-1.5 pr-3 text-right font-bold">EXP</th>
              <th className="py-1.5 pr-3 text-right font-bold">HP por EXP</th>
              <th className="py-1.5 text-right font-bold">Spawns</th>
            </tr>
          </thead>
          <tbody>
            {s.mobs.map((m) => (
              <tr key={m.id} className="border-t border-line">
                <td className="py-1.5 pr-3">
                  <a href={meowdbMobUrl(m.id)} target="_blank" rel="noreferrer" className="font-bold underline decoration-line underline-offset-4">
                    {m.name}
                  </a>
                  {m.timer && <span className="ml-1 text-ink-soft">(cada ~{Math.round(m.timer / 60)} min)</span>}
                </td>
                <td className="py-1.5 pr-3 text-right">{m.level}</td>
                <td className="py-1.5 pr-3 text-right">{fmtInt(m.hp)}</td>
                <td className="py-1.5 pr-3 text-right font-bold">{fmtInt(m.exp)}</td>
                <td className="py-1.5 pr-3 text-right">{m.exp ? (m.hp / m.exp).toLocaleString("es-CL", { maximumFractionDigits: 1 }) : "–"}</td>
                <td className="py-1.5 text-right">
                  {m.spawnPoints} ({Math.round(m.share)}%)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        Las estimaciones suponen que matas los mobs en la proporción en que aparecen y que juegas solo; en party la EXP se reparte.
        Techo del mapa: {fmtInt(s.solo.mobs)} mobs/h solo, {fmtInt(s.party.mobs)} en party completa.
      </p>
    </div>
  );
}

function Fig({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <p className="text-sm font-bold text-ink-soft">{label}</p>
      <p className="text-2xl font-extrabold sm:text-3xl">{value}</p>
      <p className="text-xs text-ink-soft">{hint}</p>
    </div>
  );
}

function ProxySetting({ onChange }: { onChange: () => void }) {
  const [v, setV] = useState(getCustomProxy());
  return (
    <details>
      <summary className="cursor-pointer">Origen de los datos</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="https://tu-proxy/osms/" className="w-64 rounded-lg border border-line bg-sky px-2 py-1 text-ink" />
        <button
          onClick={() => {
            setCustomProxy(v);
            onChange();
          }}
          className="rounded-lg border border-line px-2 py-1 font-bold text-ink"
        >
          Guardar y recargar
        </button>
      </div>
    </details>
  );
}
