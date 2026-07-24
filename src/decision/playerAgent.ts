import type { Player } from "../model/types.js";

/**
 * The player's own say in a move (requirement 5.5 step 4).
 *
 * Phase C stub: every player accepts. Phase D replaces this with a model of
 * expected playing time, wages, club reputation, ambition and preferences —
 * the completion criterion there is observing players refusing moves for
 * playing-time reasons.
 */
export interface PlayerAgent {
  acceptsMove(player: Player, fromClubId: string | null, toClubId: string): boolean;
}

export class AlwaysAcceptAgent implements PlayerAgent {
  acceptsMove(): boolean {
    return true;
  }
}
