import type { SimDate } from "../core/calendar.js";
import { compareIds } from "../core/rng.js";
import { AIDecisionMaker, ASK_MULTIPLIER } from "../decision/aiDecisionMaker.js";
import type { ClubDecisionMaker, MarketCandidate, SquadContext } from "../decision/clubDecisionMaker.js";
import type { MoveProposal, PlayerAgent, RefusalReason } from "../decision/playerAgent.js";
import { marketValue, playerAbility, wageFor } from "../finance/value.js";
import type { Formation, RoleBook } from "../model/roles.js";
import type { Player } from "../model/types.js";
import { getSquad, transferPlayer, type World } from "../model/world.js";
import { applyTransferMorale } from "../morale/morale.js";
import { buildDepthChart, rankIn, type ClubDepthChart, type SquadRank } from "../squad/depthChart.js";

/**
 * Transfer market (requirement 5.5). Runs during the two windows:
 * summer (Jul 1 - Aug 31) and winter (Jan 1 - 31).
 *
 * Per market day, in deterministic league order every club:
 *   1. lists its surplus (need scan via depth chart); other clubs' rostered
 *      players can also be approached unsolicited at a premium
 *      (self-valuation × depth coefficient, requirement 5.5 step 3),
 *   2. picks at most one target (value-for-money ranking, incl. depth needs),
 *   3. negotiates with the selling club,
 *   4. the player weighs playing time / wages / reputation / ambition and
 *      may refuse (requirement 5.5 step 4, Phase D),
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

export interface RefusalRecord {
  date: string;
  playerId: string;
  playerName: string;
  fromClubId: string | null;
  toClubId: string;
  reason: RefusalReason;
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

const MAX_SIGNINGS_PER_WINDOW = 3;

export class TransferMarket {
  private signingsThisWindow = new Map<string, number>();
  /** "buyerId:playerId" pairs already refused this window — no repeat bids. */
  private refusedPairs = new Set<string>();
  private windowOpen = false;
  readonly completed: TransferRecord[] = [];
  readonly refusals: RefusalRecord[] = [];

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
      club: this.world.clubsById.get(clubId)!,
    };
  }

  private chartOf(clubId: string): ClubDepthChart {
    return buildDepthChart(clubId, getSquad(this.world, clubId), this.roleBook, this.formation);
  }

  /** Rank the player would take if added to the destination squad today. */
  private expectedRankAt(clubId: string, player: Player): SquadRank {
    const squadPlus = [...getSquad(this.world, clubId), player];
    const chart = buildDepthChart(clubId, squadPlus, this.roleBook, this.formation);
    return rankIn(chart, player.id);
  }

  /** Daily tick hook. No-op outside windows. */
  processDay(date: SimDate, clubIds: readonly string[]): void {
    const open = isTransferWindowOpen(date);
    if (open && !this.windowOpen) {
      // New window begins.
      this.signingsThisWindow.clear();
      this.refusedPairs.clear();
    }
    this.windowOpen = open;
    if (!open) return;
    // Trade every third day to keep season runtime flat.
    if (date.day % 3 !== 1) return;

    // 1. Build the candidate pool: every player of every club, priced by the
    // seller's own depth chart (surplus cheap, starters at a premium), plus
    // free agents. Charts are computed once per market day per club.
    const charts = new Map<string, ClubDepthChart>();
    for (const clubId of clubIds) charts.set(clubId, this.chartOf(clubId));

    interface PoolEntry {
      player: Player;
      askingFee: number;
      sellerId: string | null;
      sellerRank: SquadRank;
    }
    const pool = new Map<string, PoolEntry>();
    for (const clubId of clubIds) {
      const chart = charts.get(clubId)!;
      for (const player of getSquad(this.world, clubId)) {
        const rank = rankIn(chart, player.id);
        const askingFee =
          Math.round(marketValue(player, date.year) * ASK_MULTIPLIER[rank] * 100) / 100;
        pool.set(player.id, { player, askingFee, sellerId: clubId, sellerRank: rank });
      }
    }
    for (const freeAgent of this.world.freeAgents) {
      pool.set(freeAgent.id, { player: freeAgent, askingFee: 0, sellerId: null, sellerRank: "OUT" });
    }

    // 2-5. Each club may attempt one signing per market day.
    for (const clubId of clubIds) {
      const brain = this.brains.get(clubId);
      if (!brain) continue;
      if ((this.signingsThisWindow.get(clubId) ?? 0) >= MAX_SIGNINGS_PER_WINDOW) continue;

      const candidates: MarketCandidate[] = [];
      for (const entry of pool.values()) {
        if (entry.sellerId === clubId) continue;
        if (this.refusedPairs.has(`${clubId}:${entry.player.id}`)) continue;
        candidates.push({ player: entry.player, askingFee: entry.askingFee });
      }
      candidates.sort((a, b) => compareIds(a.player.id, b.player.id));

      const ctx = this.contextFor(clubId, date);
      const choice = brain.chooseSigning(ctx, candidates);
      if (!choice) continue;
      const entry = pool.get(choice.playerId);
      if (!entry) continue;
      const { player } = entry;

      // 3. Club-to-club negotiation (skipped for free agents).
      if (entry.sellerId) {
        const sellerBrain = this.brains.get(entry.sellerId);
        if (!sellerBrain) continue;
        const sellerCtx = this.contextFor(entry.sellerId, date);
        if (!sellerBrain.respondToOffer(sellerCtx, player, choice.offeredFee)) continue;
      }

      // 4. The player's own decision (requirement 5.5 step 4).
      const fromStrength = entry.sellerId ? this.world.clubsById.get(entry.sellerId)!.strength : 0;
      const proposal: MoveProposal = {
        player,
        fromClubId: entry.sellerId,
        toClubId: clubId,
        currentRank: entry.sellerRank,
        expectedRank: this.expectedRankAt(clubId, player),
        fromClubStrength: fromStrength,
        toClubStrength: this.world.clubsById.get(clubId)!.strength,
        currentWage: player.contract?.annualWage ?? 0,
        offeredWage: wageFor(playerAbility(player)) * 1.1, // signing bump
      };
      const decision = this.playerAgent.decide(proposal);
      if (!decision.accept) {
        this.refusedPairs.add(`${clubId}:${player.id}`);
        this.refusals.push({
          date: `${date.year}-${date.month}-${date.day}`,
          playerId: player.id,
          playerName: player.name,
          fromClubId: entry.sellerId,
          toClubId: clubId,
          reason: decision.reason ?? "OVERALL",
        });
        continue;
      }

      // 5. Execute: fee through the ledger, move, fresh contract.
      if (entry.sellerId && choice.offeredFee > 0) {
        this.world.ledger.record(date, "TRANSFER_FEE", clubId, entry.sellerId, choice.offeredFee, player.id);
      }
      pool.delete(player.id);
      transferPlayer(this.world, player.id, clubId);
      applyTransferMorale(this.world, player.id, entry.sellerId, clubId);
      player.contract = {
        annualWage: Math.round(proposal.offeredWage * 100) / 100,
        endYear: this.seasonEndYear + contractYearsFor(player.age),
      };
      this.signingsThisWindow.set(clubId, (this.signingsThisWindow.get(clubId) ?? 0) + 1);
      this.completed.push({
        date: `${date.year}-${date.month}-${date.day}`,
        playerId: player.id,
        playerName: player.name,
        fromClubId: entry.sellerId,
        toClubId: clubId,
        fee: entry.sellerId ? choice.offeredFee : 0,
      });
    }
  }
}
