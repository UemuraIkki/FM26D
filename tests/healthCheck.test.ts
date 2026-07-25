import { describe, expect, it } from "vitest";
import { giniCoefficient, giniOfChampions } from "../src/stats/gini.js";
import {
  evaluateHealthCheck,
  healthCheckToCsv,
  runHealthCheck,
  summarizeHealthCheck,
  type HealthCheckRow,
} from "../src/stats/healthCheck.js";
import { buildWorld } from "../src/model/world.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

describe("Gini coefficient (non-functional requirement 7)", () => {
  it("is 0 for a perfectly equal distribution", () => {
    expect(giniCoefficient([5, 5, 5, 5])).toBeCloseTo(0, 6);
  });

  it("approaches 1 as one entry takes everything", () => {
    const g = giniCoefficient([0, 0, 0, 100]);
    expect(g).toBeGreaterThan(0.7);
    expect(g).toBeLessThan(1);
  });

  it("is 0 for an all-zero distribution (no data yet)", () => {
    expect(giniCoefficient([0, 0, 0])).toBe(0);
  });

  it("giniOfChampions counts non-winning clubs as zero", () => {
    const g = giniOfChampions(["A", "A", "A"], ["A", "B", "C", "D"]);
    // One club won every title, three never won: maximal concentration.
    expect(g).toBeCloseTo(0.75, 6);
  });
});

describe("long-term health check (non-functional requirement 7, 必須)", () => {
  it("runHealthCheck produces one row per season with all four tracked metrics", { timeout: 60_000 }, () => {
    const world = buildWorld(11, [LEAGUE_PATH]);
    const rows = runHealthCheck(world, 2026, 3);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.avgAge).toBeGreaterThan(0);
      expect(row.avgAbility).toBeGreaterThan(0);
      expect(row.conservationDrift).toBeLessThan(1e-6);
      expect(row.champion.length).toBeGreaterThan(0);
      expect(row.retired).toBeGreaterThanOrEqual(0);
      expect(row.rookies).toBeGreaterThanOrEqual(0);
    }
  });

  it("summarizeHealthCheck and evaluateHealthCheck report against thresholds", { timeout: 60_000 }, () => {
    const world = buildWorld(20260724, [LEAGUE_PATH]);
    const rows = runHealthCheck(world, 2026, 10);
    const summary = summarizeHealthCheck(world, rows);
    expect(summary.seasons).toBe(10);
    expect(summary.distinctChampions).toBeGreaterThanOrEqual(1);
    expect(summary.giniOfChampions).toBeGreaterThanOrEqual(0);
    expect(summary.giniOfChampions).toBeLessThanOrEqual(1);

    const results = evaluateHealthCheck(summary);
    expect(results).toHaveLength(5);
    for (const r of results) expect(typeof r.ok).toBe("boolean");
    // This seed's 10-season run should be healthy on every tracked metric.
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("healthCheckToCsv formats a parseable header + one line per season", () => {
    const rows: HealthCheckRow[] = [
      { season: 2026, avgAge: 25.5, avgAbility: 70.2, conservationDrift: 0, champion: "ARS", retired: 3, rookies: 5 },
      { season: 2027, avgAge: 25.6, avgAbility: 70.4, conservationDrift: 0, champion: "LIV", retired: 4, rookies: 6 },
    ];
    const csv = healthCheckToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("season,avg_age,avg_ability,conservation_drift,champion,retired,rookies");
    expect(lines[1]).toContain("2026");
    expect(lines[1]).toContain("ARS");
  });
});
