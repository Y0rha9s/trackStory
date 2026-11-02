import { useEffect, useMemo, useState } from "react";
import { characters, useCharacters } from "../characters";
import { CLASSES, type ItemSources } from "../core/gear";
import { buildGuide } from "../core/guide";
import { requiredExp } from "../core/expTable";
import { buildPrevMap, chainOf, forMyClass, pendingChain, statusOf, type Quest, type QuestStatus } from "../core/quests";
import { loadItemSources, loadQuests, loadWorld } from "../data/loader";
import type { World } from "../data/world";
import { fmtInt } from "../hooks";
import { NumberInput } from "./NumberInput";

type View = "available" | "soon" | "done" | "all";
type Sort = "level-desc" | "exp" | "level" | "region";

const VIEWS: { id: View; label: string }[] = [
  { id: "available", label: "Disponibles ahora" },
  { id: "soon", label: "Próximas (+10 niveles)" },
  { id: "done", label: "Hechas" },
  { id: "all", label: "Todas" },
];
const KIND_LABEL = { normal: "", daily: "Diaria", weekly: "Semanal", repeat: "Repetible" } as const;
const STATUS_LABEL: Record<QuestStatus, string> = { done: "Hecha", available: "Disponible", "locked-prereq": "Falta una quest previa", "locked-level": "Nivel muy bajo" };
const MAX_ROWS = 200;

interface Row {
  q: Quest;
  status: QuestStatus;
}

/** Guía de quests: qué hacer ahora según tu nivel y clase, con progreso por personaje. */
export function QuestsPanel({ detectedLevel }: { detectedLevel: number | null }) {
  const { active } = useCharacters();
  const level = active.gear.level;
  const classId = active.gear.classId;
  const [quests, setQuests] = useState<Quest[] | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("available");
  const [sort, setSort] = useState<Sort>("level-desc");
  const [region, setRegion] = useState("");
  const [query, setQuery] = useState("");
  const [repeatables, setRepeatables] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [itemSrc, setItemSrc] = useState<ItemSources | null>(null);

  const load = () => {
    setError("");
    loadQuests().then(setQuests, (e: Error) => setError(e.message));
  };
  useEffect(load, []);
  // Los mapas y mobs son opcionales: sin ellos el detalle solo no dice dónde.
  useEffect(() => {
    loadWorld().then(
      (r) => setWorld(r.world),
      () => undefined,
    );
    void loadItemSources().then(setItemSrc);
  }, []);

  const done = useMemo(() => new Set(active.questsDone), [active.questsDone]);
  const known = useMemo(() => new Set((quests ?? []).map((q) => q.id)), [quests]);
  const byId = useMemo(() => new Map((quests ?? []).map((q) => [q.id, q])), [quests]);
  const prevMap = useMemo(() => buildPrevMap(quests ?? []), [quests]);
  const regions = useMemo(() => [...new Set((quests ?? []).filter((q) => forMyClass(q, classId)).map((q) => q.region))].sort(), [quests, classId]);

  const rows: Row[] = useMemo(() => {
    if (!quests) return [];
    const ctx = { level, classId, done, known };
    const needle = query.trim().toLowerCase();
    return quests
      .filter((q) => forMyClass(q, classId) && (!region || q.region === region) && (repeatables || q.kind === "normal") && (!needle || `${q.name} ${q.npc} ${q.region}`.toLowerCase().includes(needle)))
      .map((q) => ({ q, status: statusOf(q, ctx) }))
      .filter(({ q, status }) => {
        if (q.region === "Event" && view !== "all" && !region) return false;
        if (view === "available") return status === "available";
        if (view === "done") return status === "done";
        if (view === "soon") return status !== "done" && status !== "available" && q.levelMin <= level + 10;
        return true;
      })
      .sort((a, b) => {
        if (sort === "level-desc") return b.q.levelMin - a.q.levelMin || b.q.exp - a.q.exp;
        if (sort === "exp") return b.q.exp - a.q.exp;
        if (sort === "level") return a.q.levelMin - b.q.levelMin || b.q.exp - a.q.exp;
        return a.q.region.localeCompare(b.q.region) || a.q.levelMin - b.q.levelMin;
      });
  }, [quests, level, classId, done, known, view, sort, region, query, repeatables]);

  // Con orden por nivel se agrupa bajo un título "Nivel N"; "de tu nivel hacia abajo" es el orden por defecto.
  const groups = useMemo(() => {
    const out: { key: string; title: string | null; rows: Row[] }[] = [];
    for (const r of rows.slice(0, MAX_ROWS)) {
      const byLevel = sort === "level-desc" || sort === "level";
      const key = byLevel ? `L${r.q.levelMin}` : sort === "region" ? r.q.region : "all";
      let g = out.at(-1);
      if (!g || g.key !== key) {
        g = { key, title: byLevel ? (r.q.levelMin ? `Nivel ${r.q.levelMin}` : "Sin nivel mínimo") : sort === "region" ? r.q.region : null, rows: [] };
        out.push(g);
      }
      g.rows.push(r);
    }
    return out;
  }, [rows, sort]);

  const availableExp = rows.reduce((n, { q, status }) => n + (status === "available" ? q.exp : 0), 0);
  const req = requiredExp(level);

  return (
    <section aria-label="Guía de quests" className="space-y-4">
      <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <h2 className="text-lg font-bold">Guía de quests</h2>
            <p className="text-sm text-ink-soft">
              {active.name} · {CLASSES.find((c) => c.id === classId)?.label}. Datos: OSMS Data Explorer. Toca una quest para ver cómo completarla.
            </p>
          </div>
          <label className="w-28 text-sm font-bold text-ink-soft">
            Nivel
            <div className="flex gap-1">
              <NumberInput value={level} min={1} max={100} onChange={(l) => characters.updateGear({ level: l })} />
              {detectedLevel !== null && detectedLevel !== level && (
                <button onClick={() => characters.updateGear({ level: detectedLevel })} title="Usar el nivel leído del juego" className="mt-1 rounded-lg border border-line px-2 text-xs font-bold text-ink">
                  {detectedLevel}
                </button>
              )}
            </div>
          </label>
          <div className="ml-auto text-right">
            <p className="text-xs font-bold text-ink-soft">EXP en esta lista (disponibles)</p>
            <p className="text-2xl font-extrabold">{fmtInt(availableExp)}</p>
            {req > 0 && <p className="text-xs text-ink-soft">≈ {((availableExp / req) * 100).toFixed(0)} % de un nivel {level}</p>}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div role="tablist" className="flex flex-wrap gap-1">
            {VIEWS.map((v) => (
              <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)} className={`rounded-lg border px-3 py-1 text-sm font-bold ${view === v.id ? "border-tile bg-tile text-white" : "border-line"}`}>
                {v.label}
              </button>
            ))}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border border-line bg-panel px-2 py-1 text-sm" aria-label="Ordenar">
            <option value="level-desc">Por nivel: de tu nivel hacia abajo</option>
            <option value="level">Por nivel: de menor a mayor</option>
            <option value="exp">Más EXP primero</option>
            <option value="region">Por zona</option>
          </select>
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="rounded-lg border border-line bg-panel px-2 py-1 text-sm" aria-label="Zona">
            <option value="">Todas las zonas</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar quest o NPC…" className="min-w-40 flex-1 rounded-lg border border-line bg-panel px-2 py-1 text-sm" />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={repeatables} onChange={(e) => setRepeatables(e.target.checked)} />
            Diarias y semanales
          </label>
        </div>
      </div>

      {error && (
        <p className="text-sm text-bad">
          No se pudieron cargar las quests ({error}).{" "}
          <button onClick={load} className="font-bold underline">
            Reintentar
          </button>
        </p>
      )}
      {!quests && !error && <p className="text-sm text-ink-soft">Cargando quests…</p>}
      {quests && rows.length === 0 && <p className="rounded-2xl border border-line bg-panel p-4 text-ink-soft">No hay quests con estos filtros.</p>}

      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.key}>
            {g.title && <h3 className="mb-2 text-sm font-extrabold text-ink-soft">{g.title}</h3>}
            <ul className="grid items-start gap-3 lg:grid-cols-2">
              {g.rows.map(({ q, status }) => (
                <QuestCard
                  key={q.id}
                  q={q}
                  status={status}
                  level={level}
                  req={req}
                  expanded={open === q.id}
                  onToggleOpen={() => setOpen(open === q.id ? null : q.id)}
                  byId={byId}
                  done={done}
                  known={known}
                  world={world}
                  prev={prevMap}
                  itemSrc={itemSrc}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
      {rows.length > MAX_ROWS && <p className="text-sm text-ink-soft">Se muestran {MAX_ROWS} de {rows.length}; usa los filtros para acotar.</p>}
    </section>
  );
}

function QuestCard({
  q,
  status,
  level,
  req,
  expanded,
  onToggleOpen,
  byId,
  done,
  known,
  world,
  prev,
  itemSrc,
}: {
  q: Quest;
  status: QuestStatus;
  level: number;
  req: number;
  expanded: boolean;
  onToggleOpen: () => void;
  byId: ReadonlyMap<string, Quest>;
  done: ReadonlySet<string>;
  known: ReadonlySet<string>;
  world: World | null;
  prev: ReadonlyMap<string, Quest>;
  itemSrc: ItemSources | null;
}) {
  const need = [...q.mobReqs.map((m) => `${m.count}× ${m.name}`), ...q.itemReqs.map((i) => `${i.count}× ${i.name}`)];
  const next = q.nextId ? byId.get(q.nextId) : undefined;
  const expPct = req > 0 && q.exp > 0 ? (q.exp / req) * 100 : null;
  const blocked = q.prereqs.filter((p) => known.has(p.id) && !done.has(p.id));
  return (
    <li className={`rounded-2xl border bg-panel p-4 ${status === "available" ? "border-tile" : "border-line"} ${status === "done" ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={status === "done"} onChange={() => characters.toggleQuest(q.id)} aria-label={`Marcar "${q.name}" como hecha`} className="mt-1.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <button onClick={onToggleOpen} aria-expanded={expanded} className="w-full text-left">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-bold">{q.name}</span>
              {KIND_LABEL[q.kind] && <span className="rounded bg-line px-1.5 text-xs font-bold">{KIND_LABEL[q.kind]}</span>}
              <span className="ml-auto text-xs font-bold text-ink-soft">{expanded ? "▲ Ocultar" : "▼ Cómo completarla"}</span>
            </span>
            <span className="block text-sm text-ink-soft">
              {q.region} · {q.npc || "—"} · nivel {q.levelMin || "—"}
            </span>
          </button>

          <p className="mt-2 text-sm">
            {q.exp > 0 && (
              <span className="mr-3 font-bold">
                {fmtInt(q.exp)} EXP{expPct !== null && <span className="font-normal text-ink-soft"> ({expPct.toFixed(1)} % del nv {level})</span>}
              </span>
            )}
            {q.money > 0 && <span className="mr-3">{fmtInt(q.money)} mesos</span>}
            {q.rewardItems && <span className="text-ink-soft">{q.rewardItems}</span>}
          </p>

          {need.length > 0 && (
            <p className="mt-1 text-sm">
              <span className="font-bold text-ink-soft">Necesitas: </span>
              {need.join(" · ")}
            </p>
          )}
          {next && (
            <p className="mt-1 text-xs text-ink-soft">
              Continúa con <span className="font-bold">{next.name}</span> (nv {next.levelMin || "—"})
            </p>
          )}

          {status !== "available" && status !== "done" && (
            <p className="mt-1 text-xs font-bold text-bad">
              {STATUS_LABEL[status]}
              {status === "locked-prereq" && `: ${blocked.map((b) => b.name).join(", ")}`}
              {status === "locked-level" && ` (pide nivel ${q.levelMin})`}
            </p>
          )}

          {expanded && <QuestSteps q={q} next={next} level={level} byId={byId} done={done} world={world} prev={prev} itemSrc={itemSrc} />}
        </div>
      </div>
    </li>
  );
}

/** Recorrido paso a paso (NPC, mapas, ticket, mobs, entrega), generado con los datos públicos de OSMS. */
function QuestSteps({
  q,
  next,
  level,
  byId,
  done,
  world,
  prev,
  itemSrc,
}: {
  q: Quest;
  next: Quest | undefined;
  level: number;
  byId: ReadonlyMap<string, Quest>;
  done: ReadonlySet<string>;
  world: World | null;
  prev: ReadonlyMap<string, Quest>;
  itemSrc: ItemSources | null;
}) {
  const before = pendingChain(q, byId, done);
  const steps: { title: string; body: React.ReactNode }[] = buildGuide(q, next, { world, itemSrc, byId, done }, before).map((g) => ({
    title: g.title,
    body: (
      <div className="space-y-0.5 text-ink-soft">
        {g.lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
    ),
  }));
  // Si un mob del objetivo está muy por encima de tu nivel, se avisa.
  const hard = q.mobReqs.filter((m) => (world?.mobs.get(m.id)?.level ?? 0) > level + 5);
  if (hard.length) steps.push({ title: "Ojo con el nivel", body: <span className="text-bad">{hard.map((m) => m.name).join(", ")}: más de 5 niveles sobre el tuyo.</span> });

  const chain = chainOf(q, byId, prev);
  if (chain.length > 1) {
    const total = chain.reduce((n, c) => n + c.exp, 0);
    const needOf = (c: Quest) => [...c.mobReqs.map((m) => `${m.count}× ${m.name}`), ...c.itemReqs.map((x) => `${x.count}× ${x.name}`)];
    steps.push({
      title: `Cadena de ${chain.length} quests${next ? ": después sigue la siguiente" : ""}`,
      body: (
        <>
          <ol className="space-y-1">
            {chain.map((c, i) => (
              <li key={c.id} className={c.id === q.id ? "font-bold" : ""}>
                <span className="text-ink-soft">{i + 1}.</span> {done.has(c.id) ? "✓ " : ""}
                {c.name}
                <span className="font-normal text-ink-soft">
                  {" "}
                  (nv {c.levelMin || "—"}
                  {c.npc ? `, ${c.npc}` : ""}
                  {c.exp ? `, ${fmtInt(c.exp)} EXP` : ""})
                </span>
                {c.id === q.id && <span className="ml-1 rounded bg-tile px-1 text-xs text-white">esta</span>}
                {c.id !== q.id && !done.has(c.id) && needOf(c).length > 0 && <span className="block pl-4 text-xs font-normal text-ink-soft">Necesitas: {needOf(c).join(" · ")}</span>}
              </li>
            ))}
          </ol>
          {total > 0 && <p className="mt-1 text-xs text-ink-soft">EXP total de la cadena: {fmtInt(total)}</p>}
        </>
      ),
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-line p-3 text-sm">
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-tile text-xs font-extrabold text-white">{i + 1}</span>
            <div className="min-w-0">
              <p className="font-bold">{s.title}</p>
              <div>{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
      {q.description && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-bold">Historia</summary>
          <p className="mt-1 whitespace-pre-line text-xs text-ink-soft">{q.description}</p>
        </details>
      )}
    </div>
  );
}
