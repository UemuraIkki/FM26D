import type { TeamSheet } from "../engine/index.js";
import type { World } from "../model/world.js";

/**
 * Morale system (requirement 4.7).
 *
 * Per-player state: morale / playing-time satisfaction / manager trust
 * (consumed by the Phase F board model). Per-club state: team atmosphere.
 * All values live on [0, 100], revert to their baselines daily, and move on
 * events (results, repeated benching, transfers, renewals).
 *
 * Match influence is hard-capped at ±5% (requirement 4.7: divergence guard —
 * good form can only compound so far).
 */

export interface PlayerMorale {
  morale: number;
  satisfaction: number;
  trust: number;
  /** Consecutive matches out of the XI. */
  benchStreak: number;
}

const BASE_MORALE = 60;
const BASE_SATISFACTION = 55;
const BASE_TRUST = 55;
const BASE_ATMOSPHERE = 55;

const REVERT_MORALE = 0.015;
const REVERT_SATISFACTION = 0.01;
const REVERT_TRUST = 0.01;
const REVERT_ATMOSPHERE = 0.02;

export const MAX_MORALE_EFFECT = 0.05;

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

export function moraleOf(world: World, playerId: string): PlayerMorale {
  const state = world.moraleByPlayer.get(playerId);
  if (!state) throw new Error(`no morale state for player: ${playerId}`);
  return state;
}

export function atmosphereOf(world: World, clubId: string): number {
  const value = world.atmosphereByClub.get(clubId);
  if (value === undefined) throw new Error(`no atmosphere for club: ${clubId}`);
  return value;
}

/** Daily mean reversion for every player and club (requirement 4.7). */
export function moraleDailyTick(world: World): void {
  for (const state of world.moraleByPlayer.values()) {
    state.morale = clamp(state.morale + (BASE_MORALE - state.morale) * REVERT_MORALE);
    state.satisfaction = clamp(state.satisfaction + (BASE_SATISFACTION - state.satisfaction) * REVERT_SATISFACTION);
    state.trust = clamp(state.trust + (BASE_TRUST - state.trust) * REVERT_TRUST);
  }
  for (const [clubId, value] of world.atmosphereByClub) {
    world.atmosphereByClub.set(clubId, clamp(value + (BASE_ATMOSPHERE - value) * REVERT_ATMOSPHERE));
  }
}

/** Result + selection events for one club after a match. */
export function applyMatchMorale(
  world: World,
  clubId: string,
  sheet: TeamSheet,
  outcome: "WIN" | "DRAW" | "LOSS",
): void {
  const started = new Set(sheet.players.map((p) => p.id));
  const squad = world.playersByClub.get(clubId) ?? [];
  for (const player of squad) {
    const state = world.moraleByPlayer.get(player.id);
    if (!state) continue;
    const inXI = started.has(player.id);
    if (outcome === "WIN") {
      state.morale = clamp(state.morale + (inXI ? 4 : 2));
      state.trust = clamp(state.trust + 2);
    } else if (outcome === "LOSS") {
      state.morale = clamp(state.morale - (inXI ? 4 : 2));
      state.trust = clamp(state.trust - 2.5);
    } else {
      state.trust = clamp(state.trust - 0.5);
    }
    // Requirement 4.7: repeated benching gnaws at playing-time satisfaction.
    if (inXI) {
      state.benchStreak = 0;
      state.satisfaction = clamp(state.satisfaction + 5);
    } else {
      state.benchStreak++;
      state.satisfaction = clamp(state.satisfaction - (3 + state.benchStreak * 0.5));
      if (state.satisfaction < 35) state.morale = clamp(state.morale - 1.5);
    }
  }
  const atmosphere = atmosphereOf(world, clubId);
  const delta = outcome === "WIN" ? 2.5 : outcome === "LOSS" ? -2.5 : 0;
  world.atmosphereByClub.set(clubId, clamp(atmosphere + delta));
}

/** A move is a fresh start for the player and a ripple for both squads. */
export function applyTransferMorale(world: World, playerId: string, fromClubId: string | null, toClubId: string): void {
  const state = world.moraleByPlayer.get(playerId);
  if (state) {
    state.morale = clamp(Math.max(state.morale, 70));
    state.satisfaction = 60;
    state.trust = 55;
    state.benchStreak = 0;
  }
  if (fromClubId !== null && world.atmosphereByClub.has(fromClubId)) {
    world.atmosphereByClub.set(fromClubId, clamp(atmosphereOf(world, fromClubId) - 2));
  }
  if (world.atmosphereByClub.has(toClubId)) {
    world.atmosphereByClub.set(toClubId, clamp(atmosphereOf(world, toClubId) + 1));
  }
}

/** A renewed contract is a vote of confidence. */
export function applyRenewalMorale(world: World, playerId: string): void {
  const state = world.moraleByPlayer.get(playerId);
  if (!state) return;
  state.morale = clamp(state.morale + 5);
  state.satisfaction = clamp(state.satisfaction + 3);
}

/**
 * Match-day ability multiplier, hard-capped at ±5% (requirement 4.7).
 * Composite: personal morale weighs most, then playing-time satisfaction,
 * then the dressing-room atmosphere.
 */
export function moraleMultiplier(world: World, clubId: string, playerId: string): number {
  const state = world.moraleByPlayer.get(playerId);
  if (!state) return 1;
  const composite = 0.5 * state.morale + 0.3 * state.satisfaction + 0.2 * atmosphereOf(world, clubId);
  const effect = ((composite - 57.5) / 42.5) * MAX_MORALE_EFFECT;
  return 1 + Math.max(-MAX_MORALE_EFFECT, Math.min(MAX_MORALE_EFFECT, effect));
}

/** Scale a team sheet's attributes by each player's morale multiplier. */
export function applyMoraleToSheet(world: World, sheet: TeamSheet): TeamSheet {
  return {
    teamId: sheet.teamId,
    players: sheet.players.map((p) => {
      const m = moraleMultiplier(world, sheet.teamId, p.id);
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
