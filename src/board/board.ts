import type { SimDate } from "../core/calendar.js";
import { toIso } from "../core/calendar.js";
import { compareIds } from "../core/rng.js";
import type { StandingRow } from "../league/standings.js";
import type { Manager } from "../model/manager.js";
import type { World } from "../model/world.js";

/**
 * Board model (requirement 5.2): confidence in the manager is computed from
 * the gap between expected position (squad stature) and actual results, and
 * the manager is dismissed below a threshold. Sacked managers return to the
 * market; the club appoints the best available name (requirement 5.4).
 */

export interface ManagerChange {
  date: string;
  clubId: string;
  outManagerId: string;
  outManagerName: string;
  inManagerId: string;
  inManagerName: string;
  reason: "MID_SEASON_SACKING" | "END_OF_SEASON";
}

const CONFIDENCE_START = 55;
const SACK_THRESHOLD = 25;
/** No sackings before this many league matches (new-season patience). */
const MIN_MATCHES_BEFORE_SACK = 8;
/** End-of-season dismissal when final position misses expectation by this much. */
const SEASON_MISS_LIMIT = 6;

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

export function managerOf(world: World, clubId: string): Manager {
  const manager = world.managers.find((m) => m.clubId === clubId);
  if (!manager) throw new Error(`club has no manager: ${clubId}`);
  return manager;
}

export function boardConfidenceOf(world: World, clubId: string): number {
  const value = world.boardConfidence.get(clubId);
  if (value === undefined) throw new Error(`no board confidence for club: ${clubId}`);
  return value;
}

/** Expected league position by squad stature (1 = strongest), ties by id. */
export function expectedPositions(world: World, clubIds: readonly string[]): Map<string, number> {
  const sorted = [...clubIds].sort((a, b) => {
    const sa = world.clubsById.get(a)!.strength;
    const sb = world.clubsById.get(b)!.strength;
    return sb - sa || compareIds(a, b);
  });
  const expected = new Map<string, number>();
  sorted.forEach((clubId, index) => expected.set(clubId, index + 1));
  return expected;
}

/** Small on-pitch effect of the manager's tactical quality, capped at ±2%. */
export function managerMultiplier(world: World, clubId: string): number {
  const manager = world.managers.find((m) => m.clubId === clubId);
  if (!manager) return 1;
  const effect = ((manager.attributes.tactical - 60) / 40) * 0.02;
  return 1 + Math.max(-0.02, Math.min(0.02, effect));
}

export class BoardSystem {
  readonly changes: ManagerChange[] = [];
  private expected: Map<string, number>;

  constructor(
    private readonly world: World,
    private readonly clubIds: readonly string[],
  ) {
    this.expected = expectedPositions(world, clubIds);
    for (const clubId of clubIds) {
      if (!world.boardConfidence.has(clubId)) {
        world.boardConfidence.set(clubId, CONFIDENCE_START);
      }
    }
  }

  /** Update confidence after a club's match, then check for a sacking. */
  reviewAfterMatch(
    date: SimDate,
    clubId: string,
    outcome: "WIN" | "DRAW" | "LOSS",
    table: readonly StandingRow[],
  ): void {
    const actualPos = table.findIndex((row) => row.clubId === clubId) + 1;
    const played = table.find((row) => row.clubId === clubId)?.played ?? 0;
    const expectedPos = this.expected.get(clubId) ?? this.clubIds.length / 2;
    const positionDelta = expectedPos - actualPos; // positive = overperforming

    const resultDelta = outcome === "WIN" ? 2 : outcome === "DRAW" ? -0.5 : -2.5;
    let confidence = boardConfidenceOf(this.world, clubId) + resultDelta + 0.15 * positionDelta;

    // A lost dressing room (average squad trust) leaks confidence too.
    const squad = this.world.playersByClub.get(clubId) ?? [];
    if (squad.length > 0) {
      let trustSum = 0;
      for (const p of squad) trustSum += this.world.moraleByPlayer.get(p.id)?.trust ?? 55;
      if (trustSum / squad.length < 40) confidence -= 0.5;
    }
    this.world.boardConfidence.set(clubId, clamp(confidence));

    if (played >= MIN_MATCHES_BEFORE_SACK && clamp(confidence) <= SACK_THRESHOLD) {
      this.replaceManager(date, clubId, "MID_SEASON_SACKING");
    }
  }

  /** Final review: reputations move with the season, big misses cost the job. */
  reviewSeasonEnd(date: SimDate, table: readonly StandingRow[]): void {
    for (const clubId of this.clubIds) {
      const actualPos = table.findIndex((row) => row.clubId === clubId) + 1;
      const expectedPos = this.expected.get(clubId) ?? this.clubIds.length / 2;
      const delta = expectedPos - actualPos;
      const manager = this.world.managers.find((m) => m.clubId === clubId);
      if (!manager) continue;
      manager.attributes.reputation = clamp(
        manager.attributes.reputation + Math.max(-6, Math.min(6, delta * 0.8)),
      );
      if (delta <= -SEASON_MISS_LIMIT) {
        this.replaceManager(date, clubId, "END_OF_SEASON");
      }
    }
  }

  private replaceManager(date: SimDate, clubId: string, reason: ManagerChange["reason"]): void {
    const outgoing = managerOf(this.world, clubId);

    // Requirement 5.4: the sacked manager re-enters the market, bruised.
    outgoing.clubId = null;
    outgoing.attributes.reputation = clamp(outgoing.attributes.reputation - 5);

    // Hire the biggest available name (deterministic tie-break) — never the
    // manager who was just shown the door.
    const candidates = this.world.managers
      .filter((m) => m.clubId === null && m.id !== outgoing.id)
      .sort((a, b) => b.attributes.reputation - a.attributes.reputation || compareIds(a.id, b.id));
    const incoming = candidates[0];
    if (!incoming) {
      // Empty market: the outgoing manager stays after all.
      outgoing.clubId = clubId;
      return;
    }
    incoming.clubId = clubId;
    this.world.boardConfidence.set(clubId, CONFIDENCE_START);

    // New-manager bounce: the dressing room resets behind the appointment.
    for (const player of this.world.playersByClub.get(clubId) ?? []) {
      const state = this.world.moraleByPlayer.get(player.id);
      if (!state) continue;
      state.trust = Math.max(state.trust, 55);
      state.morale = clamp(state.morale + 3);
    }
    const atmosphere = this.world.atmosphereByClub.get(clubId);
    if (atmosphere !== undefined) this.world.atmosphereByClub.set(clubId, clamp(atmosphere + 5));

    this.changes.push({
      date: toIso(date),
      clubId,
      outManagerId: outgoing.id,
      outManagerName: outgoing.name,
      inManagerId: incoming.id,
      inManagerName: incoming.name,
      reason,
    });
  }
}
