import { playerAbility } from "../finance/value.js";
import { getSquad, type World } from "../model/world.js";
import { runSeason, type SeasonOptions } from "../sim/season.js";
import { giniOfChampions } from "./gini.js";

/**
 * Long-term health check (non-functional requirement 7, 必須): run N
 * seasons on a persistent World and track, per season, exactly the four
 * metrics the requirement names — league average age/ability (inflation/
 * deflation), money conservation, champion concentration (via Gini,
 * src/stats/gini.ts), and the retirement-vs-academy-intake balance —
 * against tests/development.test.ts's threshold bands, plus a CSV
 * artifact so the run is inspectable outside the test suite.
 */
export interface HealthCheckRow {
  season: number;
  avgAge: number;
  avgAbility: number;
  conservationDrift: number;
  champion: string;
  retired: number;
  rookies: number;
}

export interface HealthCheckSummary {
  seasons: number;
  giniOfChampions: number;
  distinctChampions: number;
  totalRetired: number;
  totalRookies: number;
  maxConservationDrift: number;
  minAvgAge: number;
  maxAvgAge: number;
  minAvgAbility: number;
  maxAvgAbility: number;
}

export interface HealthCheckThresholds {
  avgAge: { min: number; max: number };
  avgAbility: { min: number; max: number };
  rookieToRetiredRatio: { min: number; max: number };
  maxConservationDrift: number;
  minDistinctChampions: number;
}

export const HEALTH_CHECK_THRESHOLDS: HealthCheckThresholds = {
  avgAge: { min: 20, max: 30 },
  avgAbility: { min: 40, max: 85 },
  rookieToRetiredRatio: { min: 0.5, max: 3 },
  maxConservationDrift: 1e-6,
  minDistinctChampions: 2,
};

export function runHealthCheck(
  world: World,
  startYear: number,
  seasons: number,
  options: Omit<SeasonOptions, "startYear" | "keepMatches"> = {},
): HealthCheckRow[] {
  const primaryLeagueId = world.leagues[0]!.id;
  const rows: HealthCheckRow[] = [];
  for (let s = 0; s < seasons; s++) {
    const report = runSeason(world, { ...options, startYear: startYear + s, keepMatches: false });
    const squadPlayers = world.leagues[0]!.clubs.flatMap((c) => getSquad(world, c.id));
    const avgAge = squadPlayers.reduce((sum, p) => sum + p.age, 0) / squadPlayers.length;
    const avgAbility = squadPlayers.reduce((sum, p) => sum + playerAbility(p), 0) / squadPlayers.length;
    rows.push({
      season: startYear + s,
      avgAge,
      avgAbility,
      conservationDrift: world.ledger.conservationDrift(),
      champion: report.tables.get(primaryLeagueId)!.sorted()[0]!.clubId,
      retired: report.development.retired,
      rookies: report.development.rookies,
    });
  }
  return rows;
}

export function summarizeHealthCheck(world: World, rows: readonly HealthCheckRow[]): HealthCheckSummary {
  const allClubIds = world.leagues[0]!.clubs.map((c) => c.id);
  const champions = rows.map((r) => r.champion);
  return {
    seasons: rows.length,
    giniOfChampions: giniOfChampions(champions, allClubIds),
    distinctChampions: new Set(champions).size,
    totalRetired: rows.reduce((s, r) => s + r.retired, 0),
    totalRookies: rows.reduce((s, r) => s + r.rookies, 0),
    maxConservationDrift: Math.max(0, ...rows.map((r) => r.conservationDrift)),
    minAvgAge: Math.min(...rows.map((r) => r.avgAge)),
    maxAvgAge: Math.max(...rows.map((r) => r.avgAge)),
    minAvgAbility: Math.min(...rows.map((r) => r.avgAbility)),
    maxAvgAbility: Math.max(...rows.map((r) => r.avgAbility)),
  };
}

/** Per-metric pass/fail against HEALTH_CHECK_THRESHOLDS (threshold monitoring). */
export function evaluateHealthCheck(
  summary: HealthCheckSummary,
  thresholds: HealthCheckThresholds = HEALTH_CHECK_THRESHOLDS,
): Array<{ metric: string; ok: boolean; detail: string }> {
  return [
    {
      metric: "avgAge range",
      ok: summary.minAvgAge >= thresholds.avgAge.min && summary.maxAvgAge <= thresholds.avgAge.max,
      detail: `${summary.minAvgAge.toFixed(2)}-${summary.maxAvgAge.toFixed(2)} (target ${thresholds.avgAge.min}-${thresholds.avgAge.max})`,
    },
    {
      metric: "avgAbility range",
      ok: summary.minAvgAbility >= thresholds.avgAbility.min && summary.maxAvgAbility <= thresholds.avgAbility.max,
      detail: `${summary.minAvgAbility.toFixed(2)}-${summary.maxAvgAbility.toFixed(2)} (target ${thresholds.avgAbility.min}-${thresholds.avgAbility.max})`,
    },
    {
      metric: "money conservation",
      ok: summary.maxConservationDrift <= thresholds.maxConservationDrift,
      detail: `max drift ${summary.maxConservationDrift} (target <= ${thresholds.maxConservationDrift})`,
    },
    {
      metric: "rookie/retired ratio",
      ok:
        summary.totalRetired === 0 ||
        (summary.totalRookies / summary.totalRetired >= thresholds.rookieToRetiredRatio.min &&
          summary.totalRookies / summary.totalRetired <= thresholds.rookieToRetiredRatio.max),
      detail: `${summary.totalRookies}/${summary.totalRetired} = ${(summary.totalRetired ? summary.totalRookies / summary.totalRetired : 0).toFixed(2)} (target ${thresholds.rookieToRetiredRatio.min}-${thresholds.rookieToRetiredRatio.max})`,
    },
    {
      metric: "champion concentration (Gini)",
      ok: summary.distinctChampions >= thresholds.minDistinctChampions,
      detail: `gini=${summary.giniOfChampions.toFixed(3)}, ${summary.distinctChampions} distinct champion(s) over ${summary.seasons} season(s)`,
    },
  ];
}

export function healthCheckToCsv(rows: readonly HealthCheckRow[]): string {
  const header = "season,avg_age,avg_ability,conservation_drift,champion,retired,rookies";
  const lines = rows.map(
    (r) =>
      `${r.season},${r.avgAge.toFixed(3)},${r.avgAbility.toFixed(3)},${r.conservationDrift},${r.champion},${r.retired},${r.rookies}`,
  );
  return [header, ...lines].join("\n") + "\n";
}
