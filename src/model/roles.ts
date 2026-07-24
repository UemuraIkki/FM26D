import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Player, PlayerAttributes, Position } from "./types.js";

/**
 * Role aptitude scores (requirement 4.2):
 *   roleScore(player, role) = Σ wᵢ · attrᵢ / Σ wᵢ
 * Normalized by total weight so scores stay on the 1-99 attribute scale.
 * Role definitions and the default formation are data-driven (data/roles.json).
 */

export interface Role {
  id: string;
  name: string;
  positions: Position[];
  weights: Partial<Record<keyof PlayerAttributes, number>>;
}

export interface Formation {
  name: string;
  /** 11 role ids, GK first. */
  slots: string[];
}

export interface RoleBook {
  roles: Role[];
  rolesById: Map<string, Role>;
  defaultFormation: Formation;
}

const ATTR_KEYS = new Set<string>([
  "passing", "shooting", "dribbling", "defending", "aerial",
  "speed", "stamina", "strength", "agility",
  "decisions", "positioning", "finishing", "ambition", "professionalism",
  "shotStopping", "aerialHandling", "distribution",
]);

export function loadRoleBook(path = "data/roles.json"): RoleBook {
  const raw = JSON.parse(readFileSync(resolve(path), "utf8")) as {
    roles: Role[];
    defaultFormation: Formation;
  };
  if (!Array.isArray(raw.roles) || raw.roles.length === 0) throw new Error(`no roles in ${path}`);
  const VALID_POSITIONS = new Set<string>(["GK", "DF", "MF", "FW"]);
  const rolesById = new Map<string, Role>();
  for (const role of raw.roles) {
    if (rolesById.has(role.id)) throw new Error(`duplicate role id: ${role.id}`);
    if (!Array.isArray(role.positions) || role.positions.length === 0) {
      throw new Error(`role ${role.id}: positions must be a non-empty array`);
    }
    for (const pos of role.positions) {
      if (!VALID_POSITIONS.has(pos)) throw new Error(`role ${role.id}: invalid position "${pos}"`);
    }
    let totalWeight = 0;
    for (const [key, weight] of Object.entries(role.weights)) {
      if (!ATTR_KEYS.has(key)) throw new Error(`role ${role.id}: unknown attribute "${key}"`);
      if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
        throw new Error(`role ${role.id}: weight for "${key}" must be a positive finite number`);
      }
      totalWeight += weight;
    }
    if (totalWeight <= 0) throw new Error(`role ${role.id}: weights must sum to > 0`);
    rolesById.set(role.id, role);
  }
  const formation = raw.defaultFormation;
  if (formation.slots.length !== 11) throw new Error(`formation ${formation.name} must have 11 slots`);
  for (const slot of formation.slots) {
    if (!rolesById.has(slot)) throw new Error(`formation references unknown role: ${slot}`);
  }
  return { roles: raw.roles, rolesById, defaultFormation: formation };
}

let defaultBook: RoleBook | null = null;

export function getRoleBook(): RoleBook {
  if (!defaultBook) defaultBook = loadRoleBook();
  return defaultBook;
}

export function roleScore(player: Player, role: Role): number {
  let sum = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(role.weights)) {
    if (weight === undefined) continue;
    sum += player.attributes[key as keyof PlayerAttributes] * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return 0;
  return sum / totalWeight;
}

export function isEligible(player: Player, role: Role): boolean {
  return role.positions.includes(player.position);
}
