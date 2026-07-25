import { compareIds } from "../core/rng.js";
import type { Player } from "../model/types.js";
import { countEligible, rankEligible, type Formation, type RoleBook } from "../model/roles.js";

/**
 * Depth chart (requirement 4.2): per formation role, rank eligible players
 * 1st/2nd/3rd by role score, then mechanically detect transfer needs
 * (shortage) and sellable surplus.
 *
 * Starter and backup slots are filled by an exclusive draft — one player can
 * occupy only one slot — so four defenders can no longer satisfy both the CB
 * and FB requirements simultaneously. Roles draft in scarcity order (fewest
 * eligible candidates per needed slot first) to avoid starving a role whose
 * candidates were taken by a more flexible one; ties break on role id for
 * determinism.
 */

export interface DepthEntry {
  player: Player;
  score: number;
}

export interface RoleDepth {
  roleId: string;
  /** Number of XI slots using this role. */
  slots: number;
  /** Full eligibility ranking (informational), best first. */
  depth: DepthEntry[];
  /** Exclusively drafted starters + backups for this role, best first. */
  assigned: DepthEntry[];
  /** Starters + one backup per slot: slots * 2. */
  required: number;
  shortage: boolean;
}

export interface ClubDepthChart {
  clubId: string;
  roles: RoleDepth[];
  /** Roles whose exclusive allocation came up short — transfer targets (5.5 step 1). */
  shortages: RoleDepth[];
  /** Players left unassigned by every role — sale candidates. */
  surplus: Player[];
}

interface DraftRole {
  roleId: string;
  slots: number;
  need: number;
  assigned: DepthEntry[];
}

/** One exclusive draft round: each role fills `need` slots from unassigned players. */
function draftRound(
  draftRoles: DraftRole[],
  squad: readonly Player[],
  assignedIds: Set<string>,
  book: RoleBook,
): void {
  const remaining = draftRoles.map((r) => ({ role: r, toFill: r.need }));
  while (remaining.some((r) => r.toFill > 0)) {
    // Scarcity order, recomputed as players get taken.
    const open = remaining.filter((r) => r.toFill > 0);
    open.sort((a, b) => {
      const roleA = book.rolesById.get(a.role.roleId)!;
      const roleB = book.rolesById.get(b.role.roleId)!;
      const candA = countEligible(squad, roleA, assignedIds);
      const candB = countEligible(squad, roleB, assignedIds);
      return candA / a.toFill - candB / b.toFill || compareIds(a.role.roleId, b.role.roleId);
    });
    const current = open[0]!;
    const role = book.rolesById.get(current.role.roleId)!;
    const best = rankEligible(squad, role, assignedIds)[0];
    current.toFill--;
    if (!best) continue; // shortage — leave the slot unfilled
    assignedIds.add(best.player.id);
    current.role.assigned.push(best);
  }
}

export type SquadRank = "STARTER" | "BACKUP" | "OUT";

/** Squad status of one player according to the exclusive allocation. */
export function rankIn(chart: ClubDepthChart, playerId: string): SquadRank {
  for (const rd of chart.roles) {
    const starters = rd.assigned.slice(0, rd.slots);
    if (starters.some((e) => e.player.id === playerId)) return "STARTER";
  }
  for (const rd of chart.roles) {
    const backups = rd.assigned.slice(rd.slots);
    if (backups.some((e) => e.player.id === playerId)) return "BACKUP";
  }
  return "OUT";
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

  const draftRoles: DraftRole[] = [...slotCounts].map(([roleId, slots]) => ({
    roleId,
    slots,
    need: slots,
    assigned: [],
  }));
  const assignedIds = new Set<string>();

  // Round 1: starters. Round 2: one backup per slot.
  draftRound(draftRoles, squad, assignedIds, book);
  draftRound(draftRoles, squad, assignedIds, book);

  const roles: RoleDepth[] = draftRoles.map((dr) => {
    const role = book.rolesById.get(dr.roleId)!;
    const depth = rankEligible(squad, role);
    const required = dr.slots * 2;
    return {
      roleId: dr.roleId,
      slots: dr.slots,
      depth,
      assigned: dr.assigned,
      required,
      shortage: dr.assigned.length < required,
    };
  });

  const surplus = squad.filter((p) => !assignedIds.has(p.id));
  return {
    clubId,
    roles,
    shortages: roles.filter((r) => r.shortage),
    surplus,
  };
}
