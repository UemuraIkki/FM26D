import { deriveRng } from "../core/rng.js";
import { growthPotential, playerAbility } from "../finance/value.js";
import { initialFitness } from "./fitness.js";
import { pickNationality } from "./nationality.js";
import type { World } from "./world.js";
import type { Player, PlayerAttributes, Position } from "./types.js";

/**
 * Shadow world (requirement 2.3): leagues outside the big five are not
 * simulated. They interact with the simulated world in two ways:
 *  - inflow: every summer a batch of prospects arrives on the market,
 *  - outflow: free agents nobody signed leave the market at season end
 *    (their careers continue "outside", we only keep aggregates).
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

/** Summer inflow: prospects from outside the simulated leagues. */
export function supplyShadowProspects(world: World, year: number, count = 40): Player[] {
  const rng = deriveRng(world.seed, `shadow:${year}`);
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
    // Mostly solid squad players, occasionally a gem.
    const base = 55 + rng.int(0, 20) + (rng.chance(0.08) ? rng.int(5, 12) : 0);
    const attributes = {} as PlayerAttributes;
    for (const key of ATTR_KEYS) {
      const isGkAttr = key === "shotStopping" || key === "aerialHandling" || key === "distribution";
      if (position !== "GK" && isGkAttr) {
        attributes[key] = rng.int(5, 25);
      } else {
        attributes[key] = Math.max(1, Math.min(99, Math.round(base + rng.gaussian(0, 7))));
      }
    }
    const age = 18 + rng.int(0, 10);
    const player: Player = {
      id: `SHW-${year}-${String(i + 1).padStart(2, "0")}`,
      name: `Shadow Prospect ${year}-${i + 1}`,
      clubId: null,
      position,
      age,
      attributes,
      contract: null,
      nationality: pickNationality(rng),
      potential: 0,
    };
    player.potential = growthPotential(playerAbility(player), age, rng);
    arrivals.push(player);
    world.players.push(player);
    world.freeAgents.push(player);
    world.moraleByPlayer.set(player.id, { morale: 65, satisfaction: 55, trust: 55, benchStreak: 0 });
    world.fitnessByPlayer.set(player.id, initialFitness());
    world.capsByPlayer.set(player.id, 0);
  }
  return arrivals;
}

/**
 * Season-end outflow: unsigned free agents leave for the shadow world.
 * They are removed from the market and the active player list; requirement
 * 6.4 data retention (keep aggregates for notable careers) arrives with the
 * history phase.
 */
export function exitUnsignedFreeAgents(world: World): number {
  const leaving = world.freeAgents.length;
  for (const player of world.freeAgents) {
    const idx = world.players.findIndex((p) => p.id === player.id);
    if (idx >= 0) world.players.splice(idx, 1);
    world.moraleByPlayer.delete(player.id);
    world.fitnessByPlayer.delete(player.id);
    world.capsByPlayer.delete(player.id);
  }
  world.freeAgents.length = 0;
  return leaving;
}
