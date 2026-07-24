import type { SimDate } from "../core/calendar.js";
import { playerAbility } from "../finance/value.js";
import type { TeamSheet } from "../engine/index.js";
import { isAvailable } from "./fitness.js";
import { generateSquad } from "./playerGen.js";
import type { Club, Player, Position } from "./types.js";
import type { World } from "./world.js";

/**
 * National-team call-ups (requirement 2.2/2.3). Real players of the given
 * nationality fill each position band first, ability-ranked; any shortfall
 * is padded with synthetic shadow-world players generated the same way the
 * Champions League fills its abstract-club slots (src/competitions/
 * championsLeague.ts), so a position band is never left empty and
 * `selectStartingXI` never starves for a role.
 */
const CALLUP_QUOTA: ReadonlyArray<{ position: Position; count: number }> = [
  { position: "GK", count: 3 },
  { position: "DF", count: 8 },
  { position: "MF", count: 8 },
  { position: "FW", count: 4 },
];

/** Average ability of a nation's real player pool; the strength backing an
 *  abstract fill squad and used to seed tournament draw pots. */
export function nationStrength(world: World, nationId: string): number {
  let total = 0;
  let count = 0;
  for (const p of world.players) {
    if (p.nationality !== nationId) continue;
    total += playerAbility(p);
    count++;
  }
  return count > 0 ? total / count : 62;
}

export function callUpSquad(world: World, nationId: string, date: SimDate): Player[] {
  const realByPosition = new Map<Position, Player[]>();
  for (const p of world.players) {
    if (p.nationality !== nationId) continue;
    if (!isAvailable(world, p.id, date)) continue;
    const list = realByPosition.get(p.position) ?? [];
    list.push(p);
    realByPosition.set(p.position, list);
  }
  const avgAbility = nationStrength(world, nationId);

  let syntheticSquad: Player[] | null = null;
  const squad: Player[] = [];
  for (const { position, count } of CALLUP_QUOTA) {
    const real = (realByPosition.get(position) ?? []).sort((a, b) => playerAbility(b) - playerAbility(a));
    const chosen = real.slice(0, count);
    squad.push(...chosen);
    if (chosen.length < count) {
      if (!syntheticSquad) {
        const pseudoClub: Club = {
          id: `NAT-${nationId}`,
          name: nationId,
          shortName: nationId,
          strength: Math.max(1, Math.min(99, Math.round(avgAbility))),
        };
        syntheticSquad = generateSquad(world.seed, pseudoClub);
      }
      const fill = syntheticSquad
        .filter((p) => p.position === position)
        .sort((a, b) => playerAbility(b) - playerAbility(a))
        .slice(0, count - chosen.length);
      squad.push(...fill);
    }
  }
  return squad;
}

/** Increment caps for real (tracked) players who started; synthetic fill is skipped. */
export function recordCaps(world: World, sheet: TeamSheet): void {
  for (const p of sheet.players) {
    if (!world.capsByPlayer.has(p.id)) continue;
    world.capsByPlayer.set(p.id, (world.capsByPlayer.get(p.id) ?? 0) + 1);
  }
}
