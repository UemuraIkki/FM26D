import { describe, expect, it } from "vitest";
import { buildWorld, getSquad, transferPlayer } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

describe("persistent world", () => {
  it("keeps mutations (transfers) across seasons", () => {
    const world = buildWorld(42, [LEAGUE_PATH]);
    const arsenal = getSquad(world, "ARS");
    const mover = arsenal[0]!;
    transferPlayer(world, mover.id, "CHE");

    expect(mover.clubId).toBe("CHE");
    expect(getSquad(world, "ARS").some((p) => p.id === mover.id)).toBe(false);
    expect(getSquad(world, "CHE").some((p) => p.id === mover.id)).toBe(true);

    // Running a season must not rebuild squads and erase the transfer.
    runSeason(world, { startYear: 2026, keepMatches: false });
    expect(getSquad(world, "CHE").some((p) => p.id === mover.id)).toBe(true);
    expect(getSquad(world, "ARS").some((p) => p.id === mover.id)).toBe(false);
  });

  it("keeps clubId and the club index consistent (single ownership path)", () => {
    const world = buildWorld(7, [LEAGUE_PATH]);
    const player = getSquad(world, "LIV")[3]!;
    transferPlayer(world, player.id, "EVE");
    // Every player appears in exactly the index bucket matching clubId.
    for (const [clubId, squad] of world.playersByClub) {
      for (const p of squad) expect(p.clubId).toBe(clubId);
    }
    // No duplicates across buckets.
    const seen = new Set<string>();
    for (const squad of world.playersByClub.values()) {
      for (const p of squad) {
        expect(seen.has(p.id)).toBe(false);
        seen.add(p.id);
      }
    }
    expect(seen.size).toBe(world.players.length);
  });

  it("rejects unknown players and clubs", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    expect(() => transferPlayer(world, "nope", "ARS")).toThrow();
    expect(() => transferPlayer(world, getSquad(world, "ARS")[0]!.id, "XXX")).toThrow();
  });
});
