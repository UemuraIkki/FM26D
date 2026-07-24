import { runSeason } from "../sim/season.js";
import { computeCalibration, CALIBRATION_TARGETS } from "../stats/calibration.js";

/**
 * Headless CLI (Phase A).
 *   npm run season    -- [--seed 12345] [--year 2026]
 *   npm run calibrate -- [--seasons 50] [--seed 1]
 */

const LEAGUE_PATH = "data/leagues/premier-league.json";

function argValue(name: string, fallback: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) {
    const v = Number(process.argv[idx + 1]);
    if (!Number.isNaN(v)) return v;
  }
  return fallback;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function commandSeason(): void {
  const seed = argValue("seed", 20260808);
  const year = argValue("year", 2026);
  const report = runSeason({ leaguePath: LEAGUE_PATH, seed, startYear: year });

  console.log(`\n=== ${report.seasonLabel} final table (seed=${seed}) ===\n`);
  console.log("Pos Club                      P   W  D  L   GF  GA  GD  Pts");
  report.table.sorted().forEach((row, i) => {
    console.log(
      `${String(i + 1).padStart(2)}  ${row.clubId.padEnd(24)} ${String(row.played).padStart(3)} ${String(row.won).padStart(3)} ${String(row.drawn).padStart(2)} ${String(row.lost).padStart(2)} ${String(row.goalsFor).padStart(4)} ${String(row.goalsAgainst).padStart(3)} ${String(row.goalDifference).padStart(4)} ${String(row.points).padStart(4)}`,
    );
  });

  const stats = computeCalibration(report.matches);
  console.log(`\nGoals/match: ${stats.goalsPerMatch.toFixed(2)}  Pass%: ${pct(stats.passSuccessRate)}  Shots/team: ${stats.shotsPerTeamPerMatch.toFixed(1)}`);
  console.log(`Home/Draw/Away: ${pct(stats.homeWinRate)} / ${pct(stats.drawRate)} / ${pct(stats.awayWinRate)}  (home adv: ${pct(stats.homeAdvantage)})`);
}

function commandCalibrate(): void {
  const seasons = argValue("seasons", 50);
  const baseSeed = argValue("seed", 1);
  const all = [];
  const start = Date.now();
  for (let s = 0; s < seasons; s++) {
    const report = runSeason({ leaguePath: LEAGUE_PATH, seed: baseSeed + s, startYear: 2026 });
    all.push(...report.matches);
  }
  const elapsed = (Date.now() - start) / 1000;
  const stats = computeCalibration(all);

  console.log(`\n=== Calibration over ${seasons} seasons (${stats.matches} matches, ${elapsed.toFixed(1)}s) ===\n`);
  const rows: Array<[string, string, string, boolean]> = [
    ["goals/match", stats.goalsPerMatch.toFixed(2), "2.60-2.80", stats.goalsPerMatch >= CALIBRATION_TARGETS.goalsPerMatch.min && stats.goalsPerMatch <= CALIBRATION_TARGETS.goalsPerMatch.max],
    ["pass success", pct(stats.passSuccessRate), "78%-85%", stats.passSuccessRate >= CALIBRATION_TARGETS.passSuccessRate.min && stats.passSuccessRate <= CALIBRATION_TARGETS.passSuccessRate.max],
    ["shots/team", stats.shotsPerTeamPerMatch.toFixed(1), "11-14", stats.shotsPerTeamPerMatch >= CALIBRATION_TARGETS.shotsPerTeamPerMatch.min && stats.shotsPerTeamPerMatch <= CALIBRATION_TARGETS.shotsPerTeamPerMatch.max],
    ["home advantage", pct(stats.homeAdvantage), "8%-10%", stats.homeAdvantage >= CALIBRATION_TARGETS.homeAdvantage.min && stats.homeAdvantage <= CALIBRATION_TARGETS.homeAdvantage.max],
  ];
  for (const [name, value, target, ok] of rows) {
    console.log(`${ok ? "OK " : "NG "} ${name.padEnd(16)} ${value.padStart(8)}   (target ${target})`);
  }
  console.log(`\nH/D/A: ${pct(stats.homeWinRate)} / ${pct(stats.drawRate)} / ${pct(stats.awayWinRate)}`);
}

const command = process.argv[2];
if (command === "season") commandSeason();
else if (command === "calibrate") commandCalibrate();
else {
  console.log("usage: main.ts <season|calibrate> [--seed N] [--year N] [--seasons N]");
  process.exit(1);
}
