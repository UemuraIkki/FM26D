import { loadLeague } from "./loader.js";
import { generateSquad } from "./playerGen.js";
import type { Club, LeagueData, Player } from "./types.js";

/**
 * Persistent world state.
 *
 * - Multi-league from the start (requirement 2.1): `leagues` is a list even
 *   while only the PL is simulated.
 * - Built once and carried across seasons; future phases (transfers,
 *   contracts, morale) mutate it through explicit functions rather than
 *   rebuilding from the seed.
 * - Player ownership has one authoritative field (`player.clubId`); the
 *   per-club index is private to this module and only updated through
 *   `transferPlayer` so the two can never diverge.
 */
export interface World {
  seed: number;
  leagues: LeagueData[];
  clubsById: Map<string, Club>;
  players: Player[];
  /** Derived index — do not mutate outside this module. */
  playersByClub: Map<string, Player[]>;
}

export function buildWorld(seed: number, leaguePaths: readonly string[]): World {
  const leagues: LeagueData[] = [];
  const clubsById = new Map<string, Club>();
  const players: Player[] = [];
  const playersByClub = new Map<string, Player[]>();

  for (const path of leaguePaths) {
    const league = loadLeague(path);
    leagues.push(league);
    for (const club of league.clubs) {
      if (clubsById.has(club.id)) throw new Error(`duplicate club id across leagues: ${club.id}`);
      clubsById.set(club.id, club);
      const squad = generateSquad(seed, club);
      players.push(...squad);
      playersByClub.set(club.id, squad);
    }
  }

  return { seed, leagues, clubsById, players, playersByClub };
}

export function getSquad(world: World, clubId: string): readonly Player[] {
  const squad = world.playersByClub.get(clubId);
  if (!squad) throw new Error(`unknown club: ${clubId}`);
  return squad;
}

/**
 * Atomically move a player between clubs. The only sanctioned way to change
 * ownership — updates `player.clubId` and the club index together.
 */
export function transferPlayer(world: World, playerId: string, toClubId: string): void {
  const player = world.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`unknown player: ${playerId}`);
  const to = world.playersByClub.get(toClubId);
  if (!to) throw new Error(`unknown destination club: ${toClubId}`);
  if (player.clubId === toClubId) return;

  const from = world.playersByClub.get(player.clubId);
  if (from) {
    const idx = from.findIndex((p) => p.id === playerId);
    if (idx >= 0) from.splice(idx, 1);
  }
  player.clubId = toClubId;
  to.push(player);
}
