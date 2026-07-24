import { describe, expect, it } from "vitest";
import { createRng, deriveRng } from "../src/core/rng.js";
import { simulateMatch } from "../src/engine/index.js";
import { loadLeague } from "../src/model/loader.js";
import { generateSquad } from "../src/model/playerGen.js";
import { buildWorld } from "../src/model/world.js";
import { selectStartingXI } from "../src/sim/lineup.js";
import { computeCalibration } from "../src/stats/calibration.js";
import { runSeason } from "../src/sim/season.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

function sheets(seed: number, homeId: string, awayId: string) {
  const league = loadLeague(LEAGUE_PATH);
  const home = league.clubs.find((c) => c.id === homeId)!;
  const away = league.clubs.find((c) => c.id === awayId)!;
  return {
    home: selectStartingXI(home.id, generateSquad(seed, home)),
    away: selectStartingXI(away.id, generateSquad(seed, away)),
  };
}

describe("match engine", () => {
  it("produces a full event log with kickoff and full time", () => {
    const { home, away } = sheets(1, "ARS", "CHE");
    const result = simulateMatch(home, away, createRng(99));
    expect(result.events[0]?.type).toBe("KICKOFF");
    expect(result.events.at(-1)?.type).toBe("FULL_TIME");
    expect(result.events.some((e) => e.type === "HALF_TIME")).toBe(true);
    expect(result.events.length).toBeGreaterThan(500); // ~720 ticks, most log something
    // Goals in the log match the score.
    const loggedGoals = result.events.filter((e) => e.type === "GOAL").length;
    expect(loggedGoals).toBe(result.homeGoals + result.awayGoals);
  });

  it("rates every starter from the event log", () => {
    const { home, away } = sheets(2, "LIV", "EVE");
    const result = simulateMatch(home, away, createRng(7));
    for (const p of [...home.players, ...away.players]) {
      const rating = result.ratings[p.id];
      expect(rating).toBeDefined();
      expect(rating!).toBeGreaterThanOrEqual(4);
      expect(rating!).toBeLessThanOrEqual(10);
    }
  });

  it("is deterministic for the same rng seed", () => {
    const { home, away } = sheets(3, "MCI", "TOT");
    const a = simulateMatch(home, away, deriveRng(10, "m"));
    const b = simulateMatch(home, away, deriveRng(10, "m"));
    expect(a.homeGoals).toBe(b.homeGoals);
    expect(a.awayGoals).toBe(b.awayGoals);
    expect(a.events).toEqual(b.events);
  });

  it("lets stronger squads dominate over many matches", () => {
    const { home, away } = sheets(4, "LIV", "BUR"); // 89 vs 65
    let strongPoints = 0;
    let weakPoints = 0;
    for (let i = 0; i < 60; i++) {
      const r = simulateMatch(home, away, deriveRng(i, "dom"));
      if (r.homeGoals > r.awayGoals) strongPoints += 3;
      else if (r.homeGoals < r.awayGoals) weakPoints += 3;
      else {
        strongPoints++;
        weakPoints++;
      }
    }
    expect(strongPoints).toBeGreaterThan(weakPoints * 1.5);
  });
});

describe("calibration sanity (loose bounds)", () => {
  it("season-level stats are in a plausible football range", () => {
    const world = buildWorld(777, [LEAGUE_PATH]);
    const report = runSeason(world, { startYear: 2026 });
    const stats = computeCalibration(report.matches);
    // Wide guards, not the strict 3.4 targets: those are enforced via `npm run calibrate`.
    expect(stats.goalsPerMatch).toBeGreaterThan(1.8);
    expect(stats.goalsPerMatch).toBeLessThan(3.8);
    expect(stats.passSuccessRate).toBeGreaterThan(0.7);
    expect(stats.passSuccessRate).toBeLessThan(0.92);
    expect(stats.shotsPerTeamPerMatch).toBeGreaterThan(7);
    expect(stats.shotsPerTeamPerMatch).toBeLessThan(19);
    expect(stats.homeWinRate).toBeGreaterThan(stats.awayWinRate);
  });
});
