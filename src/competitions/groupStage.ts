import { compareIds, type Rng } from "../core/rng.js";

/**
 * Shared group-stage primitives for the Champions League and international
 * tournaments (World Cup / EURO) — both run a seeded-pot draw into round-
 * robin groups, standard points/GD/GF standings, and single-leg knockout
 * shuffles.
 */

export interface GroupRow {
  id: string;
  points: number;
  gf: number;
  ga: number;
}

export type GroupOutcome = "HOME" | "AWAY" | "DRAW";

/** Applies a group match's score to both rows; returns the outcome for stage-specific side effects (e.g. prize money). */
export function applyGroupResult(
  table: readonly GroupRow[],
  homeId: string,
  awayId: string,
  homeGoals: number,
  awayGoals: number,
): GroupOutcome {
  const homeRow = table.find((r) => r.id === homeId)!;
  const awayRow = table.find((r) => r.id === awayId)!;
  homeRow.gf += homeGoals;
  homeRow.ga += awayGoals;
  awayRow.gf += awayGoals;
  awayRow.ga += homeGoals;
  if (homeGoals > awayGoals) {
    homeRow.points += 3;
    return "HOME";
  }
  if (homeGoals < awayGoals) {
    awayRow.points += 3;
    return "AWAY";
  }
  homeRow.points++;
  awayRow.points++;
  return "DRAW";
}

/** Points → goal difference → goals-for → id tiebreak, best first. */
export function sortGroupTable(rows: readonly GroupRow[]): GroupRow[] {
  return [...rows].sort(
    (a, b) => b.points - a.points || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || compareIds(a.id, b.id),
  );
}

/** In-place Fisher-Yates shuffle via the project's seeded Rng (requirement 3.2: never Math.random). */
export function shuffle<T>(rng: Rng, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}
