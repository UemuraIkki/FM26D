import type { EnginePlayer, TeamSheet } from "../engine/index.js";
import { countEligible, getRoleBook, rankEligible, type Formation, type RoleBook } from "../model/roles.js";
import type { Player } from "../model/types.js";

/**
 * Pick the starting XI by role score (requirement 4.2).
 *
 * Slots are filled in scarcity order — the slot with the fewest remaining
 * eligible candidates chooses first — so a flexible role can no longer consume
 * the only player a stricter later slot could accept (which made the naive
 * slot-order greedy reject feasible XIs). Still greedy per slot rather than a
 * global maximum-score assignment; deterministic via compareIds tie-breaks.
 */

export function toEnginePlayer(p: Player): EnginePlayer {
  return { id: p.id, position: p.position, ...p.attributes };
}

export interface LineupSlot {
  index: number;
  roleId: string;
  player?: Player;
}

/**
 * Fills every still-open slot in scarcity order (fewest eligible unpicked
 * candidates first, so a flexible role can't consume the only player a
 * stricter later slot could accept) via role-score selection, mutating
 * `slots`/`picked` in place. Shared by `selectStartingXI` (all-automatic)
 * and `HumanDecisionMaker.selectLineup` (fills whatever a manager policy's
 * explicit picks didn't cover) so both apply identical fallback logic.
 */
export function fillOpenSlots(
  slots: LineupSlot[],
  squad: readonly Player[],
  book: RoleBook,
  picked: Set<string>,
  clubId: string,
): void {
  while (slots.some((s) => !s.player)) {
    const open = slots.filter((s) => !s.player);
    let chosen: LineupSlot | undefined;
    let chosenCount = Infinity;
    for (const slot of open) {
      const role = book.rolesById.get(slot.roleId);
      if (!role) throw new Error(`unknown role in formation: ${slot.roleId}`);
      const count = countEligible(squad, role, picked);
      if (count < chosenCount) {
        chosen = slot;
        chosenCount = count;
      }
    }
    const slot = chosen!;
    const role = book.rolesById.get(slot.roleId)!;
    const best = rankEligible(squad, role, picked)[0];
    if (!best) throw new Error(`club ${clubId}: no eligible player for role ${slot.roleId}`);
    picked.add(best.player.id);
    slot.player = best.player;
  }
}

export function buildTeamSheet(clubId: string, slots: readonly LineupSlot[]): TeamSheet {
  return {
    teamId: clubId,
    players: [...slots].sort((a, b) => a.index - b.index).map((s) => toEnginePlayer(s.player as Player)),
  };
}

export function selectStartingXI(
  clubId: string,
  squad: readonly Player[],
  book: RoleBook = getRoleBook(),
  formation: Formation = book.defaultFormation,
): TeamSheet {
  const picked = new Set<string>();
  const slots: LineupSlot[] = formation.slots.map((roleId, index) => ({ index, roleId }));
  fillOpenSlots(slots, squad, book, picked, clubId);
  return buildTeamSheet(clubId, slots);
}
