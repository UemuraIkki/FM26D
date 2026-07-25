import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { addDays, nextWeekday, toIso, type SimDate } from "../core/calendar.js";
import { compareIds, deriveRng } from "../core/rng.js";
import type { ClubDecisionMaker } from "../decision/clubDecisionMaker.js";
import { simulateMatch, type EngineParams, type MatchResult, type TeamSheet } from "../engine/index.js";
import { WORLD_ACCOUNT } from "../finance/ledger.js";
import { applyGroupResult, shuffle, sortGroupTable, type GroupRow } from "./groupStage.js";
import { applyMatchMorale, applyMoraleToSheet } from "../morale/morale.js";
import { applyFitnessToSheet, applyMatchFitnessCost, availableSquad } from "../model/fitness.js";
import type { RoleBook } from "../model/roles.js";
import { generateSquad } from "../model/playerGen.js";
import type { Club, Player } from "../model/types.js";
import { getSquad, recordAppearance, type World } from "../model/world.js";
import { selectStartingXI } from "../sim/lineup.js";

/**
 * UEFA Champions League (requirement 2.2 / 2.3).
 *
 * 32 participants: `slotsPerLeague` qualifiers from every simulated league
 * (by last season's table when available, squad stature otherwise) plus
 * abstract clubs carrying only a strength parameter (shadow world, 2.3).
 * Group stage (8 groups of 4, Tuesdays Sep-Dec, home & away) then
 * single-leg knockouts. Prize money flows through the world ledger for
 * simulated clubs; abstract clubs are pure opposition.
 */

interface CLConfig {
  id: string;
  name: string;
  slotsPerLeague: number;
  abstractClubs: Array<{ id: string; name: string; strength: number }>;
  prizes: {
    groupStage: number;
    groupWin: number;
    roundOf16: number;
    quarterFinal: number;
    semiFinal: number;
    winner: number;
  };
}

export interface CLMatch {
  id: string;
  date: SimDate;
  stage: "GROUP" | "R16" | "QF" | "SF" | "FINAL";
  group?: number;
  homeId: string;
  awayId: string;
  result?: MatchResult;
  /** Winner after a drawn knockout tie ("penalties"). */
  koWinnerId?: string;
}

export interface CLReport {
  season: string;
  participants: string[];
  winnerId?: string;
  finalists?: [string, string];
  matches: CLMatch[];
}

let cachedConfig: CLConfig | null = null;

export function loadCLConfig(path = "data/champions-league.json"): CLConfig {
  if (!cachedConfig) {
    cachedConfig = JSON.parse(readFileSync(resolve(path), "utf8")) as CLConfig;
  }
  return cachedConfig;
}

interface Entrant {
  id: string;
  strength: number;
  real: boolean;
}

export class ChampionsLeague {
  private config: CLConfig;
  private entrants: Entrant[] = [];
  private abstractSquads = new Map<string, Player[]>();
  private groups: string[][] = [];
  private groupTables = new Map<number, GroupRow[]>();
  private byDate = new Map<string, CLMatch[]>();
  private koQueue: string[] = [];
  readonly report: CLReport;
  readonly lastMatchDate: SimDate;

  constructor(
    private readonly world: World,
    private readonly roleBook: RoleBook,
    private readonly brains: ReadonlyMap<string, ClubDecisionMaker>,
    private readonly startYear: number,
    private readonly engineParams: Partial<EngineParams> | undefined,
  ) {
    this.config = loadCLConfig();
    this.report = { season: `UCL-${startYear}`, participants: [], matches: [] };
    this.pickEntrants();
    this.drawGroups();
    this.lastMatchDate = this.scheduleGroupStage();
  }

  private pickEntrants(): void {
    const slots = this.config.slotsPerLeague;
    for (const league of this.world.leagues) {
      const order =
        this.world.lastSeasonPositions?.get(league.id) ??
        [...league.clubs]
          .sort((a, b) => b.strength - a.strength || compareIds(a.id, b.id))
          .map((c) => c.id);
      for (const clubId of order.slice(0, slots)) {
        const club = this.world.clubsById.get(clubId)!;
        this.entrants.push({ id: clubId, strength: club.strength, real: true });
      }
    }
    for (const abs of this.config.abstractClubs) {
      if (this.entrants.length >= 32) break;
      this.entrants.push({ id: abs.id, strength: abs.strength, real: false });
      const pseudoClub: Club = { id: abs.id, name: abs.name, shortName: abs.name, strength: abs.strength };
      this.abstractSquads.set(abs.id, generateSquad(this.world.seed, pseudoClub));
    }
    this.report.participants = this.entrants.map((e) => e.id);
    for (const e of this.entrants) {
      if (e.real) {
        this.world.ledger.record(
          { year: this.startYear, month: 9, day: 1 },
          "BROADCAST",
          WORLD_ACCOUNT,
          e.id,
          this.config.prizes.groupStage,
          "UCL group stage",
        );
      }
    }
  }

  /** Seeded pots (by strength) → 8 groups of 4, deterministic shuffle within pots. */
  private drawGroups(): void {
    const rng = deriveRng(this.world.seed, `cl:${this.startYear}:draw`);
    const sorted = [...this.entrants].sort((a, b) => b.strength - a.strength || compareIds(a.id, b.id));
    this.groups = Array.from({ length: 8 }, () => []);
    for (let pot = 0; pot < 4; pot++) {
      const potClubs = sorted.slice(pot * 8, pot * 8 + 8);
      shuffle(rng, potClubs);
      potClubs.forEach((club, g) => this.groups[g]!.push(club.id));
    }
    this.groups.forEach((group, g) =>
      this.groupTables.set(g, group.map((id) => ({ id, points: 0, gf: 0, ga: 0 }))),
    );
  }

  private addMatch(match: CLMatch): void {
    const key = toIso(match.date);
    const list = this.byDate.get(key);
    if (list) list.push(match);
    else this.byDate.set(key, [match]);
    this.report.matches.push(match);
  }

  /** 6 group matchdays on Tuesdays from mid-September; returns final date. */
  private scheduleGroupStage(): SimDate {
    const firstTuesday = nextWeekday({ year: this.startYear, month: 9, day: 12 }, 2);
    // Round-robin pairs for a group of 4: 3 rounds, then reversed fixtures.
    const pairRounds = [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
      [[0, 3], [1, 2]],
    ];
    let serial = 0;
    for (let md = 0; md < 6; md++) {
      const date = addDays(firstTuesday, md * 21); // every 3 weeks
      const round = pairRounds[md % 3]!;
      const reverse = md >= 3;
      this.groups.forEach((group, g) => {
        for (const [a, b] of round) {
          serial++;
          const home = reverse ? group[b!]! : group[a!]!;
          const away = reverse ? group[a!]! : group[b!]!;
          this.addMatch({
            id: `CL-${this.startYear}-G${String(serial).padStart(3, "0")}`,
            date,
            stage: "GROUP",
            group: g,
            homeId: home,
            awayId: away,
          });
        }
      });
    }
    // Knockout Tuesdays: R16 in Feb, QF in Apr, SF late Apr, final late May.
    return nextWeekday({ year: this.startYear + 1, month: 5, day: 24 }, 6);
  }

  /**
   * Falls back to the full unfiltered squad if injuries have thinned a
   * position band below what `selectStartingXI` needs (requirement 4.4;
   * same safety net as src/sim/season.ts's selectLineupSafe).
   */
  private sheetFor(clubId: string, date: SimDate): TeamSheet {
    const real = this.world.clubsById.has(clubId);
    if (real) {
      const brain = this.brains.get(clubId);
      const build = (squad: readonly Player[]) =>
        brain
          ? brain.selectLineup({ squad, roleBook: this.roleBook, formation: this.roleBook.defaultFormation })
          : selectStartingXI(clubId, squad, this.roleBook);
      let sheet: TeamSheet;
      try {
        sheet = build(availableSquad(this.world, clubId, date));
      } catch {
        sheet = build(getSquad(this.world, clubId));
      }
      return applyFitnessToSheet(this.world, applyMoraleToSheet(this.world, sheet));
    }
    const squad = this.abstractSquads.get(clubId);
    if (!squad) throw new Error(`no squad for CL entrant: ${clubId}`);
    return applyFitnessToSheet(this.world, selectStartingXI(clubId, squad, this.roleBook));
  }

  private playMatch(match: CLMatch): void {
    const rng = deriveRng(this.world.seed, `match:${match.id}`);
    const home = this.sheetFor(match.homeId, match.date);
    const away = this.sheetFor(match.awayId, match.date);
    const result = simulateMatch(home, away, rng, this.engineParams);
    match.result = result;

    for (const sheet of [home, away]) {
      applyMatchFitnessCost(this.world, sheet, match.date, { matchId: match.id });
      recordAppearance(this.world, sheet);
    }
    for (const [clubId, sheet, goalsFor, goalsAgainst] of [
      [match.homeId, home, result.homeGoals, result.awayGoals],
      [match.awayId, away, result.awayGoals, result.homeGoals],
    ] as const) {
      if (!this.world.clubsById.has(clubId)) continue;
      const outcome = goalsFor > goalsAgainst ? "WIN" : goalsFor < goalsAgainst ? "LOSS" : "DRAW";
      applyMatchMorale(this.world, clubId, sheet, outcome);
    }

    if (match.stage === "GROUP") {
      const table = this.groupTables.get(match.group!)!;
      const outcome = applyGroupResult(table, match.homeId, match.awayId, result.homeGoals, result.awayGoals);
      const winnerId = outcome === "HOME" ? match.homeId : outcome === "AWAY" ? match.awayId : null;
      if (winnerId && this.world.clubsById.has(winnerId)) {
        this.world.ledger.record(match.date, "MERIT", WORLD_ACCOUNT, winnerId, this.config.prizes.groupWin, "UCL group win");
      }
    } else {
      // Single-leg knockout: level ties go to "penalties" (seeded coin with a
      // slight quality lean).
      if (result.homeGoals === result.awayGoals) {
        const strengthOf = (id: string): number =>
          this.world.clubsById.get(id)?.strength ??
          this.config.abstractClubs.find((a) => a.id === id)?.strength ??
          70;
        const lean = 0.5 + (strengthOf(match.homeId) - strengthOf(match.awayId)) * 0.003;
        const pkRng = deriveRng(this.world.seed, `clpk:${match.id}`);
        match.koWinnerId = pkRng.chance(Math.max(0.2, Math.min(0.8, lean))) ? match.homeId : match.awayId;
      } else {
        match.koWinnerId = result.homeGoals > result.awayGoals ? match.homeId : match.awayId;
      }
      this.koQueue.push(match.koWinnerId);
    }
  }

  private scheduleKnockoutRound(
    stage: "R16" | "QF" | "SF" | "FINAL",
    entrantIds: string[],
    date: SimDate,
    prize: number,
  ): void {
    const rng = deriveRng(this.world.seed, `cl:${this.startYear}:${stage}`);
    const order = [...entrantIds];
    shuffle(rng, order);
    for (let i = 0; i < order.length; i += 2) {
      this.addMatch({
        id: `CL-${this.startYear}-${stage}-${i / 2 + 1}`,
        date,
        stage,
        homeId: order[i]!,
        awayId: order[i + 1]!,
      });
      for (const id of [order[i]!, order[i + 1]!]) {
        if (this.world.clubsById.has(id) && prize > 0) {
          this.world.ledger.record(date, "MERIT", WORLD_ACCOUNT, id, prize, `UCL ${stage}`);
        }
      }
    }
  }

  /** Daily tick hook: play today's matches, advance stages when complete. */
  processDay(date: SimDate): void {
    const todays = this.byDate.get(toIso(date));
    if (todays) {
      for (const match of todays) this.playMatch(match);
    }

    const iso = toIso(date);
    // Stage transitions on fixed dates (day after the last group MD etc.).
    if (iso === toIso(this.groupStageEndTrigger())) {
      const qualified: string[] = [];
      for (let g = 0; g < 8; g++) {
        const table = sortGroupTable(this.groupTables.get(g)!);
        qualified.push(table[0]!.id, table[1]!.id);
      }
      this.scheduleKnockoutRound("R16", qualified, nextWeekday({ year: this.startYear + 1, month: 2, day: 14 }, 2), this.config.prizes.roundOf16);
      this.koQueue = [];
    }
    if (iso === toIso(nextWeekday({ year: this.startYear + 1, month: 2, day: 15 }, 3))) {
      // Day after R16: schedule QF from winners.
      if (this.koQueue.length === 8) {
        this.scheduleKnockoutRound("QF", [...this.koQueue], nextWeekday({ year: this.startYear + 1, month: 4, day: 7 }, 2), this.config.prizes.quarterFinal);
        this.koQueue = [];
      }
    }
    if (iso === toIso(nextWeekday({ year: this.startYear + 1, month: 4, day: 8 }, 3))) {
      if (this.koQueue.length === 4) {
        this.scheduleKnockoutRound("SF", [...this.koQueue], nextWeekday({ year: this.startYear + 1, month: 4, day: 28 }, 2), this.config.prizes.semiFinal);
        this.koQueue = [];
      }
    }
    if (iso === toIso(nextWeekday({ year: this.startYear + 1, month: 4, day: 29 }, 3))) {
      if (this.koQueue.length === 2) {
        const finalists = [...this.koQueue] as [string, string];
        this.report.finalists = finalists;
        this.scheduleKnockoutRound("FINAL", finalists, this.lastMatchDate, 0);
        this.koQueue = [];
      }
    }
    if (iso === toIso(this.lastMatchDate) && this.koQueue.length === 1) {
      this.report.winnerId = this.koQueue[0]!;
      if (this.world.clubsById.has(this.report.winnerId)) {
        this.world.ledger.record(date, "MERIT", WORLD_ACCOUNT, this.report.winnerId, this.config.prizes.winner, "UCL winner");
      }
    }
  }

  private groupStageEndTrigger(): SimDate {
    const firstTuesday = nextWeekday({ year: this.startYear, month: 9, day: 12 }, 2);
    return addDays(firstTuesday, 5 * 21 + 1); // day after matchday 6
  }
}
