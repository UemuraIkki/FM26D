import type { ManagerPolicy } from "../decision/humanDecisionMaker.js";
import { Ledger, type Transaction } from "../finance/ledger.js";
import type { PlayerMorale } from "../morale/morale.js";
import type { PlayerFitness } from "../model/fitness.js";
import type { Manager } from "../model/manager.js";
import type { Club, LeagueData, Player } from "../model/types.js";
import type { RetiredRecord, World } from "../model/world.js";

/**
 * World <-> plain JSON (requirement 6.2/7: SQLite checkpoint snapshots).
 * `playersByClub` and `freeAgents` are NOT serialized separately — per
 * src/model/world.ts's own invariant, they're fully derivable from
 * `players[].clubId`, and rebuilding them on load (rather than persisting
 * parallel copies) keeps object identity correct: every player a club's
 * roster references is the exact same object as in `players`, which a
 * naive JSON round-trip of both arrays would NOT guarantee.
 */
interface SerializedWorld {
  seed: number;
  leagues: LeagueData[];
  players: Player[];
  ledger: { initial: Array<[string, number]>; transactions: Transaction[] };
  moraleByPlayer: Array<[string, PlayerMorale]>;
  atmosphereByClub: Array<[string, number]>;
  managers: Manager[];
  boardConfidence: Array<[string, number]>;
  lastSeasonPositions: Array<[string, string[]]> | null;
  fitnessByPlayer: Array<[string, PlayerFitness]>;
  capsByPlayer: Array<[string, number]>;
  appearancesByPlayer: Array<[string, number]>;
  watchlist: string[];
  retiredArchive: Array<[string, RetiredRecord]>;
  foundedYear: number;
  humanControlledClubId: string | null;
  managerPolicy: ManagerPolicy | null;
}

export function serializeWorld(world: World): string {
  const data: SerializedWorld = {
    seed: world.seed,
    leagues: world.leagues,
    players: world.players,
    ledger: world.ledger.snapshot(),
    moraleByPlayer: [...world.moraleByPlayer],
    atmosphereByClub: [...world.atmosphereByClub],
    managers: world.managers,
    boardConfidence: [...world.boardConfidence],
    lastSeasonPositions: world.lastSeasonPositions ? [...world.lastSeasonPositions] : null,
    fitnessByPlayer: [...world.fitnessByPlayer],
    capsByPlayer: [...world.capsByPlayer],
    appearancesByPlayer: [...world.appearancesByPlayer],
    watchlist: [...world.watchlist],
    retiredArchive: [...world.retiredArchive],
    foundedYear: world.foundedYear,
    humanControlledClubId: world.humanControlledClubId ?? null,
    managerPolicy: world.managerPolicy ?? null,
  };
  return JSON.stringify(data);
}

export function deserializeWorld(json: string): World {
  const data = JSON.parse(json) as SerializedWorld;

  const clubsById = new Map<string, Club>();
  for (const league of data.leagues) for (const club of league.clubs) clubsById.set(club.id, club);

  const playersByClub = new Map<string, Player[]>();
  for (const clubId of clubsById.keys()) playersByClub.set(clubId, []);
  const freeAgents: Player[] = [];
  for (const player of data.players) {
    if (player.clubId === null) freeAgents.push(player);
    else playersByClub.get(player.clubId)!.push(player);
  }

  const world: World = {
    seed: data.seed,
    leagues: data.leagues,
    clubsById,
    players: data.players,
    playersByClub,
    freeAgents,
    ledger: Ledger.restore(data.ledger),
    moraleByPlayer: new Map(data.moraleByPlayer),
    atmosphereByClub: new Map(data.atmosphereByClub),
    managers: data.managers,
    boardConfidence: new Map(data.boardConfidence),
    fitnessByPlayer: new Map(data.fitnessByPlayer),
    capsByPlayer: new Map(data.capsByPlayer),
    appearancesByPlayer: new Map(data.appearancesByPlayer),
    watchlist: new Set(data.watchlist),
    retiredArchive: new Map(data.retiredArchive),
    foundedYear: data.foundedYear,
  };
  if (data.lastSeasonPositions) world.lastSeasonPositions = new Map(data.lastSeasonPositions);
  if (data.humanControlledClubId) world.humanControlledClubId = data.humanControlledClubId;
  if (data.managerPolicy) world.managerPolicy = data.managerPolicy;
  return world;
}
