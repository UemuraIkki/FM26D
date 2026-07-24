import { playerAbility } from "../finance/value.js";
import type { Player } from "../model/types.js";
import type { RetiredRecord, World } from "../model/world.js";
import type { NewsEvent } from "./newsFeed.js";

/**
 * Watch-list registration and career tracking (requirement 6.3). A watched
 * player's status can be read whether they're currently active or already
 * archived (requirement 6.4) — retirement doesn't drop them off the list.
 */
export function addToWatchlist(world: World, playerId: string): void {
  const active = world.players.some((p) => p.id === playerId);
  const archived = world.retiredArchive.has(playerId);
  if (!active && !archived) throw new Error(`unknown player: ${playerId}`);
  world.watchlist.add(playerId);
}

export function removeFromWatchlist(world: World, playerId: string): void {
  world.watchlist.delete(playerId);
}

export interface WatchedPlayerStatus {
  playerId: string;
  player?: Player;
  ability?: number;
  archived?: RetiredRecord;
  apps: number;
  caps: number;
}

export function watchedPlayerStatus(world: World, playerId: string): WatchedPlayerStatus | null {
  if (!world.watchlist.has(playerId)) return null;
  const player = world.players.find((p) => p.id === playerId);
  const archived = world.retiredArchive.get(playerId);
  return {
    playerId,
    ...(player ? { player, ability: playerAbility(player) } : {}),
    ...(archived ? { archived } : {}),
    apps: player ? (world.appearancesByPlayer.get(playerId) ?? 0) : (archived?.aggregate.clubApps ?? 0),
    caps: player ? (world.capsByPlayer.get(playerId) ?? 0) : (archived?.aggregate.caps ?? 0),
  };
}

export function watchlistStatuses(world: World): WatchedPlayerStatus[] {
  return [...world.watchlist]
    .map((id) => watchedPlayerStatus(world, id))
    .filter((s): s is WatchedPlayerStatus => s !== null);
}

/** Career-tracking feed: news events touching any currently-watched player. */
export function feedForWatchlist(events: readonly NewsEvent[], world: World): NewsEvent[] {
  return events.filter((e) => e.playerId !== undefined && world.watchlist.has(e.playerId));
}
