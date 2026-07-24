import { describe, expect, it } from "vitest";
import { runSeason } from "../src/sim/season.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

function seasonFingerprint(seed: number): string {
  const report = runSeason({ leaguePath: LEAGUE_PATH, seed, startYear: 2026 });
  const table = report.table
    .sorted()
    .map((r) => `${r.clubId}:${r.points}:${r.goalDifference}`)
    .join("|");
  const scores = report.matches.map((m) => `${m.fixture.id}=${m.result.homeGoals}-${m.result.awayGoals}`).join(",");
  const eventCount = report.matches.reduce((sum, m) => sum + m.result.events.length, 0);
  return `${table}#${scores}#${eventCount}`;
}

describe("determinism (requirement 3.2)", () => {
  it("reproduces the identical season for the same seed", () => {
    expect(seasonFingerprint(123456)).toBe(seasonFingerprint(123456));
  });

  it("produces different histories for different seeds", () => {
    expect(seasonFingerprint(1)).not.toBe(seasonFingerprint(2));
  });
});
