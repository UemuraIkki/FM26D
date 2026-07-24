import { compareIds } from "../core/rng.js";
import { marketValue, playerAbility } from "../finance/value.js";
import { isEligible, roleScore } from "../model/roles.js";
import type { Player } from "../model/types.js";
import { selectStartingXI } from "../sim/lineup.js";
import { buildDepthChart } from "../squad/depthChart.js";
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
const ASK_STARTER = 1.6;
const ASK_BACKUP = 1.15;
const ASK_SURPLUS = 0.75;

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
    let coef = ASK_SURPLUS;
    for (const rd of chart.roles) {
      const starterIds = rd.assigned.slice(0, rd.slots).map((e) => e.player.id);
      const backupIds = rd.assigned.slice(rd.slots).map((e) => e.player.id);
      if (starterIds.includes(player.id)) return Math.round(value * ASK_STARTER * 100) / 100;
      if (backupIds.includes(player.id)) coef = Math.max(coef, ASK_BACKUP);
    }
    return Math.round(value * coef * 100) / 100;
  }

  chooseSigning(context: SquadContext, candidates: readonly MarketCandidate[]): SigningChoice | null {
    // Requirement 5.5 steps 1-2: scan starter weaknesses per formation role,
    // rank candidates by improvement per cost.
    const chart = buildDepthChart(this.clubId, context.squad, context.roleBook, context.formation);
    const weakestStarter = new Map<string, number>();
    for (const rd of chart.roles) {
      const starters = rd.assigned.slice(0, rd.slots);
      if (starters.length < rd.slots) {
        weakestStarter.set(rd.roleId, 0); // unfilled slot: any eligible player improves
      } else {
        weakestStarter.set(rd.roleId, Math.min(...starters.map((e) => e.score)));
      }
    }

    let best: { choice: SigningChoice; utility: number; id: string } | null = null;
    for (const { player, askingFee } of candidates) {
      if (askingFee > context.balance * MAX_FEE_FRACTION) continue;
      let improvement = 0;
      for (const [roleId, starterScore] of weakestStarter) {
        const role = context.roleBook.rolesById.get(roleId)!;
        if (!isEligible(player, role)) continue;
        improvement = Math.max(improvement, roleScore(player, role) - starterScore);
      }
      if (improvement < IMPROVEMENT_THRESHOLD) continue;
      const utility = improvement / (1 + askingFee / 20);
      if (!best || utility > best.utility || (utility === best.utility && compareIds(player.id, best.id) < 0)) {
        best = { choice: { playerId: player.id, offeredFee: askingFee }, utility, id: player.id };
      }
    }
    return best ? best.choice : null;
  }

  respondToOffer(context: SquadContext, player: Player, offeredFee: number): boolean {
    return offeredFee >= this.askingFeeFor(context, player);
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
