import { deriveRng, type Rng } from "../core/rng.js";
import type { Club } from "./types.js";

/**
 * Manager entity (requirement 5.4): independent of clubs, with attributes,
 * moving through the managerial market on sackings and appointments.
 */

export interface ManagerAttributes {
  /** Match preparation quality — small on-pitch bonus. */
  tactical: number;
  /** Youth development (consumed by the future growth phase). */
  development: number;
  /** Standing in the game; drives hiring order and rises/falls with results. */
  reputation: number;
}

export interface Manager {
  id: string;
  name: string;
  /** null = on the market. */
  clubId: string | null;
  attributes: ManagerAttributes;
}

const FIRST = ["Alex", "Bruno", "Carlo", "Diego", "Erik", "Frank", "Gian", "Hans", "Ivan", "Jose", "Kenny", "Luis", "Marco", "Nuno", "Oliver", "Pep", "Rafa", "Sam", "Thomas", "Unai"];
const LAST = ["Almeida", "Baxter", "Conte", "Dorn", "Esteves", "Ferrer", "Grant", "Hoffmann", "Iborra", "Jansen", "Kovac", "Lampe", "Moreno", "Novak", "Olsen", "Perez", "Quinn", "Ricci", "Silva", "Tanner"];

function clampAttr(v: number): number {
  return Math.max(1, Math.min(99, Math.round(v)));
}

function makeManager(rng: Rng, id: string, baseLevel: number, clubId: string | null): Manager {
  return {
    id,
    name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
    clubId,
    attributes: {
      tactical: clampAttr(baseLevel + rng.gaussian(0, 6)),
      development: clampAttr(baseLevel + rng.gaussian(0, 8)),
      reputation: clampAttr(baseLevel + rng.gaussian(0, 5)),
    },
  };
}

/** One manager per club (level tracks club stature) plus a free-agent pool. */
export function generateManagers(worldSeed: number, clubs: readonly Club[], freePoolSize = 12): Manager[] {
  const managers: Manager[] = [];
  for (const club of clubs) {
    const rng = deriveRng(worldSeed, `manager:${club.id}`);
    managers.push(makeManager(rng, `MGR-${club.id}`, club.strength, club.id));
  }
  const poolRng = deriveRng(worldSeed, "manager:pool");
  for (let i = 0; i < freePoolSize; i++) {
    // Market levels span journeymen to proven names.
    const level = 55 + poolRng.int(0, 30);
    managers.push(makeManager(poolRng, `MGR-FREE-${String(i + 1).padStart(2, "0")}`, level, null));
  }
  return managers;
}
