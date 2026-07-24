import { describe, expect, it } from "vitest";
import { loadRoleBook, roleScore, isEligible } from "../src/model/roles.js";
import { buildDepthChart } from "../src/squad/depthChart.js";
import { selectStartingXI } from "../src/sim/lineup.js";
import { generateSquad } from "../src/model/playerGen.js";
import { loadLeague } from "../src/model/loader.js";
import type { Player, PlayerAttributes } from "../src/model/types.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

function makePlayer(id: string, position: Player["position"], attrs: Partial<PlayerAttributes>): Player {
  const base: PlayerAttributes = {
    passing: 50, shooting: 50, dribbling: 50, defending: 50, aerial: 50,
    speed: 50, stamina: 50, strength: 50, agility: 50,
    decisions: 50, positioning: 50, finishing: 50, ambition: 50, professionalism: 50,
    shotStopping: 10, aerialHandling: 10, distribution: 10,
  };
  return {
    id, name: id, clubId: "T", position, age: 25,
    attributes: { ...base, ...attrs }, contract: null, nationality: "ENG", potential: 60,
  };
}

describe("role book", () => {
  it("loads ~20 roles with a valid 11-slot default formation", () => {
    const book = loadRoleBook();
    expect(book.roles.length).toBeGreaterThanOrEqual(20);
    expect(book.defaultFormation.slots).toHaveLength(11);
    expect(book.defaultFormation.slots[0]).toBe("GK");
  });

  it("roleScore is a weight-normalized average on the attribute scale", () => {
    const book = loadRoleBook();
    const poacher = book.rolesById.get("P")!;
    const uniform = makePlayer("u", "FW", {});
    // All weighted attrs are 50 -> score exactly 50.
    expect(roleScore(uniform, poacher)).toBeCloseTo(50, 5);

    const finisher = makePlayer("f", "FW", { finishing: 90, positioning: 80, shooting: 85 });
    expect(roleScore(finisher, poacher)).toBeGreaterThan(roleScore(uniform, poacher));
  });

  it("ranks specialists above generalists for their role", () => {
    const book = loadRoleBook();
    const cb = book.rolesById.get("CB")!;
    const stopper = makePlayer("s", "DF", { defending: 85, aerial: 80, positioning: 80 });
    const playmaker = makePlayer("p", "DF", { passing: 90, defending: 55 });
    expect(roleScore(stopper, cb)).toBeGreaterThan(roleScore(playmaker, cb));
  });

  it("enforces positional eligibility", () => {
    const book = loadRoleBook();
    const gkRole = book.rolesById.get("GK")!;
    expect(isEligible(makePlayer("g", "GK", {}), gkRole)).toBe(true);
    expect(isEligible(makePlayer("d", "DF", {}), gkRole)).toBe(false);
  });
});

describe("depth chart", () => {
  it("flags shortage when eligible depth < slots * 2", () => {
    const book = loadRoleBook();
    // Squad with only 1 GK: GK role (1 slot) requires 2.
    const squad = [
      makePlayer("gk1", "GK", { shotStopping: 70 }),
      ...Array.from({ length: 8 }, (_, i) => makePlayer(`df${i}`, "DF", {})),
      ...Array.from({ length: 8 }, (_, i) => makePlayer(`mf${i}`, "MF", {})),
      ...Array.from({ length: 5 }, (_, i) => makePlayer(`fw${i}`, "FW", {})),
    ];
    const chart = buildDepthChart("T", squad, book);
    const gkDepth = chart.roles.find((r) => r.roleId === "GK")!;
    expect(gkDepth.shortage).toBe(true);
    expect(chart.shortages.map((r) => r.roleId)).toContain("GK");
  });

  it("detects surplus players outside every role's required depth", () => {
    const book = loadRoleBook();
    const league = loadLeague(LEAGUE_PATH);
    const club = league.clubs[0]!;
    const squad = generateSquad(1, club);
    const chart = buildDepthChart(club.id, squad, book);
    // A 22-man balanced squad vs an 11-slot formation should leave someone spare.
    expect(chart.surplus.length).toBeGreaterThan(0);
    // Surplus players must not appear in any role's required depth.
    for (const p of chart.surplus) {
      for (const rd of chart.roles) {
        const inRequired = rd.depth.slice(0, rd.required).some((e) => e.player.id === p.id);
        expect(inRequired).toBe(false);
      }
    }
    // Generated squads are balanced: no shortages expected.
    expect(chart.shortages).toHaveLength(0);
  });

  it("ranks depth best-first", () => {
    const book = loadRoleBook();
    const squad = generateSquad(2, loadLeague(LEAGUE_PATH).clubs[1]!);
    const chart = buildDepthChart("X", squad, book);
    for (const rd of chart.roles) {
      for (let i = 1; i < rd.depth.length; i++) {
        expect(rd.depth[i - 1]!.score).toBeGreaterThanOrEqual(rd.depth[i]!.score);
      }
    }
  });
});

describe("role-based lineup", () => {
  it("fills all 11 slots with distinct players, GK first", () => {
    const league = loadLeague(LEAGUE_PATH);
    const club = league.clubs[2]!;
    const sheet = selectStartingXI(club.id, generateSquad(3, club));
    expect(sheet.players).toHaveLength(11);
    expect(new Set(sheet.players.map((p) => p.id)).size).toBe(11);
    expect(sheet.players.filter((p) => p.position === "GK")).toHaveLength(1);
  });
});
