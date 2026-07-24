import { addDays, compareDates, type SimDate } from "../core/calendar.js";
import { deriveRng } from "../core/rng.js";
import type { TeamSheet } from "../engine/index.js";
import type { World } from "./world.js";
import type { Player } from "./types.js";

/**
 * Fitness / injury (requirement 4.4). Mirrors the morale system's shape
 * (src/morale/morale.ts): a per-player state map on `World`, daily mean
 * reversion, event-driven cost after matches, and a bounded ±% multiplier
 * fed into the match engine. Fitness only ever hurts ability (it caps at
 * 100, so there is no "above baseline" bonus the way morale has).
 *
 * International duty (2.2) adds extra fitness cost and injury risk on top
 * of a normal match, per requirement 4.4's "代表戦参加は疲労・怪我リスクを
 * 上乗せする".
 */

export interface PlayerFitness {
  value: number; // 0-100
  injuryReturnDate: SimDate | null;
}

const BASE_FITNESS = 100;
const REVERT_FITNESS = 0.08;

const MATCH_FITNESS_COST = 9;
const INTERNATIONAL_EXTRA_COST = 5;

const BASE_INJURY_RISK = 0.01;
const LOW_FITNESS_INJURY_RISK = 0.02; // additional risk at 0 fitness, scaled linearly
const INTERNATIONAL_INJURY_RISK_BONUS = 0.012;
const INJURY_DURATION_MIN_DAYS = 3;
const INJURY_DURATION_MAX_DAYS = 30;

export const MAX_FITNESS_EFFECT = 0.05;

function clamp01to100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

export function initialFitness(): PlayerFitness {
  return { value: BASE_FITNESS, injuryReturnDate: null };
}

/** Daily mean reversion toward full fitness; clears expired injuries. */
export function fitnessDailyTick(world: World, date: SimDate): void {
  for (const state of world.fitnessByPlayer.values()) {
    state.value = clamp01to100(state.value + (BASE_FITNESS - state.value) * REVERT_FITNESS);
    if (state.injuryReturnDate && compareDates(date, state.injuryReturnDate) >= 0) {
      state.injuryReturnDate = null;
    }
  }
}

/**
 * Post-match fitness cost + injury roll for every starter in `sheet`.
 * Synthetic/abstract players (no tracked fitness state, e.g. CL/national
 * abstract squads) are silently skipped.
 */
export function applyMatchFitnessCost(
  world: World,
  sheet: TeamSheet,
  date: SimDate,
  opts: { internationalDuty?: boolean; matchId?: string } = {},
): number {
  const cost = MATCH_FITNESS_COST + (opts.internationalDuty ? INTERNATIONAL_EXTRA_COST : 0);
  let newInjuries = 0;
  for (const player of sheet.players) {
    const state = world.fitnessByPlayer.get(player.id);
    if (!state) continue;
    const fitnessBefore = state.value;
    state.value = clamp01to100(state.value - cost);

    const rng = deriveRng(world.seed, `injury:${opts.matchId ?? date.year + "-" + date.month + "-" + date.day}:${player.id}`);
    const lowFitnessPenalty = LOW_FITNESS_INJURY_RISK * ((100 - fitnessBefore) / 100);
    const risk =
      BASE_INJURY_RISK + lowFitnessPenalty + (opts.internationalDuty ? INTERNATIONAL_INJURY_RISK_BONUS : 0);
    if (rng.chance(risk)) {
      const duration = rng.int(INJURY_DURATION_MIN_DAYS, INJURY_DURATION_MAX_DAYS);
      state.injuryReturnDate = addDays(date, duration);
      newInjuries++;
    }
  }
  return newInjuries;
}

/** Match-day ability multiplier, hard-capped at -5% (requirement 4.4/4.7 parity). */
export function fitnessMultiplier(world: World, playerId: string): number {
  const state = world.fitnessByPlayer.get(playerId);
  if (!state) return 1;
  const effect = -((100 - state.value) / 100) * MAX_FITNESS_EFFECT;
  return 1 + Math.max(-MAX_FITNESS_EFFECT, effect);
}

/** Scale a team sheet's attributes by each player's fitness multiplier. */
export function applyFitnessToSheet(world: World, sheet: TeamSheet): TeamSheet {
  return {
    teamId: sheet.teamId,
    players: sheet.players.map((p) => {
      const m = fitnessMultiplier(world, p.id);
      if (m === 1) return p;
      return {
        ...p,
        passing: p.passing * m,
        shooting: p.shooting * m,
        dribbling: p.dribbling * m,
        defending: p.defending * m,
        aerial: p.aerial * m,
        speed: p.speed * m,
        stamina: p.stamina * m,
        strength: p.strength * m,
        agility: p.agility * m,
        decisions: p.decisions * m,
        positioning: p.positioning * m,
        finishing: p.finishing * m,
        shotStopping: p.shotStopping * m,
        aerialHandling: p.aerialHandling * m,
        distribution: p.distribution * m,
      };
    }),
  };
}

export function isAvailable(world: World, playerId: string, date: SimDate): boolean {
  const state = world.fitnessByPlayer.get(playerId);
  if (!state || !state.injuryReturnDate) return true;
  return compareDates(date, state.injuryReturnDate) >= 0;
}

/** Squad filtered to players fit for selection today (requirement 4.4). */
export function availableSquad(world: World, clubId: string, date: SimDate): Player[] {
  const squad = world.playersByClub.get(clubId);
  if (!squad) throw new Error(`unknown club: ${clubId}`);
  return squad.filter((p) => isAvailable(world, p.id, date));
}
