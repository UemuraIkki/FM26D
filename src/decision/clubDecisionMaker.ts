import type { TeamSheet } from "../engine/index.js";
import type { Formation, RoleBook } from "../model/roles.js";
import type { Player } from "../model/types.js";

/**
 * 絶対制約 (requirement 1): every club decision flows through this interface.
 * Observation mode wires an `AIDecisionMaker` for all clubs; the future
 * manager mode swaps exactly one club to a `HumanDecisionMaker` without
 * touching the orchestration.
 *
 * Phase A/B scope: lineup selection. Phase C adds transfer decisions
 * (targets, offers, keep/sell), Phase F adds board/manager interactions.
 */
export interface ClubDecisionMaker {
  readonly clubId: string;
  selectLineup(context: LineupContext): TeamSheet;
}

export interface LineupContext {
  squad: readonly Player[];
  roleBook: RoleBook;
  formation: Formation;
}
