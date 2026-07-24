import { addDays, compareDates, toIso, type SimDate } from "../core/calendar.js";
import { deriveRng } from "../core/rng.js";
import type { ClubDecisionMaker } from "../decision/clubDecisionMaker.js";
import { AIDecisionMaker } from "../decision/aiDecisionMaker.js";
import { RationalPlayerAgent, type PlayerAgent } from "../decision/playerAgent.js";
import { simulateMatch, type EngineParams, type MatchResult } from "../engine/index.js";
import {
  payBroadcastBase,
  payMeritPayments,
  payMonthlyWages,
  payTicketIncome,
  processContractExpiries,
} from "../finance/economy.js";
import { StandingsTable } from "../league/standings.js";
import { getRoleBook, type RoleBook } from "../model/roles.js";
import { getSquad, type World } from "../model/world.js";
import { fixturesByDate, generateSeasonFixtures, type Fixture } from "../schedule/fixtures.js";
import { TransferMarket, type RefusalRecord, type TransferRecord } from "../transfer/market.js";

export interface PlayedMatch {
  fixture: Fixture;
  result: MatchResult;
}

export interface SeasonReport {
  seasonLabel: string;
  table: StandingsTable;
  matches: PlayedMatch[];
  transfers: TransferRecord[];
  /** Moves that fell through on the player's own decision (requirement 5.5-4). */
  refusals: RefusalRecord[];
  contractSummary: { renewed: number; released: number };
}

export interface SeasonOptions {
  /** League to run (id within world.leagues). Defaults to the first league. */
  leagueId?: string;
  /** e.g. 2026 → season 2026/27, kicks off mid-August 2026. */
  startYear: number;
  engineParams?: Partial<EngineParams>;
  roleBook?: RoleBook;
  /**
   * Club brains. Every club decision goes through its ClubDecisionMaker
   * (absolute constraint, requirement 1). Missing clubs get an
   * AIDecisionMaker — the future manager mode overrides exactly one entry.
   */
  decisionMakers?: ReadonlyMap<string, ClubDecisionMaker>;
  /** Player-side transfer consent (Phase C default: always accepts). */
  playerAgent?: PlayerAgent;
  /** Disable the transfer market (e.g. for pure engine calibration runs). */
  transfersEnabled?: boolean;
  /** Called after each simulated match. */
  onMatch?: (played: PlayedMatch) => void;
  /**
   * Retain per-match results (with full event logs) in the report.
   * Disable for bulk statistical runs to keep memory flat; consumers then
   * aggregate via `onMatch`. Default true.
   */
  keepMatches?: boolean;
}

/**
 * Run one league season with the daily tick loop (requirement 3.1) over a
 * persistent world. The loop starts July 1 (summer transfer window) and ends
 * after the final matchday plus season-end processing (merit payments,
 * contract expiries), so world state carries correctly into the next season.
 */
export function runSeason(world: World, options: SeasonOptions): SeasonReport {
  const { startYear } = options;
  const league = options.leagueId
    ? world.leagues.find((l) => l.id === options.leagueId)
    : world.leagues[0];
  if (!league) throw new Error(`league not found: ${options.leagueId ?? "(none loaded)"}`);

  const seasonLabel = `${league.id}-${startYear}`;
  const clubIds = league.clubs.map((c) => c.id);
  const roleBook = options.roleBook ?? getRoleBook();
  const transfersEnabled = options.transfersEnabled !== false;

  const brains = new Map<string, ClubDecisionMaker>();
  for (const id of clubIds) {
    brains.set(id, options.decisionMakers?.get(id) ?? new AIDecisionMaker(id));
  }

  const seasonStart: SimDate = { year: startYear, month: 8, day: 8 };
  const fixtures = generateSeasonFixtures(world.seed, seasonLabel, clubIds, seasonStart);
  const byDate = fixturesByDate(fixtures);
  const lastDate = fixtures.reduce((max, f) => (compareDates(f.date, max) > 0 ? f.date : max), fixtures[0]!.date);

  const table = new StandingsTable(clubIds);
  const matches: PlayedMatch[] = [];
  const market = new TransferMarket(
    world,
    roleBook,
    roleBook.defaultFormation,
    brains,
    options.playerAgent ?? new RationalPlayerAgent(),
    startYear + 1,
  );

  // Daily tick from July 1 (window opens) through the final matchday.
  let day: SimDate = { year: startYear, month: 7, day: 1 };
  const broadcastDay = toIso({ year: startYear, month: 8, day: 1 });
  while (compareDates(day, lastDate) <= 0) {
    payMonthlyWages(world, day, clubIds);
    if (toIso(day) === broadcastDay) payBroadcastBase(world, day, clubIds);
    if (transfersEnabled) market.processDay(day, clubIds);

    const todays = byDate.get(toIso(day));
    if (todays) {
      for (const fixture of todays) {
        const context = { roleBook, formation: roleBook.defaultFormation };
        const home = brains.get(fixture.homeClubId)!.selectLineup({ ...context, squad: getSquad(world, fixture.homeClubId) });
        const away = brains.get(fixture.awayClubId)!.selectLineup({ ...context, squad: getSquad(world, fixture.awayClubId) });
        const rng = deriveRng(world.seed, `match:${fixture.id}`);
        const result = simulateMatch(home, away, rng, options.engineParams);
        table.record(fixture.homeClubId, fixture.awayClubId, result.homeGoals, result.awayGoals);
        payTicketIncome(world, day, fixture.homeClubId);
        const played = { fixture, result };
        if (options.keepMatches !== false) matches.push(played);
        options.onMatch?.(played);
      }
    }
    day = addDays(day, 1);
  }

  // Season end: merit payments by final position, then contract expiries.
  payMeritPayments(world, day, table.sorted());
  const contractSummary = processContractExpiries(
    world,
    day,
    startYear + 1,
    clubIds,
    brains,
    roleBook,
    roleBook.defaultFormation,
  );

  return { seasonLabel, table, matches, transfers: market.completed, refusals: market.refusals, contractSummary };
}
