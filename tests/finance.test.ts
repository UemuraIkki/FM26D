import { describe, expect, it } from "vitest";
import { Ledger, WORLD_ACCOUNT } from "../src/finance/ledger.js";
import { ageCurve, baseValue, contractFactor, marketValue, playerAbility, wageFor } from "../src/finance/value.js";
import { buildWorld, getSquad } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";
const DATE = { year: 2026, month: 8, day: 1 };

describe("ledger", () => {
  it("tracks balances through double-entry records", () => {
    const ledger = new Ledger();
    ledger.openAccount("A", 100);
    ledger.openAccount("B", 50);
    ledger.record(DATE, "TRANSFER_FEE", "A", "B", 30);
    ledger.record(DATE, "TICKET", WORLD_ACCOUNT, "A", 5);
    ledger.record(DATE, "WAGE", "B", WORLD_ACCOUNT, 10);
    expect(ledger.balanceOf("A")).toBe(75);
    expect(ledger.balanceOf("B")).toBe(70);
    expect(ledger.conservationDrift()).toBe(0);
    const net = ledger.systemNetCheck();
    // Inter-club fee cancels; only WORLD flows change the system total.
    expect(net.sumBalances - net.sumInitial).toBeCloseTo(net.netWorldInflow, 9);
  });

  it("rejects negative amounts and unknown accounts", () => {
    const ledger = new Ledger();
    ledger.openAccount("A", 10);
    expect(() => ledger.record(DATE, "TICKET", WORLD_ACCOUNT, "A", -5)).toThrow();
    expect(() => ledger.record(DATE, "TICKET", WORLD_ACCOUNT, "X", 5)).toThrow();
  });
});

describe("market value (requirement 4.2)", () => {
  it("grows with ability and peaks in the mid-20s", () => {
    expect(baseValue(85)).toBeGreaterThan(baseValue(75));
    expect(ageCurve(27)).toBeGreaterThan(ageCurve(34));
    expect(ageCurve(27)).toBeGreaterThan(ageCurve(19));
  });

  it("collapses when the contract is nearly over (Bosman leverage)", () => {
    expect(contractFactor(1)).toBeLessThan(contractFactor(3));
    expect(contractFactor(0)).toBe(0);
  });

  it("values a real generated player plausibly", () => {
    const world = buildWorld(5, [LEAGUE_PATH]);
    const star = getSquad(world, "LIV")
      .map((p) => ({ p, a: playerAbility(p) }))
      .sort((x, y) => y.a - x.a)[0]!;
    const value = marketValue(star.p, 2026);
    expect(value).toBeGreaterThan(5);
    // Loose sanity ceiling, not a calibration target: real ages (requirement
    // 8) widen the variance a bit vs. purely procedural ages, so this just
    // guards against a genuinely broken value, not a specific number.
    expect(value).toBeLessThan(400);
    expect(wageFor(star.a)).toBeGreaterThan(1);
  });
});

describe("season economy (requirement 5.1)", () => {
  it("conserves money across a full season with transfers", () => {
    const world = buildWorld(99, [LEAGUE_PATH]);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });

    // Conservation: replaying the ledger reproduces every balance exactly.
    expect(world.ledger.conservationDrift()).toBeLessThan(1e-9);
    // System total only changes by net WORLD inflow (fees between clubs cancel).
    const net = world.ledger.systemNetCheck();
    expect(net.sumBalances - net.sumInitial).toBeCloseTo(net.netWorldInflow, 6);

    // The economy actually ran: wages, tickets, broadcast, merit all present.
    const types = new Set(world.ledger.transactions.map((t) => t.type));
    for (const required of ["WAGE", "TICKET", "BROADCAST", "MERIT"]) {
      expect(types.has(required as never)).toBe(true);
    }
    expect(report.table.sorted()[0]!.played).toBe(38);
  });
});
