/** Core world model types (Phase A scope: league, clubs, players). */

export type Position = "GK" | "DF" | "MF" | "FW";

/** Requirement 4.1: 17 attributes, integer 1-99. */
export interface PlayerAttributes {
  // Technical (5)
  passing: number;
  shooting: number;
  dribbling: number;
  defending: number;
  aerial: number;
  // Physical (4)
  speed: number;
  stamina: number;
  strength: number;
  agility: number;
  // Mental (5)
  decisions: number;
  positioning: number;
  finishing: number;
  ambition: number;
  professionalism: number;
  // GK-specific (3)
  shotStopping: number;
  aerialHandling: number;
  distribution: number;
}

export interface Player {
  id: string;
  name: string;
  clubId: string;
  position: Position;
  age: number;
  attributes: PlayerAttributes;
}

export interface Club {
  id: string;
  name: string;
  shortName: string;
  /** Overall squad quality guide, 1-99. Used by the placeholder squad generator. */
  strength: number;
}

export interface LeagueData {
  id: string;
  name: string;
  country: string;
  clubs: Club[];
}

export interface World {
  seed: number;
  league: LeagueData;
  players: Player[];
  playersByClub: Map<string, Player[]>;
}
