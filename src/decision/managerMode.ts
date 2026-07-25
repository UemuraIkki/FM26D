import { HumanDecisionMaker } from "./humanDecisionMaker.js";
import type { ClubDecisionMaker } from "./clubDecisionMaker.js";
import type { World } from "../model/world.js";
import type { SeasonReport } from "../sim/season.js";

/**
 * Manager Mode orchestration (future extension, requirement 1's "future
 * manager mode"). Deliberately thin: `runSeason` itself is never touched —
 * a caller builds the `decisionMakers` map from `World`'s state and passes
 * it straight into `SeasonOptions`, exactly as if it had hand-built an
 * AIDecisionMaker override for one club.
 */

/**
 * Builds the `decisionMakers` override for `runSeason` from World's Manager
 * Mode state. Empty (not undefined, so callers can pass this straight
 * through under exactOptionalPropertyTypes) when no club is human-controlled
 * — season.ts's `options.decisionMakers?.get(id) ?? new AIDecisionMaker(id)`
 * treats an empty map identically to an absent one.
 */
export function buildManagerBrains(world: World): Map<string, ClubDecisionMaker> {
  const brains = new Map<string, ClubDecisionMaker>();
  if (world.humanControlledClubId) {
    brains.set(world.humanControlledClubId, new HumanDecisionMaker(world.humanControlledClubId, world.managerPolicy ?? {}));
  }
  return brains;
}

/**
 * Call after `runSeason` returns. If the human's club sacked its manager
 * this season, control is lost (game over / job search) — mutates World to
 * clear Manager Mode state and reports it so the caller can prompt for a
 * new club.
 */
export function applyManagerModeOutcome(world: World, report: SeasonReport): { sacked: boolean } {
  if (!world.humanControlledClubId) return { sacked: false };
  const sacked = report.managerChanges.some((c) => c.clubId === world.humanControlledClubId);
  if (sacked) {
    delete world.humanControlledClubId;
    delete world.managerPolicy;
  }
  return { sacked };
}
