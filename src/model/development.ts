import type { Rng } from "../core/rng.js";
import { deriveRng } from "../core/rng.js";
import { playerAbility } from "../finance/value.js";
import type { RoleBook } from "./roles.js";
import type { Player, PlayerAttributes } from "./types.js";
import { purgeExpiredArchives, retirePlayer } from "./world.js";
import type { World } from "./world.js";
import { ensurePositionCoverage, generateYouthIntake } from "./youth.js";

/**
 * Growth, aging and retirement (requirement 4.3): an age curve applied to
 * actual attributes (not just market value, unlike src/finance/value.ts's
 * ageCurve — that scales price only). Peak 26-28; below it, players close
 * part of the gap to their `potential` ceiling each season; above 31 they
 * decline, accelerating with age. Past 33 there's a rising, seeded chance
 * of retirement each season-end.
 */

const ATTR_KEYS: ReadonlyArray<keyof PlayerAttributes> = [
  "passing", "shooting", "dribbling", "defending", "aerial",
  "speed", "stamina", "strength", "agility",
  "decisions", "positioning", "finishing", "ambition", "professionalism",
  "shotStopping", "aerialHandling", "distribution",
];

const PEAK_START = 26;
const DECLINE_START = 31;
const RETIRE_START = 33;
const RETIRE_CERTAIN = 40;

function clampAttr(v: number): number {
  return Math.max(1, Math.min(99, Math.round(v)));
}

function growthRate(age: number): number {
  if (age <= 20) return 0.16;
  if (age <= 23) return 0.1;
  if (age <= 25) return 0.05;
  return 0;
}

function declineRate(age: number): number {
  if (age <= DECLINE_START) return 0;
  return 0.02 + (age - DECLINE_START) * 0.012;
}

/** One season of aging: attribute growth/decline, then birthday. */
export function developPlayer(player: Player, rng: Rng): void {
  const ability = playerAbility(player);
  let pct = 0;
  if (player.age < PEAK_START && ability < player.potential) pct = growthRate(player.age);
  else if (player.age > DECLINE_START) pct = -declineRate(player.age);

  if (pct !== 0) {
    for (const key of ATTR_KEYS) {
      player.attributes[key] = clampAttr(player.attributes[key] * (1 + pct) + rng.gaussian(0, 0.6));
    }
  }
  player.age += 1;
}

function retirementChance(age: number): number {
  if (age < RETIRE_START) return 0;
  if (age >= RETIRE_CERTAIN) return 1;
  return Math.min(1, (age - RETIRE_START + 1) * 0.15);
}

/**
 * Season-end development pass (requirement 4.3): age/grow/decline every
 * rostered player, retire the ones age catches up with, then let every
 * club take in its next academy intake (src/model/youth.ts) to keep the
 * player pool from running dry over many seasons.
 */
export interface RetiredPlayerSummary {
  id: string;
  name: string;
  notable: boolean;
}

export function processSeasonEndDevelopment(
  world: World,
  seasonLabel: string,
  seasonEndYear: number,
  clubIds: readonly string[],
  roleBook: RoleBook,
): { aged: number; retired: number; rookies: number; retiredPlayers: RetiredPlayerSummary[] } {
  const rng = deriveRng(world.seed, `develop:${seasonLabel}`);
  let retired = 0;
  let aged = 0;
  const retiredPlayers: RetiredPlayerSummary[] = [];
  for (const player of [...world.players]) {
    developPlayer(player, rng);
    aged++;
    if (rng.chance(retirementChance(player.age))) {
      const { id, name } = player;
      retirePlayer(world, id, seasonEndYear);
      retiredPlayers.push({ id, name, notable: world.retiredArchive.get(id)!.notable });
      retired++;
    }
  }

  let rookies = 0;
  for (const clubId of clubIds) {
    rookies += generateYouthIntake(world, clubId, seasonLabel, seasonEndYear).length;
    // Retirement can't be refused the way a transfer sale can (unlike
    // src/decision/aiDecisionMaker.ts's respondToOffer guard) — top up any
    // position the ordinary intake above still left completely empty.
    rookies += ensurePositionCoverage(world, clubId, seasonLabel, seasonEndYear, roleBook).length;
  }

  purgeExpiredArchives(world, seasonEndYear);

  return { aged, retired, rookies, retiredPlayers };
}
