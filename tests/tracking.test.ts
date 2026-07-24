import { describe, expect, it } from "vitest";
import { addToWatchlist, feedForWatchlist, removeFromWatchlist, watchedPlayerStatus, watchlistStatuses } from "../src/observe/tracking.js";
import { purgeExpiredArchives, retirePlayer } from "../src/model/world.js";
import { deriveNewsFeed } from "../src/observe/newsFeed.js";
import { buildWorld, getSquad } from "../src/model/world.js";
import { runSeason } from "../src/sim/season.js";

const LEAGUE_PATH = "data/leagues/premier-league.json";

describe("watchlist (requirement 6.3)", () => {
  it("adds, lists and removes a watched player", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    const player = getSquad(world, "LIV")[0]!;

    addToWatchlist(world, player.id);
    expect(world.watchlist.has(player.id)).toBe(true);
    expect(watchedPlayerStatus(world, player.id)?.player?.id).toBe(player.id);
    expect(watchlistStatuses(world).map((s) => s.playerId)).toContain(player.id);

    removeFromWatchlist(world, player.id);
    expect(world.watchlist.has(player.id)).toBe(false);
    expect(watchedPlayerStatus(world, player.id)).toBeNull();
  });

  it("rejects watching an unknown player", () => {
    const world = buildWorld(1, [LEAGUE_PATH]);
    expect(() => addToWatchlist(world, "nope")).toThrow();
  });

  it("keeps tracking a watched player after retirement, reading from the archive", () => {
    const world = buildWorld(2, [LEAGUE_PATH]);
    const player = getSquad(world, "ARS")[0]!;
    addToWatchlist(world, player.id);

    retirePlayer(world, player.id, 2027);
    const status = watchedPlayerStatus(world, player.id);
    expect(status).not.toBeNull();
    expect(status!.player).toBeUndefined();
    expect(status!.archived?.aggregate.name).toBe(player.name);
  });

  it("filters a news feed down to watched players only", () => {
    const world = buildWorld(3, [LEAGUE_PATH]);
    const report = runSeason(world, { startYear: 2026, keepMatches: false });
    const events = deriveNewsFeed(report, world);
    const someTransferee = report.transfers[0]?.playerId;
    expect(someTransferee).toBeDefined();

    world.watchlist.add(someTransferee!);
    const filtered = feedForWatchlist(events, world);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((e) => e.playerId === someTransferee)).toBe(true);
  });
});

describe("retention archive (requirement 6.4)", () => {
  it("classifies notability by club appearances or international caps", () => {
    const world = buildWorld(4, [LEAGUE_PATH]);
    const veteran = getSquad(world, "CHE")[0]!;
    world.appearancesByPlayer.set(veteran.id, 150);
    const capped = getSquad(world, "CHE")[1]!;
    world.capsByPlayer.set(capped.id, 3);
    const journeyman = getSquad(world, "CHE")[2]!;
    world.appearancesByPlayer.set(journeyman.id, 5);
    world.capsByPlayer.set(journeyman.id, 0);

    retirePlayer(world, veteran.id, 2027);
    retirePlayer(world, capped.id, 2027);
    retirePlayer(world, journeyman.id, 2027);

    expect(world.retiredArchive.get(veteran.id)!.notable).toBe(true);
    expect(world.retiredArchive.get(capped.id)!.notable).toBe(true);
    expect(world.retiredArchive.get(journeyman.id)!.notable).toBe(false);
  });

  it("purges detail for non-notable retirees five years after retirement, keeps the aggregate", () => {
    const world = buildWorld(5, [LEAGUE_PATH]);
    const journeyman = getSquad(world, "MCI")[0]!;
    world.appearancesByPlayer.set(journeyman.id, 5);
    retirePlayer(world, journeyman.id, 2027);

    purgeExpiredArchives(world, 2030); // 3 years later — too soon
    expect(world.retiredArchive.get(journeyman.id)!.detail).toBeDefined();

    purgeExpiredArchives(world, 2032); // 5 years later — purge
    const record = world.retiredArchive.get(journeyman.id)!;
    expect(record.detail).toBeUndefined();
    expect(record.aggregate.name).toBe(journeyman.name);
  });

  it("keeps notable retirees' detail forever", () => {
    const world = buildWorld(6, [LEAGUE_PATH]);
    const star = getSquad(world, "TOT")[0]!;
    world.capsByPlayer.set(star.id, 10);
    retirePlayer(world, star.id, 2027);

    purgeExpiredArchives(world, 2050); // 23 years later
    expect(world.retiredArchive.get(star.id)!.detail).toBeDefined();
  });
});
