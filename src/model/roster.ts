import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Position } from "./types.js";

/**
 * Real player rosters (requirement 8: 実データ調達). Club/league names in
 * data/leagues/*.json are already real; this supplies real player names
 * (+ position/age/nationality) to seed onto procedurally-generated
 * attributes (src/model/playerGen.ts) — skill ratings stay synthetic since
 * no legitimate public source of FM-style attribute data exists.
 *
 * A roster file is optional per league: data/rosters/<same-basename>.json
 * next to data/leagues/<basename>.json. Missing file or missing club entry
 * falls back to fully-procedural generation for that club, so partial
 * real-data coverage never breaks the pipeline.
 */
export interface RosterPlayer {
  name: string;
  position: Position;
  age: number;
  /** Plain country name from the source data (mapped to internal nation
   *  codes where recognized by src/model/nationality.ts; kept as-is otherwise). */
  nationality: string;
}

export type Roster = Record<string, RosterPlayer[]>;

function rosterPathFor(leaguePath: string): string {
  return leaguePath.replace(/leagues([\\/])/, "rosters$1");
}

export function loadRoster(leaguePath: string): Roster | null {
  const path = rosterPathFor(leaguePath);
  const resolved = resolve(path);
  if (!existsSync(resolved)) return null;
  const raw = readFileSync(resolved, "utf8");
  return JSON.parse(raw) as Roster;
}
