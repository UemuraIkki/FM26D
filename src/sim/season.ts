import { addDays, compareDates, toIso, type SimDate } from "../core/calendar.js";
import { deriveRng } from "../core/rng.js";
import { simulateMatch, type EngineParams, type MatchResult } from "../engine/index.js";
import { StandingsTable } from "../league/standings.js";
import { loadLeague } from "../model/loader.js";
import { generateSquad } from "../model/playerGen.js";
import type { Player, World } from "../model/types.js";
import { fixturesByDate, generateSeasonFixtures, type Fixture } from "../schedule/fixtures.js";
import { selectStartingXI } from "./lineup.js";

export interface PlayedMatch {
  fixture: Fixture;
  result: MatchResult;
}

export interface SeasonReport {
  seasonLabel: string;
  table: StandingsTable;
  matches: PlayedMatch[];
}

export interface SeasonOptions {
  leaguePath: string;
  seed: number;
  /** e.g. 2026 → season 2026/27, kicks off mid-August 2026. */
  startYear: number;
  engineParams?: Partial<EngineParams>;
  /** Called after each simulated day that had matches. */
  onMatch?: (played: PlayedMatch) => void;
}

export function buildWorld(seed: number, leaguePath: string): World {
  const league = loadLeague(leaguePath);
  const players: Player[] = [];
  const playersByClub = new Map<string, Player[]>();
  for (const club of league.clubs) {
    const squad = generateSquad(seed, club);
    players.push(...squad);
    playersByClub.set(club.id, squad);
  }
  return { seed, league, players, playersByClub };
}

/**
 * Run one league season with the daily tick loop (requirement 3.1).
 * Phase A: the only daily systems are fixtures; injuries/morale/contracts hook
 * into the same loop later.
 */
export function runSeason(options: SeasonOptions): SeasonReport {
  const { seed, startYear } = options;
  const world = buildWorld(seed, options.leaguePath);
  const seasonLabel = `${world.league.id}-${startYear}`;
  const clubIds = world.league.clubs.map((c) => c.id);

  const seasonStart: SimDate = { year: startYear, month: 8, day: 8 };
  const fixtures = generateSeasonFixtures(seed, seasonLabel, clubIds, seasonStart);
  const byDate = fixturesByDate(fixtures);
  const lastDate = fixtures.reduce((max, f) => (compareDates(f.date, max) > 0 ? f.date : max), fixtures[0]!.date);

  const table = new StandingsTable(clubIds);
  const matches: PlayedMatch[] = [];

  let day = seasonStart;
  while (compareDates(day, lastDate) <= 0) {
    const todays = byDate.get(toIso(day));
    if (todays) {
      for (const fixture of todays) {
        const homeSquad = world.playersByClub.get(fixture.homeClubId)!;
        const awaySquad = world.playersByClub.get(fixture.awayClubId)!;
        const home = selectStartingXI(fixture.homeClubId, homeSquad);
        const away = selectStartingXI(fixture.awayClubId, awaySquad);
        const rng = deriveRng(seed, `match:${fixture.id}`);
        const result = simulateMatch(home, away, rng, options.engineParams);
        table.record(fixture.homeClubId, fixture.awayClubId, result.homeGoals, result.awayGoals);
        const played = { fixture, result };
        matches.push(played);
        options.onMatch?.(played);
      }
    }
    day = addDays(day, 1);
  }

  return { seasonLabel, table, matches };
}
