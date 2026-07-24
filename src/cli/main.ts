import { getRoleBook } from "../model/roles.js";
import { buildWorld, getSquad } from "../model/world.js";
import { runSeason } from "../sim/season.js";
import { buildDepthChart } from "../squad/depthChart.js";
import { CalibrationAccumulator, computeCalibration, CALIBRATION_TARGETS } from "../stats/calibration.js";

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
  const world = buildWorld(seed, [LEAGUE_PATH]);
  const report = runSeason(world, { startYear: year });

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
  const acc = new CalibrationAccumulator();
  const start = Date.now();
  for (let s = 0; s < seasons; s++) {
    const world = buildWorld(baseSeed + s, [LEAGUE_PATH]);
    runSeason(world, {
      startYear: 2026,
      keepMatches: false,
      onMatch: (m) => acc.add(m),
    });
  }
  const elapsed = (Date.now() - start) / 1000;
  const stats = acc.stats();

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

function argString(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function commandDepth(): void {
  const seed = argValue("seed", 20260808);
  const clubFilter = argString("club");
  const world = buildWorld(seed, [LEAGUE_PATH]);
  const book = getRoleBook();

  for (const club of world.leagues[0]!.clubs) {
    if (clubFilter && club.id !== clubFilter) continue;
    const chart = buildDepthChart(club.id, getSquad(world, club.id), book);

    console.log(`\n=== ${club.name} (${club.id}, str ${club.strength}) ===`);
    if (clubFilter) {
      for (const rd of chart.roles) {
        const top = rd.depth
          .slice(0, 3)
          .map((e, i) => `${i + 1}) ${e.player.name} ${e.score.toFixed(1)}`)
          .join("  ");
        console.log(`${rd.roleId.padEnd(4)} x${rd.slots}  ${top}${rd.shortage ? "  << SHORTAGE" : ""}`);
      }
    }
    const shortages = chart.shortages.map((r) => r.roleId).join(", ") || "none";
    const surplus = chart.surplus.map((p) => `${p.name}(${p.position})`).join(", ") || "none";
    console.log(`shortages: ${shortages}`);
    console.log(`surplus:   ${surplus}`);
  }
}

const command = process.argv[2];
if (command === "season") commandSeason();
else if (command === "calibrate") commandCalibrate();
else if (command === "depth") commandDepth();
else {
  console.log("usage: main.ts <season|calibrate|depth> [--seed N] [--year N] [--seasons N] [--club ID]");
  process.exit(1);
}
