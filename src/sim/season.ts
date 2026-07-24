import { addDays, compareDates, toIso, type SimDate } from "../core/calendar.js";
import { BoardSystem, managerMultiplier, type ManagerChange } from "../board/board.js";
import { ChampionsLeague, type CLReport } from "../competitions/championsLeague.js";
import { deriveRng } from "../core/rng.js";
import type { ClubDecisionMaker } from "../decision/clubDecisionMaker.js";
import { AIDecisionMaker } from "../decision/aiDecisionMaker.js";
import { RationalPlayerAgent, type PlayerAgent } from "../decision/playerAgent.js";
import { simulateMatch, type EngineParams, type MatchResult, type TeamSheet } from "../engine/index.js";
import {
  payBroadcastBase,
  payMeritPayments,
  payMonthlyWages,
  payTicketIncome,
  processContractExpiries,
} from "../finance/economy.js";
import { StandingsTable } from "../league/standings.js";
import { getRoleBook, type RoleBook } from "../model/roles.js";
import { exitUnsignedFreeAgents, supplyShadowProspects } from "../model/shadow.js";
import { getSquad, type World } from "../model/world.js";
import { applyMatchMorale, applyMoraleToSheet, moraleDailyTick } from "../morale/morale.js";
import { fixturesByDate, generateSeasonFixtures, type Fixture } from "../schedule/fixtures.js";
import { TransferMarket, type RefusalRecord, type TransferRecord } from "../transfer/market.js";

export interface PlayedMatch {
  fixture: Fixture;
  result: MatchResult;
}

export interface SeasonReport {
  seasonLabel: string;
  /** Primary (first) league's table, for single-league ergonomics. */
  table: StandingsTable;
  /** Every simulated league's table by league id. */
  tables: Map<string, StandingsTable>;
  matches: PlayedMatch[];
  transfers: TransferRecord[];
  /** Moves that fell through on the player's own decision (requirement 5.5-4). */
  refusals: RefusalRecord[];
  /** Sackings and appointments this season (requirements 5.2 / 5.4). */
  managerChanges: ManagerChange[];
  contractSummary: { renewed: number; released: number };
  /** Champions League summary; undefined when the world has fewer than 2 leagues. */
  championsLeague?: CLReport;
  /** Shadow-world flows (requirement 2.3). */
  shadow: { arrivals: number; departures: number };
}

export interface SeasonOptions {
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
  /** Player-side transfer consent (default: RationalPlayerAgent). */
  playerAgent?: PlayerAgent;
  /** Disable the transfer market (e.g. for pure engine calibration runs). */
  transfersEnabled?: boolean;
  /** Champions League on/off; default: on when 2+ leagues are simulated. */
  championsLeagueEnabled?: boolean;
  /** Called after each simulated league match. */
  onMatch?: (played: PlayedMatch) => void;
  /**
   * Retain per-match results (with full event logs) in the report.
   * Disable for bulk statistical runs to keep memory flat; consumers then
   * aggregate via `onMatch`. Default true.
   */
  keepMatches?: boolean;
}

/**
 * Run one full world season with the daily tick loop (requirement 3.1):
 * every simulated league in parallel on the same calendar, the Champions
 * League midweek, the cross-league transfer market in the windows, finances,
 * morale, boards, and shadow-world flows. The loop starts July 1 and ends
 * after the last fixture (league or CL final) plus season-end processing.
 */
export function runSeason(world: World, options: SeasonOptions): SeasonReport {
  const { startYear } = options;
  if (world.leagues.length === 0) throw new Error("world has no leagues");

  const seasonLabel = `WORLD-${startYear}`;
  const roleBook = options.roleBook ?? getRoleBook();
  const transfersEnabled = options.transfersEnabled !== false;
  const clEnabled = options.championsLeagueEnabled ?? world.leagues.length >= 2;

  const allClubIds: string[] = [];
  for (const league of world.leagues) for (const club of league.clubs) allClubIds.push(club.id);

  const brains = new Map<string, ClubDecisionMaker>();
  for (const id of allClubIds) {
    brains.set(id, options.decisionMakers?.get(id) ?? new AIDecisionMaker(id));
  }

  // Shadow inflow before the window opens (requirement 2.3).
  const arrivals = transfersEnabled ? supplyShadowProspects(world, startYear).length : 0;

  const seasonStart: SimDate = { year: startYear, month: 8, day: 8 };
  interface LeagueRun {
    id: string;
    clubIds: string[];
    table: StandingsTable;
    board: BoardSystem;
    broadcastBase: number;
    byDate: Map<string, Fixture[]>;
    lastDate: SimDate;
  }
  const runs: LeagueRun[] = world.leagues.map((league) => {
    const clubIds = league.clubs.map((c) => c.id);
    const fixtures = generateSeasonFixtures(world.seed, `${league.id}-${startYear}`, clubIds, seasonStart);
    return {
      id: league.id,
      clubIds,
      table: new StandingsTable(clubIds),
      board: new BoardSystem(world, clubIds),
      broadcastBase: league.broadcastBase ?? 100,
      byDate: fixturesByDate(fixtures),
      lastDate: fixtures.reduce((max, f) => (compareDates(f.date, max) > 0 ? f.date : max), fixtures[0]!.date),
    };
  });

  const market = new TransferMarket(
    world,
    roleBook,
    roleBook.defaultFormation,
    brains,
    options.playerAgent ?? new RationalPlayerAgent(),
    startYear + 1,
  );
  const cl = clEnabled ? new ChampionsLeague(world, roleBook, brains, startYear, options.engineParams) : null;

  const matches: PlayedMatch[] = [];
  let lastDate = runs.reduce((max, r) => (compareDates(r.lastDate, max) > 0 ? r.lastDate : max), runs[0]!.lastDate);
  if (cl && compareDates(cl.lastMatchDate, lastDate) > 0) lastDate = cl.lastMatchDate;

  let day: SimDate = { year: startYear, month: 7, day: 1 };
  const broadcastDay = toIso({ year: startYear, month: 8, day: 1 });
  while (compareDates(day, lastDate) <= 0) {
    moraleDailyTick(world);
    payMonthlyWages(world, day, allClubIds);
    if (toIso(day) === broadcastDay) {
      for (const run of runs) payBroadcastBase(world, day, run.clubIds, run.broadcastBase);
    }
    if (transfersEnabled) market.processDay(day, allClubIds);
    cl?.processDay(day);

    for (const run of runs) {
      const todays = run.byDate.get(toIso(day));
      if (!todays) continue;
      for (const fixture of todays) {
        const context = { roleBook, formation: roleBook.defaultFormation };
        const home = brains.get(fixture.homeClubId)!.selectLineup({ ...context, squad: getSquad(world, fixture.homeClubId) });
        const away = brains.get(fixture.awayClubId)!.selectLineup({ ...context, squad: getSquad(world, fixture.awayClubId) });
        const rng = deriveRng(world.seed, `match:${fixture.id}`);
        // Morale (±5%) and manager quality (±2%) scale match-day ability.
        const result = simulateMatch(
          scaleSheet(applyMoraleToSheet(world, home), managerMultiplier(world, fixture.homeClubId)),
          scaleSheet(applyMoraleToSheet(world, away), managerMultiplier(world, fixture.awayClubId)),
          rng,
          options.engineParams,
        );
        run.table.record(fixture.homeClubId, fixture.awayClubId, result.homeGoals, result.awayGoals);
        payTicketIncome(world, day, fixture.homeClubId);
        const homeOutcome = result.homeGoals > result.awayGoals ? "WIN" : result.homeGoals < result.awayGoals ? "LOSS" : "DRAW";
        const awayOutcome = homeOutcome === "WIN" ? "LOSS" : homeOutcome === "LOSS" ? "WIN" : "DRAW";
        applyMatchMorale(world, fixture.homeClubId, home, homeOutcome);
        applyMatchMorale(world, fixture.awayClubId, away, awayOutcome);
        const sorted = run.table.sorted();
        run.board.reviewAfterMatch(day, fixture.homeClubId, homeOutcome, sorted);
        run.board.reviewAfterMatch(day, fixture.awayClubId, awayOutcome, sorted);
        const played = { fixture, result };
        if (options.keepMatches !== false) matches.push(played);
        options.onMatch?.(played);
      }
    }
    day = addDays(day, 1);
  }

  // Season end: board verdicts, merit payments, contract expiries, shadow exit.
  const tables = new Map<string, StandingsTable>();
  const lastSeasonPositions = new Map<string, string[]>();
  const managerChanges: ManagerChange[] = [];
  for (const run of runs) {
    const sorted = run.table.sorted();
    run.board.reviewSeasonEnd(day, sorted);
    payMeritPayments(world, day, sorted, run.broadcastBase);
    tables.set(run.id, run.table);
    lastSeasonPositions.set(run.id, sorted.map((row) => row.clubId));
    managerChanges.push(...run.board.changes);
  }
  world.lastSeasonPositions = lastSeasonPositions;

  const contractSummary = processContractExpiries(
    world,
    day,
    startYear + 1,
    allClubIds,
    brains,
    roleBook,
    roleBook.defaultFormation,
  );
  const departures = transfersEnabled ? exitUnsignedFreeAgents(world) : 0;

  const report: SeasonReport = {
    seasonLabel,
    table: tables.get(world.leagues[0]!.id)!,
    tables,
    matches,
    transfers: market.completed,
    refusals: market.refusals,
    managerChanges,
    contractSummary,
    shadow: { arrivals, departures },
  };
  if (cl) report.championsLeague = cl.report;
  return report;
}

/** Uniformly scale a sheet's attributes (bounded factors only). */
function scaleSheet(sheet: TeamSheet, factor: number): TeamSheet {
  if (factor === 1) return sheet;
  return {
    teamId: sheet.teamId,
    players: sheet.players.map((p) => ({
      ...p,
      passing: p.passing * factor,
      shooting: p.shooting * factor,
      dribbling: p.dribbling * factor,
      defending: p.defending * factor,
      aerial: p.aerial * factor,
      speed: p.speed * factor,
      stamina: p.stamina * factor,
      strength: p.strength * factor,
      agility: p.agility * factor,
      decisions: p.decisions * factor,
      positioning: p.positioning * factor,
      finishing: p.finishing * factor,
      shotStopping: p.shotStopping * factor,
      aerialHandling: p.aerialHandling * factor,
      distribution: p.distribution * factor,
    })),
  };
}
