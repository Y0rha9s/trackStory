import { useEffect, useMemo, useState } from "react";
import { CLASSES, SLOTS, blockedItems, classOf, describeItem, diffBuilds, evaluate, nextUpgrades, osmsItemUrl, project, validBuild, type Build, type ClassDef, type GearItem, type Blocked, type ItemSources, type SlotKey, type Stats } from "../core/gear";
import { loadGear, loadItemSources } from "../data/loader";
import { fmtInt } from "../hooks";
import { NumberInput } from "./NumberInput";
import { characters, useCharacters, type GearForm } from "../characters";

const STAT_LABEL: Record<keyof Stats, string> = { str: "STR", dex: "DEX", int: "INT", luk: "LUK" };
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)} %`;

/** Estilo "scouter": tus stats y equipo → daño estimado, qué tan lejos estás del óptimo y qué equipo viene en los próximos niveles. */
export function GearPanel({ detectedLevel }: { detectedLevel: number | null }) {
  const { active } = useCharacters();
  const form = active.gear;
  const [items, setItems] = useState<GearItem[] | null>(null);
  const [sources, setSources] = useState<ItemSources | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  const load = () => {
    setStatus("loading");
    void loadItemSources().then(setSources);
    loadGear()
      .then((g) => {
        setItems(g);
        setStatus("idle");
      })
      .catch((e: Error) => {
        setError(e.message);
        setStatus("error");
      });
  };
  useEffect(() => {
    load();
  }, []);

  const cls = classOf(form.classId);
  const set = (patch: Partial<GearForm>) => characters.updateGear(patch);
  const opt = { defense: form.balanced ? 1 : 0, extraAtk: form.extraAtk };

  const hiddenSet = useMemo(() => new Set(form.hidden), [form.hidden]);
  const visible = useMemo(() => (items ? items.filter((i) => !hiddenSet.has(i.id)) : null), [items, hiddenSet]);
  const hide = (id: number) => set({ hidden: [...new Set([...form.hidden, id])], equipped: Object.fromEntries(Object.entries(form.equipped).filter(([, v]) => v !== id)) });
  const unhide = (id: number) => set({ hidden: form.hidden.filter((h) => h !== id) });

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const build: Build = useMemo(() => {
    const b: Build = {};
    for (const { key } of SLOTS) {
      const id = form.equipped[key];
      if (id && byId.has(id)) b[key] = byId.get(id)!;
    }
    return b;
  }, [form.equipped, byId]);

  const result = useMemo(() => {
    if (!visible) return null;
    const mine = evaluate(cls, form.stats, build, form.extraAtk);
    const timeline = project(cls, form.level, form.stats, visible, opt, 20, form.apToPrimary);
    const next = nextUpgrades(cls, form.level, form.stats, visible, opt, timeline[0].build, 20, form.apToPrimary);
    const blocked = blockedItems(cls, form.level, form.stats, visible, timeline[0].build);
    return { mine, timeline, next, blocked };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, cls, form.level, form.stats, form.extraAtk, form.balanced, form.apToPrimary, build]);

  const best = result?.timeline[0];
  const bestEval = best ? evaluate(cls, form.stats, best.build, form.extraAtk) : null;
  const ratio = result && bestEval && bestEval.damage > 0 ? result.mine.damage / bestEval.damage : null;
  const valid = validBuild(build);

  const optionsFor = (slot: SlotKey) =>
    (visible ?? []).filter((i) => i.slot === slot && (i.reqLevel <= form.level || form.equipped[slot] === i.id) && (i.reqJob === 0 || (i.reqJob & cls.jobBit) !== 0) && (slot !== "Weapon" || cls.weapons.includes(i.weaponType ?? ""))).sort((a, b) => b.reqLevel - a.reqLevel || a.name.localeCompare(b.name));

  return (
    <section aria-label="Equipo y daño" className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Equipo y daño</h2>
        <p className="text-sm text-ink-soft">Datos de equipos: OSMS Data Explorer. Daño: fórmulas de MapleStory Classic según MeowDB (golpe máximo, habilidad al 100 %).</p>
      </div>

      {status === "loading" && <p className="mt-3 text-sm text-ink-soft">Cargando equipos…</p>}
      {status === "error" && (
        <p className="mt-3 text-sm text-bad">
          No se pudieron cargar los equipos ({error}).{" "}
          <button onClick={load} className="font-bold underline">
            Reintentar
          </button>
        </p>
      )}

      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-bold text-ink-soft">
              Clase
              <select value={form.classId} onChange={(e) => set({ classId: e.target.value as GearForm["classId"], equipped: {} })} className="mt-1 w-full rounded-lg border border-line bg-panel px-2 py-1.5 font-normal text-ink">
                {CLASSES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold text-ink-soft">
              Nivel
              <div className="mt-1 flex gap-1">
                <NumberInput value={form.level} min={1} max={100} onChange={(level) => set({ level })} />
                {detectedLevel !== null && detectedLevel !== form.level && (
                  <button onClick={() => set({ level: detectedLevel })} title="Usar el nivel leído del juego" className="rounded-lg border border-line px-2 text-xs font-bold text-ink">
                    {detectedLevel}
                  </button>
                )}
              </div>
            </label>
          </div>

          <div>
            <p className="text-sm font-bold text-ink-soft">Stats base (los que repartiste con AP, sin equipo)</p>
            <div className="mt-1 grid grid-cols-4 gap-2">
              {(Object.keys(STAT_LABEL) as (keyof Stats)[]).map((k) => (
                <label key={k} className={`text-xs font-bold ${k === cls.primary ? "text-tile" : "text-ink-soft"}`}>
                  {STAT_LABEL[k]}
                  <NumberInput value={form.stats[k]} min={0} max={999} onChange={(v) => set({ stats: { ...form.stats, [k]: v } })} />
                </label>
              ))}
            </div>
          </div>

          <label className="block text-sm font-bold text-ink-soft">
            {cls.magic ? "Ataque mágico extra" : "Ataque extra"} (pergaminos, pociones)
            <NumberInput value={form.extraAtk} min={0} max={999} onChange={(extraAtk) => set({ extraAtk })} />
          </label>

          <div className="space-y-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.apToPrimary} onChange={(e) => set({ apToPrimary: e.target.checked })} />
              Proyectar con 5 AP por nivel al stat principal ({STAT_LABEL[cls.primary]})
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.balanced} onChange={(e) => set({ balanced: e.target.checked })} />
              Tener en cuenta la defensa (si no, solo importa el daño)
            </label>
          </div>

          <div>
            <p className="text-sm font-bold text-ink-soft">Tu equipo puesto</p>
            <div className="mt-1 space-y-1.5">
              {SLOTS.map(({ key, label }) => (
                <label key={key} className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs font-bold text-ink-soft">
                  {label}
                  <select
                    value={form.equipped[key] ?? ""}
                    disabled={!items}
                    onChange={(e) => {
                      const eq = { ...form.equipped };
                      if (e.target.value) eq[key] = Number(e.target.value);
                      else delete eq[key];
                      set({ equipped: eq });
                    }}
                    className="min-w-0 rounded-lg border border-line bg-panel px-1.5 py-1 font-normal text-ink"
                  >
                    <option value="">— nada —</option>
                    {optionsFor(key).map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} (nv {i.reqLevel})
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {!valid && <p className="mt-1 text-xs text-bad">Combinación imposible (2H weapon + Shield, o Overall + Top/Bottom).</p>}
          </div>
        </div>

        <div className="space-y-4">
          {!result && status !== "error" && <p className="text-sm text-ink-soft">Esperando los datos de equipos…</p>}
          {result && best && bestEval && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label={cls.magic ? "Tu daño máximo (hechizo base)" : "Tu golpe máximo"} value={fmtInt(Math.round(result.mine.damage))} hint={`ataque ${result.mine.watk + result.mine.matk + form.extraAtk} · defensa ${result.mine.pdd}`} />
                <Stat
                  label="Frente al óptimo de tu nivel"
                  value={ratio !== null ? `${Math.round(ratio * 100)} %` : "–"}
                  hint={`óptimo: ${fmtInt(Math.round(bestEval.damage))}`}
                  tone={ratio !== null && ratio >= 0.95 ? "good" : undefined}
                />
              </div>

              <Section title={`Mejor equipo para nivel ${form.level}`}>
                <BuildTable build={best.build} mine={build} next={result.next} blocked={result.blocked} cls={cls} sources={sources} onHide={hide} />
                <HiddenList ids={form.hidden} byId={byId} onRestore={unhide} />
              </Section>

              <Section title="Lo que viene">
                {[5, 10].map((n) => {
                  const p = result.timeline[n];
                  const steps = diffBuilds(best.build, p.build);
                  return (
                    <div key={n} className="mb-3">
                      <p className="text-sm font-bold">
                        Nivel {p.level} (+{n}){" "}
                        <span className="text-good">{pct(((p.damage - bestEval.damage) / bestEval.damage) * 100)} de daño</span>
                      </p>
                      {steps.length === 0 ? (
                        <p className="text-xs text-ink-soft">Sin cambios de equipo respecto a ahora.</p>
                      ) : (
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {steps.map((d) => (
                            <li key={d.slot}>
                              <span className="font-bold text-ink-soft">{SLOTS.find((s) => s.key === d.slot)?.label}:</span> {d.to ? <ItemLink item={d.to} cls={cls} sources={sources} /> : "sin ítem"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
                <Milestones timeline={result.timeline} cls={cls} sources={sources} />
              </Section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** Niveles en que cambia el equipo óptimo (ahí aparecen escalones como 45, 55, 65). */
function Milestones({ timeline, cls, sources }: { timeline: ReturnType<typeof project>; cls: ClassDef; sources: ItemSources | null }) {
  const rows = timeline.slice(1).flatMap((p, i) => {
    const d = diffBuilds(timeline[i].build, p.build);
    return d.length ? [{ level: p.level, d }] : [];
  });
  if (!rows.length) return null;
  return (
    <div className="border-t border-line pt-2">
      <p className="text-sm font-bold">Escalones de equipo</p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {rows.map((r) => (
          <li key={r.level}>
            <span className="font-bold">Nv {r.level}:</span> {r.d.map((x, i) => (
              <span key={x.slot}>
                {i > 0 && ", "}
                {x.to ? <ItemLink item={x.to} cls={cls} sources={sources} /> : "sin ítem"}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ítem con enlace a su ficha en OSMS (drops) y tooltip con precio, receta y quest. */
function ItemLink({ item, cls, sources, onHide }: { item: GearItem; cls: ClassDef; sources: ItemSources | null; onHide?: (id: number) => void }) {
  const link = (
    <a href={osmsItemUrl(item, cls)} target="_blank" rel="noreferrer" title={describeItem(item, sources)} className="underline decoration-dotted underline-offset-2 hover:text-tile">
      {item.name} <span className="text-xs text-ink-soft">(nv {item.reqLevel})</span>
    </a>
  );
  if (!onHide) return link;
  return (
    <span>
      {link}{" "}
      <button onClick={() => onHide(item.id)} title="No existe en Classic: ocultarlo y recalcular" aria-label={`Ocultar ${item.name}`} className="rounded px-1 text-xs font-bold text-ink-soft hover:text-bad">
        ✕
      </button>
    </span>
  );
}

function HiddenList({ ids, byId, onRestore }: { ids: number[]; byId: Map<number, GearItem>; onRestore: (id: number) => void }) {
  if (!ids.length) return null;
  return (
    <p className="mt-2 text-xs text-ink-soft">
      Ocultos (no existen en Classic):{" "}
      {ids.map((id) => (
        <button key={id} onClick={() => onRestore(id)} title="Volver a incluirlo" className="mr-2 underline">
          {byId.get(id)?.name ?? id} ↩
        </button>
      ))}
    </p>
  );
}

function BuildTable({ build, mine, next: nextBy, blocked, cls, sources, onHide }: { build: Build; mine: Build; next: Partial<Record<SlotKey, GearItem>>; blocked: Partial<Record<SlotKey, Blocked>>; cls: ClassDef; sources: ItemSources | null; onHide: (id: number) => void }) {
  const rows = SLOTS.filter(({ key }) => build[key] || nextBy[key] || blocked[key]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-ink-soft">
            <th className="pb-1 pr-3 font-bold">Slot</th>
            <th className="pb-1 pr-3 font-bold">Mejor ahora</th>
            <th className="pb-1 font-bold">Próximo equipo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label }) => {
            const it = build[key];
            const next = nextBy[key];
            const same = it && mine[key]?.id === it.id;
            return (
              <tr key={key} className="border-t border-line align-top">
                <td className="py-1.5 pr-3 font-bold text-ink-soft">{label}</td>
                <td className="py-1.5 pr-3">
                  {it ? <ItemLink item={it} cls={cls} sources={sources} onHide={onHide} /> : <span className="text-ink-soft">—</span>}
                  {it && <div className={`text-xs font-bold ${same ? "text-good" : "text-ink-soft"}`}>{same ? "ya lo tienes" : mine[key] ? `cambiar ${mine[key]!.name}` : "te falta"}</div>}
                  {blocked[key] && (
                    <div className="text-xs text-bad">
                      Bloqueado por stats: {blocked[key]!.item.name} (nv {blocked[key]!.item.reqLevel}), te falta {blocked[key]!.missing.join(", ")}
                    </div>
                  )}
                </td>
                <td className="py-1.5">{next ? <ItemLink item={next} cls={cls} sources={sources} onHide={onHide} /> : <span className="text-xs text-ink-soft">sin mejora en los próximos 20 niveles</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <h3 className="mb-2 font-bold">{title}</h3>
      {children}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "good" }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-xs font-bold text-ink-soft">{label}</p>
      <p className={`text-2xl font-extrabold ${tone === "good" ? "text-good" : ""}`}>{value}</p>
      <p className="text-xs text-ink-soft">{hint}</p>
    </div>
  );
}
