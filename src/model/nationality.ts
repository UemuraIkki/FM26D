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

const NAME_ALIASES: Record<string, string> = {
  usa: "united states",
  "united states of america": "united states",
  "republic of korea": "south korea",
  "ivory coast": "côte d'ivoire",
};

/**
 * Map a plain country name (e.g. from real roster data, requirement 8) to
 * this project's nation id where recognized (data/nationalities.json).
 * Countries outside that list (most of the world — it only names the big
 * five leagues' host countries plus a curated set of footballing nations)
 * are returned unchanged: those players simply aren't eligible for the
 * simulated national-team call-ups (src/model/nationalTeam.ts), the same
 * as any shadow-world nationality.
 */
export function mapCountryNameToCode(countryName: string): string {
  const { nations } = loadNationalities();
  const key = NAME_ALIASES[countryName.toLowerCase()] ?? countryName.toLowerCase();
  const match = nations.find((n) => n.name.toLowerCase() === key);
  return match?.id ?? countryName;
}
