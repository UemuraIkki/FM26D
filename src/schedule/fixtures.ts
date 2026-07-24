import type { SimDate } from "../core/calendar.js";
import { addDays, nextWeekday, toIso } from "../core/calendar.js";
import { deriveRng } from "../core/rng.js";

export interface Fixture {
  id: string;
  round: number; // 1-based matchday
  date: SimDate;
  homeClubId: string;
  awayClubId: string;
}

/**
 * Double round-robin schedule via the circle (Berger) method.
 * Club order is shuffled deterministically from the seed, so different seeds
 * produce different calendars while staying reproducible (requirement 3.2).
 * Every round is played on a Saturday, one round per week, starting from the
 * first Saturday on/after `seasonStart`.
 */
export function generateSeasonFixtures(
  worldSeed: number,
  seasonLabel: string,
  clubIds: readonly string[],
  seasonStart: SimDate,
): Fixture[] {
  if (clubIds.length % 2 !== 0) throw new Error("club count must be even");
  const rng = deriveRng(worldSeed, `fixtures:${seasonLabel}`);
  const order = [...clubIds];
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j] as string, order[i] as string];
  }

  const n = order.length;
  const roundsPerHalf = n - 1;
  const half: Array<Array<{ home: string; away: string }>> = [];

  // Circle method: fix order[0], rotate the rest.
  const rotating = order.slice(1);
  for (let r = 0; r < roundsPerHalf; r++) {
    const pairs: Array<{ home: string; away: string }> = [];
    const arr = [order[0] as string, ...rotating];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i] as string;
      const b = arr[n - 1 - i] as string;
      const homeFirst = (r + i) % 2 === 0;
      pairs.push(homeFirst ? { home: a, away: b } : { home: b, away: a });
    }
    half.push(pairs);
    rotating.unshift(rotating.pop() as string);
  }

  const firstSaturday = nextWeekday(seasonStart, 6);
  const fixtures: Fixture[] = [];
  let fixtureSerial = 0;
  for (let r = 0; r < roundsPerHalf * 2; r++) {
    const date = addDays(firstSaturday, r * 7);
    const basePairs = half[r % roundsPerHalf] as Array<{ home: string; away: string }>;
    const secondHalf = r >= roundsPerHalf;
    for (const pair of basePairs) {
      const home = secondHalf ? pair.away : pair.home;
      const away = secondHalf ? pair.home : pair.away;
      fixtureSerial++;
      fixtures.push({
        id: `${seasonLabel}-${String(fixtureSerial).padStart(3, "0")}`,
        round: r + 1,
        date,
        homeClubId: home,
        awayClubId: away,
      });
    }
  }
  return fixtures;
}

/** Group fixtures by ISO date for the daily tick loop. */
export function fixturesByDate(fixtures: readonly Fixture[]): Map<string, Fixture[]> {
  const map = new Map<string, Fixture[]>();
  for (const f of fixtures) {
    const key = toIso(f.date);
    const list = map.get(key);
    if (list) list.push(f);
    else map.set(key, [f]);
  }
  return map;
}
