import type { PlayedMatch } from "../sim/season.js";

/** Aggregate calibration metrics (requirement 3.4). */
export interface CalibrationStats {
  matches: number;
  goalsPerMatch: number;
  passSuccessRate: number;
  shotsPerTeamPerMatch: number;
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  /** Home advantage as (homeWinRate - awayWinRate). */
  homeAdvantage: number;
}

/**
 * Streaming accumulator so multi-thousand-season runs never retain match
 * objects (each carries a full event log) in memory.
 */
export class CalibrationAccumulator {
  private goals = 0;
  private passesAttempted = 0;
  private passesCompleted = 0;
  private shots = 0;
  private homeWins = 0;
  private draws = 0;
  private awayWins = 0;
  private count = 0;

  add(match: PlayedMatch): void {
    const { result } = match;
    this.count++;
    this.goals += result.homeGoals + result.awayGoals;
    this.passesAttempted += result.home.passesAttempted + result.away.passesAttempted;
    this.passesCompleted += result.home.passesCompleted + result.away.passesCompleted;
    this.shots += result.home.shots + result.away.shots;
    if (result.homeGoals > result.awayGoals) this.homeWins++;
    else if (result.homeGoals < result.awayGoals) this.awayWins++;
    else this.draws++;
  }

  stats(): CalibrationStats {
    const n = Math.max(this.count, 1);
    return {
      matches: this.count,
      goalsPerMatch: this.goals / n,
      passSuccessRate: this.passesAttempted > 0 ? this.passesCompleted / this.passesAttempted : 0,
      shotsPerTeamPerMatch: this.shots / (2 * n),
      homeWinRate: this.homeWins / n,
      drawRate: this.draws / n,
      awayWinRate: this.awayWins / n,
      homeAdvantage: (this.homeWins - this.awayWins) / n,
    };
  }
}

export function computeCalibration(matches: readonly PlayedMatch[]): CalibrationStats {
  const acc = new CalibrationAccumulator();
  for (const match of matches) acc.add(match);
  return acc.stats();
}

export const CALIBRATION_TARGETS = {
  goalsPerMatch: { min: 2.6, max: 2.8 },
  passSuccessRate: { min: 0.78, max: 0.85 },
  shotsPerTeamPerMatch: { min: 11, max: 14 },
  homeAdvantage: { min: 0.08, max: 0.1 },
} as const;
