import type { EnginePlayer, TeamSheet } from "../engine/index.js";
import type { Player, Position } from "../model/types.js";

/**
 * Pick a starting XI (4-4-2) by simple positional ability.
 * Proper role scores / depth charts arrive in Phase B — the engine only sees
 * the resulting `TeamSheet`, so this can be swapped freely.
 */

const FORMATION: ReadonlyArray<{ position: Position; count: number }> = [
  { position: "GK", count: 1 },
  { position: "DF", count: 4 },
  { position: "MF", count: 4 },
  { position: "FW", count: 2 },
];

function positionalAbility(p: Player): number {
  const a = p.attributes;
  switch (p.position) {
    case "GK":
      return (a.shotStopping * 3 + a.aerialHandling * 2 + a.distribution + a.agility) / 7;
    case "DF":
      return (a.defending * 3 + a.positioning * 2 + a.aerial + a.strength + a.speed) / 8;
    case "MF":
      return (a.passing * 3 + a.decisions * 2 + a.dribbling + a.stamina + a.defending) / 8;
    case "FW":
      return (a.shooting * 2 + a.finishing * 2 + a.speed + a.dribbling + a.positioning) / 7;
  }
}

function toEnginePlayer(p: Player): EnginePlayer {
  return { id: p.id, position: p.position, ...p.attributes };
}

export function selectStartingXI(clubId: string, squad: readonly Player[]): TeamSheet {
  const players: EnginePlayer[] = [];
  for (const { position, count } of FORMATION) {
    const candidates = squad
      .filter((p) => p.position === position)
      .sort((a, b) => positionalAbility(b) - positionalAbility(a) || a.id.localeCompare(b.id));
    if (candidates.length < count) {
      throw new Error(`club ${clubId}: not enough ${position} (${candidates.length}/${count})`);
    }
    for (let i = 0; i < count; i++) players.push(toEnginePlayer(candidates[i] as Player));
  }
  return { teamId: clubId, players };
}
