import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { NewsEvent } from "../observe/newsFeed.js";
import type { World } from "../model/world.js";
import { deserializeWorld, serializeWorld } from "./serialize.js";

// process.getBuiltinModule (not a static `import "node:sqlite"`) sidesteps
// a Vite/vite-node bug where node:sqlite — new enough (Node 22.5+) to be
// missing from Vite 5.4's hardcoded builtin-module list — gets its "node:"
// prefix stripped during externalization and then fails to resolve as a
// bare "sqlite" package. See vitest.config.ts for the matching dep config.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

/**
 * SQLite checkpoint save/load (requirement 6.2 + 7: "セーブ: SQLite。
 * チェックポイントはスナップショット+シード管理"). One `checkpoints` row
 * is kept (latest overwrites — multiple save slots are out of scope), plus
 * an append-only `news_events` table satisfying requirement 6.1's
 * "SQLiteテーブル" output option directly.
 *
 * Checkpoints are only ever taken between `runSeason` calls (season
 * granularity, not mid-season) — see src/sim/season.ts's header and the
 * Phase I plan for why that's the determinism-preserving boundary: no
 * per-season transient object (transfer market, board, competitions)
 * persists on `World`, so a `World` snapshot right after a `runSeason`
 * call returns is a complete, sufficient resume point.
 */

function open(dbPath: string): DatabaseSyncType {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      seed INTEGER NOT NULL,
      next_start_year INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      world_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS news_events (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      player_id TEXT,
      club_id TEXT,
      data_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS news_events_player ON news_events(player_id);
    CREATE INDEX IF NOT EXISTS news_events_type ON news_events(type);
  `);
  return db;
}

export function saveCheckpoint(dbPath: string, world: World, nextStartYear: number, newEvents: readonly NewsEvent[]): void {
  const db = open(dbPath);
  try {
    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO checkpoints (id, seed, next_start_year, created_at, world_json) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET seed = excluded.seed, next_start_year = excluded.next_start_year,
         created_at = excluded.created_at, world_json = excluded.world_json`,
    ).run(world.seed, nextStartYear, new Date().toISOString(), serializeWorld(world));

    const insertEvent = db.prepare(
      `INSERT OR REPLACE INTO news_events (id, date, type, summary, player_id, club_id, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of newEvents) {
      insertEvent.run(e.id, e.date, e.type, e.summary, e.playerId ?? null, e.clubId ?? null, JSON.stringify(e.data));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }
}

export function loadCheckpoint(dbPath: string): { world: World; nextStartYear: number } | null {
  const db = open(dbPath);
  try {
    const row = db.prepare("SELECT seed, next_start_year, world_json FROM checkpoints WHERE id = 1").get() as
      | { seed: number; next_start_year: number; world_json: string }
      | undefined;
    if (!row) return null;
    return { world: deserializeWorld(row.world_json), nextStartYear: row.next_start_year };
  } finally {
    db.close();
  }
}

export interface NewsEventQuery {
  playerId?: string;
  type?: string;
  limit?: number;
}

export function queryNewsEvents(dbPath: string, filter: NewsEventQuery = {}): NewsEvent[] {
  const db = open(dbPath);
  try {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter.playerId) {
      clauses.push("player_id = ?");
      params.push(filter.playerId);
    }
    if (filter.type) {
      clauses.push("type = ?");
      params.push(filter.type);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = filter.limit ?? 200;
    const rows = db
      .prepare(`SELECT id, date, type, summary, player_id, club_id, data_json FROM news_events ${where} ORDER BY date ASC, id ASC LIMIT ?`)
      .all(...params, limit) as Array<{
      id: string;
      date: string;
      type: string;
      summary: string;
      player_id: string | null;
      club_id: string | null;
      data_json: string;
    }>;
    return rows.map((r) => {
      const event: NewsEvent = {
        id: r.id,
        date: r.date,
        type: r.type as NewsEvent["type"],
        summary: r.summary,
        data: JSON.parse(r.data_json) as Record<string, unknown>,
      };
      if (r.player_id) event.playerId = r.player_id;
      if (r.club_id) event.clubId = r.club_id;
      return event;
    });
  } finally {
    db.close();
  }
}
