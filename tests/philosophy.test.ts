import { describe, expect, it } from "vitest";
import { candidateScore } from "../src/board/board.js";
import { AIDecisionMaker } from "../src/decision/aiDecisionMaker.js";
import type { SquadContext } from "../src/decision/clubDecisionMaker.js";
import { getRoleBook } from "../src/model/roles.js";
import type { Club, Player, PlayerAttributes } from "../src/model/types.js";
import { buildWorld, getSquad } from "../src/model/world.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";
const FIXTURE_PATH = "tests/fixtures/philosophy-league.json";

function makeAttrs(value: number): PlayerAttributes {
  return {
    passing: value, shooting: value, dribbling: value, defending: value, aerial: value,
    speed: value, stamina: value, strength: value, agility: value,
    decisions: value, positioning: value, finishing: value, ambition: value, professionalism: value,
    shotStopping: value, aerialHandling: value, distribution: value,
  };
}

function makePlayer(id: string, age: number, ability: number): Player {
  return {
    id,
    name: id,
    clubId: null,
    position: "FW",
    age,
    attributes: makeAttrs(ability),
    contract: null,
    nationality: "",
    potential: ability,
  };
}

describe("club philosophy (requirement 5.3): default assignment", () => {
  it("assigns every club a youthFocus and developAndSell within [-1, 1] when the league data omits them", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    for (const club of world.leagues[0]!.clubs) {
      expect(club.youthFocus).toBeGreaterThanOrEqual(-1);
      expect(club.youthFocus).toBeLessThanOrEqual(1);
      expect(club.developAndSell).toBeGreaterThanOrEqual(-1);
      expect(club.developAndSell).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic per seed and varies across clubs", () => {
    const a = buildWorld(2026, [LEAGUE_PATH]);
    const b = buildWorld(2026, [LEAGUE_PATH]);
    const valuesA = a.leagues[0]!.clubs.map((c) => c.youthFocus);
    const valuesB = b.leagues[0]!.clubs.map((c) => c.youthFocus);
    expect(valuesA).toEqual(valuesB);
    expect(new Set(valuesA).size).toBeGreaterThan(1);
  });

  it("JSON can pin a club's philosophy and buildWorld leaves it untouched", () => {
    const world = buildWorld(1, [FIXTURE_PATH]);
    const pinned = world.clubsById.get("PIN")!;
    expect(pinned.youthFocus).toBe(0.9);
    expect(pinned.developAndSell).toBe(-0.9);
    const auto = world.clubsById.get("AUT")!;
    expect(auto.youthFocus).toBeGreaterThanOrEqual(-1);
    expect(auto.youthFocus).toBeLessThanOrEqual(1);
  });
});

describe("club philosophy (requirement 5.3): chooseSigning age bias", () => {
  it("a youth-first club prefers an equally-good young candidate over a veteran", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const roleBook = getRoleBook();
    const brain = new AIDecisionMaker("ARS");
    const club: Club = { id: "ARS", name: "Arsenal", shortName: "Arsenal", strength: 88, youthFocus: 1 };
    const context: SquadContext = {
      squad: getSquad(world, "ARS"),
      roleBook,
      formation: roleBook.defaultFormation,
      balance: 1000,
      currentYear: 2026,
      club,
    };
    const young = makePlayer("YOUNG", 18, 99);
    const old = makePlayer("OLD", 32, 99);
    const choice = brain.chooseSigning(context, [
      { player: young, askingFee: 10 },
      { player: old, askingFee: 10 },
    ]);
    expect(choice?.playerId).toBe("YOUNG");
  });

  it("a win-now club prefers an equally-good veteran over a young candidate", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const roleBook = getRoleBook();
    const brain = new AIDecisionMaker("ARS");
    const club: Club = { id: "ARS", name: "Arsenal", shortName: "Arsenal", strength: 88, youthFocus: -1 };
    const context: SquadContext = {
      squad: getSquad(world, "ARS"),
      roleBook,
      formation: roleBook.defaultFormation,
      balance: 1000,
      currentYear: 2026,
      club,
    };
    const young = makePlayer("YOUNG2", 18, 99);
    const old = makePlayer("OLD2", 32, 99);
    const choice = brain.chooseSigning(context, [
      { player: young, askingFee: 10 },
      { player: old, askingFee: 10 },
    ]);
    expect(choice?.playerId).toBe("OLD2");
  });
});

describe("club philosophy (requirement 5.3): wantsToRenew thresholds", () => {
  // The test player is deliberately absent from `squad`, so it never lands
  // in the depth chart and wantsToRenew always falls through to the
  // young-prospect exception — isolating just that threshold logic.
  function contextFor(club: Club): SquadContext {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const roleBook = getRoleBook();
    return {
      squad: getSquad(world, "ARS"),
      roleBook,
      formation: roleBook.defaultFormation,
      balance: 1000,
      currentYear: 2026,
      club,
    };
  }

  it("neutral philosophy reproduces the original age<=21, ability>=70 exception", () => {
    const brain = new AIDecisionMaker("ARS");
    const club: Club = { id: "ARS", name: "Arsenal", shortName: "Arsenal", strength: 88, youthFocus: 0 };
    expect(brain.wantsToRenew(contextFor(club), makePlayer("P1", 21, 70))).toBe(true);
    expect(brain.wantsToRenew(contextFor(club), makePlayer("P2", 22, 70))).toBe(false);
    expect(brain.wantsToRenew(contextFor(club), makePlayer("P3", 21, 65))).toBe(false);
  });

  it("a youth-first club widens the age window and lowers the ability floor", () => {
    const brain = new AIDecisionMaker("ARS");
    const club: Club = { id: "ARS", name: "Arsenal", shortName: "Arsenal", strength: 88, youthFocus: 1 };
    expect(brain.wantsToRenew(contextFor(club), makePlayer("P4", 23, 65))).toBe(true);
  });

  it("a win-now club narrows the age window and raises the ability floor", () => {
    const brain = new AIDecisionMaker("ARS");
    const club: Club = { id: "ARS", name: "Arsenal", shortName: "Arsenal", strength: 88, youthFocus: -1 };
    expect(brain.wantsToRenew(contextFor(club), makePlayer("P5", 23, 65))).toBe(false);
    expect(brain.wantsToRenew(contextFor(club), makePlayer("P6", 19, 70))).toBe(false);
  });
});

describe("club philosophy (requirement 5.3): manager hiring bias", () => {
  const manager = {
    id: "M1",
    name: "Test Manager",
    clubId: null,
    attributes: { tactical: 90, development: 90, reputation: 50 },
  };

  it("neutral philosophy (0, 0) scores strictly by reputation", () => {
    expect(candidateScore(manager, { youthFocus: 0, developAndSell: 0 })).toBe(50);
    expect(candidateScore(manager, {})).toBe(50);
  });

  it("a youth-first club (youthFocus > 0) adds weight for development", () => {
    const score = candidateScore(manager, { youthFocus: 1, developAndSell: 0 });
    expect(score).toBeGreaterThan(50);
  });

  it("a perennial-winner club (developAndSell < 0) adds weight for tactical", () => {
    const score = candidateScore(manager, { youthFocus: 0, developAndSell: -1 });
    expect(score).toBeGreaterThan(50);
  });

  it("win-now (youthFocus < 0) does not add development weight; develop-and-sell (> 0) does not add tactical weight", () => {
    expect(candidateScore(manager, { youthFocus: -1, developAndSell: 0 })).toBe(50);
    expect(candidateScore(manager, { youthFocus: 0, developAndSell: 1 })).toBe(50);
  });
});
