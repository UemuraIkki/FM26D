import type { Rng } from "../core/rng.js";
import type { Player } from "../model/types.js";
import { getRoleBook, isEligible, roleScore } from "../model/roles.js";

/**
 * Market value (requirement 4.2):
 *   value = base(ability) × ageCurve(age) × contractFactor(残年数) × leagueCoef
 * Currency unit: 1 = £1M equivalent.
 */

/** Best role score across eligible roles = the player's headline ability. */
export function playerAbility(player: Player): number {
  const book = getRoleBook();
  let best = 0;
  for (const role of book.roles) {
    if (!isEligible(player, role)) continue;
    const score = roleScore(player, role);
    if (score > best) best = score;
  }
  return best;
}

/** Exponential in ability: 50 → ~1.1M, 75 → ~9M, 85 → ~29M, 95 → ~92M. */
export function baseValue(ability: number): number {
  return 1.1 * Math.exp((ability - 50) / 8.6);
}

/** Peak 26-28, youth potential premium, decline after 31 (requirement 4.3 curve). */
export function ageCurve(age: number): number {
  if (age <= 20) return 0.9;
  if (age <= 23) return 1.0;
  if (age <= 28) return 1.05;
  if (age <= 30) return 0.85;
  if (age <= 32) return 0.55;
  if (age <= 34) return 0.3;
  return 0.15;
}

/** Requirement 4.6: one year left slashes the fee (Bosman leverage). */
export function contractFactor(yearsLeft: number): number {
  if (yearsLeft <= 0) return 0; // free agent
  if (yearsLeft === 1) return 0.55;
  if (yearsLeft === 2) return 0.85;
  return 1.0;
}

export function marketValue(player: Player, currentYear: number, leagueCoef = 1.0): number {
  const ability = playerAbility(player);
  const yearsLeft = player.contract ? Math.max(0, player.contract.endYear - currentYear) : 0;
  const value = baseValue(ability) * ageCurve(player.age) * contractFactor(yearsLeft) * leagueCoef;
  return Math.round(value * 100) / 100;
}

/** Annual wage demand by ability (1 = £1M/yr). 75 → ~3.1M, 85 → ~7.3M, 95 → ~17M. */
export function wageFor(ability: number): number {
  const wage = 1.3 * Math.exp((ability - 60) / 13.5);
  return Math.round(Math.max(0.3, wage) * 100) / 100;
}

/**
 * Ceiling ability (requirement 4.3) a young player can grow toward — more
 * headroom the younger they are, none once they're through the growth
 * window (used by src/model/development.ts's season-end attribute growth).
 */
export function growthPotential(currentAbility: number, age: number, rng: Rng): number {
  const room = age <= 20 ? rng.int(8, 20) : age <= 23 ? rng.int(4, 12) : age <= 26 ? rng.int(0, 6) : 0;
  return Math.min(99, currentAbility + room);
}
