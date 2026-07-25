import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Ledger, WORLD_ACCOUNT } from "../src/finance/ledger.js";
import { deserializeWorld, serializeWorld } from "../src/persist/serialize.js";
import { loadCheckpoint, queryNewsEvents, saveCheckpoint } from "../src/persist/checkpoint.js";
import { deriveNewsFeed } from "../src/observe/newsFeed.js";
import { buildWorld } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";
const DATE = { year: 2026, month: 8, day: 1 };

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "fm26d-test-"));
  return join(dir, "checkpoint.sqlite");
}

describe("Ledger snapshot/restore", () => {
  it("round-trips balances and transactions exactly", () => {
    const ledger = new Ledger();
    ledger.openAccount("A", 100);
    ledger.openAccount("B", 50);
    ledger.record(DATE, "TRANSFER_FEE", "A", "B", 30);
    ledger.record(DATE, "TICKET", WORLD_ACCOUNT, "A", 5);

    const restored = Ledger.restore(ledger.snapshot());
    expect(restored.balanceOf("A")).toBe(ledger.balanceOf("A"));
    expect(restored.balanceOf("B")).toBe(ledger.balanceOf("B"));
    expect(restored.transactions).toEqual(ledger.transactions);
    expect(restored.conservationDrift()).toBeLessThan(1e-9);
    expect(restored.systemNetCheck()).toEqual(ledger.systemNetCheck());
  });
});

describe("World serialize/deserialize (requirement 6.2 checkpoint)", () => {
  it("round-trips a persistent world including Maps/Sets and derived indices", () => {
    const world = buildWorld(42, [LEAGUE_PATH]);
    world.watchlist.add(world.players[0]!.id);
    runSeason(world, { startYear: 2026, keepMatches: false });

    const restored = deserializeWorld(serializeWorld(world));

    expect(restored.seed).toBe(world.seed);
    expect(restored.players.length).toBe(world.players.length);
    expect(restored.watchlist).toEqual(world.watchlist);
    expect(restored.capsByPlayer.size).toBe(world.capsByPlayer.size);
    expect(restored.appearancesByPlayer.size).toBe(world.appearancesByPlayer.size);
    expect(restored.ledger.conservationDrift()).toBeLessThan(1e-9);
    expect(restored.ledger.transactions.length).toBe(world.ledger.transactions.length);

    // Every club's roster is drawn from the same restored `players` array
    // (object identity), matching the single-source-of-truth invariant.
    for (const club of world.leagues[0]!.clubs) {
      const squad = restored.playersByClub.get(club.id)!;
      for (const p of squad) {
        expect(restored.players.includes(p)).toBe(true);
        expect(p.clubId).toBe(club.id);
      }
    }
  });

  it("round-trips Manager Mode state (humanControlledClubId/managerPolicy)", () => {
    const world = buildWorld(42, [LEAGUE_PATH]);
    world.humanControlledClubId = "ARS";
    world.managerPolicy = { protectedPlayers: ["ARS-01"], releaseList: ["ARS-02"] };

    const restored = deserializeWorld(serializeWorld(world));
    expect(restored.humanControlledClubId).toBe("ARS");
    expect(restored.managerPolicy).toEqual(world.managerPolicy);
  });

  it("omits Manager Mode fields entirely for a pure observation-mode world (no stray keys/undefined leaking through)", () => {
    const world = buildWorld(42, [LEAGUE_PATH]);
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored.humanControlledClubId).toBeUndefined();
    expect(restored.managerPolicy).toBeUndefined();
  });
});

describe("Phase I completion: checkpoint save/resume is determinism-preserving (requirement 3.2/6.2)", () => {
  it("resuming from a checkpoint produces an identical continuation to an uninterrupted run", () => {
    const seed = 777;

    // Uninterrupted: 4 seasons on one world.
    const uninterrupted = buildWorld(seed, [LEAGUE_PATH]);
    const uninterruptedHistory: string[] = [];
    for (let s = 0; s < 4; s++) {
      const report = runSeason(uninterrupted, { startYear: 2026 + s, keepMatches: false });
      uninterruptedHistory.push(
        `${report.table.sorted()[0]!.clubId}|${report.transfers.map((t) => t.playerId + t.toClubId).join(",")}|${report.development.retired}`,
      );
    }

    // Interrupted: 2 seasons, checkpoint to SQLite, reload, 2 more seasons.
    const dbPath = tempDbPath();
    try {
      let world = buildWorld(seed, [LEAGUE_PATH]);
      const interruptedHistory: string[] = [];
      for (let s = 0; s < 2; s++) {
        const report = runSeason(world, { startYear: 2026 + s, keepMatches: false });
        interruptedHistory.push(
          `${report.table.sorted()[0]!.clubId}|${report.transfers.map((t) => t.playerId + t.toClubId).join(",")}|${report.development.retired}`,
        );
      }
      saveCheckpoint(dbPath, world, 2028, []);

      const loaded = loadCheckpoint(dbPath)!;
      world = loaded.world;
      expect(loaded.nextStartYear).toBe(2028);
      for (let s = 0; s < 2; s++) {
        const report = runSeason(world, { startYear: 2028 + s, keepMatches: false });
        interruptedHistory.push(
          `${report.table.sorted()[0]!.clubId}|${report.transfers.map((t) => t.playerId + t.toClubId).join(",")}|${report.development.retired}`,
        );
      }

      expect(interruptedHistory).toEqual(uninterruptedHistory);
    } finally {
      rmSync(dbPath, { force: true });
    }
  });

  it("persists news events across a save and queries them back", () => {
    const dbPath = tempDbPath();
    try {
      const world = buildWorld(5, [LEAGUE_PATH]);
      const report = runSeason(world, { startYear: 2026, keepMatches: false });
      const events = deriveNewsFeed(report, world);
      expect(events.length).toBeGreaterThan(0);

      saveCheckpoint(dbPath, world, 2027, events);
      const loaded = loadCheckpoint(dbPath)!;
      expect(loaded.world.players.length).toBe(world.players.length);

      const queried = queryNewsEvents(dbPath, { limit: 1000 });
      expect(queried.length).toBe(events.length);
      const transferType = events.find((e) => e.type === "TRANSFER");
      if (transferType) {
        const byType = queryNewsEvents(dbPath, { type: "TRANSFER" });
        expect(byType.length).toBeGreaterThan(0);
        expect(byType.every((e) => e.type === "TRANSFER")).toBe(true);
      }
    } finally {
      rmSync(dbPath, { force: true });
    }
  });
});
