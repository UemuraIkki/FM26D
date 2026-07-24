import type { MatchEvent, TeamSheet } from "./types.js";

/**
 * Post-match player ratings derived purely from the event log (requirement
 * 3.3) — including the win/loss adjustment, whose scoreline is recomputed
 * from GOAL events rather than read from any external result field.
 * Scale: 4.0 - 10.0, base 6.5.
 */

const BASE = 6.5;
const MIN = 4.0;
const MAX = 10.0;

export function computeRatings(events: readonly MatchEvent[], home: TeamSheet, away: TeamSheet): Record<string, number> {
  const delta = new Map<string, number>();
  const bump = (id: string | undefined, amount: number): void => {
    if (!id) return;
    delta.set(id, (delta.get(id) ?? 0) + amount);
  };

  let homeGoals = 0;
  let awayGoals = 0;
  for (const e of events) {
    if (e.type === "GOAL") {
      if (e.teamId === home.teamId) homeGoals++;
      else if (e.teamId === away.teamId) awayGoals++;
    }
  }

  for (const e of events) {
    switch (e.type) {
      case "PASS":
      case "LONG_BALL":
        bump(e.playerId, e.success ? 0.015 : -0.05);
        break;
      case "DRIBBLE":
        if (e.success) {
          bump(e.playerId, 0.06);
          bump(e.opponentId, -0.04);
        } else {
          bump(e.playerId, -0.04);
        }
        break;
      case "TACKLE":
        bump(e.playerId, 0.08);
        break;
      case "INTERCEPTION":
        bump(e.playerId, 0.05);
        break;
      case "SHOT":
        bump(e.playerId, -0.03);
        break;
      case "GOAL":
        bump(e.playerId, 1.0);
        bump(e.assistId, 0.5);
        bump(e.opponentId, -0.15); // keeper beaten
        break;
      case "SAVE":
        bump(e.playerId, 0.2);
        break;
      default:
        break;
    }
  }

  // Team-level result adjustment: winners +0.2, losers -0.2.
  const diff = homeGoals - awayGoals;
  const teamAdj = (teamSheet: TeamSheet, sign: number): void => {
    for (const p of teamSheet.players) bump(p.id, 0.2 * sign);
  };
  if (diff > 0) {
    teamAdj(home, 1);
    teamAdj(away, -1);
  } else if (diff < 0) {
    teamAdj(home, -1);
    teamAdj(away, 1);
  }

  const ratings: Record<string, number> = {};
  for (const p of [...home.players, ...away.players]) {
    const raw = BASE + (delta.get(p.id) ?? 0);
    ratings[p.id] = Math.round(Math.min(MAX, Math.max(MIN, raw)) * 10) / 10;
  }
  return ratings;
}
