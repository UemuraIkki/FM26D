import type { Player } from "../model/types.js";
import { isEligible, roleScore, type Formation, type RoleBook } from "../model/roles.js";

/**
 * Depth chart (requirement 4.2): per formation role, rank eligible players
 * 1st/2nd/3rd by role score, then mechanically detect transfer needs
 * (shortage) and sellable surplus.
 */

export interface DepthEntry {
  player: Player;
  score: number;
}

export interface RoleDepth {
  roleId: string;
  /** Number of XI slots using this role. */
  slots: number;
  /** Eligible players sorted by score, best first. */
  depth: DepthEntry[];
  /** Starters + one backup per slot: slots * 2. */
  required: number;
  shortage: boolean;
}

export interface ClubDepthChart {
  clubId: string;
  roles: RoleDepth[];
  /** Roles where eligible depth < required — transfer targets (5.5 step 1). */
  shortages: RoleDepth[];
  /** Players outside the top `required` of every role — sale candidates. */
  surplus: Player[];
}

export function buildDepthChart(
  clubId: string,
  squad: readonly Player[],
  book: RoleBook,
  formation: Formation = book.defaultFormation,
): ClubDepthChart {
  const slotCounts = new Map<string, number>();
  for (const slot of formation.slots) {
    slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1);
  }

  const roles: RoleDepth[] = [];
  const usedPlayerIds = new Set<string>();

  for (const [roleId, slots] of slotCounts) {
    const role = book.rolesById.get(roleId);
    if (!role) throw new Error(`unknown role in formation: ${roleId}`);
    const depth = squad
      .filter((p) => isEligible(p, role))
      .map((player) => ({ player, score: roleScore(player, role) }))
      .sort((a, b) => b.score - a.score || a.player.id.localeCompare(b.player.id));
    const required = slots * 2;
    for (const entry of depth.slice(0, required)) usedPlayerIds.add(entry.player.id);
    roles.push({ roleId, slots, depth, required, shortage: depth.length < required });
  }

  const surplus = squad.filter((p) => !usedPlayerIds.has(p.id));
  return {
    clubId,
    roles,
    shortages: roles.filter((r) => r.shortage),
    surplus,
  };
}
