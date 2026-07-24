import { fromIso, toIso, type SimDate } from "../core/calendar.js";
import type { SeasonReport } from "../sim/season.js";
import type { World } from "../model/world.js";

/**
 * Unified news feed (requirement 6.1): normalizes the season report's
 * already-existing sub-records (transfers, manager changes, development,
 * titles) into one chronologically-sorted, typed event stream, plus a
 * deliberately modest set of "record" detectors (100th club appearance,
 * first international cap). Broader records (e.g. all-time top scorer,
 * longest unbeaten run) are out of scope — nothing in the current data
 * model tracks the history needed to compute them.
 */
export type NewsEventType =
  | "TRANSFER"
  | "TRANSFER_REFUSED"
  | "MANAGER_SACKED"
  | "MANAGER_HIRED"
  | "RETIREMENT"
  | "TITLE"
  | "RECORD_100_APPS"
  | "FIRST_CAP";

export interface NewsEvent {
  id: string;
  date: string; // ISO
  type: NewsEventType;
  summary: string;
  playerId?: string;
  clubId?: string;
  data: Record<string, unknown>;
}

export function deriveNewsFeed(
  report: SeasonReport,
  world: World,
  prevCaps?: ReadonlyMap<string, number>,
  prevAppearances?: ReadonlyMap<string, number>,
): NewsEvent[] {
  const events: NewsEvent[] = [];
  let seq = 0;
  const push = (
    date: SimDate,
    type: NewsEventType,
    summary: string,
    fields: { playerId?: string; clubId?: string } = {},
    data: Record<string, unknown> = {},
  ): void => {
    seq++;
    events.push({ id: `${type}-${toIso(date)}-${seq}`, date: toIso(date), type, summary, ...fields, data });
  };

  for (const t of report.transfers) {
    const fee = t.fee > 0 ? `£${t.fee.toFixed(1)}M` : "free";
    push(
      fromIso(t.date),
      "TRANSFER",
      `${t.playerName} moves ${t.fromClubId ?? "free agency"} -> ${t.toClubId} (${fee})`,
      { playerId: t.playerId, clubId: t.toClubId },
      { fromClubId: t.fromClubId, toClubId: t.toClubId, fee: t.fee },
    );
  }
  for (const r of report.refusals) {
    push(
      fromIso(r.date),
      "TRANSFER_REFUSED",
      `${r.playerName} turns down ${r.fromClubId ?? "free agency"} -> ${r.toClubId} (${r.reason})`,
      { playerId: r.playerId, clubId: r.toClubId },
      { fromClubId: r.fromClubId, toClubId: r.toClubId, reason: r.reason },
    );
  }

  for (const c of report.managerChanges) {
    const date = fromIso(c.date);
    push(date, "MANAGER_SACKED", `${c.outManagerName} leaves ${c.clubId} (${c.reason})`, { clubId: c.clubId }, { managerId: c.outManagerId, reason: c.reason });
    push(date, "MANAGER_HIRED", `${c.inManagerName} appointed at ${c.clubId}`, { clubId: c.clubId }, { managerId: c.inManagerId });
  }

  for (const retiree of report.development.retiredPlayers) {
    push(
      report.seasonEndDate,
      "RETIREMENT",
      `${retiree.name} retires${retiree.notable ? " (notable career retained in full)" : ""}`,
      { playerId: retiree.id },
      { notable: retiree.notable },
    );
  }

  for (const [leagueId, table] of report.tables) {
    const champion = table.sorted()[0];
    if (champion) {
      push(report.seasonEndDate, "TITLE", `${champion.clubId} win the ${leagueId} title`, { clubId: champion.clubId }, { competition: leagueId });
    }
  }
  if (report.championsLeague?.winnerId) {
    push(report.seasonEndDate, "TITLE", `${report.championsLeague.winnerId} win the Champions League`, { clubId: report.championsLeague.winnerId }, { competition: "UCL" });
  }
  if (report.worldCup?.winnerId) {
    push(report.seasonEndDate, "TITLE", `${report.worldCup.winnerId} win the World Cup`, {}, { competition: "WORLD_CUP" });
  }
  if (report.euro?.winnerId) {
    push(report.seasonEndDate, "TITLE", `${report.euro.winnerId} win EURO`, {}, { competition: "EURO" });
  }

  if (prevAppearances) {
    for (const [playerId, apps] of world.appearancesByPlayer) {
      const before = prevAppearances.get(playerId) ?? 0;
      if (before < 100 && apps >= 100) {
        const player = world.players.find((p) => p.id === playerId);
        const fields = player?.clubId ? { playerId, clubId: player.clubId } : { playerId };
        push(report.seasonEndDate, "RECORD_100_APPS", `${player?.name ?? playerId} reaches 100 career club appearances`, fields, { appearances: apps });
      }
    }
  }
  if (prevCaps) {
    for (const [playerId, caps] of world.capsByPlayer) {
      const before = prevCaps.get(playerId) ?? 0;
      if (before === 0 && caps >= 1) {
        const player = world.players.find((p) => p.id === playerId);
        const fields = player?.clubId ? { playerId, clubId: player.clubId } : { playerId };
        push(report.seasonEndDate, "FIRST_CAP", `${player?.name ?? playerId} earns their first international cap`, fields, { nationality: player?.nationality });
      }
    }
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return events;
}
