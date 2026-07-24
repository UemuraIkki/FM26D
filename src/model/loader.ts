import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LeagueData } from "./types.js";

/**
 * League/club data is data-driven from external JSON (requirement: 非機能/データ).
 */
export function loadLeague(path: string): LeagueData {
  const raw = readFileSync(resolve(path), "utf8");
  const league = JSON.parse(raw) as LeagueData;
  if (!league.id || !Array.isArray(league.clubs) || league.clubs.length < 2) {
    throw new Error(`invalid league data: ${path}`);
  }
  const ids = new Set<string>();
  for (const club of league.clubs) {
    if (ids.has(club.id)) throw new Error(`duplicate club id: ${club.id}`);
    ids.add(club.id);
  }
  return league;
}
