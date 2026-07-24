import { describe, expect, it } from "vitest";
import { boardConfidenceOf, expectedPositions, managerMultiplier, managerOf } from "../src/board/board.js";
import { buildWorld } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

describe("board & manager entities (requirements 5.2 / 5.4)", () => {
  it("every club starts with exactly one manager plus a free market pool", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    for (const club of world.leagues[0]!.clubs) {
      expect(world.managers.filter((m) => m.clubId === club.id)).toHaveLength(1);
    }
    expect(world.managers.filter((m) => m.clubId === null).length).toBeGreaterThanOrEqual(10);
  });

  it("expected positions rank clubs by squad stature", () => {
    const world = buildWorld(2, [LEAGUE_PATH]);
    const clubIds = world.leagues[0]!.clubs.map((c) => c.id);
    const expected = expectedPositions(world, clubIds);
    expect(expected.get("LIV")).toBeLessThanOrEqual(3); // strength 89
    expect(expected.get("BUR")).toBeGreaterThanOrEqual(18); // strength 65
  });

  it("manager tactical quality shifts match ability by at most ±2%", () => {
    const world = buildWorld(3, [LEAGUE_PATH]);
    for (const club of world.leagues[0]!.clubs) {
      const m = managerMultiplier(world, club.id);
      expect(m).toBeGreaterThanOrEqual(0.98);
      expect(m).toBeLessThanOrEqual(1.02);
    }
  });

  it("sacked managers hit the market and are replaced by a different name", () => {
    const world = buildWorld(2026, [LEAGUE_PATH]);
    const before = new Map(
      world.leagues[0]!.clubs.map((c) => [c.id, managerOf(world, c.id).id]),
    );
    const report = runSeason(world, { startYear: 2026, keepMatches: false });
    for (const change of report.managerChanges) {
      expect(change.inManagerId).not.toBe(change.outManagerId);
      expect(before.get(change.clubId)).toBeDefined();
      // The sacked manager is now club-less or has found a new club - never
      // still registered at the club that fired them (unless re-hired later
      // by a different change).
      const outgoing = world.managers.find((m) => m.id === change.outManagerId)!;
      const laterHire = report.managerChanges.some(
        (c) => c !== change && c.inManagerId === change.outManagerId && c.clubId === change.clubId,
      );
      if (!laterHire) expect(outgoing.clubId === change.clubId).toBe(false);
    }
    // Every club still has exactly one manager after the merry-go-round.
    for (const club of world.leagues[0]!.clubs) {
      expect(world.managers.filter((m) => m.clubId === club.id)).toHaveLength(1);
    }
  });

  it("board confidence stays within [0, 100]", () => {
    const world = buildWorld(7, [LEAGUE_PATH]);
    runSeason(world, { startYear: 2026, keepMatches: false });
    for (const club of world.leagues[0]!.clubs) {
      const c = boardConfidenceOf(world, club.id);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(100);
    }
  });
});

describe("Phase F completion: realistic managerial turnover", () => {
  it("averages a plausible number of changes per season over 5 seasons", { timeout: 120_000 }, () => {
    const world = buildWorld(20260724, [LEAGUE_PATH]);
    let total = 0;
    for (let s = 0; s < 5; s++) {
      const report = runSeason(world, { startYear: 2026 + s, keepMatches: false });
      total += report.managerChanges.length;
    }
    const perSeason = total / 5;
    // Real top-flight turnover runs roughly 6-13 changes across 20 clubs.
    expect(perSeason).toBeGreaterThanOrEqual(3);
    expect(perSeason).toBeLessThanOrEqual(15);
  });

  it("is deterministic per seed", () => {
    const run = (seed: number) => {
      const world = buildWorld(seed, [LEAGUE_PATH]);
      const report = runSeason(world, { startYear: 2026, keepMatches: false });
      return report.managerChanges.map((c) => `${c.date}:${c.clubId}:${c.outManagerId}->${c.inManagerId}`).join("|");
    };
    expect(run(999)).toBe(run(999));
  });
});
