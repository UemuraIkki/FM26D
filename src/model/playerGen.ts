import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Rng } from "../core/rng.js";
import { deriveRng } from "../core/rng.js";
import { mapCountryNameToCode } from "./nationality.js";
import type { RosterPlayer } from "./roster.js";
import type { Club, Player, PlayerAttributes, Position } from "./types.js";

/**
 * Procedural squad generation (Phase A/B), now real-name-aware (requirement
 * 8): attribute generation stays fully synthetic — no legitimate public
 * source of FM-style 17-attribute ratings exists to import — but a club's
 * name/position/age/nationality are drawn from a real roster
 * (src/model/roster.ts) when one is supplied, falling back to procedural
 * identity generation position-by-position for any shortfall.
 *
 * Generation parameters (squad plan, name syllables, positional profiles,
 * spreads) are data-driven from data/playergen.json per the 非機能/データ
 * requirement.
 */

export interface PlayerGenConfig {
  squadPlan: Array<{ position: Position; count: number }>;
  firstSyllables: string[];
  lastSyllables: string[];
  profiles: Record<Position, Partial<Record<keyof PlayerAttributes, number>>>;
  baseOffsetFromClubStrength: number;
  playerSpreadStdDev: number;
  attributeNoiseStdDev: number;
  outfieldGkAttrRange: [number, number];
  ageRange: [number, number];
}

let cachedConfig: PlayerGenConfig | null = null;

export function loadPlayerGenConfig(path = "data/playergen.json"): PlayerGenConfig {
  const config = JSON.parse(readFileSync(resolve(path), "utf8")) as PlayerGenConfig;
  if (!Array.isArray(config.squadPlan) || config.squadPlan.length === 0) {
    throw new Error(`invalid playergen config: ${path}`);
  }
  return config;
}

function getConfig(): PlayerGenConfig {
  if (!cachedConfig) cachedConfig = loadPlayerGenConfig();
  return cachedConfig;
}

function makeName(rng: Rng, config: PlayerGenConfig): string {
  const first = rng.pick(config.firstSyllables) + rng.pick(config.lastSyllables);
  const last = rng.pick(config.firstSyllables) + rng.pick(config.lastSyllables) + rng.pick(config.lastSyllables);
  return `${first} ${last}`;
}

function clampAttr(v: number): number {
  return Math.max(1, Math.min(99, Math.round(v)));
}

const ATTR_KEYS: ReadonlyArray<keyof PlayerAttributes> = [
  "passing", "shooting", "dribbling", "defending", "aerial",
  "speed", "stamina", "strength", "agility",
  "decisions", "positioning", "finishing", "ambition", "professionalism",
  "shotStopping", "aerialHandling", "distribution",
];

function generateAttributes(rng: Rng, config: PlayerGenConfig, base: number, position: Position): PlayerAttributes {
  const profile = config.profiles[position] ?? {};
  const attrs = {} as PlayerAttributes;
  for (const key of ATTR_KEYS) {
    // GK-specific attributes are near-floor for outfield players.
    const isGkAttr = key === "shotStopping" || key === "aerialHandling" || key === "distribution";
    const floorForOutfield = position !== "GK" && isGkAttr;
    const bias = profile[key] ?? 0;
    const value = floorForOutfield
      ? rng.int(config.outfieldGkAttrRange[0], config.outfieldGkAttrRange[1])
      : base + bias + rng.gaussian(0, config.attributeNoiseStdDev);
    attrs[key] = clampAttr(value);
  }
  return attrs;
}

export function generateSquad(worldSeed: number, club: Club, roster?: readonly RosterPlayer[]): Player[] {
  const config = getConfig();
  const rng = deriveRng(worldSeed, `squad:${club.id}`);
  const players: Player[] = [];
  let serial = 0;

  // Real players available per position, consumed as each slot is filled.
  const realByPosition = new Map<Position, RosterPlayer[]>();
  if (roster) {
    for (const p of roster) {
      const list = realByPosition.get(p.position) ?? [];
      list.push(p);
      realByPosition.set(p.position, list);
    }
  }

  for (const { position, count } of config.squadPlan) {
    const realPool = realByPosition.get(position);
    for (let i = 0; i < count; i++) {
      serial++;
      // Base level: club strength with per-player spread; a few points below
      // strength on average so `strength` reads as "first XI quality".
      const base = club.strength + config.baseOffsetFromClubStrength + rng.gaussian(0, config.playerSpreadStdDev);
      const real = realPool?.shift();
      players.push({
        id: `${club.id}-${String(serial).padStart(2, "0")}`,
        name: real?.name ?? makeName(rng, config),
        clubId: club.id,
        position,
        age: real?.age ?? rng.int(config.ageRange[0], config.ageRange[1]),
        attributes: generateAttributes(rng, config, base, position),
        contract: null, // assigned by buildWorld
        nationality: real ? mapCountryNameToCode(real.nationality) : "", // "" assigned by buildWorld
        potential: 0, // assigned by buildWorld
      });
    }
  }
  return players;
}
