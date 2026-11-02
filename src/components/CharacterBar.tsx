import { useRef } from "react";
import { characters, useCharacters } from "../characters";

/** Selector de personaje: crear, renombrar, borrar y copia de seguridad (los datos viven en este navegador). */
export function CharacterBar() {
  const { chars, active, activeId } = useCharacters();
  const file = useRef<HTMLInputElement>(null);

  const create = () => {
    const name = window.prompt("Nombre del personaje nuevo:", `Personaje ${chars.length + 1}`);
    if (name === null) return;
    characters.create(name, window.confirm("¿Copiar clase, stats y equipo del personaje actual como punto de partida?"));
  };
  const rename = () => {
    const name = window.prompt("Nuevo nombre:", active.name);
    if (name !== null) characters.rename(active.id, name);
  };
  const remove = () => {
    if (chars.length > 1 && window.confirm(`¿Borrar a "${active.name}"? Se pierden sus stats y equipo guardados.`)) characters.remove(active.id);
  };
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([characters.exportJson()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "maple-track-personajes.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    if (!window.confirm("Importar reemplaza TODOS los personajes guardados en este navegador. ¿Continuar?")) return;
    if (!characters.importJson(await f.text())) window.alert("El archivo no tiene el formato de Maple Track.");
  };

  const btn = "rounded-lg border border-line px-2.5 py-1 text-sm font-bold";
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel px-3 py-2">
      <label className="flex items-center gap-2 text-sm font-bold text-ink-soft">
        Personaje
        <select value={activeId} onChange={(e) => characters.select(e.target.value)} className="rounded-lg border border-line bg-panel px-2 py-1 font-bold text-ink">
          {chars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <button onClick={create} className={btn}>
        Nuevo
      </button>
      <button onClick={rename} className={btn}>
        Renombrar
      </button>
      <button onClick={remove} disabled={chars.length <= 1} className={`${btn} disabled:opacity-40`}>
        Borrar
      </button>
      <label className="flex items-center gap-1.5 text-sm" title="Con el tracker leyendo el juego, el nivel de este personaje se actualiza solo">
        <input type="checkbox" checked={active.autoLevel} onChange={(e) => characters.setAutoLevel(e.target.checked)} />
        Nivel automático
      </label>
      <span className="ml-auto flex gap-2">
        <button onClick={exportFile} className={btn} title="Descarga todos tus personajes como archivo">
          Exportar
        </button>
        <button onClick={() => file.current?.click()} className={btn} title="Carga un archivo exportado antes">
          Importar
        </button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0]).then(() => (e.target.value = ""))} />
      </span>
    </div>
  );
}
