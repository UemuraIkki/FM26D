import { addDays, nextWeekday, toIso, type SimDate } from "../core/calendar.js";
import { deriveRng } from "../core/rng.js";
import { simulateMatch, type EngineParams } from "../engine/index.js";
import { applyFitnessToSheet, applyMatchFitnessCost } from "../model/fitness.js";
import { callUpSquad, recordCaps } from "../model/nationalTeam.js";
import { nationIds } from "../model/nationality.js";
import type { RoleBook } from "../model/roles.js";
import { selectStartingXI } from "../sim/lineup.js";
import type { World } from "../model/world.js";

/**
 * In-season international match weeks (requirement 2.2): September,
 * October, November, and March, two friendly dates each. Dates land on
 * Wednesday + the following Sunday, which never collide with the league's
 * Saturday fixtures or the Champions League's Tuesday group nights — the
 * same "keep competitions apart by date, not by runtime arbitration" trick
 * src/competitions/championsLeague.ts already relies on. No qualifying
 * groups are modeled: nations are paired off deterministically at random
 * each date. No ledger money moves (friendlies aren't a club-financial
 * event); sheets get fitness scaling only, never club morale (morale's
 * atmosphere lookup is keyed by clubId and would throw for a nation id).
 */
export class InternationalWindows {
  private byDate = new Map<string, Array<{ home: string; away: string }>>();
  private matchCount = 0;
  private injuryCount = 0;

  constructor(
    private readonly world: World,
    private readonly roleBook: RoleBook,
    startYear: number,
    private readonly engineParams: Partial<EngineParams> | undefined,
  ) {
    this.scheduleWindows(startYear);
  }

  private scheduleWindows(startYear: number): void {
    const nations = nationIds();
    const windowAnchors: SimDate[] = [
      { year: startYear, month: 9, day: 1 },
      { year: startYear, month: 10, day: 1 },
      { year: startYear, month: 11, day: 1 },
      { year: startYear + 1, month: 3, day: 1 },
    ];
    for (const anchor of windowAnchors) {
      const wednesday = nextWeekday(anchor, 3);
      const sunday = addDays(wednesday, 4);
      for (const date of [wednesday, sunday]) {
        const rng = deriveRng(this.world.seed, `intlwindow:${toIso(date)}`);
        const order = [...nations];
        for (let i = order.length - 1; i > 0; i--) {
          const j = rng.int(0, i);
          [order[i], order[j]] = [order[j]!, order[i]!];
        }
        const pairs: Array<{ home: string; away: string }> = [];
        for (let i = 0; i + 1 < order.length; i += 2) {
          pairs.push({ home: order[i]!, away: order[i + 1]! });
        }
        this.byDate.set(toIso(date), pairs);
      }
    }
  }

  private sheetFor(nationId: string, date: SimDate) {
    const squad = callUpSquad(this.world, nationId, date);
    const sheet = selectStartingXI(nationId, squad, this.roleBook);
    return applyFitnessToSheet(this.world, sheet);
  }

  processDay(date: SimDate): void {
    const pairs = this.byDate.get(toIso(date));
    if (!pairs) return;
    for (const { home, away } of pairs) {
      const matchId = `INTLW-${toIso(date)}-${home}-${away}`;
      const rng = deriveRng(this.world.seed, `match:${matchId}`);
      const homeSheet = this.sheetFor(home, date);
      const awaySheet = this.sheetFor(away, date);
      simulateMatch(homeSheet, awaySheet, rng, this.engineParams);
      this.matchCount++;
      for (const sheet of [homeSheet, awaySheet]) {
        this.injuryCount += applyMatchFitnessCost(this.world, sheet, date, {
          internationalDuty: true,
          matchId,
        });
        recordCaps(this.world, sheet);
      }
    }
  }

  get summary(): { matches: number; injuries: number } {
    return { matches: this.matchCount, injuries: this.injuryCount };
  }
}
