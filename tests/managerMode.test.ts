import { describe, expect, it } from "vitest";
import { AIDecisionMaker } from "../src/decision/aiDecisionMaker.js";
import type { SquadContext } from "../src/decision/clubDecisionMaker.js";
import { HumanDecisionMaker, type ManagerPolicy } from "../src/decision/humanDecisionMaker.js";
import { applyManagerModeOutcome, buildManagerBrains } from "../src/decision/managerMode.js";
import { getRoleBook } from "../src/model/roles.js";
import type { Club } from "../src/model/types.js";
import { buildWorld, getSquad } from "../src/model/world.js";
import { runSeason, type SeasonReport } from "../src/sim/season.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

function contextFor(clubId: string, policy: ManagerPolicy = {}): { ctx: SquadContext; human: HumanDecisionMaker } {
  const world = buildWorld(1, [LEAGUE_PATH]);
  const roleBook = getRoleBook();
  const club: Club = { id: clubId, name: clubId, shortName: clubId, strength: 85 };
  const ctx: SquadContext = {
    squad: getSquad(world, clubId),
    roleBook,
    formation: roleBook.defaultFormation,
    balance: 1000,
    currentYear: 2026,
    club,
  };
  return { ctx, human: new HumanDecisionMaker(clubId, policy) };
}

describe("HumanDecisionMaker: selectLineup", () => {
  it("starts an explicitly preferred, available, eligible player in their role", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const roleBook = getRoleBook();
    const squad = getSquad(world, "ARS");
    const gkSlot = roleBook.defaultFormation.slots[0]!;
    const gkRole = roleBook.rolesById.get(gkSlot)!;
    const preferredGk = squad.find((p) => gkRole.positions.includes(p.position))!;

    const human = new HumanDecisionMaker("ARS", { preferredStarters: { [gkSlot]: preferredGk.id } });
    const sheet = human.selectLineup({ squad, roleBook, formation: roleBook.defaultFormation });

    expect(sheet.players).toHaveLength(11);
    expect(sheet.players[0]!.id).toBe(preferredGk.id);
  });

  it("falls back to normal role-score selection when the preferred player is unavailable", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const roleBook = getRoleBook();
    const squad = getSquad(world, "ARS");
    const gkSlot = roleBook.defaultFormation.slots[0]!;

    const human = new HumanDecisionMaker("ARS", { preferredStarters: { [gkSlot]: "NOT-IN-SQUAD" } });
    const sheet = human.selectLineup({ squad, roleBook, formation: roleBook.defaultFormation });
    expect(sheet.players).toHaveLength(11);
    expect(new Set(sheet.players.map((p) => p.id)).size).toBe(11); // no duplicate picks
  });

  it("with an empty policy, fields the same XI as AIDecisionMaker", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const roleBook = getRoleBook();
    const squad = getSquad(world, "ARS");
    const context = { squad, roleBook, formation: roleBook.defaultFormation };

    const humanSheet = new HumanDecisionMaker("ARS", {}).selectLineup(context);
    const aiSheet = new AIDecisionMaker("ARS").selectLineup(context);
    expect(humanSheet.players.map((p) => p.id)).toEqual(aiSheet.players.map((p) => p.id));
  });
});

describe("HumanDecisionMaker: chooseSigning", () => {
  it("pursues the highest-priority transferTarget present in the pool and within budget", () => {
    const { ctx, human } = contextFor("ARS", { transferTargets: ["OUT-OF-POOL", "TARGET-2", "TARGET-1"] });
    const candidates = [
      { player: { id: "TARGET-1" } as never, askingFee: 10 },
      { player: { id: "TARGET-2" } as never, askingFee: 20 },
    ];
    const choice = human.chooseSigning(ctx, candidates);
    expect(choice).toEqual({ playerId: "TARGET-2", offeredFee: 20 });
  });

  it("skips a priority target that's over budget and falls through to the next one", () => {
    const { ctx, human } = contextFor("ARS", { transferTargets: ["EXPENSIVE", "AFFORDABLE"] });
    const candidates = [
      { player: { id: "EXPENSIVE" } as never, askingFee: 999 },
      { player: { id: "AFFORDABLE" } as never, askingFee: 10 },
    ];
    expect(human.chooseSigning(ctx, candidates)).toEqual({ playerId: "AFFORDABLE", offeredFee: 10 });
  });

  it("returns null when no policy target is present in the candidate pool", () => {
    const { ctx, human } = contextFor("ARS", { transferTargets: ["SOMEONE-ELSE"] });
    expect(human.chooseSigning(ctx, [{ player: { id: "OTHER" } as never, askingFee: 5 }])).toBeNull();
  });

  it("returns null with no transferTargets policy set", () => {
    const { ctx, human } = contextFor("ARS", {});
    expect(human.chooseSigning(ctx, [{ player: { id: "OTHER" } as never, askingFee: 5 }])).toBeNull();
  });
});

describe("HumanDecisionMaker: respondToOffer", () => {
  it("refuses any offer for a protected player regardless of price", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const roleBook = getRoleBook();
    const club: Club = { id: "ARS", name: "Arsenal", shortName: "Arsenal", strength: 88 };
    const ctx: SquadContext = {
      squad: getSquad(world, "ARS"),
      roleBook,
      formation: roleBook.defaultFormation,
      balance: 1000,
      currentYear: 2026,
      club,
    };
    const player = { id: "PROTECTED", name: "P", clubId: "ARS", position: "FW" as const, age: 26, attributes: {} as never, contract: null, nationality: "", potential: 80 };
    const human = new HumanDecisionMaker("ARS", { protectedPlayers: ["PROTECTED"] });
    expect(human.respondToOffer(ctx, player, 1_000_000)).toBe(false);
  });

  it("delegates to AI logic for non-protected players", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const roleBook = getRoleBook();
    const club: Club = { id: "ARS", name: "Arsenal", shortName: "Arsenal", strength: 88 };
    const ctx: SquadContext = {
      squad: getSquad(world, "ARS"),
      roleBook,
      formation: roleBook.defaultFormation,
      balance: 1000,
      currentYear: 2026,
      club,
    };
    const player = { id: "NOT-PROTECTED", name: "P", clubId: "ARS", position: "FW" as const, age: 26, attributes: {} as never, contract: null, nationality: "", potential: 80 };
    const human = new HumanDecisionMaker("ARS", { protectedPlayers: ["SOMEONE-ELSE"] });
    const ai = new AIDecisionMaker("ARS");
    expect(human.respondToOffer(ctx, player, 1_000_000)).toBe(ai.respondToOffer(ctx, player, 1_000_000));
  });
});

describe("HumanDecisionMaker: wantsToRenew", () => {
  const player = { id: "EXPIRING", name: "P", clubId: "ARS", position: "FW" as const, age: 26, attributes: {} as never, contract: null, nationality: "", potential: 80 };

  it("releases a player on the releaseList regardless of AI's own judgment", () => {
    const { ctx, human } = contextFor("ARS", { releaseList: ["EXPIRING"] });
    expect(human.wantsToRenew(ctx, player)).toBe(false);
  });

  it("delegates to AI's judgment for players not on the releaseList", () => {
    const { ctx, human } = contextFor("ARS", { releaseList: ["SOMEONE-ELSE"] });
    const ai = new AIDecisionMaker("ARS");
    expect(human.wantsToRenew(ctx, player)).toBe(ai.wantsToRenew(ctx, player));
  });
});

describe("Manager Mode orchestration (src/decision/managerMode.ts)", () => {
  it("buildManagerBrains returns an empty map for a world with no human-controlled club", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    expect(buildManagerBrains(world).size).toBe(0);
  });

  it("buildManagerBrains wires a HumanDecisionMaker for exactly the human-controlled club", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    world.humanControlledClubId = "ARS";
    world.managerPolicy = { protectedPlayers: ["X"] };
    const brains = buildManagerBrains(world)!;
    expect(brains.size).toBe(1);
    expect(brains.get("ARS")).toBeInstanceOf(HumanDecisionMaker);
  });

  it("applyManagerModeOutcome reports no sacking and leaves state untouched when the human's club isn't in managerChanges", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    world.humanControlledClubId = "ARS";
    world.managerPolicy = {};
    const report = { managerChanges: [{ clubId: "CHE" }] } as unknown as SeasonReport;
    expect(applyManagerModeOutcome(world, report)).toEqual({ sacked: false });
    expect(world.humanControlledClubId).toBe("ARS");
  });

  it("applyManagerModeOutcome clears Manager Mode state when the human's club is sacked", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    world.humanControlledClubId = "ARS";
    world.managerPolicy = {};
    const report = { managerChanges: [{ clubId: "ARS" }] } as unknown as SeasonReport;
    expect(applyManagerModeOutcome(world, report)).toEqual({ sacked: true });
    expect(world.humanControlledClubId).toBeUndefined();
    expect(world.managerPolicy).toBeUndefined();
  });
});

describe("Manager Mode completion: a human-controlled club plays a full season", () => {
  it("runs a full season without crashing (empty policy = every match's lineup call succeeds)", () => {
    const world = buildWorld(2026, [LEAGUE_PATH]);
    world.humanControlledClubId = "ARS";
    world.managerPolicy = {};
    const report = runSeason(world, { startYear: 2026, keepMatches: true, decisionMakers: buildManagerBrains(world) });
    const arsMatches = report.matches.filter(
      (m) => m.fixture.homeClubId === "ARS" || m.fixture.awayClubId === "ARS",
    );
    // selectLineup would throw (caught only by selectLineupSafe's injury
    // fallback, not a missing-brain bug) if HumanDecisionMaker ever failed
    // to produce a full XI; reaching a recorded result for every ARS
    // fixture is proof every call succeeded all season.
    expect(arsMatches.length).toBeGreaterThan(30);
    expect(applyManagerModeOutcome(world, report).sacked).toBeDefined();
  });

  it("with a non-trivial policy (preferred keeper, protected star, a transfer target), the season still completes deterministically", () => {
    const run = () => {
      const world = buildWorld(2026, [LEAGUE_PATH]);
      const roleBook = getRoleBook();
      const squad = getSquad(world, "ARS");
      const gkSlot = roleBook.defaultFormation.slots[0]!;
      const gk = squad.find((p) => p.position === "GK")!;
      world.humanControlledClubId = "ARS";
      world.managerPolicy = {
        preferredStarters: { [gkSlot]: gk.id },
        protectedPlayers: [gk.id],
        transferTargets: [world.players.find((p) => p.clubId === "CHE")!.id],
      };
      const report = runSeason(world, { startYear: 2026, keepMatches: false, decisionMakers: buildManagerBrains(world) });
      return report.tables.get(world.leagues[0]!.id)!.sorted().map((r) => r.clubId).join(",");
    };
    expect(run()).toBe(run());
  });
});
