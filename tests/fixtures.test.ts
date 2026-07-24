import { describe, expect, it } from "vitest";
import { dayOfWeek } from "../src/core/calendar.js";
import { generateSeasonFixtures } from "../src/schedule/fixtures.js";

const CLUBS = Array.from({ length: 20 }, (_, i) => `C${String(i).padStart(2, "0")}`);
const START = { year: 2026, month: 8, day: 8 };

describe("fixtures", () => {
  it("generates a full double round-robin", () => {
    const fixtures = generateSeasonFixtures(1, "TEST-2026", CLUBS, START);
    expect(fixtures).toHaveLength(380); // 20 clubs -> 38 rounds x 10 matches

    // Every ordered pair (home, away) appears exactly once.
    const seen = new Set<string>();
    for (const f of fixtures) {
      const key = `${f.homeClubId}-${f.awayClubId}`;
      expect(f.homeClubId).not.toBe(f.awayClubId);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(380);
  });

  it("gives every club exactly one match per round", () => {
    const fixtures = generateSeasonFixtures(2, "TEST-2026", CLUBS, START);
    for (let round = 1; round <= 38; round++) {
      const inRound = fixtures.filter((f) => f.round === round);
      expect(inRound).toHaveLength(10);
      const clubs = new Set(inRound.flatMap((f) => [f.homeClubId, f.awayClubId]));
      expect(clubs.size).toBe(20);
    }
  });

  it("schedules all matches on Saturdays", () => {
    const fixtures = generateSeasonFixtures(3, "TEST-2026", CLUBS, START);
    for (const f of fixtures) expect(dayOfWeek(f.date)).toBe(6);
  });

  it("is deterministic per seed and varies across seeds", () => {
    const a = generateSeasonFixtures(5, "TEST-2026", CLUBS, START);
    const b = generateSeasonFixtures(5, "TEST-2026", CLUBS, START);
    const c = generateSeasonFixtures(6, "TEST-2026", CLUBS, START);
    expect(a).toEqual(b);
    expect(a.map((f) => f.homeClubId).join(",")).not.toBe(c.map((f) => f.homeClubId).join(","));
  });
});
