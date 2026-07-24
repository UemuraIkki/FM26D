import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Rng } from "../core/rng.js";

/**
 * Named nations for player nationality assignment and national-team call-ups
 * (requirement 2.2/4.5). Weight drives the procedural distribution — biased
 * toward the five simulated leagues' host countries, with a realistic mix of
 * other footballing nations. Countries outside this list are shadow-world
 * (requirement 2.3) and only appear as abstract tournament entrants.
 */
export interface NationInfo {
  id: string;
  name: string;
  confederation: string;
  weight: number;
}

interface NationalitiesConfig {
  nations: NationInfo[];
}

let cachedConfig: NationalitiesConfig | null = null;

export function loadNationalities(path = "data/nationalities.json"): NationalitiesConfig {
  if (!cachedConfig) {
    cachedConfig = JSON.parse(readFileSync(resolve(path), "utf8")) as NationalitiesConfig;
  }
  return cachedConfig;
}

export function nationIds(): string[] {
  return loadNationalities().nations.map((n) => n.id);
}

/** Weighted draw of a nationality for procedural player generation. */
export function pickNationality(rng: Rng): string {
  const { nations } = loadNationalities();
  const idx = rng.weightedIndex(nations.map((n) => n.weight));
  return nations[idx]!.id;
}
