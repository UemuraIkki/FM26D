import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapCountryNameToCode } from "../src/model/nationality.js";
import { generateSquad } from "../src/model/playerGen.js";
import { loadRoster, type RosterPlayer } from "../src/model/roster.js";
import { buildWorld, getSquad } from "../src/model/world.js";
import type { Club } from "../src/model/types.js";

const CLUB: Club = { id: "TST", name: "Test FC", shortName: "Test", strength: 80 };

describe("real player rosters (requirement 8)", () => {
  it("mapCountryNameToCode maps recognized names, passes through unrecognized ones", () => {
    expect(mapCountryNameToCode("England")).toBe("ENG");
    expect(mapCountryNameToCode("Spain")).toBe("ESP");
    expect(mapCountryNameToCode("USA")).toBe("USA");
    expect(mapCountryNameToCode("Atlantis")).toBe("Atlantis");
  });

  it("seeds real name/age/nationality onto a synthetic-attribute squad, filling the rest procedurally", () => {
    const roster: RosterPlayer[] = [
      { name: "Real Keeper", position: "GK", age: 29, nationality: "Spain" },
      { name: "Real Winger", position: "FW", age: 23, nationality: "Brazil" },
    ];
    const squad = generateSquad(1, CLUB, roster);
    // Squad plan totals (GK:3, DF:8, MF:8, FW:5) unaffected by real-data seeding.
    expect(squad).toHaveLength(24);

    const gk = squad.filter((p) => p.position === "GK");
    expect(gk.some((p) => p.name === "Real Keeper" && p.age === 29 && p.nationality === "ESP")).toBe(true);
    // Other GK slots still procedurally generated (non-empty synthetic names).
    expect(gk.filter((p) => p.name !== "Real Keeper")).toHaveLength(2);

    const fw = squad.filter((p) => p.position === "FW");
    expect(fw.some((p) => p.name === "Real Winger" && p.nationality === "BRA")).toBe(true);
    expect(fw).toHaveLength(5);

    // Attributes are always synthetic, real or not — no attribute-data source exists.
    for (const p of squad) {
      expect(p.attributes.passing).toBeGreaterThanOrEqual(1);
      expect(p.attributes.passing).toBeLessThanOrEqual(99);
    }
  });

  it("falls back to fully procedural generation when no roster is given", () => {
    const squad = generateSquad(1, CLUB);
    expect(squad).toHaveLength(24);
    expect(squad.every((p) => p.name.includes(" "))).toBe(true); // synthetic "First Last" shape
  });

  it("loadRoster reads a file next to the league data and returns null when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm26d-roster-test-"));
    try {
      const leaguesDir = join(dir, "leagues");
      const rostersDir = join(dir, "rosters");
      mkdirSync(leaguesDir);
      mkdirSync(rostersDir);
      const leaguePath = join(leaguesDir, "test-league.json");
      writeFileSync(leaguePath, "{}");
      writeFileSync(join(rostersDir, "test-league.json"), JSON.stringify({ TST: [{ name: "X", position: "GK", age: 20, nationality: "England" }] }));

      const found = loadRoster(leaguePath);
      expect(found?.TST).toHaveLength(1);

      writeFileSync(join(leaguesDir, "no-roster-league.json"), "{}");
      const missing = loadRoster(join(leaguesDir, "no-roster-league.json"));
      expect(missing).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buildWorld wires real nationality through without the procedural draw overwriting it", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm26d-roster-world-test-"));
    try {
      const leaguesDir = join(dir, "leagues");
      const rostersDir = join(dir, "rosters");
      mkdirSync(leaguesDir);
      mkdirSync(rostersDir);
      const league = {
        id: "TSTL",
        name: "Test League",
        country: "Testland",
        clubs: [
          { id: "TST", name: "Test FC", shortName: "Test", strength: 80 },
          { id: "TS2", name: "Test FC 2", shortName: "Test2", strength: 75 },
        ],
      };
      const leaguePath = join(leaguesDir, "test-league.json");
      writeFileSync(leaguePath, JSON.stringify(league));
      writeFileSync(
        join(rostersDir, "test-league.json"),
        JSON.stringify({ TST: [{ name: "Real Player", position: "MF", age: 26, nationality: "Japan" }] }),
      );

      const world = buildWorld(1, [leaguePath]);
      const real = getSquad(world, "TST").find((p) => p.name === "Real Player")!;
      expect(real.nationality).toBe("JPN");
      // Club with no roster entry stays fully procedural.
      expect(getSquad(world, "TS2").every((p) => p.nationality.length > 0)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
