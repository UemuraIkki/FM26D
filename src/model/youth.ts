import { deriveRng, type Rng } from "../core/rng.js";
import { growthPotential, playerAbility, wageFor } from "../finance/value.js";
import { contractYearsFor } from "../transfer/market.js";
import { initialFitness } from "./fitness.js";
import { pickNationality } from "./nationality.js";
import { minHeadcountByPosition, type RoleBook } from "./roles.js";
import type { Player, PlayerAttributes, Position } from "./types.js";
import type { World } from "./world.js";

/**
 * Youth academy intake (requirement 4.3 rookie supply): every season-end
 * each club signs 1-3 fresh 16-18 year-olds straight onto its own roster
 * (distinct from src/model/shadow.ts's shadow-world free-agent inflow —
 * these join their academy club under contract from day one, with plenty
 * of growthPotential headroom for src/model/development.ts to grow them).
 */

const POSITIONS: ReadonlyArray<{ position: Position; weight: number }> = [
  { position: "GK", weight: 1 },
  { position: "DF", weight: 3 },
  { position: "MF", weight: 3 },
  { position: "FW", weight: 2 },
];

const ATTR_KEYS: ReadonlyArray<keyof PlayerAttributes> = [
  "passing", "shooting", "dribbling", "defending", "aerial",
  "speed", "stamina", "strength", "agility",
  "decisions", "positioning", "finishing", "ambition", "professionalism",
  "shotStopping", "aerialHandling", "distribution",
];

function createProspect(
  world: World,
  rng: Rng,
  clubId: string,
  position: Position,
  seasonLabel: string,
  seasonEndYear: number,
  serial: number,
): Player {
  const club = world.clubsById.get(clubId)!;
  const squad = world.playersByClub.get(clubId)!;

  // Below first-team level on arrival — headroom is the point.
  const base = club.strength - 18 + rng.gaussian(0, 6);
  const attributes = {} as PlayerAttributes;
  for (const key of ATTR_KEYS) {
    const isGkAttr = key === "shotStopping" || key === "aerialHandling" || key === "distribution";
    if (position !== "GK" && isGkAttr) {
      attributes[key] = rng.int(5, 20);
    } else {
      attributes[key] = Math.max(1, Math.min(99, Math.round(base + rng.gaussian(0, 6))));
    }
  }
  const age = 16 + rng.int(0, 2);
  const player: Player = {
    id: `${clubId}-Y${seasonLabel}-${String(serial).padStart(2, "0")}`,
    name: `Academy Prospect ${clubId}-${seasonLabel}-${serial}`,
    clubId,
    position,
    age,
    attributes,
    contract: null,
    nationality: pickNationality(rng),
    potential: 0,
  };
  const ability = playerAbility(player);
  player.potential = growthPotential(ability, age, rng);
  player.contract = {
    annualWage: wageFor(ability),
    endYear: seasonEndYear + contractYearsFor(age),
  };

  world.players.push(player);
  squad.push(player);
  world.moraleByPlayer.set(player.id, { morale: 60, satisfaction: 55, trust: 55, benchStreak: 0 });
  world.fitnessByPlayer.set(player.id, initialFitness());
  world.capsByPlayer.set(player.id, 0);
  return player;
}

/** Ordinary random academy intake: 1-3 prospects, positions weighted like the first-team profile. */
export function generateYouthIntake(
  world: World,
  clubId: string,
  seasonLabel: string,
  seasonEndYear: number,
): Player[] {
  if (!world.clubsById.has(clubId) || !world.playersByClub.has(clubId)) {
    throw new Error(`unknown club: ${clubId}`);
  }
  const rng = deriveRng(world.seed, `youth:${seasonLabel}:${clubId}`);
  const count = rng.int(1, 3);
  const arrivals: Player[] = [];
  for (let i = 0; i < count; i++) {
    const roll = rng.next() * 9;
    let position: Position = "FW";
    let acc = 0;
    for (const { position: pos, weight } of POSITIONS) {
      acc += weight;
      if (roll < acc) {
        position = pos;
        break;
      }
    }
    arrivals.push(createProspect(world, rng, clubId, position, seasonLabel, seasonEndYear, i + 1));
  }
  return arrivals;
}

/**
 * Emergency top-up: retirement is age-driven and can't be refused the way a
 * transfer sale can (src/decision/aiDecisionMaker.ts's respondToOffer), so a
 * position can fall short of what the formation needs even after the
 * ordinary intake above. Guarantee at least enough players per position to
 * fill every formation slot so `selectStartingXI` never starves for a role.
 */
export function ensurePositionCoverage(
  world: World,
  clubId: string,
  seasonLabel: string,
  seasonEndYear: number,
  roleBook: RoleBook,
): Player[] {
  const squad = world.playersByClub.get(clubId);
  if (!squad) throw new Error(`unknown club: ${clubId}`);
  const rng = deriveRng(world.seed, `youth-cover:${seasonLabel}:${clubId}`);
  const need = minHeadcountByPosition(roleBook);
  const filled: Player[] = [];
  let serial = 1000;
  for (const { position } of POSITIONS) {
    const have = squad.filter((p) => p.position === position).length;
    for (let i = have; i < need[position]; i++) {
      filled.push(createProspect(world, rng, clubId, position, seasonLabel, seasonEndYear, serial++));
    }
  }
  return filled;
}
