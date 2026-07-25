import { describe, expect, it } from "vitest";
import { AIDecisionMaker } from "../src/decision/aiDecisionMaker.js";
import type { SquadContext } from "../src/decision/clubDecisionMaker.js";
import { getRoleBook } from "../src/model/roles.js";
import type { Club, Player, PlayerAttributes } from "../src/model/types.js";
import { buildWorld, getSquad } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

function makeAttrs(value: number): PlayerAttributes {
  return {
    passing: value, shooting: value, dribbling: value, defending: value, aerial: value,
    speed: value, stamina: value, strength: value, agility: value,
    decisions: value, positioning: value, finishing: value, ambition: value, professionalism: value,
    shotStopping: value, aerialHandling: value, distribution: value,
  };
}

function makePlayer(id: string): Player {
  return {
    id,
    name: id,
    clubId: "ARS",
    position: "FW",
    age: 26,
    attributes: makeAttrs(80),
    contract: null,
    nationality: "",
    potential: 80,
  };
}

describe("transfer cooldown: no reselling a player days after buying them", () => {
  it("respondToOffer refuses an offer for a player the club acquired earlier this window", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const roleBook = getRoleBook();
    const brain = new AIDecisionMaker("ARS");
    const club: Club = { id: "ARS", name: "Arsenal", shortName: "Arsenal", strength: 88 };
    const player = makePlayer("RECENT");
    const context: SquadContext = {
      squad: getSquad(world, "ARS"),
      roleBook,
      formation: roleBook.defaultFormation,
      balance: 1000,
      currentYear: 2026,
      club,
      recentlyAcquired: new Set(["RECENT"]),
    };
    // Even a wildly generous offer must be refused while on cooldown.
    expect(brain.respondToOffer(context, player, 1_000_000)).toBe(false);
  });

  it("respondToOffer is unaffected when recentlyAcquired is absent (season-end contract contexts)", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const roleBook = getRoleBook();
    const brain = new AIDecisionMaker("ARS");
    const club: Club = { id: "ARS", name: "Arsenal", shortName: "Arsenal", strength: 88 };
    const player = makePlayer("NOT-RECENT");
    const context: SquadContext = {
      squad: getSquad(world, "ARS"),
      roleBook,
      formation: roleBook.defaultFormation,
      balance: 1000,
      currentYear: 2026,
      club,
    };
    // askingFeeFor a fringe player generated above is modest; a huge offer clears it.
    expect(brain.respondToOffer(context, player, 1_000_000)).toBe(true);
  });

  it("Phase C completion (regression): no player transfers twice within the same window over a full season", () => {
    const world = buildWorld(2026, [LEAGUE_PATH]);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });

    const windowKey = (dateStr: string): string => {
      const [year, month] = dateStr.split("-").map(Number);
      if (month === 7 || month === 8) return `${year}-summer`;
      return `${year}-${month}`; // winter (Jan) or any other month, kept distinct
    };
    const seen = new Set<string>();
    for (const t of report.transfers) {
      const key = `${t.playerId}:${windowKey(t.date)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
