import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { addDays, toIso, type SimDate } from "../core/calendar.js";
import { compareIds, deriveRng } from "../core/rng.js";
import { applyFitnessToSheet, applyMatchFitnessCost } from "../model/fitness.js";
import { callUpSquad, nationStrength, recordCaps } from "../model/nationalTeam.js";
import { generateSquad } from "../model/playerGen.js";
import type { Club, Player } from "../model/types.js";
import type { World } from "../model/world.js";
import { simulateMatch, type EngineParams, type MatchResult } from "../engine/index.js";
import { selectStartingXI } from "../sim/lineup.js";
import type { RoleBook } from "../model/roles.js";

/**
 * World Cup / EURO (requirement 2.2): a 4-yearly national tournament, fully
 * simulated (groups + knockouts) within July of the host season, before the
 * Aug 8 domestic kickoff already used by generateSeasonFixtures. Structured
 * like the Champions League (src/competitions/championsLeague.ts) but keyed
 * by nationality-derived squads (src/model/nationalTeam.ts) instead of club
 * squads, and shares one class between both competitions since — once the
 * group stage is normalized to a single round-robin (3 matchdays for both
 * groups of 3 and groups of 4) — the two formats need identical scheduling.
 *
 * No ledger money moves here: international federations aren't club-ledger
 * accounts in this sim (unlike the CL, whose prize money goes to real
 * clubs). Sheets get fitness scaling only, never club morale — morale's
 * atmosphere lookup is keyed by clubId and would throw for a nation id.
 */

export type TournamentKind = "WORLD_CUP" | "EURO";

interface TournamentConfig {
  id: string;
  name: string;
  groupCount: number;
  groupSize: number;
  participants: string[];
  abstractNations: Array<{ id: string; name: string; strength: number }>;
}

export interface TournamentMatch {
  id: string;
  date: SimDate;
  stage: "GROUP" | "R16" | "QF" | "SF" | "FINAL";
  group?: number;
  homeId: string;
  awayId: string;
  result?: MatchResult;
  koWinnerId?: string;
}

export interface TournamentReport {
  competition: TournamentKind;
  season: string;
  participants: string[];
  winnerId?: string;
  finalists?: [string, string];
  matches: TournamentMatch[];
  injuries: number;
}

interface GroupRow {
  id: string;
  points: number;
  gf: number;
  ga: number;
}

const CONFIG_PATH: Record<TournamentKind, string> = {
  WORLD_CUP: "data/world-cup.json",
  EURO: "data/euro.json",
};

const cachedConfigs = new Map<TournamentKind, TournamentConfig>();

function loadTournamentConfig(kind: TournamentKind): TournamentConfig {
  let config = cachedConfigs.get(kind);
  if (!config) {
    config = JSON.parse(readFileSync(resolve(CONFIG_PATH[kind]), "utf8")) as TournamentConfig;
    cachedConfigs.set(kind, config);
  }
  return config;
}

/** Cycle: World Cup years ≡ 2 mod 4 (2026, 2030…), EURO years ≡ 0 mod 4 (2028, 2032…). */
export function tournamentKindFor(startYear: number): TournamentKind | null {
  const mod = startYear % 4;
  if (mod === 2) return "WORLD_CUP";
  if (mod === 0) return "EURO";
  return null;
}

/** Single round-robin pairing table for a group of `size` entrants (indices into the group). */
function roundRobinRounds(size: number): number[][][] {
  if (size === 4) {
    return [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
      [[0, 3], [1, 2]],
    ];
  }
  if (size === 3) {
    return [[[0, 1]], [[0, 2]], [[1, 2]]];
  }
  throw new Error(`unsupported tournament group size: ${size}`);
}

interface Entrant {
  id: string;
  strength: number;
  real: boolean;
}

export class InternationalTournament {
  private config: TournamentConfig;
  private entrants: Entrant[] = [];
  private abstractSquads = new Map<string, Player[]>();
  private groups: string[][] = [];
  private groupTables = new Map<number, GroupRow[]>();
  private byDate = new Map<string, TournamentMatch[]>();
  private koQueue: string[] = [];
  readonly report: TournamentReport;
  readonly lastMatchDate: SimDate;

  /** Stage transition trigger dates, computed once (see scheduleGroupStage). */
  private groupEndTrigger!: SimDate;
  private r16Date!: SimDate;
  private qfDate!: SimDate;
  private sfDate!: SimDate;
  private finalDate!: SimDate;

  constructor(
    private readonly world: World,
    private readonly roleBook: RoleBook,
    private readonly kind: TournamentKind,
    private readonly startYear: number,
    private readonly engineParams: Partial<EngineParams> | undefined,
  ) {
    this.config = loadTournamentConfig(kind);
    this.report = { competition: kind, season: `${this.config.id}-${startYear}`, participants: [], matches: [], injuries: 0 };
    this.pickEntrants();
    this.drawGroups();
    this.lastMatchDate = this.scheduleGroupStage();
  }

  private pickEntrants(): void {
    for (const nationId of this.config.participants) {
      this.entrants.push({ id: nationId, strength: nationStrength(this.world, nationId), real: true });
    }
    for (const abs of this.config.abstractNations) {
      this.entrants.push({ id: abs.id, strength: abs.strength, real: false });
      const pseudoClub: Club = { id: abs.id, name: abs.name, shortName: abs.name, strength: abs.strength };
      this.abstractSquads.set(abs.id, generateSquad(this.world.seed, pseudoClub));
    }
    const expected = this.config.groupCount * this.config.groupSize;
    if (this.entrants.length !== expected) {
      throw new Error(
        `${this.kind} config has ${this.entrants.length} entrants, expected ${expected} (${this.config.groupCount} groups of ${this.config.groupSize})`,
      );
    }
    this.report.participants = this.entrants.map((e) => e.id);
  }

  /** Seeded pots (by strength) → groups, deterministic shuffle within pots. */
  private drawGroups(): void {
    const rng = deriveRng(this.world.seed, `${this.kind}:${this.startYear}:draw`);
    const sorted = [...this.entrants].sort((a, b) => b.strength - a.strength || compareIds(a.id, b.id));
    const { groupCount, groupSize } = this.config;
    this.groups = Array.from({ length: groupCount }, () => []);
    for (let pot = 0; pot < groupSize; pot++) {
      const potEntrants = sorted.slice(pot * groupCount, pot * groupCount + groupCount);
      for (let i = potEntrants.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [potEntrants[i], potEntrants[j]] = [potEntrants[j]!, potEntrants[i]!];
      }
      potEntrants.forEach((entrant, g) => this.groups[g]!.push(entrant.id));
    }
    this.groups.forEach((group, g) =>
      this.groupTables.set(g, group.map((id) => ({ id, points: 0, gf: 0, ga: 0 }))),
    );
  }

  private addMatch(match: TournamentMatch): void {
    const key = toIso(match.date);
    const list = this.byDate.get(key);
    if (list) list.push(match);
    else this.byDate.set(key, [match]);
    this.report.matches.push(match);
  }

  /**
   * Single round-robin group stage, 3 matchdays 4 days apart starting July 4
   * of `startYear`, then 4 knockout rounds also 4 days apart — 7 stages
   * total, comfortably finishing (~July 28) before the Aug 8 domestic
   * kickoff (src/schedule/fixtures.ts's season start date).
   */
  private scheduleGroupStage(): SimDate {
    const rounds = roundRobinRounds(this.config.groupSize);
    const anchor: SimDate = addDays({ year: this.startYear, month: 7, day: 1 }, 3); // July 4
    let serial = 0;
    let lastMd = anchor;
    for (let md = 0; md < rounds.length; md++) {
      const date = addDays(anchor, md * 4);
      lastMd = date;
      const round = rounds[md]!;
      this.groups.forEach((group, g) => {
        for (const [a, b] of round) {
          serial++;
          this.addMatch({
            id: `${this.config.id}-${this.startYear}-G${String(serial).padStart(3, "0")}`,
            date,
            stage: "GROUP",
            group: g,
            homeId: group[a!]!,
            awayId: group[b!]!,
          });
        }
      });
    }
    this.groupEndTrigger = addDays(lastMd, 1);
    this.r16Date = addDays(lastMd, 4);
    this.qfDate = addDays(this.r16Date, 4);
    this.sfDate = addDays(this.qfDate, 4);
    this.finalDate = addDays(this.sfDate, 4);
    return this.finalDate;
  }

  private sheetFor(id: string, date: SimDate) {
    const real = this.config.participants.includes(id);
    const squad = real ? callUpSquad(this.world, id, date) : this.abstractSquads.get(id)!;
    const sheet = selectStartingXI(id, squad, this.roleBook);
    return applyFitnessToSheet(this.world, sheet);
  }

  private playMatch(match: TournamentMatch): void {
    const rng = deriveRng(this.world.seed, `match:${match.id}`);
    const home = this.sheetFor(match.homeId, match.date);
    const away = this.sheetFor(match.awayId, match.date);
    const result = simulateMatch(home, away, rng, this.engineParams);
    match.result = result;

    for (const sheet of [home, away]) {
      this.report.injuries += applyMatchFitnessCost(this.world, sheet, match.date, {
        internationalDuty: true,
        matchId: match.id,
      });
      recordCaps(this.world, sheet);
    }

    if (match.stage === "GROUP") {
      const table = this.groupTables.get(match.group!)!;
      const homeRow = table.find((r) => r.id === match.homeId)!;
      const awayRow = table.find((r) => r.id === match.awayId)!;
      homeRow.gf += result.homeGoals;
      homeRow.ga += result.awayGoals;
      awayRow.gf += result.awayGoals;
      awayRow.ga += result.homeGoals;
      if (result.homeGoals > result.awayGoals) homeRow.points += 3;
      else if (result.homeGoals < result.awayGoals) awayRow.points += 3;
      else {
        homeRow.points++;
        awayRow.points++;
      }
    } else {
      if (result.homeGoals === result.awayGoals) {
        const strengthOf = (id: string): number => this.entrants.find((e) => e.id === id)?.strength ?? 65;
        const lean = 0.5 + (strengthOf(match.homeId) - strengthOf(match.awayId)) * 0.003;
        const pkRng = deriveRng(this.world.seed, `${this.kind}pk:${match.id}`);
        match.koWinnerId = pkRng.chance(Math.max(0.2, Math.min(0.8, lean))) ? match.homeId : match.awayId;
      } else {
        match.koWinnerId = result.homeGoals > result.awayGoals ? match.homeId : match.awayId;
      }
      this.koQueue.push(match.koWinnerId);
    }
  }

  private scheduleKnockoutRound(stage: "R16" | "QF" | "SF" | "FINAL", entrantIds: string[], date: SimDate): void {
    const rng = deriveRng(this.world.seed, `${this.kind}:${this.startYear}:${stage}`);
    const order = [...entrantIds];
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (let i = 0; i < order.length; i += 2) {
      this.addMatch({
        id: `${this.config.id}-${this.startYear}-${stage}-${i / 2 + 1}`,
        date,
        stage,
        homeId: order[i]!,
        awayId: order[i + 1]!,
      });
    }
  }

  /** Daily tick hook: play today's matches, advance stages when complete. */
  processDay(date: SimDate): void {
    const todays = this.byDate.get(toIso(date));
    if (todays) for (const match of todays) this.playMatch(match);

    const iso = toIso(date);

    if (iso === toIso(this.groupEndTrigger)) {
      const qualified: string[] = [];
      for (let g = 0; g < this.config.groupCount; g++) {
        const table = [...this.groupTables.get(g)!].sort(
          (a, b) => b.points - a.points || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || compareIds(a.id, b.id),
        );
        qualified.push(table[0]!.id, table[1]!.id);
      }
      this.scheduleKnockoutRound("R16", qualified, this.r16Date);
      this.koQueue = [];
    }
    if (iso === toIso(addDays(this.r16Date, 1)) && this.koQueue.length === this.config.groupCount) {
      this.scheduleKnockoutRound("QF", [...this.koQueue], this.qfDate);
      this.koQueue = [];
    }
    if (iso === toIso(addDays(this.qfDate, 1)) && this.koQueue.length === this.config.groupCount / 2) {
      this.scheduleKnockoutRound("SF", [...this.koQueue], this.sfDate);
      this.koQueue = [];
    }
    if (iso === toIso(addDays(this.sfDate, 1)) && this.koQueue.length === this.config.groupCount / 4) {
      const finalists = [...this.koQueue] as [string, string];
      this.report.finalists = finalists;
      this.scheduleKnockoutRound("FINAL", finalists, this.finalDate);
      this.koQueue = [];
    }
    if (iso === toIso(this.finalDate) && this.koQueue.length === 1) {
      this.report.winnerId = this.koQueue[0]!;
    }
  }
}
