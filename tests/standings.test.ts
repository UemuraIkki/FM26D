import { describe, expect, it } from "vitest";
import { StandingsTable } from "../src/league/standings.js";

describe("standings", () => {
  it("awards points and sorts by points, GD, GF", () => {
    const table = new StandingsTable(["A", "B", "C"]);
    table.record("A", "B", 2, 0); // A win
    table.record("B", "C", 1, 1); // draw
    table.record("C", "A", 0, 1); // A win away

    const rows = table.sorted();
    expect(rows[0]?.clubId).toBe("A");
    expect(rows[0]?.points).toBe(6);
    expect(rows[0]?.goalDifference).toBe(3);
    // B and C both have 1 point; C has GD -1 vs B's GD -2, so C ranks higher.
    expect(rows[1]?.clubId).toBe("C");
    expect(rows[1]?.points).toBe(1);
    expect(rows[2]?.clubId).toBe("B");
    expect(rows[2]?.points).toBe(1);
    expect(rows[1]?.goalDifference).toBeGreaterThan(rows[2]?.goalDifference ?? 99);
  });

  it("tracks played counts", () => {
    const table = new StandingsTable(["A", "B"]);
    table.record("A", "B", 0, 0);
    table.record("B", "A", 3, 2);
    const rows = table.sorted();
    for (const row of rows) expect(row.played).toBe(2);
    expect(rows[0]?.clubId).toBe("B");
  });
});
