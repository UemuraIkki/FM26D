import { describe, expect, it } from "vitest";
import { playerAbility } from "../src/finance/value.js";
import { developPlayer, processSeasonEndDevelopment } from "../src/model/development.js";
import { getRoleBook, minHeadcountByPosition } from "../src/model/roles.js";
import { buildWorld, getSquad } from "../src/model/world.js";
import { createRng } from "../src/core/rng.js";
import { runSeason } from "../src/sim/season.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

describe("growth and decline (requirement 4.3)", () => {
  it("grows a young player's ability toward their potential over a season", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const player = getSquad(world, "LIV").find((p) => p.age <= 20)!;
    // Leave clear headroom so the growth cap doesn't ceiling-clip the test.
    for (const key of Object.keys(player.attributes) as (keyof typeof player.attributes)[]) {
      player.attributes[key] = 50;
    }
    player.potential = 99;
    const before = playerAbility(player);
    const rng = createRng(42);
    for (let i = 0; i < 5; i++) developPlayer(player, rng);
    expect(playerAbility(player)).toBeGreaterThan(before);
  });

  it("declines an aging player's ability past 31", () => {
    const world = buildWorld(2, [LEAGUE_PATH]);
    const player = getSquad(world, "ARS")[0]!;
    player.age = 33;
    player.potential = playerAbility(player); // no growth headroom
    const before = playerAbility(player);
    const rng = createRng(7);
    for (let i = 0; i < 5; i++) developPlayer(player, rng);
    expect(playerAbility(player)).toBeLessThan(before);
  });

  it("ages a player by exactly one year per call", () => {
    const world = buildWorld(3, [LEAGUE_PATH]);
    const player = getSquad(world, "CHE")[0]!;
    const startAge = player.age;
    developPlayer(player, createRng(1));
    expect(player.age).toBe(startAge + 1);
  });
});

describe("retirement (requirement 4.3)", () => {
  it("retires a player once age reaches the certain-retirement threshold", () => {
    const world = buildWorld(5, [LEAGUE_PATH]);
    const roleBook = getRoleBook();
    const player = getSquad(world, "LIV")[5]!;
    player.age = 39; // developPlayer bumps to 40 -> retirementChance = 1
    const result = processSeasonEndDevelopment(world, "test-retire", 2027, ["LIV"], roleBook);
    expect(result.retired).toBeGreaterThanOrEqual(1);
    expect(world.players.some((p) => p.id === player.id)).toBe(false);
    expect(world.moraleByPlayer.has(player.id)).toBe(false);
    expect(world.fitnessByPlayer.has(player.id)).toBe(false);
    expect(world.capsByPlayer.has(player.id)).toBe(false);
  });
});

describe("academy intake and position coverage (requirement 4.3 rookie supply)", () => {
  it("tops up every club to at least the formation's minimum headcount per position", () => {
    const world = buildWorld(9, [LEAGUE_PATH]);
    const roleBook = getRoleBook();
    const need = minHeadcountByPosition(roleBook);
    const clubIds = world.leagues[0]!.clubs.map((c) => c.id);

    // Force a worst case: strip every forward from one club.
    const club = clubIds[0]!;
    for (const p of [...getSquad(world, club)]) {
      if (p.position === "FW") {
        const idx = world.players.findIndex((x) => x.id === p.id);
        world.players.splice(idx, 1);
        world.playersByClub.get(club)!.splice(world.playersByClub.get(club)!.indexOf(p), 1);
      }
    }
    expect(getSquad(world, club).filter((p) => p.position === "FW")).toHaveLength(0);

    processSeasonEndDevelopment(world, "test-cover", 2027, clubIds, roleBook);

    for (const clubId of clubIds) {
      for (const position of ["GK", "DF", "MF", "FW"] as const) {
        const have = getSquad(world, clubId).filter((p) => p.position === position).length;
        expect(have).toBeGreaterThanOrEqual(need[position]);
      }
    }
  });
});

describe("非機能要件7: 長期健全性テスト (long-term health check, 10 seasons)", () => {
  it(
    "league age/ability stay bounded, retirement/rookie supply balances, no 1-club monopoly, money conserves",
    { timeout: 120_000 },
    () => {
      const world = buildWorld(20260724, [LEAGUE_PATH]);
      const champions = new Map<string, number>();
      let totalRetired = 0;
      let totalRookies = 0;
      const avgAges: number[] = [];
      const avgAbilities: number[] = [];

      for (let s = 0; s < 10; s++) {
        const report = runSeason(world, { startYear: 2026 + s, keepMatches: false });
        totalRetired += report.development.retired;
        totalRookies += report.development.rookies;

        const champion = report.table.sorted()[0]!.clubId;
        champions.set(champion, (champions.get(champion) ?? 0) + 1);

        const squadPlayers = world.leagues[0]!.clubs.flatMap((c) => getSquad(world, c.id));
        avgAges.push(squadPlayers.reduce((sum, p) => sum + p.age, 0) / squadPlayers.length);
        avgAbilities.push(squadPlayers.reduce((sum, p) => sum + playerAbility(p), 0) / squadPlayers.length);
      }

      // Age/ability drift stays in a plausible football range (no runaway
      // inflation/deflation over a decade of aging + academy intake).
      for (const avgAge of avgAges) {
        expect(avgAge).toBeGreaterThan(20);
        expect(avgAge).toBeLessThan(30);
      }
      for (const avgAbility of avgAbilities) {
        expect(avgAbility).toBeGreaterThan(40);
        expect(avgAbility).toBeLessThan(85);
      }

      // Retirement vs rookie-supply balance: neither side runs away —
      // the player pool doesn't collapse or explode over 10 seasons.
      expect(totalRetired).toBeGreaterThan(0);
      expect(totalRookies).toBeGreaterThan(0);
      const ratio = totalRookies / totalRetired;
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(3);

      // No single-club monopoly across a decade.
      expect(champions.size).toBeGreaterThanOrEqual(2);

      // Money conservation still holds after ten seasons of aging/retirement/intake.
      expect(world.ledger.conservationDrift()).toBeLessThan(1e-9);
    },
  );
});
