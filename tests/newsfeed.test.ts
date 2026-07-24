import { describe, expect, it } from "vitest";
import { deriveNewsFeed } from "../src/observe/newsFeed.js";
import { buildWorld } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

describe("news feed (requirement 6.1)", () => {
  it("normalizes a season report into a chronologically-sorted event stream", () => {
    const world = buildWorld(9, [LEAGUE_PATH]);
    const prevCaps = new Map(world.capsByPlayer);
    const prevApps = new Map(world.appearancesByPlayer);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });

    const events = deriveNewsFeed(report, world, prevCaps, prevApps);
    expect(events.length).toBeGreaterThan(0);

    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1]!.date <= events[i]!.date).toBe(true);
    }

    const types = new Set(events.map((e) => e.type));
    expect(types.has("TRANSFER")).toBe(true);
    expect(types.has("TITLE")).toBe(true);

    // Every id is unique.
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);

    // Title event actually names the season's league champion.
    const champion = report.table.sorted()[0]!.clubId;
    const titleEvent = events.find((e) => e.type === "TITLE" && e.data.competition === "ENG1");
    expect(titleEvent?.clubId).toBe(champion);
  });

  it("detects manager sackings/hirings and retirements", () => {
    const world = buildWorld(20260724, [LEAGUE_PATH]);
    let report = null;
    for (let s = 0; s < 5 && !report; s++) {
      const r = runSeason(world, { startYear: 2026 + s, keepMatches: false });
      if (r.managerChanges.length > 0 && r.development.retiredPlayers.length > 0) report = r;
    }
    expect(report).not.toBeNull();
    const events = deriveNewsFeed(report!, world);
    expect(events.some((e) => e.type === "MANAGER_SACKED")).toBe(true);
    expect(events.some((e) => e.type === "MANAGER_HIRED")).toBe(true);
    expect(events.some((e) => e.type === "RETIREMENT")).toBe(true);
  });

  it("is deterministic per seed", () => {
    const run = (seed: number) => {
      const world = buildWorld(seed, [LEAGUE_PATH]);
      const report = runSeason(world, { startYear: 2026, keepMatches: false });
      return deriveNewsFeed(report, world)
        .map((e) => `${e.id}:${e.type}:${e.summary}`)
        .join("|");
    };
    expect(run(13)).toBe(run(13));
  });
});
