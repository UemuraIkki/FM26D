import type { Rng } from "../core/rng.js";
import { deriveRng } from "../core/rng.js";
import type { Club, Player, PlayerAttributes, Position } from "./types.js";

/**
 * Placeholder procedural squad generation for Phase A.
 * Real-data import (requirement 8) replaces this later; the rest of the sim
 * only depends on the `Player` shape, not on how squads are produced.
 */

const SQUAD_PLAN: ReadonlyArray<{ position: Position; count: number }> = [
  { position: "GK", count: 3 },
  { position: "DF", count: 7 },
  { position: "MF", count: 7 },
  { position: "FW", count: 5 },
];

const FIRST_SYLLABLES = ["Al", "Ben", "Car", "Dan", "Ed", "Fer", "Gar", "Har", "Iv", "Jor", "Kai", "Lu", "Mar", "Nic", "Os", "Pa", "Ra", "Sam", "Tom", "Vic"];
const LAST_SYLLABLES = ["son", "ley", "ford", "ton", "well", "man", "field", "wood", "er", "is", "ez", "io", "ard", "ken", "by"];

function makeName(rng: Rng): string {
  const first = rng.pick(FIRST_SYLLABLES) + rng.pick(LAST_SYLLABLES);
  const last = rng.pick(FIRST_SYLLABLES) + rng.pick(LAST_SYLLABLES) + rng.pick(LAST_SYLLABLES);
  return `${first} ${last}`;
}

function clampAttr(v: number): number {
  return Math.max(1, Math.min(99, Math.round(v)));
}

/** Positional bias applied on top of the player's base level (in attribute points). */
const PROFILE: Record<Position, Partial<Record<keyof PlayerAttributes, number>>> = {
  GK: { shotStopping: 8, aerialHandling: 6, distribution: 2, passing: -12, shooting: -25, dribbling: -20, defending: -8, finishing: -20, speed: -10 },
  DF: { defending: 8, aerial: 6, strength: 5, positioning: 5, shooting: -12, finishing: -10, dribbling: -5 },
  MF: { passing: 7, decisions: 5, dribbling: 3, stamina: 4, shooting: -2, aerial: -4 },
  FW: { shooting: 8, finishing: 8, dribbling: 4, speed: 4, defending: -12, aerial: 0 },
};

const ATTR_KEYS: ReadonlyArray<keyof PlayerAttributes> = [
  "passing", "shooting", "dribbling", "defending", "aerial",
  "speed", "stamina", "strength", "agility",
  "decisions", "positioning", "finishing", "ambition", "professionalism",
  "shotStopping", "aerialHandling", "distribution",
];

function generateAttributes(rng: Rng, base: number, position: Position): PlayerAttributes {
  const profile = PROFILE[position];
  const attrs = {} as PlayerAttributes;
  for (const key of ATTR_KEYS) {
    // GK-specific attributes are near-floor for outfield players.
    const isGkAttr = key === "shotStopping" || key === "aerialHandling" || key === "distribution";
    const floorForOutfield = position !== "GK" && isGkAttr;
    const bias = profile[key] ?? 0;
    const value = floorForOutfield
      ? rng.int(5, 25)
      : base + bias + rng.gaussian(0, 6);
    attrs[key] = clampAttr(value);
  }
  return attrs;
}

export function generateSquad(worldSeed: number, club: Club): Player[] {
  const rng = deriveRng(worldSeed, `squad:${club.id}`);
  const players: Player[] = [];
  let serial = 0;
  for (const { position, count } of SQUAD_PLAN) {
    for (let i = 0; i < count; i++) {
      serial++;
      // Base level: club strength with per-player spread; a couple of points
      // below strength on average so `strength` reads as "first XI quality".
      const base = club.strength - 3 + rng.gaussian(0, 5);
      players.push({
        id: `${club.id}-${String(serial).padStart(2, "0")}`,
        name: makeName(rng),
        clubId: club.id,
        position,
        age: rng.int(18, 34),
        attributes: generateAttributes(rng, base, position),
      });
    }
  }
  return players;
}
