import { getRoleBook } from "../model/roles.js";
import { buildWorld, getSquad, type World } from "../model/world.js";
import { runSeason } from "../sim/season.js";
import { buildDepthChart } from "../squad/depthChart.js";
import { CalibrationAccumulator, computeCalibration, CALIBRATION_TARGETS } from "../stats/calibration.js";
import { deriveNewsFeed } from "../observe/newsFeed.js";
import { addToWatchlist, removeFromWatchlist, watchlistStatuses } from "../observe/tracking.js";
import { loadCheckpoint, queryNewsEvents, saveCheckpoint, type NewsEventQuery } from "../persist/checkpoint.js";
import { evaluateHealthCheck, healthCheckToCsv, runHealthCheck, summarizeHealthCheck } from "../stats/healthCheck.js";
import { writeFileSync } from "node:fs";

/**
 * Headless CLI (Phase A; observation commands added Phase I).
 *   npm run season      -- [--seed 12345] [--year 2026]
 *   npm run calibrate   -- [--seasons 50] [--seed 1]
 *   npm run play        -- [--seed N] --seasons N [--until YEAR] --db <path> [--resume]
 *   npm run feed        -- --db <path> [--player ID] [--type TYPE] [--limit N]
 *   npm run watch       -- --db <path> --player ID
 *   npm run unwatch     -- --db <path> --player ID
 *   npm run watchlist   -- --db <path>
 *   npm run healthcheck -- [--seed N] [--seasons 10] [--out path.csv]
 *
 * `play`'s checkpoints are season-granularity, not day-granularity (see the
 * Phase I plan / README) — "指定日到達での自動一時停止" (--until) stops
 * once a season boundary reaches the target year, not an arbitrary day.
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

  console.log(`\n=== Transfers (${report.transfers.length}) ===`);
  for (const t of report.transfers) {
    const fee = t.fee > 0 ? `£${t.fee.toFixed(1)}M` : "free";
    console.log(`${t.date}  ${t.playerName.padEnd(24)} ${(t.fromClubId ?? "FA").padEnd(4)} -> ${t.toClubId.padEnd(4)} ${fee}`);
  }
  console.log(`\n=== Refused moves (${report.refusals.length}) ===`);
  for (const r of report.refusals) {
    console.log(`${r.date}  ${r.playerName.padEnd(24)} ${(r.fromClubId ?? "FA").padEnd(4)} -> ${r.toClubId.padEnd(4)} refused: ${r.reason}`);
  }
  console.log(`\n=== Manager changes (${report.managerChanges.length}) ===`);
  for (const c of report.managerChanges) {
    console.log(`${c.date}  ${c.clubId.padEnd(4)} ${c.outManagerName} -> ${c.inManagerName}  (${c.reason})`);
  }
  console.log(`\nContracts: ${report.contractSummary.renewed} renewed, ${report.contractSummary.released} released to free agency`);
  const drift = world.ledger.conservationDrift();
  console.log(`Money conservation drift: ${drift} (must be 0)`);
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

function commandPlay(): void {
  const seed = argValue("seed", 20260808);
  const seasons = argValue("seasons", 1);
  const untilStr = argString("until");
  const until = untilStr !== undefined ? Number(untilStr) : undefined;
  const dbPath = argString("db") ?? "fm26d.sqlite";
  const resume = process.argv.includes("--resume");

  let world: World;
  let startYear: number;
  if (resume) {
    const loaded = loadCheckpoint(dbPath);
    if (!loaded) {
      console.log(`no checkpoint found at ${dbPath}`);
      process.exit(1);
    }
    world = loaded.world;
    startYear = loaded.nextStartYear;
    console.log(`resumed from ${dbPath}: next season ${startYear}`);
  } else {
    world = buildWorld(seed, [LEAGUE_PATH]);
    startYear = 2026;
    console.log(`new world seed=${seed}, starting ${startYear}, saving to ${dbPath}`);
  }

  let seasonsRun = 0;
  while (seasonsRun < seasons && (until === undefined || startYear <= until)) {
    const prevCaps = new Map(world.capsByPlayer);
    const prevApps = new Map(world.appearancesByPlayer);
    const report = runSeason(world, { startYear, keepMatches: false });
    const events = deriveNewsFeed(report, world, prevCaps, prevApps);
    saveCheckpoint(dbPath, world, startYear + 1, events);
    console.log(`season ${startYear}: champion=${report.table.sorted()[0]?.clubId ?? "?"}  events=${events.length}  checkpoint saved`);
    startYear += 1;
    seasonsRun += 1;
  }
  console.log(`\nplay finished: ${seasonsRun} season(s) run; resume with --resume to continue from season ${startYear}`);
}

function commandFeed(): void {
  const dbPath = argString("db") ?? "fm26d.sqlite";
  const player = argString("player");
  const type = argString("type");
  const limit = argValue("limit", 50);
  const query: NewsEventQuery = { limit };
  if (player) query.playerId = player;
  if (type) query.type = type;

  const events = queryNewsEvents(dbPath, query);
  if (events.length === 0) console.log("(no events)");
  for (const e of events) console.log(`${e.date}  [${e.type}]  ${e.summary}`);
}

function commandWatchToggle(add: boolean): void {
  const dbPath = argString("db") ?? "fm26d.sqlite";
  const playerId = argString("player");
  if (!playerId) {
    console.log("usage: watch|unwatch --db <path> --player <id>");
    process.exit(1);
  }
  const loaded = loadCheckpoint(dbPath);
  if (!loaded) {
    console.log(`no checkpoint at ${dbPath}`);
    process.exit(1);
  }
  if (add) addToWatchlist(loaded.world, playerId);
  else removeFromWatchlist(loaded.world, playerId);
  saveCheckpoint(dbPath, loaded.world, loaded.nextStartYear, []);
  console.log(`${add ? "watching" : "unwatched"} ${playerId}`);
}

function commandWatchlist(): void {
  const dbPath = argString("db") ?? "fm26d.sqlite";
  const loaded = loadCheckpoint(dbPath);
  if (!loaded) {
    console.log(`no checkpoint at ${dbPath}`);
    process.exit(1);
  }
  const statuses = watchlistStatuses(loaded.world);
  if (statuses.length === 0) {
    console.log("(watchlist empty)");
    return;
  }
  for (const s of statuses) {
    if (s.player) {
      console.log(
        `${s.playerId}  ${s.player.name.padEnd(24)} ${(s.player.clubId ?? "FA").padEnd(4)}  age ${s.player.age}  ability ${s.ability?.toFixed(1)}  apps ${s.apps}  caps ${s.caps}`,
      );
    } else {
      console.log(`${s.playerId}  ${(s.archived?.aggregate.name ?? "?").padEnd(24)} RETIRED  apps ${s.apps}  caps ${s.caps}  notable=${s.archived?.notable}`);
    }
  }
}

/**
 * Long-term health check (non-functional requirement 7, 必須): run N
 * seasons on one persistent world, track league average age/ability,
 * money conservation, champion concentration (Gini) and the
 * retirement-vs-academy-intake balance, write a CSV, and print
 * threshold pass/fail for each metric.
 */
function commandHealthCheck(): void {
  const seed = argValue("seed", 20260808);
  const seasons = argValue("seasons", 10);
  const outPath = argString("out") ?? "healthcheck.csv";
  const world = buildWorld(seed, [LEAGUE_PATH]);

  console.log(`\n=== Long-term health check: ${seasons} seasons (seed=${seed}) ===\n`);
  const rows = runHealthCheck(world, 2026, seasons);
  const summary = summarizeHealthCheck(world, rows);

  writeFileSync(outPath, healthCheckToCsv(rows), "utf8");
  console.log(`CSV written to ${outPath}\n`);

  for (const { metric, ok, detail } of evaluateHealthCheck(summary)) {
    console.log(`${ok ? "OK " : "NG "} ${metric.padEnd(28)} ${detail}`);
  }
}

const command = process.argv[2];
if (command === "season") commandSeason();
else if (command === "calibrate") commandCalibrate();
else if (command === "depth") commandDepth();
else if (command === "play") commandPlay();
else if (command === "feed") commandFeed();
else if (command === "watch") commandWatchToggle(true);
else if (command === "unwatch") commandWatchToggle(false);
else if (command === "watchlist") commandWatchlist();
else if (command === "healthcheck") commandHealthCheck();
else {
  console.log(
    "usage: main.ts <season|calibrate|depth|play|feed|watch|unwatch|watchlist|healthcheck> [--seed N] [--year N] [--seasons N] [--club ID] [--db PATH] [--player ID] [--until YEAR] [--resume] [--out PATH]",
  );
  process.exit(1);
}
