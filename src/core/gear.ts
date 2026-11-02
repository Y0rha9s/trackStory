/**
 * Cálculo de daño y equipo óptimo para MapleStory Classic (fórmulas de MapleStory Classic según MeowDB).
 * Los datos de ítems vienen de OSMS Data Explorer (items.json).
 */

export type StatKey = "str" | "dex" | "int" | "luk";
export type SlotKey = "Hat" | "Top" | "Bottom" | "Overall" | "Shoes" | "Glove" | "Shield" | "Cape" | "Earring" | "Weapon";

export const SLOTS: { key: SlotKey; label: string }[] = [
  { key: "Weapon", label: "Weapon" },
  { key: "Hat", label: "Hat" },
  { key: "Overall", label: "Overall" },
  { key: "Top", label: "Top" },
  { key: "Bottom", label: "Bottom" },
  { key: "Glove", label: "Gloves" },
  { key: "Shoes", label: "Shoes" },
  { key: "Cape", label: "Cape" },
  { key: "Shield", label: "Shield" },
  { key: "Earring", label: "Earring" },
];

export interface GearItem {
  id: number;
  name: string;
  slot: SlotKey;
  weaponType: string | null;
  reqLevel: number;
  /** máscara de clases (1 guerrero, 2 mago, 4 arquero, 8 ladrón); 0 = todas */
  reqJob: number;
  req: Record<StatKey, number>;
  bonus: Record<StatKey, number>;
  watk: number;
  matk: number;
  pdd: number;
  mdd: number;
  mhp: number;
  tuc: number;
  price: number | null;
}

export type Build = Partial<Record<SlotKey, GearItem | null>>;
export type Stats = Record<StatKey, number>;

export interface ClassDef {
  id: "warrior" | "mage" | "bowman" | "thief";
  label: string;
  jobBit: number;
  primary: StatKey;
  magic: boolean;
  weapons: string[];
}

export const CLASSES: ClassDef[] = [
  { id: "warrior", label: "Guerrero", jobBit: 1, primary: "str", magic: false, weapons: ["1H Sword", "1H Axe", "1H Blunt Weapon", "2H Sword", "2H Axe", "2H Blunt Weapon", "Spear", "Polearm"] },
  { id: "mage", label: "Mago", jobBit: 2, primary: "int", magic: true, weapons: ["Wand", "Staff"] },
  { id: "bowman", label: "Arquero", jobBit: 4, primary: "dex", magic: false, weapons: ["Bow", "Crossbow"] },
  { id: "thief", label: "Ladrón", jobBit: 8, primary: "luk", magic: false, weapons: ["Claw", "Dagger"] },
];

/**
 * Multiplicador de arma (W) de MapleStory Classic para un ataque normal: promedio 60 % golpe / 40 % estocada
 * (arcos, ballestas y garras usan el de proyectil). Fuente: MeowDB, "Dealing Damage Formulas".
 */
const WEAPON_MULT: Record<string, number> = {
  "1H Sword": 1.8,
  "2H Sword": 2.5,
  "1H Axe": 1.92,
  "1H Blunt Weapon": 1.92,
  "2H Axe": 2.6,
  "2H Blunt Weapon": 2.6,
  Spear: 2.3,
  Polearm: 2.7,
  Dagger: 1.4,
  Claw: 2.5,
  Bow: 2.5,
  Crossbow: 2.5,
};
const MAX_DAMAGE = 99_999;
const TWO_HANDED = new Set(["2H Sword", "2H Axe", "2H Blunt Weapon", "Spear", "Polearm"]);

const SUB_TO_SLOT: Record<string, SlotKey> = {
  Hat: "Hat",
  Top: "Top",
  Bottom: "Bottom",
  Overall: "Overall",
  Shoes: "Shoes",
  Glove: "Glove",
  Shield: "Shield",
  Cape: "Cape",
  Earring: "Earring",
  Weapon: "Weapon",
};

/** Equipos de jefes que todavía no existen en el servidor Classic. Lo demás se oculta a mano desde el panel. */
const NOT_IN_CLASSIC = /zakum|horntail|pink bean/i;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** items.json de OSMS → equipos que sirven para el cálculo. */
export function parseGear(raw: unknown): GearItem[] {
  const items = (raw as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) throw new Error("items.json con formato inesperado");
  const out: GearItem[] = [];
  for (const it of items as Record<string, unknown>[]) {
    if (it.category !== "Equipment") continue;
    const slot = SUB_TO_SLOT[String(it.sub_category)];
    if (!slot) continue;
    const s = (it.stats ?? {}) as Record<string, unknown>;
    // Ítems de GM/pruebas (p. ej. +999 a todo): no se pueden conseguir, distorsionan cualquier recomendación.
    if (num(s.incPAD) >= 150 || num(s.incMAD) >= 150 || [s.incSTR, s.incDEX, s.incINT, s.incLUK].some((v) => num(v) >= 100)) continue;
    // Contenido que está en los archivos del cliente pero aún no sale en Classic (jefes sin lanzar, etc.).
    if (NOT_IN_CLASSIC.test(String(it.name))) continue;
    out.push({
      id: num(it.id),
      name: String(it.name ?? it.id),
      slot,
      weaponType: slot === "Weapon" ? String(it.weapon_type ?? "") : null,
      reqLevel: num(s.reqLevel),
      reqJob: num(s.reqJob),
      req: { str: num(s.reqSTR), dex: num(s.reqDEX), int: num(s.reqINT), luk: num(s.reqLUK) },
      bonus: { str: num(s.incSTR), dex: num(s.incDEX), int: num(s.incINT), luk: num(s.incLUK) },
      watk: num(s.incPAD),
      matk: num(s.incMAD),
      pdd: num(s.incPDD),
      mdd: num(s.incMDD),
      mhp: num(s.incMHP),
      tuc: num(s.tuc),
      price: typeof it.price === "number" ? it.price : null,
    });
  }
  return out;
}

/** Quita ítems que otro del mismo slot supera o iguala en todo lo que cuenta (acelera mucho el optimizador). */
function prune(list: GearItem[]): GearItem[] {
  const v = (i: GearItem) => [i.bonus.str, i.bonus.dex, i.bonus.int, i.bonus.luk, i.watk, i.matk, i.pdd];
  const vals = list.map(v);
  return list.filter((_, a) => !vals.some((vb, b) => b !== a && vb.every((x, k) => x >= vals[a][k]) && (vb.some((x, k) => x > vals[a][k]) || b < a)));
}

export const classOf = (id: ClassDef["id"]) => CLASSES.find((c) => c.id === id)!;

export function canUse(item: GearItem, cls: ClassDef, level: number, base: Stats): boolean {
  if (item.reqLevel > level) return false;
  if (item.reqJob !== 0 && (item.reqJob & cls.jobBit) === 0) return false;
  if (item.slot === "Weapon" && !cls.weapons.includes(item.weaponType ?? "")) return false;
  return item.req.str <= base.str && item.req.dex <= base.dex && item.req.int <= base.int && item.req.luk <= base.luk;
}

export interface Evaluation {
  totals: Stats;
  watk: number;
  matk: number;
  /** golpe máximo con la habilidad al 100 % (ataque normal; hechizo base para el mago) */
  damage: number;
  pdd: number;
  mdd: number;
  mhp: number;
}

function equipped(build: Build): GearItem[] {
  return Object.values(build).filter((i): i is GearItem => !!i);
}

/** Dos manos y escudo no conviven; traje completo y arriba/abajo tampoco. */
export function validBuild(build: Build): boolean {
  const w = build.Weapon;
  if (w && build.Shield && TWO_HANDED.has(w.weaponType ?? "")) return false;
  if (build.Overall && (build.Top || build.Bottom)) return false;
  return true;
}

export function evaluate(cls: ClassDef, base: Stats, build: Build, extraAtk = 0): Evaluation {
  const totals = { ...base };
  let watk = 0;
  let matk = 0;
  let pdd = 0;
  let mdd = 0;
  let mhp = 0;
  for (const it of equipped(build)) {
    (Object.keys(totals) as StatKey[]).forEach((k) => (totals[k] += it.bonus[k]));
    watk += it.watk;
    matk += it.matk;
    pdd += it.pdd;
    mdd += it.mdd;
    mhp += it.mhp;
  }
  // Fórmulas de MapleStory Classic (MeowDB), golpe máximo con habilidad al 100 %:
  //  físico: WATK · (1 + (Principal·W + Secundario)/100)     mágico: MATK · (1 + INT/125), con MATK = ⌊INT/2⌋ + equipo + extra
  let damage: number;
  if (cls.magic) {
    const magic = Math.floor(totals.int / 2) + matk + extraAtk;
    damage = magic * (1 + totals.int / 125);
  } else {
    const wt = build.Weapon?.weaponType ?? "";
    const mult = WEAPON_MULT[wt] ?? 0;
    const melee = cls.id === "warrior";
    const primary = melee ? totals.str : cls.id === "bowman" ? totals.dex : totals.luk;
    const secondary = melee ? totals.dex : cls.id === "bowman" ? totals.str : totals.str + totals.dex;
    damage = mult ? (watk + extraAtk) * (1 + (primary * mult + secondary) / 100) : 0;
  }
  damage = Math.min(damage, MAX_DAMAGE);
  return { totals, watk, matk, damage, pdd, mdd, mhp };
}

export interface OptimizeOptions {
  /** 0 = solo daño; 1 = equilibrado: cada 100 de defensa (física + ½ mágica) vale +25 % de daño */
  defense: number;
  extraAtk?: number;
}

/** Defensa total: física + mitad de la mágica. Con defensa = 1, cada 100 puntos valen +25 % de daño. */
const defenseOf = (e: Evaluation) => e.pdd + e.mdd / 2;
const utility = (e: Evaluation, o: OptimizeOptions) => e.damage * (1 + (o.defense * defenseOf(e)) / 400 + defenseOf(e) * 1e-7);

/** Puntaje (daño con defensa opcional) de un set; sirve para comparar repartos de AP. */
export const scoreOf = (cls: ClassDef, stats: Stats, build: Build, opt: OptimizeOptions) => utility(evaluate(cls, stats, build, opt.extraAtk), opt);

const FREE_SLOTS: SlotKey[] = ["Hat", "Glove", "Shoes", "Cape", "Earring", "Shield"];

/** Mejor set para un nivel y stats base: prueba cada arma y mejora por slot (daño sube con cada stat, así que converge rápido). */
export function optimize(cls: ClassDef, level: number, base: Stats, items: GearItem[], opt: OptimizeOptions): Build {
  const usable = items.filter((i) => canUse(i, cls, level, base));
  const pool = new Map<SlotKey, GearItem[]>();
  for (const s of new Set(usable.map((i) => i.slot))) {
    const inSlot = usable.filter((i) => i.slot === s);
    // Las armas solo compiten dentro de su tipo (el multiplicador cambia con el tipo).
    pool.set(s, s === "Weapon" ? [...new Set(inSlot.map((i) => i.weaponType))].flatMap((t) => prune(inSlot.filter((i) => i.weaponType === t))) : prune(inSlot));
  }
  const bySlot = (s: SlotKey) => pool.get(s) ?? [];
  const weapons: (GearItem | null)[] = bySlot("Weapon");
  if (!weapons.length) weapons.push(null);
  const score = (b: Build) => (validBuild(b) ? utility(evaluate(cls, base, b, opt.extraAtk), opt) : -1);

  const climb = (start: Build, bodyMode: "overall" | "split"): Build => {
    let cur = start;
    const body: SlotKey[] = bodyMode === "overall" ? ["Overall"] : ["Top", "Bottom"];
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const slot of [...FREE_SLOTS, ...body]) {
        let best = cur;
        let bestScore = score(cur);
        for (const cand of [null, ...bySlot(slot)]) {
          const next = { ...cur, [slot]: cand };
          const sc = score(next);
          if (sc > bestScore) {
            best = next;
            bestScore = sc;
          }
        }
        if (best !== cur) {
          cur = best;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return cur;
  };

  let best: Build = {};
  let bestScore = -Infinity;
  for (const weapon of weapons) {
    for (const mode of ["overall", "split"] as const) {
      const b = climb({ Weapon: weapon }, mode);
      const sc = score(b);
      if (sc > bestScore) {
        best = b;
        bestScore = sc;
      }
    }
  }
  return best;
}

export interface Projection {
  level: number;
  build: Build;
  damage: number;
}

/**
 * Mejor set nivel a nivel hasta `level + span`. Con `apToPrimary` se asume que cada nivel
 * nuevo da 5 AP al stat principal (así se ven los escalones como 45/55/65 sin cambiar tus stats a mano).
 */
export function project(cls: ClassDef, level: number, base: Stats, items: GearItem[], opt: OptimizeOptions, span = 10, apToPrimary = true): Projection[] {
  const out: Projection[] = [];
  for (let l = level; l <= level + span; l++) {
    const stats = { ...base };
    if (apToPrimary) stats[cls.primary] += 5 * (l - level);
    const build = optimize(cls, l, stats, items, opt);
    out.push({ level: l, build, damage: evaluate(cls, stats, build, opt.extraAtk).damage });
  }
  return out;
}

/**
 * Siguiente mejora por slot sobre un set dado: recorre los niveles hacia adelante y devuelve, para cada slot,
 * el primer ítem que sube el puntaje (daño y, si se pide, defensa). Sirve aunque el slot no cambie el daño.
 */
export function nextUpgrades(cls: ClassDef, level: number, base: Stats, items: GearItem[], opt: OptimizeOptions, current: Build, span = 20, apToPrimary = true): Partial<Record<SlotKey, GearItem>> {
  const out: Partial<Record<SlotKey, GearItem>> = {};
  const pending = new Set<SlotKey>(SLOTS.map((s) => s.key));
  const score = (stats: Stats, b: Build) => (validBuild(b) ? utility(evaluate(cls, stats, b, opt.extraAtk), opt) : -1);
  for (let l = level + 1; l <= level + span && pending.size; l++) {
    const stats = { ...base };
    if (apToPrimary) stats[cls.primary] += 5 * (l - level);
    const ref = score(stats, current);
    for (const slot of [...pending]) {
      let bestScore = ref;
      let bestItem: GearItem | undefined;
      for (const it of items) {
        if (it.slot !== slot || it.reqLevel <= level || !canUse(it, cls, l, stats) || it.id === current[slot]?.id) continue;
        const swapped: Build = { ...current, [slot]: it };
        // Un traje completo reemplaza arriba+abajo y al revés.
        if (slot === "Overall") swapped.Top = swapped.Bottom = null;
        else if (slot === "Top" || slot === "Bottom") swapped.Overall = null;
        const sc = score(stats, swapped);
        if (sc > bestScore) {
          bestScore = sc;
          bestItem = it;
        }
      }
      if (bestItem) {
        out[slot] = bestItem;
        pending.delete(slot);
      }
    }
  }
  return out;
}

export interface Blocked {
  item: GearItem;
  /** requisitos de stats que no cumples, p. ej. "DEX 30 (tienes 4)" */
  missing: string[];
}

/** Por slot, el ítem de más nivel que ya podrías llevar por nivel y clase pero te bloquean los stats base. */
export function blockedItems(cls: ClassDef, level: number, base: Stats, items: GearItem[], build: Build): Partial<Record<SlotKey, Blocked>> {
  const out: Partial<Record<SlotKey, Blocked>> = {};
  const keys: StatKey[] = ["str", "dex", "int", "luk"];
  for (const it of items) {
    if (it.reqLevel > level || (it.reqJob !== 0 && (it.reqJob & cls.jobBit) === 0)) continue;
    if (it.slot === "Weapon" && !cls.weapons.includes(it.weaponType ?? "")) continue;
    if (it.reqLevel <= (build[it.slot]?.reqLevel ?? -1)) continue;
    const missing = keys.filter((k) => it.req[k] > base[k]).map((k) => `${k.toUpperCase()} ${it.req[k]} (tienes ${base[k]})`);
    if (!missing.length) continue;
    const cur = out[it.slot];
    if (!cur || it.reqLevel > cur.item.reqLevel || (it.reqLevel === cur.item.reqLevel && missing.length < cur.missing.length)) out[it.slot] = { item: it, missing };
  }
  return out;
}

/** Diferencias de slot entre dos sets (para mostrar qué cambiar). */
export function diffBuilds(a: Build, b: Build): { slot: SlotKey; from: GearItem | null; to: GearItem | null }[] {
  const out: { slot: SlotKey; from: GearItem | null; to: GearItem | null }[] = [];
  for (const { key } of SLOTS) {
    const from = a[key] ?? null;
    const to = b[key] ?? null;
    if ((from?.id ?? null) !== (to?.id ?? null)) out.push({ slot: key, from, to });
  }
  return out;
}

// --- De dónde sale cada ítem ------------------------------------------------------------------

export interface Recipe {
  discipline: string;
  skillLevel: number;
  meso: number;
  ingredients: { name: string; count: number }[];
}
export interface QuestReward {
  quest: string;
  level: number;
}
export interface Ticket {
  id: number;
  name: string;
  description: string;
}
export interface ItemSources {
  craft: Map<number, Recipe[]>;
  quest: Map<number, QuestReward[]>;
  /** tickets de entrada ("Ticket to Construction Site B1"), de items.json */
  tickets?: Ticket[];
}

/** items.json → tickets de entrada a zonas (nombre y descripción; el precio no viene en los datos). */
export function parseTickets(raw: unknown): Ticket[] {
  const items = (raw as { items?: Record<string, unknown>[] } | null)?.items ?? [];
  return items
    .filter((i) => /^ticket to /i.test(String(i.name)))
    .map((i) => ({ id: num(i.id), name: String(i.name), description: String(i.description ?? "") }));
}

/** crafting.json → recetas por ítem producido. */
export function parseCrafting(raw: unknown): Map<number, Recipe[]> {
  const out = new Map<number, Recipe[]>();
  const disciplines = (raw as { disciplines?: Record<string, unknown>[] } | null)?.disciplines ?? [];
  for (const d of disciplines) {
    for (const t of (d.output_types as Record<string, unknown>[]) ?? []) {
      for (const lv of (t.levels as Record<string, unknown>[]) ?? []) {
        for (const r of (lv.recipes as Record<string, unknown>[]) ?? []) {
          const id = num(r.output_id);
          const list = out.get(id) ?? [];
          list.push({
            discipline: String(d.discipline ?? ""),
            skillLevel: num(r.req_level ?? lv.level),
            meso: num(r.meso_cost),
            ingredients: ((r.ingredients as Record<string, unknown>[]) ?? []).map((i) => ({ name: String(i.item_name ?? i.item_id), count: num(i.count) })),
          });
          out.set(id, list);
        }
      }
    }
  }
  return out;
}

/** quests.json → quests que entregan cada ítem de forma garantizada. */
export function parseQuestRewards(raw: unknown): Map<number, QuestReward[]> {
  const out = new Map<number, QuestReward[]>();
  for (const q of ((raw as { quests?: Record<string, unknown>[] } | null)?.quests ?? [])) {
    for (const r of (q.rewards as Record<string, unknown>[]) ?? []) {
      if (r.type !== "item" || r.guaranteed === false) continue;
      const id = num(r.id);
      const list = out.get(id) ?? [];
      list.push({ quest: String(q.name ?? q.id), level: num(q.level_min) });
      out.set(id, list);
    }
  }
  return out;
}

/** Ficha del ítem en OSMS Data Explorer (ahí se ven los drops). */
export const osmsItemUrl = (item: GearItem, cls: ClassDef) =>
  `https://osmsdataexplorer.com/#equipment?class=${cls.jobBit}&type=${item.slot}&open=${String(item.id).padStart(8, "0")}`;

/** Texto del tooltip: precio, receta y quests. Los drops no vienen en los datos públicos: se ven en la ficha. */
export function describeItem(item: GearItem, src: ItemSources | null): string {
  const lines = [`${item.name} · nv ${item.reqLevel}`];
  const stats: string[] = [];
  if (item.watk) stats.push(`ATQ ${item.watk}`);
  if (item.matk) stats.push(`ATQ MÁG ${item.matk}`);
  (["str", "dex", "int", "luk"] as StatKey[]).forEach((k) => item.bonus[k] && stats.push(`${k.toUpperCase()} +${item.bonus[k]}`));
  if (item.pdd) stats.push(`DEF ${item.pdd}`);
  if (stats.length) lines.push(stats.join(" · "));
  if (src) {
    const recipes = src.craft.get(item.id) ?? [];
    for (const r of recipes.slice(0, 2)) {
      lines.push(`Se craftea (${r.discipline} nv ${r.skillLevel}): ${r.ingredients.map((i) => `${i.count}× ${i.name}`).join(", ")}${r.meso ? ` + ${r.meso.toLocaleString("es-CL")} mesos` : ""}`);
    }
    const quests = src.quest.get(item.id) ?? [];
    if (quests.length) lines.push(`Recompensa de quest: ${quests.slice(0, 2).map((q) => q.quest).join(", ")}`);
    if (!recipes.length && !quests.length) lines.push("Sin receta ni quest conocida: probablemente drop de monstruo");
  }
  if (item.price) lines.push(`Precio base: ${item.price.toLocaleString("es-CL")} mesos`);
  lines.push("Clic: ver drops y detalles en OSMS");
  return lines.join("\n");
}
