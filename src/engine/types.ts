/**
 * Match engine public types.
 *
 * The engine is an isolated module (要件: 試合エンジンは独立パッケージ):
 * nothing in `src/engine/` may import from the rest of the sim. It defines its
 * own input shapes and RNG interface so it can later be extracted to its own
 * package or replaced by a Rust/WASM implementation behind the same contract.
 */

export interface EngineRng {
  /** Uniform float in [0, 1). */
  next(): number;
}

export type EnginePosition = "GK" | "DF" | "MF" | "FW";

export interface EnginePlayer {
  id: string;
  position: EnginePosition;
  passing: number;
  shooting: number;
  dribbling: number;
  defending: number;
  aerial: number;
  speed: number;
  stamina: number;
  strength: number;
  agility: number;
  decisions: number;
  positioning: number;
  finishing: number;
  shotStopping: number;
  aerialHandling: number;
  distribution: number;
}

export interface TeamSheet {
  teamId: string;
  /** Starting XI. Exactly one GK expected. */
  players: EnginePlayer[];
}

export type Zone = "DEF" | "MID" | "ATT";

/**
 * Possession phase (requirement 3.3 state: holder, zone, phase).
 * TRANSITION = the moment after winning the ball, defence not yet set
 * (counter-attack window); SETTLED = organized possession.
 */
export type Phase = "SETTLED" | "TRANSITION";

export type MatchEventType =
  | "KICKOFF"
  | "PASS"
  | "DRIBBLE"
  | "LONG_BALL"
  | "SHOT"
  | "GOAL"
  | "SAVE"
  | "TACKLE"
  | "INTERCEPTION"
  | "HALF_TIME"
  | "FULL_TIME";

/** Requirement 3.3: every event is logged with actor, time and outcome. */
export interface MatchEvent {
  tick: number;
  minute: number;
  type: MatchEventType;
  teamId: string;
  playerId?: string;
  /** Opponent involved (defender, goalkeeper, tackler). */
  opponentId?: string;
  /** Receiver of a successful pass / assist provider on goals. */
  assistId?: string;
  zone?: Zone;
  phase?: Phase;
  success?: boolean;
}

export interface TeamMatchStats {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  passesAttempted: number;
  passesCompleted: number;
  possessionTicks: number;
}

export interface MatchResult {
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
  home: TeamMatchStats;
  away: TeamMatchStats;
  events: MatchEvent[];
  /** Requirement 3.3: per-player rating derived from the event log. */
  ratings: Record<string, number>;
}

/**
 * Tunable parameters — central knob set for calibration (requirement 3.4).
 * All biases are on the attribute-point scale and sit inside the logistic
 * slope, exactly as the spec formula prescribes:
 *   P = 1 / (1 + exp(-k × (att − def + bias)))
 */
export interface EngineParams {
  /** Seconds of game time per tick. */
  secondsPerTick: number;
  /** Logistic slope per attribute point. */
  k: number;
  /** Base difficulty per action type (attribute points, at equal ability). */
  passBias: number;
  holdPassBias: number;
  longBallBias: number;
  dribbleBias: number;
  shotBias: number;
  /** Extra effective-ability points for the home side (home advantage). */
  homeAdvantage: number;
  /** Extra attacking points during a TRANSITION phase (counter-attack). */
  transitionBonus: number;
  /** Action weights by zone: [advancePass, holdPass, dribble, longBall, shot] */
  weightsDef: [number, number, number, number, number];
  weightsMid: [number, number, number, number, number];
  weightsAtt: [number, number, number, number, number];
}

export const DEFAULT_PARAMS: EngineParams = {
  secondsPerTick: 7.5,
  k: 0.028,
  passBias: 30.4,
  holdPassBias: 82.1,
  longBallBias: -14.3,
  dribbleBias: 7.1,
  shotBias: -71.5,
  homeAdvantage: 1.6,
  transitionBonus: 6,
  weightsDef: [45, 40, 5, 10, 0],
  weightsMid: [45, 35, 15, 5, 0],
  weightsAtt: [0, 63, 28, 0, 5.6],
};
