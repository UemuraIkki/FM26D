import type { TeamSheet } from "../engine/index.js";
import type { Formation, RoleBook } from "../model/roles.js";
import type { Player } from "../model/types.js";

/**
 * 絶対制約 (requirement 1): every club decision flows through this interface.
 * Observation mode wires an `AIDecisionMaker` for all clubs; the future
 * manager mode swaps exactly one club to a `HumanDecisionMaker` without
 * touching the orchestration.
 *
 * Phase A/B: lineup selection. Phase C: transfer decisions (sell listings,
 * signing targets, offer responses). Phase F adds board/manager interactions.
 */
export interface ClubDecisionMaker {
  readonly clubId: string;
  selectLineup(context: LineupContext): TeamSheet;
  /** Which players to make available for transfer (requirement 5.2/5.5). */
  nominateSaleListings(context: SquadContext): Player[];
  /** Pick at most one signing attempt from the available market. */
  chooseSigning(context: SquadContext, candidates: readonly MarketCandidate[]): SigningChoice | null;
  /** Seller side: accept or reject a concrete fee offer (requirement 5.5 step 3). */
  respondToOffer(context: SquadContext, player: Player, offeredFee: number): boolean;
}

export interface LineupContext {
  squad: readonly Player[];
  roleBook: RoleBook;
  formation: Formation;
}

export interface SquadContext extends LineupContext {
  /** Current cash balance (1 = £1M). */
  balance: number;
  /** Calendar year used for market-value computations. */
  currentYear: number;
}

export interface MarketCandidate {
  player: Player;
  /** Seller's asking fee; 0 for free agents. */
  askingFee: number;
}

export interface SigningChoice {
  playerId: string;
  offeredFee: number;
}
