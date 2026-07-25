import type { Player } from "../model/types.js";

/**
 * The player's own say in a move (requirement 5.5 step 4).
 *
 * The market builds a `MoveProposal` with everything the player weighs:
 * expected playing time (squad rank now vs at the destination), wages, club
 * reputation, and the player's ambition attribute decides how those trade
 * off. Phase D completion criterion: refusals with reason PLAYING_TIME are
 * observed in the wild.
 */

export type SquadRank = "STARTER" | "BACKUP" | "OUT";

export type RefusalReason = "PLAYING_TIME" | "REPUTATION" | "WAGE" | "OVERALL";

export interface MoveProposal {
  player: Player;
  fromClubId: string | null;
  toClubId: string;
  /** Depth-chart rank at the current club (OUT for surplus/free agents). */
  currentRank: SquadRank;
  /** Depth-chart rank the player would take at the destination. */
  expectedRank: SquadRank;
  /** 0 for free agents. */
  fromClubStrength: number;
  toClubStrength: number;
  /** 0 for free agents. */
  currentWage: number;
  offeredWage: number;
}

export interface MoveDecision {
  accept: boolean;
  reason?: RefusalReason;
}

export interface PlayerAgent {
  decide(proposal: MoveProposal): MoveDecision;
}

const PLAY_SCORE: Record<SquadRank, number> = { STARTER: 2, BACKUP: 1, OUT: 0 };
const ACCEPT_THRESHOLD = 0.15;

/**
 * Utility model: ambitious players chase reputation, less ambitious players
 * protect playing time; wages matter to everyone but less than either.
 */
export class RationalPlayerAgent implements PlayerAgent {
  decide(proposal: MoveProposal): MoveDecision {
    const playDelta = PLAY_SCORE[proposal.expectedRank] - PLAY_SCORE[proposal.currentRank];
    const repDelta = Math.max(-3, Math.min(3, (proposal.toClubStrength - proposal.fromClubStrength) / 15));
    const wageDelta =
      proposal.currentWage > 0
        ? Math.max(-1, Math.min(1.5, (proposal.offeredWage - proposal.currentWage) / proposal.currentWage))
        : 1;

    const ambition = proposal.player.attributes.ambition / 99;
    const wPlay = 1.0 + 0.9 * (1 - ambition);
    const wRep = 0.3 + 1.1 * ambition;
    const wWage = 0.45;

    const terms: Array<{ reason: RefusalReason; value: number }> = [
      { reason: "PLAYING_TIME", value: playDelta * wPlay },
      { reason: "REPUTATION", value: repDelta * wRep },
      { reason: "WAGE", value: wageDelta * wWage },
    ];
    const utility = terms.reduce((sum, t) => sum + t.value, 0);
    if (utility >= ACCEPT_THRESHOLD) return { accept: true };

    let worst: { reason: RefusalReason; value: number } = { reason: "OVERALL", value: 0 };
    for (const t of terms) {
      if (t.value < worst.value) worst = t;
    }
    return { accept: false, reason: worst.reason };
  }
}
