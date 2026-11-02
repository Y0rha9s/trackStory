import type { ClassDef } from "./gear";

/** Quests de OSMS Data Explorer (quests.json) listas para filtrar y ordenar. */
export interface Quest {
  id: string;
  name: string;
  region: string;
  area: number;
  npc: string;
  npcId: number;
  levelMin: number;
  description: string;
  exp: number;
  money: number;
  rewardItems: string;
  /** quests que hay que haber completado antes */
  prereqs: { id: string; name: string }[];
  mobs: string[];
  items: string[];
  /** objetivos con cantidad, para mostrar dónde cumplirlos */
  mobReqs: { id: number; name: string; count: number }[];
  itemReqs: { id: number; name: string; count: number }[];
  /** requisitos que la app no puede comprobar (ciudadanía, skills de crafting) */
  other: string[];
  nextId: string | null;
  nextName: string | null;
  kind: "normal" | "daily" | "weekly" | "repeat";
  /** quest de avance de job: solo sirve a esa clase */
  forClass: ClassDef["id"] | null;
}

const CLASS_REGION: Record<string, ClassDef["id"]> = { Warrior: "warrior", Magician: "mage", Bowman: "bowman", Thief: "thief" };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function parseQuests(raw: unknown): Quest[] {
  const list = (raw as { quests?: Record<string, unknown>[] } | null)?.quests;
  if (!Array.isArray(list)) throw new Error("quests.json con formato inesperado");
  return list.map((q) => {
    const reqs = (Array.isArray(q.requirements_list) ? q.requirements_list : []) as Record<string, unknown>[];
    const region = str(q.region);
    return {
      id: String(q.id),
      name: str(q.name),
      region,
      area: num(q.area),
      npc: str(q.npc_name),
      npcId: num(q.npc_id),
      levelMin: num(q.level_min),
      description: str(q.description),
      exp: num(q.rewards_exp),
      money: num(q.rewards_money),
      rewardItems: str(q.rewards_items),
      prereqs: reqs.filter((r) => r.type === "quest").map((r) => ({ id: String(r.id), name: str(r.name) })),
      mobReqs: reqs.filter((r) => r.type === "mob").map((r) => ({ id: num(r.id), name: str(r.name), count: num(r.count) })),
      itemReqs: reqs.filter((r) => r.type === "item").map((r) => ({ id: num(r.id), name: str(r.name), count: num(r.count) })),
      mobs: reqs.filter((r) => r.type === "mob").map((r) => str(r.label)),
      items: reqs.filter((r) => r.type === "item").map((r) => str(r.label)),
      other: reqs.filter((r) => r.type === "citizenship" || r.type === "skill").map((r) => str(r.label)),
      nextId: q.next_quest ? String(q.next_quest) : null,
      nextName: str(q.next_quest_name) || null,
      kind: q.is_daily ? "daily" : q.is_weekly ? "weekly" : q.is_repeatable ? "repeat" : "normal",
      forClass: CLASS_REGION[region] ?? null,
    };
  });
}

export type QuestStatus = "done" | "available" | "locked-prereq" | "locked-level";

export interface QuestContext {
  level: number;
  classId: ClassDef["id"];
  done: ReadonlySet<string>;
  /** para ignorar prerrequisitos que no existen en los datos */
  known: ReadonlySet<string>;
}

export function statusOf(q: Quest, c: QuestContext): QuestStatus {
  if (c.done.has(q.id)) return "done";
  if (q.prereqs.some((p) => c.known.has(p.id) && !c.done.has(p.id))) return "locked-prereq";
  if (q.levelMin > c.level) return "locked-level";
  return "available";
}

/** ¿Esta quest corresponde a la clase? (las de avance de job son de una sola clase) */
export const forMyClass = (q: Quest, classId: ClassDef["id"]) => q.forClass === null || q.forClass === classId;

/** Quests previas sin hacer, en el orden en que hay que cumplirlas (la más antigua primero). */
export function pendingChain(q: Quest, byId: ReadonlyMap<string, Quest>, done: ReadonlySet<string>): Quest[] {
  const out: Quest[] = [];
  const seen = new Set<string>([q.id]);
  const visit = (cur: Quest) => {
    for (const p of cur.prereqs) {
      const pre = byId.get(p.id);
      if (!pre || done.has(pre.id) || seen.has(pre.id)) continue;
      seen.add(pre.id);
      visit(pre);
      out.push(pre);
    }
  };
  visit(q);
  return out;
}

/** Quest anterior de cada quest (inverso de `nextId`). */
export function buildPrevMap(quests: readonly Quest[]): Map<string, Quest> {
  const prev = new Map<string, Quest>();
  for (const q of quests) if (q.nextId && !prev.has(q.nextId)) prev.set(q.nextId, q);
  return prev;
}

/** La cadena completa a la que pertenece una quest (B1 → B2 → B3…), en orden. */
export function chainOf(q: Quest, byId: ReadonlyMap<string, Quest>, prev: ReadonlyMap<string, Quest>): Quest[] {
  const out: Quest[] = [q];
  const seen = new Set([q.id]);
  for (let cur = prev.get(q.id); cur && !seen.has(cur.id); cur = prev.get(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
  }
  for (let cur = q.nextId ? byId.get(q.nextId) : undefined; cur && !seen.has(cur.id); cur = cur.nextId ? byId.get(cur.nextId) : undefined) {
    seen.add(cur.id);
    out.push(cur);
  }
  return out;
}

/**
 * OSMS no publica los drops. Los ítems de quest suelen llevar el nombre del mob ("Blue Mushroom Cap" viene de "Blue Mushroom"),
 * así que se sugieren los mobs cuyo nombre aparece completo al inicio del ítem. Es una inferencia, no un dato.
 */
export function guessDroppers<T extends { name: string }>(itemName: string, mobs: Iterable<T>): T[] {
  const item = itemName.toLowerCase();
  const hits: T[] = [];
  const seen = new Set<string>();
  for (const m of mobs) {
    const name = m.name.toLowerCase();
    // "Blue Mushroom Cap" ← Blue Mushroom (prefijo) y "Pig's Ribbon" ← Ribbon Pig (mismas palabras en otro orden).
    const same = (a: string, b: string) => {
      const ta = [...new Set(a.match(/[a-z0-9]+/g) ?? [])].filter((w) => w !== "s").sort().join(" ");
      return ta === [...new Set(b.match(/[a-z0-9]+/g) ?? [])].filter((w) => w !== "s").sort().join(" ");
    };
    if (name.length < 4 || seen.has(name) || !(item === name || item.startsWith(name + " ") || same(item, name))) continue;
    seen.add(name);
    hits.push(m);
  }
  const longest = Math.max(0, ...hits.map((m) => m.name.length));
  return hits.filter((m) => m.name.length === longest);
}
