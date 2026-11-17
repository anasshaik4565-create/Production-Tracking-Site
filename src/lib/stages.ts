import { STAGES } from "@/lib/domain";

/** Library (default) execution order of every stage. */
export const DEFAULT_ORDER: string[] = STAGES.map((s) => s.value as string);
const rank = (stage: string) => {
  const i = DEFAULT_ORDER.indexOf(stage);
  return i < 0 ? DEFAULT_ORDER.length : i;
};

/**
 * Add a stage to an ordered list: right after the last stage that normally comes before it
 * (or first, if none does). For a list in default order this is its default position, and for a
 * customised list the existing order is left alone.
 */
export function insertInDefaultOrder(list: string[], stage: string): string[] {
  if (list.includes(stage)) return list;
  let after = -1;
  list.forEach((s, i) => {
    if (rank(s) < rank(stage)) after = i;
  });
  return [...list.slice(0, after + 1), stage, ...list.slice(after + 1)];
}

/** Move the stage at `index` up (-1) or down (+1). Returns the same list when it cannot move. */
export function moveStage(list: string[], index: number, delta: -1 | 1): string[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

export type PanelStageRow = {
  panel_id: string;
  stage: string;
  sequence: number;
  is_applicable: boolean;
};

/** One panel's assigned stages in their saved execution order. */
export function panelStageOrder(rows: PanelStageRow[], panelId: string): string[] {
  return rows
    .filter((r) => r.panel_id === panelId && r.is_applicable)
    .sort((a, b) => a.sequence - b.sequence || rank(a.stage) - rank(b.stage))
    .map((r) => r.stage);
}

/** One panel's stages: assigned ones in saved order first, then the unassigned ones. */
export function panelFullOrder(rows: PanelStageRow[], panelId: string): string[] {
  const mine = rows.filter((r) => r.panel_id === panelId);
  if (mine.length === 0) return DEFAULT_ORDER;
  const assigned = panelStageOrder(rows, panelId);
  const rest = DEFAULT_ORDER.filter((s) => !assigned.includes(s));
  return [...assigned, ...rest];
}

/**
 * Column order for a grid shared by several panels: stages sorted by their average saved position
 * among the panels that use them (so identical sequences give exactly that sequence); stages nobody
 * uses follow in library order.
 */
export function deriveColumnOrder(rows: PanelStageRow[]): string[] {
  const used = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (!r.is_applicable) continue;
    const e = used.get(r.stage) ?? { sum: 0, n: 0 };
    e.sum += r.sequence;
    e.n += 1;
    used.set(r.stage, e);
  }
  const active = [...used.keys()].sort(
    (a, b) =>
      used.get(a)!.sum / used.get(a)!.n - used.get(b)!.sum / used.get(b)!.n || rank(a) - rank(b),
  );
  return [...active, ...DEFAULT_ORDER.filter((s) => !used.has(s))];
}
