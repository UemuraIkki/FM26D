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

export function computeCalibration(matches: readonly PlayedMatch[]): CalibrationStats {
  let goals = 0;
  let passesAttempted = 0;
  let passesCompleted = 0;
  let shots = 0;
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  for (const { result } of matches) {
    goals += result.homeGoals + result.awayGoals;
    passesAttempted += result.home.passesAttempted + result.away.passesAttempted;
    passesCompleted += result.home.passesCompleted + result.away.passesCompleted;
    shots += result.home.shots + result.away.shots;
    if (result.homeGoals > result.awayGoals) homeWins++;
    else if (result.homeGoals < result.awayGoals) awayWins++;
    else draws++;
  }

  const n = Math.max(matches.length, 1);
  return {
    matches: matches.length,
    goalsPerMatch: goals / n,
    passSuccessRate: passesAttempted > 0 ? passesCompleted / passesAttempted : 0,
    shotsPerTeamPerMatch: shots / (2 * n),
    homeWinRate: homeWins / n,
    drawRate: draws / n,
    awayWinRate: awayWins / n,
    homeAdvantage: (homeWins - awayWins) / n,
  };
}

export const CALIBRATION_TARGETS = {
  goalsPerMatch: { min: 2.6, max: 2.8 },
  passSuccessRate: { min: 0.78, max: 0.85 },
  shotsPerTeamPerMatch: { min: 11, max: 14 },
  homeAdvantage: { min: 0.08, max: 0.1 },
} as const;
