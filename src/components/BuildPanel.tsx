import { useEffect, useMemo, useState } from "react";
import { characters, useCharacters } from "../characters";
import { effectRange, formatSteps, groupAp, JOBS, jobFor, parseSteps, planAp, secondJobsOf, skillRows, skillWhy, targetsAt, upcoming } from "../core/build";
import { CLASSES, classOf, type GearItem } from "../core/gear";
import { loadGear, loadSkills, loadWorld } from "../data/loader";
import { bestMapsFor, type World } from "../data/world";
import { fmtCompact } from "../hooks";
import { learnDigits, loadDigitTemplates, readSkillWindow, saveDigitTemplates } from "../ocr/skills";
import { tracker } from "../tracker/tracker";

const STAT = { str: "STR", dex: "DEX", int: "INT", luk: "LUK" } as const;

/** Qué hacer con AP, SP y dónde entrenar según el nivel del personaje (que sigue al tracker). */
export function BuildPanel({ detectedLevel }: { detectedLevel: number | null }) {
  const { active } = useCharacters();
  const { gear, build, autoLevel } = active;
  const level = gear.level;
  const cls = classOf(gear.classId);
  const job = jobFor(gear.classId, level, build.job);
  const variantIdx = Math.min(build.variant, job.variants.length - 1);
  const variant = job.variants[variantIdx];
  const customKey = `${job.id}:${variantIdx}`;
  const text = build.custom[customKey] ?? variant.text;
  const steps = useMemo(() => parseSteps(text), [text]);

  const [items, setItems] = useState<GearItem[] | null>(null);
  const [skills, setSkills] = useState<Awaited<ReturnType<typeof loadSkills>> | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [tpl, setTpl] = useState(loadDigitTemplates);
  const [readMsg, setReadMsg] = useState("");
  /** filas leídas con dígitos desconocidos: skill → glifos, para aprenderlos cuando el usuario escriba el valor */
  const [unknown, setUnknown] = useState<Record<string, string[]>>({});

  useEffect(() => {
    loadGear().then(setItems, () => undefined);
    loadSkills().then(setSkills, () => undefined);
    loadWorld().then((r) => setWorld(r.world), () => undefined);
  }, []);

  const hidden = useMemo(() => new Set(gear.hidden), [gear.hidden]);
  const visible = useMemo(() => (items ? items.filter((i) => !hidden.has(i.id)) : null), [items, hidden]);
  const ap = useMemo(() => (visible ? groupAp(planAp(cls, level, gear.stats, visible, { defense: gear.balanced ? 1 : 0, extraAtk: gear.extraAtk }, 15)) : null), [visible, cls, level, gear.stats, gear.balanced, gear.extraAtk]);
  const spots = useMemo(() => (world ? bestMapsFor(world, level, 3) : []), [world, level]);

  const info = skills?.get(job.osms);
  const targets = targetsAt(steps, level);
  const rows = skillRows(targets, build.skills, info);
  const missingTotal = rows.reduce((n, r) => n + r.missing, 0);
  const setHave = (name: string, v: number, max: number | null) => {
    const value = Math.min(max ?? 99, Math.max(0, Math.round(v) || 0));
    characters.updateBuild({ skills: { ...build.skills, [name]: value } });
    // Si esta fila no se pudo leer de la pantalla, el valor que escribes enseña los dígitos.
    const glyphs = unknown[name];
    if (glyphs) {
      const r = learnDigits(tpl, glyphs, value);
      if (r.learned > 0) {
        setTpl(r.templates);
        saveDigitTemplates(r.templates);
        setUnknown(({ [name]: _gone, ...rest }) => rest);
        setReadMsg(`Aprendí ${r.learned} dígito${r.learned > 1 ? "s" : ""} nuevo${r.learned > 1 ? "s" : ""}; la próxima lectura reconocerá esos números.`);
      }
    }
  };

  /** Lee la ventana de skills de la pantalla compartida y rellena la columna «Tengo». */
  const readScreen = () => {
    const img = tracker.snapshot();
    if (!img) return setReadMsg("Primero comparte la ventana del juego (botón de la pestaña Tracker).");
    const r = readSkillWindow(img, tpl);
    if (!r) return setReadMsg("No veo la ventana de skills. Ábrela en el juego (tecla K) y vuelve a pulsar.");
    if (r.tab === "beginner") return setReadMsg("Esa es la pestaña de principiante. Abre la de tu job.");
    const first = JOBS.find((j) => j.classId === gear.classId && j.id.endsWith("1"));
    const readJob = r.tab === "first" ? first : r.tab === "second" ? job : job;
    const names = [...(skills?.get(readJob?.osms ?? "")?.keys() ?? [])];
    if (!names.length) return setReadMsg("No pude cargar las skills de ese job (datos de OSMS).");
    const got: Record<string, number> = {};
    const unk: Record<string, string[]> = {};
    names.slice(0, r.levels.length).forEach((name, i) => {
      const lv = r.levels[i];
      const max = skills?.get(readJob!.osms)?.get(name)?.max ?? 99;
      if (lv !== null && lv <= max) got[name] = lv;
      else if (r.glyphs[i].length) unk[name] = r.glyphs[i];
    });
    characters.updateBuild({ skills: { ...build.skills, ...got } });
    setUnknown(unk);
    const bad = Object.keys(unk);
    setReadMsg(
      `Leí ${Object.keys(got).length} skills de ${readJob?.label}.` +
        (bad.length ? ` No reconocí el nivel de ${bad.join(", ")}: escríbelo en «Tengo» y aprendo esos dígitos.` : "") +
        (names.length > 6 ? " Este job tiene más de 6 skills: baja la lista en el juego y lee de nuevo para el resto (solo leo las 6 de arriba)." : ""),
    );
  };
  const markAll = () => characters.updateBuild({ skills: { ...build.skills, ...Object.fromEntries(rows.map((r) => [r.name, Math.max(r.have, r.target)])) } });
  const next = upcoming(steps, level);
  const second = secondJobsOf(gear.classId);

  const saveDraft = () => {
    characters.updateBuild({ custom: { ...build.custom, [customKey]: draft } });
    setEditing(false);
  };
  const reset = () => {
    const { [customKey]: _drop, ...rest } = build.custom;
    characters.updateBuild({ custom: rest });
    setEditing(false);
  };

  return (
    <section aria-label="Build" className="space-y-4">
      <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <h2 className="text-lg font-bold">Build · nivel {level}</h2>
            <p className="text-sm text-ink-soft">
              {active.name} · {CLASSES.find((c) => c.id === gear.classId)?.label} · {job.label}.{" "}
              {autoLevel ? (detectedLevel !== null ? "El nivel sigue al tracker." : "Nivel automático: esperando una lectura del tracker.") : "Nivel manual (activa «Nivel automático» arriba)."}
            </p>
          </div>
          {level >= 30 && (
            <label className="text-sm font-bold text-ink-soft">
              2º job
              <select value={job.id} onChange={(e) => characters.updateBuild({ job: e.target.value, variant: 0 })} className="mt-1 block rounded-lg border border-line bg-panel px-2 py-1.5 font-normal text-ink">
                {second.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {job.variants.length > 1 && (
            <label className="text-sm font-bold text-ink-soft">
              Arma
              <select value={variantIdx} onChange={(e) => characters.updateBuild({ variant: Number(e.target.value) })} className="mt-1 block rounded-lg border border-line bg-panel px-2 py-1.5 font-normal text-ink">
                {job.variants.map((v, i) => (
                  <option key={v.label} value={i}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
          <h3 className="text-lg font-bold">AP: qué hacer con los puntos</h3>
          <p className="text-sm text-ink-soft">5 AP por nivel. Calculado con tus stats base y el equipo óptimo de cada nivel (pestaña Equipo y daño).</p>
          {!ap && <p className="mt-3 text-sm text-ink-soft">Calculando…</p>}
          {ap && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {ap.map((g) => (
                <li key={g.from}>
                  <span className="font-bold">
                    Nv {g.from}
                    {g.to > g.from ? `–${g.to}` : ""}:
                  </span>{" "}
                  todo a <span className="font-bold text-tile">{STAT[g.put]}</span>
                  {g.why && <span className="block text-xs text-ink-soft">{g.why}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold">Skills a tu nivel</h3>
            <div className="flex gap-2">
              <button onClick={readScreen} title="Con la ventana de skills abierta en el juego (tecla K) y la pantalla compartida" className="rounded-lg bg-tile px-2.5 py-1 text-sm font-bold text-white">
                Leer de la pantalla
              </button>
              <button
                onClick={() => {
                  setDraft(formatSteps(steps));
                  setEditing((e) => !e);
                }}
                className="rounded-lg border border-line px-2.5 py-1 text-sm font-bold"
              >
                {editing ? "Cerrar" : "Editar plantilla"}
              </button>
            </div>
          </div>
          {readMsg && <p className="mt-2 rounded-lg bg-line/40 px-3 py-2 text-xs" role="status">{readMsg}</p>}
          <p className="text-sm text-ink-soft">Orden sugerido (plantilla propia, no oficial): a tu nivel deberías tener estos valores.</p>

          {editing ? (
            <div className="mt-3 space-y-2">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={12} className="w-full rounded-lg border border-line bg-panel p-2 font-mono text-xs text-ink" spellCheck={false} />
              <p className="text-xs text-ink-soft">Una línea por paso: «nivel Skill = valor». Ejemplo: 36 Sword Mastery = 20</p>
              <div className="flex gap-2">
                <button onClick={saveDraft} className="rounded-lg bg-tile px-3 py-1 text-sm font-bold text-white">
                  Guardar
                </button>
                <button onClick={reset} className="rounded-lg border border-line px-3 py-1 text-sm font-bold">
                  Restablecer la sugerida
                </button>
              </div>
            </div>
          ) : steps.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">No hay plantilla para este nivel todavía.</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-line/40 px-3 py-2 text-sm">
                <p>
                  {missingTotal > 0 ? (
                    <>
                      Te faltan <span className="font-extrabold text-tile">{missingTotal} SP</span> para ponerte al día.
                    </>
                  ) : (
                    <span className="font-bold text-good">Vas al día con la plantilla ✓</span>
                  )}
                </p>
                <button onClick={markAll} className="rounded-lg border border-line px-2.5 py-1 text-xs font-bold">
                  Ya los tengo todos
                </button>
              </div>
              <ul className="mt-3 space-y-3 text-sm">
                {rows.map((r) => {
                  const fx = effectRange(info?.get(r.name), r.have, r.target);
                  return (
                    <li key={r.name} className="rounded-lg border border-line p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p>
                          <span className="font-bold">{r.name}</span> <span className="text-ink-soft">objetivo</span> <span className="font-bold text-tile">{r.target}</span>
                          {r.max !== null && <span className="text-ink-soft"> / {r.max}</span>}
                        </p>
                        <label className="flex items-center gap-1.5 text-xs font-bold text-ink-soft">
                          Tengo
                          <input
                            type="number"
                            min={0}
                            max={r.max ?? 99}
                            value={r.have}
                            onChange={(e) => setHave(r.name, Number(e.target.value), r.max)}
                            className="w-16 rounded-md border border-line bg-panel px-1.5 py-0.5 text-sm font-normal text-ink"
                          />
                        </label>
                      </div>
                      <p className={`mt-1 text-xs font-bold ${r.missing > 0 ? "text-bad" : "text-good"}`}>
                        {r.missing > 0 ? `Sube de ${r.have} a ${r.target} (+${r.missing} SP)` : r.have > r.target ? `Vas ${r.have - r.target} sobre el objetivo` : "Al día ✓"}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-soft">{skillWhy(r.name)}</p>
                      {fx && r.missing > 0 && (
                        <p className="mt-0.5 text-xs text-ink-soft">
                          Nv {r.have + 1}: {fx.from.slice(0, 90)} → Nv {r.target}: {fx.to.slice(0, 90)}
                        </p>
                      )}
                    </li>
                  );
                })}
                {rows.length === 0 && <li className="text-ink-soft">Aún no toca subir nada de esta plantilla.</li>}
              </ul>
              {next.length > 0 && (
                <div className="mt-3 border-t border-line pt-2 text-sm">
                  <p className="font-bold">Lo que viene</p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {next.map((s) => (
                      <li key={`${s.at}${s.skill}${s.to}`}>
                        <span className="font-bold">Nv {s.at}:</span> {s.skill} hasta {s.to}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
        <h3 className="text-lg font-bold">Dónde entrenar a nivel {level}</h3>
        {!world && <p className="mt-2 text-sm text-ink-soft">Cargando mapas…</p>}
        {world && spots.length === 0 && <p className="mt-2 text-sm text-ink-soft">Sin mapas recomendados para este nivel con los datos actuales.</p>}
        <ul className="mt-2 grid gap-2 sm:grid-cols-3">
          {spots.map((s) => (
            <li key={s.map.id} className="rounded-xl border border-line p-3 text-sm">
              <p className="font-bold">{s.map.name}</p>
              <p className="text-xs text-ink-soft">{s.map.street}</p>
              <p className="mt-1">{s.mobs.slice(0, 3).map((m) => m.name).join(", ")}</p>
              <p className="text-xs text-ink-soft">
                Mobs nv {s.minLevel}–{s.maxLevel} · techo ≈ {fmtCompact(s.solo.exp)} EXP/h
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
