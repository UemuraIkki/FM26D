import { deriveRng } from "../core/rng.js";
import { Ledger } from "../finance/ledger.js";
import { growthPotential, playerAbility, wageFor } from "../finance/value.js";
import type { PlayerMorale } from "../morale/morale.js";
import { initialFitness, type PlayerFitness } from "./fitness.js";
import { generateManagers, type Manager } from "./manager.js";
import { loadLeague } from "./loader.js";
import { pickNationality } from "./nationality.js";
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
  /** Out-of-contract players available on a free (requirement 4.6). */
  freeAgents: Player[];
  /** All money movement (requirement 5.1); one account per club. */
  ledger: Ledger;
  /** Morale state per player (requirement 4.7). */
  moraleByPlayer: Map<string, PlayerMorale>;
  /** Team atmosphere per club, 0-100 (requirement 4.7). */
  atmosphereByClub: Map<string, number>;
  /** Manager entities incl. the out-of-work market pool (requirement 5.4). */
  managers: Manager[];
  /** Board confidence in the current manager per club (requirement 5.2). */
  boardConfidence: Map<string, number>;
  /** Final club order per league from the previous season (CL qualification). */
  lastSeasonPositions?: Map<string, string[]>;
  /** Fitness/injury state per player (requirement 4.4). */
  fitnessByPlayer: Map<string, PlayerFitness>;
  /** International caps per player (requirement 6.4 groundwork). */
  capsByPlayer: Map<string, number>;
  /** Calendar year world creation; used to seed contract end-years. */
  foundedYear: number;
}

export function buildWorld(seed: number, leaguePaths: readonly string[], foundedYear = 2026): World {
  const leagues: LeagueData[] = [];
  const clubsById = new Map<string, Club>();
  const players: Player[] = [];
  const playersByClub = new Map<string, Player[]>();
  const ledger = new Ledger();
  const moraleByPlayer = new Map<string, PlayerMorale>();
  const atmosphereByClub = new Map<string, number>();
  const fitnessByPlayer = new Map<string, PlayerFitness>();
  const capsByPlayer = new Map<string, number>();

  for (const path of leaguePaths) {
    const league = loadLeague(path);
    leagues.push(league);
    for (const club of league.clubs) {
      if (clubsById.has(club.id)) throw new Error(`duplicate club id across leagues: ${club.id}`);
      clubsById.set(club.id, club);
      const squad = generateSquad(seed, club);
      const contractRng = deriveRng(seed, `contracts:${club.id}`);
      const moraleRng = deriveRng(seed, `morale:${club.id}`);
      const nationalityRng = deriveRng(seed, `nationality:${club.id}`);
      const potentialRng = deriveRng(seed, `potential:${club.id}`);
      for (const player of squad) {
        const ability = playerAbility(player);
        player.contract = {
          annualWage: wageFor(ability),
          endYear: foundedYear + contractRng.int(1, 4),
        };
        player.nationality = pickNationality(nationalityRng);
        player.potential = growthPotential(ability, player.age, potentialRng);
        moraleByPlayer.set(player.id, {
          morale: 55 + moraleRng.int(0, 15),
          satisfaction: 55 + moraleRng.int(0, 10),
          trust: 50 + moraleRng.int(0, 10),
          benchStreak: 0,
        });
        fitnessByPlayer.set(player.id, initialFitness());
        capsByPlayer.set(player.id, 0);
      }
      players.push(...squad);
      playersByClub.set(club.id, squad);
      atmosphereByClub.set(club.id, 55 + deriveRng(seed, `atmosphere:${club.id}`).int(0, 10));
      // Initial cash reserves scale with club stature.
      ledger.openAccount(club.id, Math.round(20 + club.strength * 1.5));
    }
  }

  const managers = generateManagers(seed, [...clubsById.values()]);

  return {
    seed,
    leagues,
    clubsById,
    players,
    playersByClub,
    freeAgents: [],
    ledger,
    moraleByPlayer,
    atmosphereByClub,
    managers,
    boardConfidence: new Map(),
    fitnessByPlayer,
    capsByPlayer,
    foundedYear,
  };
}

export function getSquad(world: World, clubId: string): readonly Player[] {
  const squad = world.playersByClub.get(clubId);
  if (!squad) throw new Error(`unknown club: ${clubId}`);
  return squad;
}

/**
 * Atomically move a player between clubs (or from the free-agent pool).
 * The only sanctioned way to change ownership — updates `player.clubId`,
 * the club index and the free-agent pool together.
 */
export function transferPlayer(world: World, playerId: string, toClubId: string): void {
  const player = world.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`unknown player: ${playerId}`);
  const to = world.playersByClub.get(toClubId);
  if (!to) throw new Error(`unknown destination club: ${toClubId}`);
  if (player.clubId === toClubId) return;

  if (player.clubId === null) {
    const idx = world.freeAgents.findIndex((p) => p.id === playerId);
    if (idx >= 0) world.freeAgents.splice(idx, 1);
  } else {
    const from = world.playersByClub.get(player.clubId);
    if (from) {
      const idx = from.findIndex((p) => p.id === playerId);
      if (idx >= 0) from.splice(idx, 1);
    }
  }
  player.clubId = toClubId;
  to.push(player);
}

/** Release a player into the free-agent pool (contract expiry / mutual termination). */
export function releasePlayer(world: World, playerId: string): void {
  const player = world.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`unknown player: ${playerId}`);
  if (player.clubId === null) return;
  const from = world.playersByClub.get(player.clubId);
  if (from) {
    const idx = from.findIndex((p) => p.id === playerId);
    if (idx >= 0) from.splice(idx, 1);
  }
  player.clubId = null;
  player.contract = null;
  world.freeAgents.push(player);
}

/**
 * Permanently remove a player (retirement, requirement 4.3) — distinct from
 * `releasePlayer`, which keeps them signable as a free agent. Cleans up
 * every per-player map alongside the roster/free-agent indices so nothing
 * dangling survives a retiree.
 */
export function retirePlayer(world: World, playerId: string): void {
  const idx = world.players.findIndex((p) => p.id === playerId);
  if (idx < 0) throw new Error(`unknown player: ${playerId}`);
  const player = world.players[idx]!;
  if (player.clubId !== null) {
    const squad = world.playersByClub.get(player.clubId);
    if (squad) {
      const sIdx = squad.findIndex((p) => p.id === playerId);
      if (sIdx >= 0) squad.splice(sIdx, 1);
    }
  } else {
    const fIdx = world.freeAgents.findIndex((p) => p.id === playerId);
    if (fIdx >= 0) world.freeAgents.splice(fIdx, 1);
  }
  world.players.splice(idx, 1);
  world.moraleByPlayer.delete(playerId);
  world.fitnessByPlayer.delete(playerId);
  world.capsByPlayer.delete(playerId);
}
