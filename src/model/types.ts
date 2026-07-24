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

/** Requirement 4.6: wage, duration, free transfers on expiry. */
export interface Contract {
  /** Annual wage in currency units (1 = 1M). */
  annualWage: number;
  /** Season end-year through which the contract runs (e.g. 2028 = until summer 2028). */
  endYear: number;
}

export interface Player {
  id: string;
  name: string;
  /** null = free agent (out of contract). */
  clubId: string | null;
  position: Position;
  age: number;
  attributes: PlayerAttributes;
  contract: Contract | null;
  /** Nation id (data/nationalities.json); drives national-team call-ups. */
  nationality: string;
  /** Ceiling ability (playerAbility scale) a young player can grow toward (requirement 4.3). */
  potential: number;
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
  /** Market value multiplier for players in this league (PL = 1.0). */
  valueCoefficient?: number;
  /** Season-start broadcast payment per club, 1 = £1M (PL = 100). */
  broadcastBase?: number;
  clubs: Club[];
}
