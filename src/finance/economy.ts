import type { SimDate } from "../core/calendar.js";
import type { ClubDecisionMaker, SquadContext } from "../decision/clubDecisionMaker.js";
import type { StandingRow } from "../league/standings.js";
import type { Formation, RoleBook } from "../model/roles.js";
import { getSquad, releasePlayer, type World } from "../model/world.js";
import { applyRenewalMorale } from "../morale/morale.js";
import { WORLD_ACCOUNT } from "./ledger.js";
import { playerAbility, wageFor } from "./value.js";
import { contractYearsFor } from "../transfer/market.js";

/**
 * Club economy (requirement 5.1): income from tickets and broadcasting,
 * expenditure on wages. All flows go through the world ledger so the
 * conservation test can audit them.
 */

/** Default broadcast payment per club at season start (1 = £1M). */
const BROADCAST_BASE = 100;
/** Merit payment step per final position, scaled by league broadcast level. */
const MERIT_STEP = 3.9;

export function payMonthlyWages(world: World, date: SimDate, clubIds: readonly string[]): void {
  if (date.day !== 1) return;
  for (const clubId of clubIds) {
    let monthly = 0;
    for (const player of getSquad(world, clubId)) {
      if (player.contract) monthly += player.contract.annualWage / 12;
    }
    if (monthly > 0) {
      world.ledger.record(date, "WAGE", clubId, WORLD_ACCOUNT, Math.round(monthly * 100) / 100);
    }
  }
}

export function payTicketIncome(world: World, date: SimDate, homeClubId: string): void {
  const club = world.clubsById.get(homeClubId);
  if (!club) throw new Error(`unknown club: ${homeClubId}`);
  const income = Math.round((0.4 + club.strength * 0.028) * 100) / 100;
  world.ledger.record(date, "TICKET", WORLD_ACCOUNT, homeClubId, income);
}

export function payBroadcastBase(
  world: World,
  date: SimDate,
  clubIds: readonly string[],
  base: number = BROADCAST_BASE,
): void {
  for (const clubId of clubIds) {
    world.ledger.record(date, "BROADCAST", WORLD_ACCOUNT, clubId, base);
  }
}

export function payMeritPayments(
  world: World,
  date: SimDate,
  table: readonly StandingRow[],
  broadcastBase: number = BROADCAST_BASE,
): void {
  const scale = broadcastBase / BROADCAST_BASE;
  table.forEach((row, index) => {
    const amount = Math.round((table.length - index) * MERIT_STEP * scale * 100) / 100;
    world.ledger.record(date, "MERIT", WORLD_ACCOUNT, row.clubId, amount, `pos ${index + 1}`);
  });
}

/**
 * Season-end contract processing (requirement 4.6): contracts running out
 * are renewed if the club still wants the player, otherwise the player
 * leaves on a free (Bosman) into the free-agent pool.
 */
export function processContractExpiries(
  world: World,
  date: SimDate,
  seasonEndYear: number,
  clubIds: readonly string[],
  brains: ReadonlyMap<string, ClubDecisionMaker>,
  roleBook: RoleBook,
  formation: Formation,
): { renewed: number; released: number } {
  let renewed = 0;
  let released = 0;
  for (const clubId of clubIds) {
    const brain = brains.get(clubId);
    const squad = [...getSquad(world, clubId)];
    for (const player of squad) {
      if (!player.contract || player.contract.endYear > seasonEndYear) continue;
      const ctx: SquadContext = {
        squad: getSquad(world, clubId),
        roleBook,
        formation,
        balance: world.ledger.balanceOf(clubId),
        currentYear: date.year,
        club: world.clubsById.get(clubId)!,
      };
      const keep = brain?.wantsToRenew(ctx, player) ?? true;
      if (keep) {
        player.contract = {
          annualWage: wageFor(playerAbility(player)),
          endYear: seasonEndYear + contractYearsFor(player.age),
        };
        applyRenewalMorale(world, player.id);
        renewed++;
      } else {
        releasePlayer(world, player.id);
        released++;
      }
    }
  }
  return { renewed, released };
}
