import { describe, expect, it } from "vitest";
import { hashLabel } from "../src/core/rng.js";
import { buildWorld } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

/**
 * Requirement 3.2: same seed => byte-identical history. The fingerprint
 * covers fixtures (participants + dates), every event (actor, opponent,
 * type, tick, zone, phase, outcome) and every rating — not just scorelines.
 */
function seasonFingerprint(seed: number): string {
  const world = buildWorld(seed, [LEAGUE_PATH]);
  let hash = 0;
  const mix = (s: string): void => {
    hash = (Math.imul(hash, 31) + hashLabel(s)) >>> 0;
  };
  const report = runSeason(world, {
    startYear: 2026,
    keepMatches: false,
    onMatch: ({ fixture, result }) => {
      mix(`${fixture.id}|${fixture.homeClubId}|${fixture.awayClubId}|${fixture.date.year}-${fixture.date.month}-${fixture.date.day}`);
      for (const e of result.events) {
        mix(`${e.tick}:${e.type}:${e.teamId}:${e.playerId ?? ""}:${e.opponentId ?? ""}:${e.assistId ?? ""}:${e.zone ?? ""}:${e.phase ?? ""}:${e.success ?? ""}`);
      }
      for (const [id, rating] of Object.entries(result.ratings)) mix(`${id}=${rating}`);
    },
  });
  const table = report.table
    .sorted()
    .map((r) => `${r.clubId}:${r.points}:${r.goalDifference}:${r.goalsFor}`)
    .join("|");
  return `${table}#${hash}`;
}

describe("determinism (requirement 3.2)", () => {
  it("reproduces the identical season for the same seed", () => {
    expect(seasonFingerprint(123456)).toBe(seasonFingerprint(123456));
  });

  it("produces different histories for different seeds", () => {
    expect(seasonFingerprint(1)).not.toBe(seasonFingerprint(2));
  });
});
