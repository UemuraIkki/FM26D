import { compareIds } from "../core/rng.js";
import { marketValue, playerAbility } from "../finance/value.js";
import { isEligible, minHeadcountByPosition, roleScore } from "../model/roles.js";
import type { Player } from "../model/types.js";
import { selectStartingXI } from "../sim/lineup.js";
import { buildDepthChart, rankIn, type SquadRank } from "../squad/depthChart.js";
import type {
  ClubDecisionMaker,
  LineupContext,
  MarketCandidate,
  SigningChoice,
  SquadContext,
} from "./clubDecisionMaker.js";
import type { TeamSheet } from "../engine/index.js";

/** Minimum role-score improvement over the current starter to justify a signing. */
const IMPROVEMENT_THRESHOLD = 2;
/** Never spend more than this fraction of the balance on one fee. */
const MAX_FEE_FRACTION = 0.5;

/** Ask multipliers by squad status (requirement 5.5 step 3: self-valuation × depth coef). */
export const ASK_MULTIPLIER: Record<SquadRank, number> = {
  STARTER: 1.6,
  BACKUP: 1.15,
  OUT: 0.75,
};

/** Minimum ability for a pure squad-depth signing (filling an empty backup slot). */
const DEPTH_FLOOR = 60;

/** Default autonomous club brain used for every club in observation mode. */
export class AIDecisionMaker implements ClubDecisionMaker {
  constructor(readonly clubId: string) {}

  selectLineup(context: LineupContext): TeamSheet {
    return selectStartingXI(this.clubId, context.squad, context.roleBook, context.formation);
  }

  nominateSaleListings(context: SquadContext): Player[] {
    // Requirement 5.2: keep/sell from depth chart position — list the surplus.
    const chart = buildDepthChart(this.clubId, context.squad, context.roleBook, context.formation);
    return chart.surplus;
  }

  askingFeeFor(context: SquadContext, player: Player): number {
    const chart = buildDepthChart(this.clubId, context.squad, context.roleBook, context.formation);
    const value = marketValue(player, context.currentYear);
    const rank = rankIn(chart, player.id);
    return Math.round(value * ASK_MULTIPLIER[rank] * 100) / 100;
  }

  chooseSigning(context: SquadContext, candidates: readonly MarketCandidate[]): SigningChoice | null {
    // Requirement 5.5 steps 1-2: need scan per formation role, then rank
    // candidates by improvement per cost. Two kinds of demand:
    //  - starter upgrade: candidate beats the weakest current starter
    //  - depth fill: a role is missing backups (exclusive allocation short)
    const chart = buildDepthChart(this.clubId, context.squad, context.roleBook, context.formation);
    const weakestStarter = new Map<string, number>();
    const missingBackups = new Set<string>();
    for (const rd of chart.roles) {
      const starters = rd.assigned.slice(0, rd.slots);
      weakestStarter.set(rd.roleId, starters.length < rd.slots ? 0 : Math.min(...starters.map((e) => e.score)));
      if (rd.assigned.length < rd.required) missingBackups.add(rd.roleId);
    }

    let best: { choice: SigningChoice; utility: number; id: string } | null = null;
    for (const { player, askingFee } of candidates) {
      if (askingFee > context.balance * MAX_FEE_FRACTION) continue;
      let utility = 0;
      for (const [roleId, starterScore] of weakestStarter) {
        const role = context.roleBook.rolesById.get(roleId)!;
        if (!isEligible(player, role)) continue;
        const score = roleScore(player, role);
        const starterGain = score - starterScore;
        if (starterGain >= IMPROVEMENT_THRESHOLD) {
          utility = Math.max(utility, starterGain / (1 + askingFee / 20));
        }
        if (missingBackups.has(roleId) && score >= DEPTH_FLOOR + IMPROVEMENT_THRESHOLD) {
          // Depth signings matter less than XI upgrades.
          utility = Math.max(utility, (0.5 * (score - DEPTH_FLOOR)) / (1 + askingFee / 20));
        }
      }
      if (utility <= 0) continue;
      if (!best || utility > best.utility || (utility === best.utility && compareIds(player.id, best.id) < 0)) {
        best = { choice: { playerId: player.id, offeredFee: askingFee }, utility, id: player.id };
      }
    }
    return best ? best.choice : null;
  }

  respondToOffer(context: SquadContext, player: Player, offeredFee: number): boolean {
    if (offeredFee < this.askingFeeFor(context, player)) return false;
    // Never sell below the minimum needed to field a starting XI. Checked
    // by position headcount, not per-role depth: two single-position roles
    // (e.g. 4-4-2's P and CF, both FW-only) draw from the same position
    // pool, so a role-by-role check alone under-counts the real need — a
    // club with exactly 2 FWs can pass a naive "depth >= 1 slot" check for
    // each forward role individually while only being able to field one.
    const need = minHeadcountByPosition(context.roleBook, context.formation);
    const remaining = context.squad.filter((p) => p.id !== player.id && p.position === player.position).length;
    return remaining >= need[player.position];
  }

  /** Renewal policy at contract expiry: keep anyone the depth chart still needs. */
  wantsToRenew(context: SquadContext, player: Player): boolean {
    const chart = buildDepthChart(this.clubId, context.squad, context.roleBook, context.formation);
    for (const rd of chart.roles) {
      if (rd.assigned.some((e) => e.player.id === player.id)) return true;
    }
    // Keep young prospects with real ability even if currently outside the depth.
    return player.age <= 21 && playerAbility(player) >= 70;
  }
}
