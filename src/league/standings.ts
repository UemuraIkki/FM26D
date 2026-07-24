import { compareIds } from "../core/rng.js";

export interface StandingRow {
  clubId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export class StandingsTable {
  private rows = new Map<string, StandingRow>();

  constructor(clubIds: readonly string[]) {
    for (const id of clubIds) {
      this.rows.set(id, {
        clubId: id,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
      });
    }
  }

  record(homeClubId: string, awayClubId: string, homeGoals: number, awayGoals: number): void {
    const home = this.rows.get(homeClubId);
    const away = this.rows.get(awayClubId);
    if (!home || !away) throw new Error(`unknown club in result: ${homeClubId} vs ${awayClubId}`);
    home.played++;
    away.played++;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;
    if (homeGoals > awayGoals) {
      home.won++;
      home.points += 3;
      away.lost++;
    } else if (homeGoals < awayGoals) {
      away.won++;
      away.points += 3;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
    }
    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;
  }

  /** PL tiebreakers: points, goal difference, goals for, then club id for stability. */
  sorted(): StandingRow[] {
    return [...this.rows.values()].sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        compareIds(a.clubId, b.clubId),
    );
  }
}
