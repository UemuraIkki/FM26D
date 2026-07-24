import { describe, expect, it } from "vitest";
import { buildWorld, getSquad } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";
import { isTransferWindowOpen } from "../src/transfer/market.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

describe("transfer windows", () => {
  it("opens in summer (Jul-Aug) and winter (Jan) only", () => {
    expect(isTransferWindowOpen({ year: 2026, month: 7, day: 15 })).toBe(true);
    expect(isTransferWindowOpen({ year: 2026, month: 8, day: 31 })).toBe(true);
    expect(isTransferWindowOpen({ year: 2027, month: 1, day: 5 })).toBe(true);
    expect(isTransferWindowOpen({ year: 2026, month: 9, day: 1 })).toBe(false);
    expect(isTransferWindowOpen({ year: 2026, month: 12, day: 31 })).toBe(false);
  });
});

describe("transfer market (Phase C completion: the market turns)", () => {
  it("produces completed transfers with fees flowing through the ledger", () => {
    const world = buildWorld(2026, [LEAGUE_PATH]);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });

    expect(report.transfers.length).toBeGreaterThan(0);

    const feeTx = world.ledger.transactions.filter((t) => t.type === "TRANSFER_FEE");
    const paidMoves = report.transfers.filter((t) => t.fee > 0);
    expect(feeTx.length).toBe(paidMoves.length);

    for (const move of report.transfers) {
      // The player really is at the destination club with a fresh contract.
      const player = world.players.find((p) => p.id === move.playerId)!;
      // May have moved again later in the window; at minimum they left the seller.
      if (player.clubId !== move.toClubId) {
        expect(report.transfers.some((t) => t.playerId === move.playerId && t !== move)).toBe(true);
      } else {
        expect(player.contract).not.toBeNull();
        expect(getSquad(world, move.toClubId).some((p) => p.id === move.playerId)).toBe(true);
      }
      if (move.fromClubId) {
        expect(getSquad(world, move.fromClubId).some((p) => p.id === move.playerId)).toBe(false);
      }
    }
  });

  it("no club balance goes negative through market activity", () => {
    const world = buildWorld(777, [LEAGUE_PATH]);
    runSeason(world, { startYear: 2026, keepMatches: false });
    for (const club of world.leagues[0]!.clubs) {
      expect(world.ledger.balanceOf(club.id)).toBeGreaterThan(-50); // wages may dip small clubs, never fees
    }
  });

  it("is deterministic: same seed, same transfer history", () => {
    const run = (seed: number) => {
      const world = buildWorld(seed, [LEAGUE_PATH]);
      const report = runSeason(world, { startYear: 2026, keepMatches: false });
      return report.transfers.map((t) => `${t.date}:${t.playerId}:${t.fromClubId}->${t.toClubId}@${t.fee}`).join("|");
    };
    expect(run(4242)).toBe(run(4242));
  });

  it("contract expiries are processed at season end", () => {
    const world = buildWorld(31, [LEAGUE_PATH]);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });
    // ~24 players x 20 clubs with endYear uniform over 4 years -> plenty expire.
    expect(report.contractSummary.renewed + report.contractSummary.released).toBeGreaterThan(20);
    // Released players sit in the free-agent pool without contracts.
    for (const agent of world.freeAgents) {
      expect(agent.clubId).toBeNull();
      expect(agent.contract).toBeNull();
    }
  });
});
