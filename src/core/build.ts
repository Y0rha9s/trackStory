import { optimize, scoreOf, type ClassDef, type GearItem, type OptimizeOptions, type Stats, type StatKey } from "./gear";

/**
 * Pestaña Build: con el nivel del tracker dice qué hacer con los AP y qué skills subir.
 * El reparto de AP se calcula con el optimizador de equipo (requisitos de stats + fórmulas de daño).
 * El orden de skills es una PLANTILLA PROPIA (sugerencia), editable; no viene de ninguna guía externa.
 */

// --- Skills: plantillas editables ----------------------------------------------------------------

export interface SkillStep {
  /** nivel del personaje desde el que se apunta a este valor */
  at: number;
  skill: string;
  to: number;
}

const LINE = /^\s*(\d+)\s+(.+?)\s*=\s*(\d+)\s*$/;

/** "33 Sword Mastery = 10" por línea → pasos. Las líneas que no calzan se ignoran. */
export function parseSteps(text: string): SkillStep[] {
  const out: SkillStep[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) out.push({ at: Number(m[1]), skill: m[2], to: Number(m[3]) });
  }
  return out.sort((a, b) => a.at - b.at);
}

export const formatSteps = (steps: readonly SkillStep[]) => steps.map((s) => `${s.at} ${s.skill} = ${s.to}`).join("\n");

/** Valor al que debería estar cada skill a ese nivel (el mayor objetivo cuyo nivel ya llegó). */
export function targetsAt(steps: readonly SkillStep[], level: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of steps) if (s.at <= level) out.set(s.skill, Math.max(out.get(s.skill) ?? 0, s.to));
  return out;
}

/** Próximos pasos (nivel > actual), agrupados por el nivel en que tocan. */
export function upcoming(steps: readonly SkillStep[], level: number, limit = 6): SkillStep[] {
  return steps.filter((s) => s.at > level).slice(0, limit);
}

export interface JobVariant {
  label: string;
  text: string;
}
export interface JobDef {
  id: string;
  label: string;
  classId: ClassDef["id"] | "beginner";
  /** nombre de la clase en skills.json de OSMS */
  osms: string;
  variants: JobVariant[];
}

const lines = (...l: string[]) => l.join("\n");

/** Plantilla de guerrero de 2º job: maestría, booster, ataque final y buff. */
const warrior2 = (m: string, b: string, f: string, buff: string) =>
  lines(`33 ${m} = 10`, `36 ${m} = 20`, `39 ${b} = 10`, `42 ${b} = 20`, `46 ${f} = 10`, `52 ${f} = 25`, `56 ${f} = 30`, `56 ${buff} = 10`, `62 ${buff} = 25`, `70 ${buff} = 30`, "70 Rush = 20");

const wizard2 = (a: string, b: string) =>
  lines(`33 ${a} = 10`, `37 ${a} = 20`, `41 ${a} = 30`, "41 MP Eater = 5", "45 MP Eater = 15", "49 Meditation = 10", "54 Meditation = 20", "58 Teleport = 10", `62 ${b} = 15`, `66 ${b} = 30`, "70 Teleport = 20", "70 MP Eater = 20");

const firstJob = (main: string, s2: string, s3: string) =>
  lines(`12 ${main} = 5`, `15 ${main} = 15`, `18 ${main} = 20`, `18 ${s2} = 3`, `22 ${s2} = 15`, `25 ${s3} = 5`, `29 ${s3} = 15`);

const archer2 = (mastery: string, booster: string, soul: string, fa: string, main: string) =>
  lines(`33 ${mastery} = 10`, `36 ${mastery} = 20`, `40 ${booster} = 10`, `44 ${booster} = 20`, `48 ${soul} = 10`, `52 ${fa} = 15`, `58 ${soul} = 20`, `62 ${fa} = 30`, `66 ${main} = 10`, `70 ${main} = 20`);

export const JOBS: JobDef[] = [
  { id: "beginner", label: "Principiante", classId: "beginner", osms: "Beginner", variants: [{ label: "—", text: "" }] },
  {
    id: "warrior1",
    label: "Warrior (1er job)",
    classId: "warrior",
    osms: "Warrior",
    variants: [{ label: "Estándar", text: lines("12 Power Strike = 5", "15 Power Strike = 15", "18 Power Strike = 20", "18 Slash Blast = 3", "22 Slash Blast = 15", "25 Slash Blast = 20", "25 Max HP Increase = 5", "29 Max HP Increase = 15") }],
  },
  {
    id: "magician1",
    label: "Magician (1er job)",
    classId: "mage",
    osms: "Magician",
    variants: [{ label: "Estándar", text: firstJob("Magic Claw", "Magic Guard", "Max MP Increase") }],
  },
  {
    id: "archer1",
    label: "Archer (1er job)",
    classId: "bowman",
    osms: "Archer",
    variants: [{ label: "Estándar", text: firstJob("Double Shot", "Focus", "Critical Shot") }],
  },
  {
    id: "rogue1",
    label: "Rogue (1er job)",
    classId: "thief",
    osms: "Rogue",
    variants: [
      { label: "Garra (Lucky Seven)", text: firstJob("Lucky Seven", "Nimble Body", "Keen Eyes") },
      { label: "Daga (Double Stab)", text: firstJob("Double Stab", "Nimble Body", "Keen Eyes") },
    ],
  },
  {
    id: "fighter",
    label: "Fighter",
    classId: "warrior",
    osms: "Fighter",
    variants: [
      { label: "Espada", text: warrior2("Sword Mastery", "Sword Booster", "Final Attack: Sword", "Rage") },
      { label: "Hacha", text: warrior2("Axe Mastery", "Axe Booster", "Final Attack: Axe", "Rage") },
    ],
  },
  {
    id: "page",
    label: "Page",
    classId: "warrior",
    osms: "Page",
    variants: [
      { label: "Espada", text: warrior2("Sword Mastery", "Sword Booster", "Final Attack: Sword", "Threaten") },
      { label: "Maza", text: warrior2("Blunt Weapon Mastery", "Blunt Weapon Booster", "Final Attack: Blunt Weapon", "Threaten") },
    ],
  },
  {
    id: "spearman",
    label: "Spearman",
    classId: "warrior",
    osms: "Spearman",
    variants: [
      { label: "Lanza", text: warrior2("Spear Mastery", "Spear Booster", "Final Attack: Spear", "Iron Will") },
      { label: "Polearm", text: warrior2("Polearm Mastery", "Polearm Booster", "Final Attack: Polearm", "Iron Will") },
    ],
  },
  { id: "il", label: "I/L Wizard", classId: "mage", osms: "I/L Wizard", variants: [{ label: "Estándar", text: wizard2("Cold Beam", "Thunder Bolt") }] },
  { id: "fp", label: "F/P Wizard", classId: "mage", osms: "F/P Wizard", variants: [{ label: "Estándar", text: wizard2("Fire Arrow", "Poison Breath") }] },
  {
    id: "cleric",
    label: "Cleric",
    classId: "mage",
    osms: "Cleric",
    variants: [
      {
        label: "Estándar",
        text: lines("33 Heal = 10", "37 Heal = 20", "41 Heal = 30", "41 Bless = 5", "45 Bless = 15", "49 Holy Arrow = 10", "54 Holy Arrow = 20", "58 Invincible = 10", "62 Bless = 20", "62 Invincible = 20", "66 Holy Arrow = 30", "70 MP Eater = 10", "70 Teleport = 10"),
      },
    ],
  },
  { id: "hunter", label: "Hunter", classId: "bowman", osms: "Hunter", variants: [{ label: "Estándar", text: archer2("Bow Mastery", "Bow Booster", "Soul Arrow: Bow", "Final Attack: Bow", "Arrow Bomb") }] },
  { id: "crossbowman", label: "Crossbowman", classId: "bowman", osms: "Crossbowman", variants: [{ label: "Estándar", text: archer2("Crossbow Mastery", "Crossbow Booster", "Soul Arrow: Crossbow", "Final Attack: Crossbow", "Iron Arrow") }] },
  {
    id: "assassin",
    label: "Assassin",
    classId: "thief",
    osms: "Assassin",
    variants: [
      {
        label: "Estándar",
        text: lines("33 Claw Mastery = 10", "36 Claw Mastery = 20", "40 Critical Throw = 10", "44 Claw Booster = 10", "48 Critical Throw = 20", "51 Claw Booster = 20", "56 Critical Throw = 30", "60 Haste = 10", "66 Haste = 20", "70 Drain = 20"),
      },
    ],
  },
  {
    id: "bandit",
    label: "Bandit",
    classId: "thief",
    osms: "Bandit",
    variants: [
      {
        label: "Estándar",
        text: lines("33 Dagger Mastery = 10", "36 Dagger Mastery = 20", "40 Dagger Booster = 10", "44 Dagger Booster = 20", "48 Savage Blow = 10", "54 Savage Blow = 25", "58 Savage Blow = 30", "62 Steal = 10", "66 Haste = 15", "70 Haste = 20"),
      },
    ],
  },
];

export const jobById = (id: string) => JOBS.find((j) => j.id === id);
export const secondJobsOf = (classId: ClassDef["id"]) => JOBS.filter((j) => j.classId === classId && !j.id.endsWith("1"));

/** Job que corresponde al nivel: principiante (<10), 1er job (10–29) o el 2º job elegido (30+). */
export function jobFor(classId: ClassDef["id"], level: number, secondJob?: string): JobDef {
  if (level < 10) return JOBS[0];
  const first = JOBS.find((j) => j.classId === classId && j.id.endsWith("1"))!;
  if (level < 30) return first;
  const chosen = secondJob ? jobById(secondJob) : undefined;
  return chosen && chosen.classId === classId ? chosen : secondJobsOf(classId)[0];
}

/** SP acumulados aproximados (3 por nivel tras avanzar de job), para comprobar que una plantilla es alcanzable. */
export const approxSp = (level: number) => (level >= 30 ? 3 * (level - 30) + 4 : level >= 10 ? 3 * (level - 10) + 1 : 0);

/** skills.json de OSMS → por clase, el máximo y la descripción de cada skill. */
export interface SkillInfo {
  max: number;
  description: string;
  /** efecto de cada nivel, de 1 a max (texto de OSMS) */
  levels: string[];
}

export function parseSkills(raw: unknown): Map<string, Map<string, SkillInfo>> {
  const out = new Map<string, Map<string, SkillInfo>>();
  for (const group of Object.values((raw ?? {}) as Record<string, unknown>)) {
    if (!Array.isArray(group)) continue;
    for (const job of group as Record<string, unknown>[]) {
      const skills = new Map<string, SkillInfo>();
      for (const s of (job.skills as Record<string, unknown>[]) ?? []) {
        skills.set(String(s.name), {
          max: Number(s.max_level) || 0,
          description: String(s.description ?? "").replace(/^\[[^\]]*\]\s*/, ""),
          levels: Array.isArray(s.all_level_stats) ? (s.all_level_stats as unknown[]).map(String) : [],
        });
      }
      out.set(String(job.class_name), skills);
    }
  }
  return out;
}

// --- AP: reparto automático ------------------------------------------------------------------------

export interface ApStep {
  level: number;
  put: StatKey;
  /** por qué no va al stat principal (ítem que se habilita), si aplica */
  why: string | null;
}

/**
 * Qué hacer con los 5 AP de cada nivel nuevo. Para cada nivel prueba poner los 5 en cada stat y se queda con el que
 * deja el mejor equipo posible (daño + defensa según `opt`). Si no es el principal, explica qué ítem habilita.
 */
export function planAp(cls: ClassDef, level: number, base: Stats, items: GearItem[], opt: OptimizeOptions, span = 15, apPerLevel = 5): ApStep[] {
  const stats = { ...base };
  const out: ApStep[] = [];
  const keys: StatKey[] = ["str", "dex", "int", "luk"];
  for (let l = level + 1; l <= level + span; l++) {
    const tries = keys.map((k) => {
      const s = { ...stats, [k]: stats[k] + apPerLevel };
      const build = optimize(cls, l, s, items, opt);
      return { k, s, build, score: scoreOf(cls, s, build, opt) };
    });
    const primary = tries.find((t) => t.k === cls.primary)!;
    // Solo se desvía del stat principal si gana de forma clara (evita cambios por diferencias mínimas).
    const best = tries.reduce((a, b) => (b.score > a.score * 1.0005 ? b : a), primary);
    let why: string | null = null;
    if (best.k !== cls.primary) {
      const had = new Set(Object.values(primary.build).map((i) => i?.id));
      const gained = Object.values(best.build).filter((i): i is GearItem => !!i && !had.has(i.id));
      why = gained.length ? `habilita ${gained.slice(0, 2).map((i) => `${i.name} (nv ${i.reqLevel})`).join(", ")}` : "mejora el daño total";
    }
    Object.assign(stats, best.s);
    out.push({ level: l, put: best.k, why });
  }
  return out;
}

/** Agrupa niveles seguidos con el mismo destino: "Nv 41–44: STR". */
export function groupAp(steps: readonly ApStep[]): { from: number; to: number; put: StatKey; why: string | null }[] {
  const out: { from: number; to: number; put: StatKey; why: string | null }[] = [];
  for (const s of steps) {
    const last = out.at(-1);
    if (last && last.put === s.put && last.why === s.why && last.to === s.level - 1) last.to = s.level;
    else out.push({ from: s.level, to: s.level, put: s.put, why: s.why });
  }
  return out;
}

// --- Skills: qué falta y por qué --------------------------------------------------------------------

/** Por qué se sube cada skill (explicación propia, general; el efecto exacto por nivel viene de OSMS). */
const WHY_BY_NAME: Record<string, string> = {
  "Power Strike": "Es tu ataque principal de 1er job: más daño por golpe para subir de nivel rápido.",
  "Slash Blast": "Ataque en área: pega a varios mobs a la vez.",
  "Max HP Increase": "Más vida máxima: aguantas spots más duros.",
  "Magic Claw": "Es el ataque principal del mago de 1er job; casi todo tu daño sale de aquí.",
  "Magic Guard": "Parte del daño se descuenta del MP en vez de la vida.",
  "Max MP Increase": "Más MP: más hechizos antes de quedarte sin maná.",
  "Double Shot": "Ataque principal del arquero de 1er job: dispara dos flechas por ataque.",
  Focus: "Más precisión y evasión: fallas menos contra mobs de más nivel.",
  "Critical Shot": "Probabilidad de golpe crítico: daño extra sin gastar más MP.",
  "Lucky Seven": "Ataque principal del ladrón con garra: lanza dos estrellas.",
  "Double Stab": "Ataque principal del ladrón con daga.",
  "Nimble Body": "Más precisión y evasión.",
  "Keen Eyes": "Mejora la puntería del ladrón.",
  "Cold Beam": "Tu ataque principal de I/L: aquí sale la mayor parte del daño.",
  "Thunder Bolt": "Ataque en cadena que golpea a varios mobs: sirve para mobbing.",
  "Fire Arrow": "Tu ataque principal de F/P.",
  "Poison Breath": "Ataque de área con veneno que sigue dañando.",
  "Holy Arrow": "Ataque principal del Cleric, fuerte contra no-muertos.",
  Heal: "Cura al grupo y daña a los no-muertos; es la razón de llevar un Cleric.",
  Bless: "Sube defensa, precisión y evasión al grupo.",
  Invincible: "Reduce el daño que recibes.",
  "MP Eater": "Absorbe MP de los mobs al atacar: ahorra pociones de maná.",
  Meditation: "Sube el ataque mágico tuyo y del grupo.",
  Teleport: "Movilidad: te mueves por el mapa sin escalar.",
  Slow: "Debilita a los mobs ralentizándolos.",
  Rush: "Embestida que mueve y golpea a la vez.",
  Rage: "Sube el ataque de ti y del grupo.",
  Threaten: "Baja el ataque y la defensa de los mobs.",
  "Iron Will": "Sube defensa propia y del grupo.",
  Haste: "Más velocidad y salto.",
  "Critical Throw": "Más probabilidad de crítico con la garra.",
  Drain: "Ataque que te devuelve vida con el daño que haces.",
  Steal: "Habilidad de robar ítems a los mobs.",
  "Savage Blow": "Tu ataque principal del Bandit: varios golpes seguidos.",
  "Arrow Bomb": "Ataque de área para varios mobs.",
  "Iron Arrow": "Flecha que atraviesa varios mobs: sirve para mobbing.",
};

/** Por qué subir una skill. Las maestrías, boosters y ataques finales siguen la misma lógica en todos los jobs. */
export function skillWhy(name: string): string {
  if (WHY_BY_NAME[name]) return WHY_BY_NAME[name];
  if (/Mastery$/.test(name)) return "Maestría: sube tu daño mínimo (golpeas con más constancia) y tu precisión; el máximo no cambia.";
  if (/Booster$/.test(name)) return "Booster: ataca más rápido, y más golpes por segundo es más daño.";
  if (/^Final Attack/.test(name)) return "Ataque final: con cierta probabilidad pega un golpe extra después de tu ataque.";
  if (/^Soul Arrow/.test(name)) return "Disparas sin gastar flechas.";
  return "Sigue el orden de la plantilla.";
}

export interface SkillRow {
  name: string;
  target: number;
  have: number;
  /** puntos que faltan para llegar al objetivo (0 si ya estás) */
  missing: number;
  max: number | null;
}

/** Compara lo que tienes con lo que deberías tener. `have` son los niveles que anotó el usuario. */
export function skillRows(targets: ReadonlyMap<string, number>, have: Readonly<Record<string, number>>, info?: ReadonlyMap<string, SkillInfo>): SkillRow[] {
  return [...targets].map(([name, target]) => {
    const h = Math.max(0, have[name] ?? 0);
    return { name, target, have: h, missing: Math.max(0, target - h), max: info?.get(name)?.max ?? null };
  });
}

/** Efecto del nivel `from+1` hasta `to` (primero y último), para ver qué ganas al subirla. */
export function effectRange(info: SkillInfo | undefined, from: number, to: number): { from: string; to: string } | null {
  if (!info?.levels.length || to <= from) return null;
  const at = (n: number) => info.levels[Math.min(Math.max(n, 1), info.levels.length) - 1];
  return { from: at(from + 1), to: at(to) };
}
