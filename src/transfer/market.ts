import type { SimDate } from "../core/calendar.js";
import { compareIds } from "../core/rng.js";
import { AIDecisionMaker } from "../decision/aiDecisionMaker.js";
import type { ClubDecisionMaker, MarketCandidate, SquadContext } from "../decision/clubDecisionMaker.js";
import type { PlayerAgent } from "../decision/playerAgent.js";
import { playerAbility, wageFor } from "../finance/value.js";
import type { Formation, RoleBook } from "../model/roles.js";
import type { Player } from "../model/types.js";
import { getSquad, transferPlayer, type World } from "../model/world.js";

/**
 * Transfer market (requirement 5.5). Runs during the two windows:
 * summer (Jul 1 - Aug 31) and winter (Jan 1 - 31).
 *
 * Per market day, in deterministic league order every club:
 *   1. lists its surplus (need scan via depth chart),
 *   2. picks at most one target among other clubs' listings + free agents
 *      (value-for-money ranking),
 *   3. negotiates: the seller compares the offer with its own valuation ×
 *      depth coefficient,
 *   4. the player accepts/refuses (Phase C stub: always accepts),
 *   5. on success: fee moves buyer → seller through the ledger and the
 *      player moves with a fresh contract.
 */

export interface TransferRecord {
  date: string;
  playerId: string;
  playerName: string;
  fromClubId: string | null;
  toClubId: string;
  fee: number;
}

export function isTransferWindowOpen(date: SimDate): boolean {
  if (date.month === 7 || date.month === 8) return true; // summer
  if (date.month === 1) return true; // winter
  return false;
}

/** New contract terms on signing: youth get longer deals. */
export function contractYearsFor(age: number): number {
  if (age <= 23) return 4;
  if (age <= 28) return 3;
  return 2;
}

const MAX_SIGNINGS_PER_WINDOW = 2;

export class TransferMarket {
  private signingsThisWindow = new Map<string, number>();
  private windowOpen = false;
  readonly completed: TransferRecord[] = [];

  constructor(
    private readonly world: World,
    private readonly roleBook: RoleBook,
    private readonly formation: Formation,
    private readonly brains: ReadonlyMap<string, ClubDecisionMaker>,
    private readonly playerAgent: PlayerAgent,
    private readonly seasonEndYear: number,
  ) {}

  private contextFor(clubId: string, date: SimDate): SquadContext {
    return {
      squad: getSquad(this.world, clubId),
      roleBook: this.roleBook,
      formation: this.formation,
      balance: this.world.ledger.balanceOf(clubId),
      currentYear: date.year,
    };
  }

  /** Daily tick hook. No-op outside windows. */
  processDay(date: SimDate, clubIds: readonly string[]): void {
    const open = isTransferWindowOpen(date);
    if (open && !this.windowOpen) this.signingsThisWindow.clear(); // new window begins
    this.windowOpen = open;
    if (!open) return;
    // Trade every third day to keep season runtime flat.
    if (date.day % 3 !== 1) return;

    // 1. Collect listings from every club (need scan / surplus detection).
    const listings = new Map<string, { player: Player; askingFee: number; sellerId: string }>();
    for (const clubId of clubIds) {
      const brain = this.brains.get(clubId);
      if (!brain) continue;
      const ctx = this.contextFor(clubId, date);
      for (const player of brain.nominateSaleListings(ctx)) {
        const askingFee =
          brain instanceof AIDecisionMaker ? brain.askingFeeFor(ctx, player) : 0;
        listings.set(player.id, { player, askingFee, sellerId: clubId });
      }
    }

    // 2-5. Each club may attempt one signing per market day.
    for (const clubId of clubIds) {
      const brain = this.brains.get(clubId);
      if (!brain) continue;
      if ((this.signingsThisWindow.get(clubId) ?? 0) >= MAX_SIGNINGS_PER_WINDOW) continue;

      const candidates: MarketCandidate[] = [];
      for (const listing of listings.values()) {
        if (listing.sellerId === clubId) continue;
        candidates.push({ player: listing.player, askingFee: listing.askingFee });
      }
      for (const freeAgent of this.world.freeAgents) {
        candidates.push({ player: freeAgent, askingFee: 0 });
      }
      candidates.sort((a, b) => compareIds(a.player.id, b.player.id));

      const ctx = this.contextFor(clubId, date);
      const choice = brain.chooseSigning(ctx, candidates);
      if (!choice) continue;

      const listing = listings.get(choice.playerId);
      const player = listing?.player ?? this.world.freeAgents.find((p) => p.id === choice.playerId);
      if (!player) continue;

      // 3. Club-to-club negotiation (skipped for free agents).
      if (listing) {
        const sellerBrain = this.brains.get(listing.sellerId);
        if (!sellerBrain) continue;
        const sellerCtx = this.contextFor(listing.sellerId, date);
        if (!sellerBrain.respondToOffer(sellerCtx, player, choice.offeredFee)) continue;
      }

      // 4. Player's own decision (Phase C: stub agent).
      if (!this.playerAgent.acceptsMove(player, player.clubId, clubId)) continue;

      // 5. Execute: fee through the ledger, move, fresh contract.
      if (listing) {
        this.world.ledger.record(date, "TRANSFER_FEE", clubId, listing.sellerId, choice.offeredFee, player.id);
        listings.delete(player.id);
      }
      const fromClubId = player.clubId;
      transferPlayer(this.world, player.id, clubId);
      player.contract = {
        annualWage: wageFor(playerAbility(player)),
        endYear: this.seasonEndYear + contractYearsFor(player.age),
      };
      this.signingsThisWindow.set(clubId, (this.signingsThisWindow.get(clubId) ?? 0) + 1);
      this.completed.push({
        date: `${date.year}-${date.month}-${date.day}`,
        playerId: player.id,
        playerName: player.name,
        fromClubId,
        toClubId: clubId,
        fee: listing ? choice.offeredFee : 0,
      });
    }
  }
}
