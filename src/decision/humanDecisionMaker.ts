import { countEligible, rankEligible } from "../model/roles.js";
import type { Player } from "../model/types.js";
import type { TeamSheet } from "../engine/index.js";
import { toEnginePlayer } from "../sim/lineup.js";
import { AIDecisionMaker } from "./aiDecisionMaker.js";
import type {
  ClubDecisionMaker,
  LineupContext,
  MarketCandidate,
  SigningChoice,
  SquadContext,
} from "./clubDecisionMaker.js";

/**
 * Manager Mode (future extension, requirement 1's "future manager mode"):
 * a human-configured brain. Every decision NOT explicitly overridden by the
 * policy delegates to a plain `AIDecisionMaker` for that club — this keeps
 * "no policy set" behaviorally identical to observation mode, and means the
 * policy only needs to encode the handful of choices a human actually cares
 * about, not re-derive everything an AI already does safely.
 */
export interface ManagerPolicy {
  /** roleId -> player id. Started if eligible & in the available squad this match; otherwise falls back to normal role-score selection for that slot. */
  preferredStarters?: Partial<Record<string, string>>;
  /** Transfer targets in priority order. Each active market day, the first one present in the candidate pool and within budget is pursued. */
  transferTargets?: string[];
  /** Player ids that are refused no matter the offer. */
  protectedPlayers?: string[];
  /** Player ids to let go at contract expiry instead of auto-renewing. */
  releaseList?: string[];
}

export class HumanDecisionMaker implements ClubDecisionMaker {
  private readonly ai: AIDecisionMaker;

  constructor(
    readonly clubId: string,
    private readonly policy: ManagerPolicy,
  ) {
    this.ai = new AIDecisionMaker(clubId);
  }

  selectLineup(context: LineupContext): TeamSheet {
    const preferred = this.policy.preferredStarters;
    if (!preferred) return this.ai.selectLineup(context);

    const picked = new Set<string>();
    interface Slot {
      index: number;
      roleId: string;
      player?: Player;
    }
    const slots: Slot[] = context.formation.slots.map((roleId, index) => ({ index, roleId }));

    // Pass 1: honor explicit picks where the player is actually available and eligible.
    for (const slot of slots) {
      const preferredId = preferred[slot.roleId];
      if (!preferredId || picked.has(preferredId)) continue;
      const role = context.roleBook.rolesById.get(slot.roleId);
      if (!role) continue;
      const candidate = context.squad.find((p) => p.id === preferredId);
      if (!candidate || !role.positions.includes(candidate.position)) continue;
      picked.add(candidate.id);
      slot.player = candidate;
    }

    // Pass 2: fill everything else with the same scarcity-order role-score
    // selection AIDecisionMaker/selectStartingXI use, scoped to what's left.
    while (slots.some((s) => !s.player)) {
      const open = slots.filter((s) => !s.player);
      let chosen: Slot | undefined;
      let chosenCount = Infinity;
      for (const slot of open) {
        const role = context.roleBook.rolesById.get(slot.roleId);
        if (!role) throw new Error(`unknown role in formation: ${slot.roleId}`);
        const count = countEligible(context.squad, role, picked);
        if (count < chosenCount) {
          chosen = slot;
          chosenCount = count;
        }
      }
      const slot = chosen!;
      const role = context.roleBook.rolesById.get(slot.roleId)!;
      const best = rankEligible(context.squad, role, picked)[0];
      if (!best) throw new Error(`club ${this.clubId}: no eligible player for role ${slot.roleId}`);
      picked.add(best.player.id);
      slot.player = best.player;
    }

    return {
      teamId: this.clubId,
      players: slots.sort((a, b) => a.index - b.index).map((s) => toEnginePlayer(s.player as Player)),
    };
  }

  nominateSaleListings(context: SquadContext): Player[] {
    return this.ai.nominateSaleListings(context);
  }

  chooseSigning(context: SquadContext, candidates: readonly MarketCandidate[]): SigningChoice | null {
    const targets = this.policy.transferTargets;
    if (!targets || targets.length === 0) return null;
    for (const playerId of targets) {
      const candidate = candidates.find((c) => c.player.id === playerId);
      if (!candidate) continue;
      if (candidate.askingFee > context.balance * 0.5) continue;
      return { playerId, offeredFee: candidate.askingFee };
    }
    return null;
  }

  respondToOffer(context: SquadContext, player: Player, offeredFee: number): boolean {
    if (this.policy.protectedPlayers?.includes(player.id)) return false;
    return this.ai.respondToOffer(context, player, offeredFee);
  }

  wantsToRenew(context: SquadContext, player: Player): boolean {
    if (this.policy.releaseList?.includes(player.id)) return false;
    return this.ai.wantsToRenew(context, player);
  }
}
