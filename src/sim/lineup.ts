import type { EnginePlayer, TeamSheet } from "../engine/index.js";
import { getRoleBook, isEligible, roleScore, type Formation, type RoleBook } from "../model/roles.js";
import type { Player } from "../model/types.js";

/**
 * Pick the starting XI by filling each formation slot with the highest
 * role-score eligible player not yet selected (requirement 4.2: the role
 * evaluation function drives selection). The engine only sees the resulting
 * `TeamSheet`.
 */

function toEnginePlayer(p: Player): EnginePlayer {
  return { id: p.id, position: p.position, ...p.attributes };
}

export function selectStartingXI(
  clubId: string,
  squad: readonly Player[],
  book: RoleBook = getRoleBook(),
  formation: Formation = book.defaultFormation,
): TeamSheet {
  const picked = new Set<string>();
  const players: EnginePlayer[] = [];

  for (const slotRoleId of formation.slots) {
    const role = book.rolesById.get(slotRoleId);
    if (!role) throw new Error(`unknown role in formation: ${slotRoleId}`);
    const candidates = squad
      .filter((p) => !picked.has(p.id) && isEligible(p, role))
      .map((player) => ({ player, score: roleScore(player, role) }))
      .sort((a, b) => b.score - a.score || a.player.id.localeCompare(b.player.id));
    const best = candidates[0];
    if (!best) throw new Error(`club ${clubId}: no eligible player for role ${slotRoleId}`);
    picked.add(best.player.id);
    players.push(toEnginePlayer(best.player));
  }

  return { teamId: clubId, players };
}
