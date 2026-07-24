import { describe, expect, it } from "vitest";
import {
  applyMatchMorale,
  applyTransferMorale,
  atmosphereOf,
  MAX_MORALE_EFFECT,
  moraleDailyTick,
  moraleMultiplier,
  moraleOf,
} from "../src/morale/morale.js";
import { buildWorld, getSquad } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";
import { selectStartingXI } from "../src/sim/lineup.js";
import { computeCalibration } from "../src/stats/calibration.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

describe("morale system (requirement 4.7)", () => {
  it("mean-reverts toward baselines and stays within [0, 100]", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const player = getSquad(world, "ARS")[0]!;
    const state = moraleOf(world, player.id);
    state.morale = 5;
    state.satisfaction = 98;
    for (let day = 0; day < 400; day++) moraleDailyTick(world);
    expect(state.morale).toBeGreaterThan(40);
    expect(state.morale).toBeLessThanOrEqual(100);
    expect(state.satisfaction).toBeLessThan(70);
    for (const s of world.moraleByPlayer.values()) {
      expect(s.morale).toBeGreaterThanOrEqual(0);
      expect(s.morale).toBeLessThanOrEqual(100);
    }
  });

  it("wins lift the squad, losses hurt starters more, benching erodes satisfaction", () => {
    const world = buildWorld(2, [LEAGUE_PATH]);
    const sheet = selectStartingXI("ARS", getSquad(world, "ARS"));
    const starter = moraleOf(world, sheet.players[0]!.id);
    const benched = getSquad(world, "ARS").find((p) => !sheet.players.some((x) => x.id === p.id))!;
    const benchState = moraleOf(world, benched.id);

    const m0 = starter.morale;
    applyMatchMorale(world, "ARS", sheet, "WIN");
    expect(starter.morale).toBeGreaterThan(m0);

    const sat0 = benchState.satisfaction;
    for (let i = 0; i < 8; i++) applyMatchMorale(world, "ARS", sheet, "DRAW");
    expect(benchState.satisfaction).toBeLessThan(sat0);
    // 8 draws + the WIN above, all outside the XI.
    expect(benchState.benchStreak).toBe(9);

    const atm0 = atmosphereOf(world, "ARS");
    applyMatchMorale(world, "ARS", sheet, "LOSS");
    expect(atmosphereOf(world, "ARS")).toBeLessThan(atm0);
  });

  it("caps the match-day multiplier at ±5% even at extremes", () => {
    const world = buildWorld(3, [LEAGUE_PATH]);
    const player = getSquad(world, "LIV")[0]!;
    const state = moraleOf(world, player.id);
    state.morale = 100;
    state.satisfaction = 100;
    world.atmosphereByClub.set("LIV", 100);
    expect(moraleMultiplier(world, "LIV", player.id)).toBeLessThanOrEqual(1 + MAX_MORALE_EFFECT);
    state.morale = 0;
    state.satisfaction = 0;
    world.atmosphereByClub.set("LIV", 0);
    expect(moraleMultiplier(world, "LIV", player.id)).toBeGreaterThanOrEqual(1 - MAX_MORALE_EFFECT);
  });

  it("a transfer resets the mover and ripples both dressing rooms", () => {
    const world = buildWorld(4, [LEAGUE_PATH]);
    const player = getSquad(world, "CHE")[0]!;
    const state = moraleOf(world, player.id);
    state.morale = 30;
    state.benchStreak = 6;
    const fromAtm = atmosphereOf(world, "CHE");
    applyTransferMorale(world, player.id, "CHE", "AVL");
    expect(state.morale).toBeGreaterThanOrEqual(70);
    expect(state.benchStreak).toBe(0);
    expect(atmosphereOf(world, "CHE")).toBeLessThan(fromAtm);
  });
});

describe("Phase E completion: no divergence over 10 seasons", () => {
  it("morale and the simulated world stay bounded and sane", { timeout: 120_000 }, () => {
    const world = buildWorld(20260724, [LEAGUE_PATH]);
    const leagueAverages: number[] = [];
    let lastGoalsPerMatch = 0;

    for (let s = 0; s < 10; s++) {
      const acc: { sum: number; n: number } = { sum: 0, n: 0 };
      const report = runSeason(world, { startYear: 2026 + s, keepMatches: true });
      const stats = computeCalibration(report.matches);
      lastGoalsPerMatch = stats.goalsPerMatch;

      for (const state of world.moraleByPlayer.values()) {
        expect(state.morale).toBeGreaterThanOrEqual(0);
        expect(state.morale).toBeLessThanOrEqual(100);
        expect(state.satisfaction).toBeGreaterThanOrEqual(0);
        expect(state.satisfaction).toBeLessThanOrEqual(100);
        acc.sum += state.morale;
        acc.n++;
      }
      leagueAverages.push(acc.sum / acc.n);
      for (const value of world.atmosphereByClub.values()) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }

    // League-average morale must hover in a healthy band every season,
    // not drift monotonically to a rail (positive-feedback divergence).
    for (const avg of leagueAverages) {
      expect(avg).toBeGreaterThan(35);
      expect(avg).toBeLessThan(80);
    }
    // The football itself is still sane after 10 seasons of compounding state.
    expect(lastGoalsPerMatch).toBeGreaterThan(1.5);
    expect(lastGoalsPerMatch).toBeLessThan(4.0);
  });
});
