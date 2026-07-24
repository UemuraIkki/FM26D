import { describe, expect, it } from "vitest";
import { getRoleBook } from "../src/model/roles.js";
import { nationIds } from "../src/model/nationality.js";
import { availableSquad } from "../src/model/fitness.js";
import { selectStartingXI } from "../src/sim/lineup.js";
import { buildWorld, getSquad } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";

const BIG_FIVE = [
  "data/leagues/premier-league.json",
  "data/leagues/la-liga.json",
  "data/leagues/bundesliga.json",
  "data/leagues/serie-a.json",
  "data/leagues/ligue-1.json",
];
const PL = ["data/leagues/premier-league.json"];

describe("nationality (requirement 4.5)", () => {
  it("assigns every player a known nation id", () => {
    const world = buildWorld(1, BIG_FIVE);
    const known = new Set(nationIds());
    for (const p of world.players) {
      expect(p.nationality.length).toBeGreaterThan(0);
      expect(known.has(p.nationality)).toBe(true);
    }
  });
});

describe("Phase H completion: World Cup / EURO run to a decided winner on the 4-year cycle", () => {
  it("a World Cup year (startYear % 4 === 2) completes 32 nations before Aug 8", { timeout: 60_000 }, () => {
    const world = buildWorld(7, BIG_FIVE);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });

    expect(report.euro).toBeUndefined();
    const wc = report.worldCup!;
    expect(wc.participants).toHaveLength(32);
    expect(new Set(wc.participants).size).toBe(32);
    expect(wc.finalists).toHaveLength(2);
    expect(wc.winnerId).toBeDefined();
    expect(wc.finalists).toContain(wc.winnerId);
    for (const m of wc.matches) {
      const before = m.date.year < 2026 || (m.date.year === 2026 && (m.date.month < 8 || (m.date.month === 8 && m.date.day < 8)));
      expect(before).toBe(true);
    }
  });

  it("a EURO year (startYear % 4 === 0) completes 24 nations", { timeout: 60_000 }, () => {
    const world = buildWorld(7, BIG_FIVE);
    const report = runSeason(world, { startYear: 2028, keepMatches: false });

    expect(report.worldCup).toBeUndefined();
    const euro = report.euro!;
    expect(euro.participants).toHaveLength(24);
    expect(new Set(euro.participants).size).toBe(24);
    expect(euro.finalists).toHaveLength(2);
    expect(euro.winnerId).toBeDefined();
    expect(euro.finalists).toContain(euro.winnerId);
  });

  it("a non-cycle year has neither tournament", { timeout: 60_000 }, () => {
    const world = buildWorld(7, BIG_FIVE);
    const report = runSeason(world, { startYear: 2027, keepMatches: false });
    expect(report.worldCup).toBeUndefined();
    expect(report.euro).toBeUndefined();
  });

  it("alternates WC -> none -> EURO -> none across 4 consecutive seasons", { timeout: 120_000 }, () => {
    const world = buildWorld(11, BIG_FIVE);
    const pattern: Array<"WC" | "EURO" | "NONE"> = [];
    for (let year = 2026; year <= 2029; year++) {
      const report = runSeason(world, { startYear: year, keepMatches: false });
      pattern.push(report.worldCup ? "WC" : report.euro ? "EURO" : "NONE");
    }
    expect(pattern).toEqual(["WC", "NONE", "EURO", "NONE"]);
  });

  it("is deterministic per seed (transfers, injuries, and tournament result)", { timeout: 60_000 }, () => {
    const run = (seed: number) => {
      const world = buildWorld(seed, BIG_FIVE);
      const report = runSeason(world, { startYear: 2026, keepMatches: false });
      const transfers = report.transfers.map((t) => `${t.date}:${t.playerId}:${t.fromClubId}->${t.toClubId}`).join("|");
      const wc = report.worldCup!;
      return `${transfers}##${wc.winnerId}:${wc.finalists!.join(",")}:${wc.matches.length}:${wc.injuries}`;
    };
    expect(run(23)).toBe(run(23));
  });
});

describe("Phase H completion: international windows + fitness/injury (requirement 2.2/4.4)", () => {
  it("plays friendly windows and costs fitness/injuries; ledger stays conserved", { timeout: 60_000 }, () => {
    const world = buildWorld(7, BIG_FIVE);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });

    expect(report.internationalWindows.matches).toBeGreaterThan(0);
    expect(report.internationalWindows.injuries).toBeGreaterThan(0);
    expect(report.worldCup!.injuries).toBeGreaterThan(0);

    for (const state of world.fitnessByPlayer.values()) {
      expect(state.value).toBeGreaterThanOrEqual(0);
      expect(state.value).toBeLessThanOrEqual(100);
    }
    expect(world.ledger.conservationDrift()).toBeLessThan(1e-9);
  });

  it("is off by default for a single-league world", { timeout: 30_000 }, () => {
    const world = buildWorld(7, PL);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });
    expect(report.worldCup).toBeUndefined();
    expect(report.euro).toBeUndefined();
    expect(report.internationalWindows).toEqual({ matches: 0, injuries: 0 });
  });

  it("excludes an injured player from lineup selection until their return date", () => {
    const world = buildWorld(3, PL);
    const roleBook = getRoleBook();
    const squad = getSquad(world, "LIV");
    const gk = squad.find((p) => p.position === "GK")!;
    const today = { year: 2026, month: 9, day: 1 };
    world.fitnessByPlayer.set(gk.id, { value: 100, injuryReturnDate: { year: 2026, month: 9, day: 20 } });

    const available = availableSquad(world, "LIV", today);
    expect(available.some((p) => p.id === gk.id)).toBe(false);

    const sheet = selectStartingXI("LIV", available, roleBook);
    expect(sheet.players.some((p) => p.id === gk.id)).toBe(false);

    const afterReturn = availableSquad(world, "LIV", { year: 2026, month: 9, day: 20 });
    expect(afterReturn.some((p) => p.id === gk.id)).toBe(true);
  });
});
