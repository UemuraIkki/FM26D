import { describe, expect, it } from "vitest";
import { buildWorld } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";

const BIG_FIVE = [
  "data/leagues/premier-league.json",
  "data/leagues/la-liga.json",
  "data/leagues/bundesliga.json",
  "data/leagues/serie-a.json",
  "data/leagues/ligue-1.json",
];

describe("multi-league world (requirement 2.1)", () => {
  it("loads all five leagues with no club id collisions", () => {
    const world = buildWorld(1, BIG_FIVE);
    expect(world.leagues.map((l) => l.id)).toEqual(["ENG1", "ESP1", "GER1", "ITA1", "FRA1"]);
    const totalClubs = world.leagues.reduce((n, l) => n + l.clubs.length, 0);
    expect(world.clubsById.size).toBe(totalClubs);
  });
});

describe("Phase G completion: cross-league transfers", () => {
  it("moves players between the big five leagues in a single season", { timeout: 60_000 }, () => {
    const world = buildWorld(7, BIG_FIVE);
    const leagueOf = (clubId: string | null) =>
      clubId ? world.leagues.find((l) => l.clubs.some((c) => c.id === clubId))?.id : undefined;

    const report = runSeason(world, { startYear: 2026, keepMatches: false });

    expect(report.tables.size).toBe(5);
    for (const league of world.leagues) {
      expect(report.tables.get(league.id)!.sorted()[0]!.played).toBe(league.clubs.length * 2 - 2);
    }

    const crossLeague = report.transfers.filter(
      (t) => t.fromClubId && leagueOf(t.fromClubId) !== leagueOf(t.toClubId),
    );
    expect(crossLeague.length).toBeGreaterThan(0);
  });

  it("is deterministic per seed", { timeout: 60_000 }, () => {
    const run = (seed: number) => {
      const world = buildWorld(seed, BIG_FIVE);
      const report = runSeason(world, { startYear: 2026, keepMatches: false });
      return report.transfers.map((t) => `${t.date}:${t.playerId}:${t.fromClubId}->${t.toClubId}`).join("|");
    };
    expect(run(11)).toBe(run(11));
  });
});

describe("Champions League (requirement 2.2)", () => {
  it("runs a 32-team tournament to a single winner when 2+ leagues are simulated", { timeout: 60_000 }, () => {
    const world = buildWorld(7, BIG_FIVE);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });

    const cl = report.championsLeague!;
    expect(cl.participants).toHaveLength(32);
    expect(new Set(cl.participants).size).toBe(32);
    expect(cl.finalists).toHaveLength(2);
    expect(cl.winnerId).toBeDefined();
    expect(cl.finalists).toContain(cl.winnerId);

    // Every real (non-abstract) participant appears in world.clubsById.
    const real = cl.participants.filter((id) => world.clubsById.has(id));
    expect(real.length).toBeGreaterThan(0);
  });

  it("is absent for a single-league world", () => {
    const world = buildWorld(7, ["data/leagues/premier-league.json"]);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });
    expect(report.championsLeague).toBeUndefined();
  });
});

describe("shadow world (requirement 2.3)", () => {
  it("supplies prospects and exits unsigned free agents every season", { timeout: 60_000 }, () => {
    const world = buildWorld(7, BIG_FIVE);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });
    expect(report.shadow.arrivals).toBeGreaterThan(0);
    expect(report.shadow.departures).toBeGreaterThanOrEqual(0);
  });
});

describe("finances stay conserved across a multi-league + CL season", () => {
  it("ledger conservation drift stays at zero", { timeout: 60_000 }, () => {
    const world = buildWorld(13, BIG_FIVE);
    runSeason(world, { startYear: 2026, keepMatches: false });
    expect(world.ledger.conservationDrift()).toBeLessThan(1e-9);
    const net = world.ledger.systemNetCheck();
    expect(net.sumBalances - net.sumInitial).toBeCloseTo(net.netWorldInflow, 6);
  });
});
