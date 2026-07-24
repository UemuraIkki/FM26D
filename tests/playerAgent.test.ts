import { describe, expect, it } from "vitest";
import { RationalPlayerAgent, type MoveProposal } from "../src/decision/playerAgent.js";
import { buildWorld } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";
import type { Player, PlayerAttributes } from "../src/model/types.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

function makePlayer(ambition: number): Player {
  const base: PlayerAttributes = {
    passing: 70, shooting: 70, dribbling: 70, defending: 70, aerial: 70,
    speed: 70, stamina: 70, strength: 70, agility: 70,
    decisions: 70, positioning: 70, finishing: 70, ambition, professionalism: 70,
    shotStopping: 10, aerialHandling: 10, distribution: 10,
  };
  return {
    id: "p1", name: "Test Player", clubId: "MID", position: "MF", age: 26,
    attributes: base,
    contract: { annualWage: 4, endYear: 2029 },
    nationality: "ENG",
    potential: 70,
  };
}

function proposal(overrides: Partial<MoveProposal>, ambition: number): MoveProposal {
  return {
    player: makePlayer(ambition),
    fromClubId: "MID",
    toClubId: "BIG",
    currentRank: "STARTER",
    expectedRank: "BACKUP",
    fromClubStrength: 74,
    toClubStrength: 89,
    currentWage: 4,
    offeredWage: 5,
    ...overrides,
  };
}

describe("RationalPlayerAgent (requirement 5.5 step 4)", () => {
  it("a low-ambition starter refuses to become a big club's backup (playing time)", () => {
    const agent = new RationalPlayerAgent();
    const decision = agent.decide(proposal({}, 25));
    expect(decision.accept).toBe(false);
    expect(decision.reason).toBe("PLAYING_TIME");
  });

  it("a high-ambition player takes the same move for the bigger stage", () => {
    const agent = new RationalPlayerAgent();
    const decision = agent.decide(proposal({}, 95));
    expect(decision.accept).toBe(true);
  });

  it("a surplus player accepts a move that makes him a starter", () => {
    const agent = new RationalPlayerAgent();
    const decision = agent.decide(
      proposal({ currentRank: "OUT", expectedRank: "STARTER", toClubStrength: 66, fromClubStrength: 88 }, 50),
    );
    expect(decision.accept).toBe(true);
  });

  it("a high-ambition big-club backup refuses to drop down for playing time", () => {
    const agent = new RationalPlayerAgent();
    const decision = agent.decide(
      proposal(
        { currentRank: "BACKUP", expectedRank: "STARTER", fromClubStrength: 89, toClubStrength: 65, offeredWage: 3.5 },
        97,
      ),
    );
    expect(decision.accept).toBe(false);
    expect(decision.reason).toBe("REPUTATION");
  });

  it("free agents take a contract over unemployment", () => {
    const agent = new RationalPlayerAgent();
    const player = makePlayer(50);
    player.clubId = null;
    player.contract = null;
    const decision = agent.decide(
      proposal({ player, fromClubId: null, currentRank: "OUT", expectedRank: "BACKUP", fromClubStrength: 0, currentWage: 0 }, 50),
    );
    expect(decision.accept).toBe(true);
  });
});

describe("Phase D completion criterion", () => {
  it("playing-time refusals are observed in a simulated season", () => {
    const world = buildWorld(2026, [LEAGUE_PATH]);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });
    expect(report.refusals.length).toBeGreaterThan(0);
    const playingTime = report.refusals.filter((r) => r.reason === "PLAYING_TIME");
    expect(playingTime.length).toBeGreaterThan(0);
    // And the market still turns despite players having a say.
    expect(report.transfers.length).toBeGreaterThan(0);
  });

  it("refusals are deterministic per seed", () => {
    const run = (seed: number) => {
      const world = buildWorld(seed, [LEAGUE_PATH]);
      const report = runSeason(world, { startYear: 2026, keepMatches: false });
      return report.refusals.map((r) => `${r.date}:${r.playerId}:${r.toClubId}:${r.reason}`).join("|");
    };
    expect(run(555)).toBe(run(555));
  });
});
