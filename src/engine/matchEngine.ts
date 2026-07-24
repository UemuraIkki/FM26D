import type {
  EnginePlayer,
  EngineParams,
  EngineRng,
  MatchEvent,
  MatchResult,
  Phase,
  TeamMatchStats,
  TeamSheet,
  Zone,
} from "./types.js";
import { DEFAULT_PARAMS } from "./types.js";
import { computeRatings } from "./ratings.js";

/**
 * Possession-chain Markov match engine (requirement 3.3).
 * State: (ball-holding player, zone, phase). One tick is ~7.5s of game time.
 * Every action resolves with the unified logistic from the spec:
 *   P(success) = 1 / (1 + exp(-k × (att − def + bias)))
 * where `bias` (attribute-point scale) folds in the action's base difficulty,
 * home advantage and the transition-phase bonus.
 */

const ACTIONS = ["ADVANCE_PASS", "HOLD_PASS", "DRIBBLE", "LONG_BALL", "SHOT"] as const;
type Action = (typeof ACTIONS)[number];

interface SideState {
  sheet: TeamSheet;
  gk: EnginePlayer;
  outfield: EnginePlayer[];
  byLine: Record<"DF" | "MF" | "FW", EnginePlayer[]>;
  stats: TeamMatchStats;
  homeBonus: number;
}

function emptyStats(): TeamMatchStats {
  return { goals: 0, shots: 0, shotsOnTarget: 0, passesAttempted: 0, passesCompleted: 0, possessionTicks: 0 };
}

function validateSheet(sheet: TeamSheet): void {
  if (sheet.players.length !== 11) {
    throw new Error(`team ${sheet.teamId}: expected 11 players, got ${sheet.players.length}`);
  }
  const gks = sheet.players.filter((p) => p.position === "GK");
  if (gks.length !== 1) {
    throw new Error(`team ${sheet.teamId}: expected exactly 1 GK, got ${gks.length}`);
  }
  const ids = new Set(sheet.players.map((p) => p.id));
  if (ids.size !== 11) throw new Error(`team ${sheet.teamId}: duplicate player ids`);
}

function validateParams(params: EngineParams): void {
  if (!(params.secondsPerTick > 0)) throw new Error(`secondsPerTick must be > 0`);
  if (!(params.k > 0)) throw new Error(`k must be > 0`);
  for (const weights of [params.weightsDef, params.weightsMid, params.weightsAtt]) {
    let total = 0;
    for (const w of weights) {
      if (!(w >= 0) || !Number.isFinite(w)) throw new Error(`action weights must be finite and >= 0`);
      total += w;
    }
    if (total <= 0) throw new Error(`action weights must sum to > 0`);
  }
}

function makeSide(sheet: TeamSheet, homeBonus: number): SideState {
  validateSheet(sheet);
  const gk = sheet.players.find((p) => p.position === "GK") as EnginePlayer;
  const outfield = sheet.players.filter((p) => p !== gk);
  return {
    sheet,
    gk,
    outfield,
    byLine: {
      DF: outfield.filter((p) => p.position === "DF"),
      MF: outfield.filter((p) => p.position === "MF"),
      FW: outfield.filter((p) => p.position === "FW"),
    },
    stats: emptyStats(),
    homeBonus,
  };
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function pickFrom(rng: EngineRng, players: readonly EnginePlayer[]): EnginePlayer {
  if (players.length === 0) throw new Error("no players to pick from");
  return players[Math.floor(rng.next() * players.length)] as EnginePlayer;
}

/** Candidates excluding one player (never pass to yourself). */
function excluding(players: readonly EnginePlayer[], player: EnginePlayer): EnginePlayer[] {
  const rest = players.filter((p) => p.id !== player.id);
  return rest.length > 0 ? rest : [...players];
}

/** Line that presses the ball holder, from the defending side's perspective. */
function pressingLine(defending: SideState, zone: Zone): EnginePlayer[] {
  // Attacker in own DEF zone is pressed by opponent FWs, in MID by MFs, in ATT by DFs.
  const line = zone === "DEF" ? defending.byLine.FW : zone === "MID" ? defending.byLine.MF : defending.byLine.DF;
  return line.length > 0 ? line : defending.outfield;
}

/** Receiver candidates for an advancing pass from `zone`. */
function receiverPool(side: SideState, zone: Zone): EnginePlayer[] {
  const pool = zone === "DEF" ? side.byLine.MF : side.byLine.FW;
  return pool.length > 0 ? pool : side.outfield;
}

function advanceZone(zone: Zone): Zone {
  return zone === "DEF" ? "MID" : "ATT";
}

/** Zone as seen by the side that just won the ball (mirror). */
function mirrorZone(zone: Zone): Zone {
  return zone === "DEF" ? "ATT" : zone === "ATT" ? "DEF" : "MID";
}

function chooseAction(rng: EngineRng, params: EngineParams, zone: Zone): Action {
  const weights = zone === "DEF" ? params.weightsDef : zone === "MID" ? params.weightsMid : params.weightsAtt;
  let total = 0;
  for (const w of weights) total += w;
  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i] as number;
    if (r < 0) return ACTIONS[i] as Action;
  }
  return "HOLD_PASS";
}

export function simulateMatch(
  home: TeamSheet,
  away: TeamSheet,
  rng: EngineRng,
  paramsIn?: Partial<EngineParams>,
): MatchResult {
  const params: EngineParams = { ...DEFAULT_PARAMS, ...paramsIn };
  validateParams(params);
  const totalTicks = Math.round((90 * 60) / params.secondsPerTick);
  const halfTick = Math.floor(totalTicks / 2);

  const sides: [SideState, SideState] = [makeSide(home, params.homeAdvantage), makeSide(away, 0)];
  const events: MatchEvent[] = [];

  let possession = 0; // index into sides
  let zone: Zone = "MID";
  let holder!: EnginePlayer;
  let lastPasser: EnginePlayer | null = null;
  // Phase lives in an object property: closures (turnover/kickoff) mutate it,
  // which TypeScript's narrowing would otherwise not track on a plain let.
  const state: { phase: Phase } = { phase: "SETTLED" };

  const minuteOf = (tick: number): number => Math.min(90, Math.floor((tick * params.secondsPerTick) / 60) + 1);

  const log = (tick: number, e: Omit<MatchEvent, "tick" | "minute">): void => {
    events.push({ tick, minute: minuteOf(tick), ...e });
  };

  /** Turnover: possession flips, winner starts a transition (counter-attack window). */
  const turnover = (winner: EnginePlayer, newZone: Zone): void => {
    possession = 1 - possession;
    zone = newZone;
    holder = winner;
    lastPasser = null;
    state.phase = "TRANSITION";
  };

  const kickoff = (tick: number, toSide: number): void => {
    possession = toSide;
    zone = "MID";
    state.phase = "SETTLED";
    const mfs = sides[toSide]!.byLine.MF;
    holder = pickFrom(rng, mfs.length ? mfs : sides[toSide]!.outfield);
    lastPasser = null;
    log(tick, { type: "KICKOFF", teamId: sides[toSide]!.sheet.teamId, playerId: holder.id, zone, phase: state.phase });
  };

  kickoff(0, 0);

  for (let tick = 0; tick < totalTicks; tick++) {
    if (tick === halfTick) {
      log(tick, { type: "HALF_TIME", teamId: sides[0].sheet.teamId });
      kickoff(tick, 1); // away kicks off the second half
    }

    const att = sides[possession]!;
    const def = sides[1 - possession]!;
    att.stats.possessionTicks++;

    const action = chooseAction(rng, params, zone);
    // Transition phase: the defence is not set, attacking actions get a bonus,
    // and the phase settles after this action resolves.
    const phaseBonus = state.phase === "TRANSITION" ? params.transitionBonus : 0;
    const bonus = att.homeBonus - def.homeBonus + phaseBonus;
    const actionPhase = state.phase;
    state.phase = "SETTLED";

    const resolve = (attAbility: number, defAbility: number, bias: number): boolean => {
      const p = logistic(params.k * (attAbility - defAbility + bias + bonus));
      return rng.next() < p;
    };

    switch (action) {
      case "ADVANCE_PASS":
      case "HOLD_PASS": {
        const isAdvance = action === "ADVANCE_PASS";
        const pressers = pressingLine(def, zone);
        const presser = pickFrom(rng, pressers);
        const defAbility = (presser.defending + presser.positioning) / 2;
        const attAbility = (holder.passing + holder.decisions) / 2;
        att.stats.passesAttempted++;
        if (resolve(attAbility, defAbility, isAdvance ? params.passBias : params.holdPassBias)) {
          const nextZone: Zone = isAdvance ? advanceZone(zone) : zone;
          const receiver = pickFrom(rng, excluding(isAdvance ? receiverPool(att, zone) : att.outfield, holder));
          att.stats.passesCompleted++;
          log(tick, { type: "PASS", teamId: att.sheet.teamId, playerId: holder.id, assistId: receiver.id, zone, phase: actionPhase, success: true });
          lastPasser = holder;
          holder = receiver;
          zone = nextZone;
        } else {
          log(tick, { type: "PASS", teamId: att.sheet.teamId, playerId: holder.id, opponentId: presser.id, zone, phase: actionPhase, success: false });
          log(tick, { type: "INTERCEPTION", teamId: def.sheet.teamId, playerId: presser.id, zone: mirrorZone(zone), success: true });
          turnover(presser, mirrorZone(zone));
        }
        break;
      }
      case "LONG_BALL": {
        // Contested at the destination: the opponent's defensive line challenges
        // the target forward, not the presser at the origin.
        const attAbility = (holder.passing + holder.decisions) / 2;
        const target = pickFrom(rng, excluding(att.byLine.FW.length ? att.byLine.FW : att.outfield, holder));
        const defenders = def.byLine.DF.length ? def.byLine.DF : def.outfield;
        const marker = pickFrom(rng, defenders);
        const duel = (target.aerial + target.strength) / 2 - (marker.aerial + marker.positioning) / 2;
        att.stats.passesAttempted++;
        if (resolve((attAbility - 50) * 0.4 + duel + 50, 50, params.longBallBias)) {
          att.stats.passesCompleted++;
          log(tick, { type: "LONG_BALL", teamId: att.sheet.teamId, playerId: holder.id, assistId: target.id, zone, phase: actionPhase, success: true });
          lastPasser = holder;
          holder = target;
          zone = "ATT";
        } else {
          log(tick, { type: "LONG_BALL", teamId: att.sheet.teamId, playerId: holder.id, opponentId: marker.id, zone, phase: actionPhase, success: false });
          // The marker wins the ball deep in their own defensive zone.
          turnover(marker, "DEF");
        }
        break;
      }
      case "DRIBBLE": {
        const pressers = pressingLine(def, zone);
        const presser = pickFrom(rng, pressers);
        const attAbility = (holder.dribbling + holder.agility + holder.speed) / 3;
        const tacklerAbility = (presser.defending + presser.speed) / 2;
        if (resolve(attAbility, tacklerAbility, params.dribbleBias)) {
          log(tick, { type: "DRIBBLE", teamId: att.sheet.teamId, playerId: holder.id, opponentId: presser.id, zone, phase: actionPhase, success: true });
          zone = advanceZone(zone);
        } else {
          log(tick, { type: "DRIBBLE", teamId: att.sheet.teamId, playerId: holder.id, opponentId: presser.id, zone, phase: actionPhase, success: false });
          log(tick, { type: "TACKLE", teamId: def.sheet.teamId, playerId: presser.id, opponentId: holder.id, zone: mirrorZone(zone), success: true });
          turnover(presser, mirrorZone(zone));
        }
        break;
      }
      case "SHOT": {
        const pressers = pressingLine(def, zone);
        const presser = pickFrom(rng, pressers);
        const defAbility = (presser.defending + presser.positioning) / 2;
        const gk = def.gk;
        const shooterAbility = (holder.shooting + holder.finishing) / 2;
        const keeperAbility = (gk.shotStopping + gk.agility) / 2;
        att.stats.shots++;
        const assistId = lastPasser ? lastPasser.id : undefined;
        if (resolve(shooterAbility, (keeperAbility + defAbility) / 2, params.shotBias)) {
          att.stats.goals++;
          att.stats.shotsOnTarget++;
          log(tick, { type: "GOAL", teamId: att.sheet.teamId, playerId: holder.id, opponentId: gk.id, zone, phase: actionPhase, success: true, ...(assistId ? { assistId } : {}) });
          kickoff(tick, 1 - possession);
        } else {
          // ~half of misses are on target and count as a save.
          const onTarget = rng.next() < 0.5;
          log(tick, { type: "SHOT", teamId: att.sheet.teamId, playerId: holder.id, opponentId: gk.id, zone, phase: actionPhase, success: false });
          if (onTarget) {
            att.stats.shotsOnTarget++;
            log(tick, { type: "SAVE", teamId: def.sheet.teamId, playerId: gk.id, opponentId: holder.id, success: true });
          }
          // Goal kick / clearance: the defence restarts settled, no counter window.
          possession = 1 - possession;
          zone = "DEF";
          state.phase = "SETTLED";
          holder = pickFrom(rng, def.byLine.DF.length ? def.byLine.DF : def.outfield);
          lastPasser = null;
        }
        break;
      }
    }
  }

  log(totalTicks, { type: "FULL_TIME", teamId: sides[0].sheet.teamId });

  const result: MatchResult = {
    homeTeamId: home.teamId,
    awayTeamId: away.teamId,
    homeGoals: sides[0].stats.goals,
    awayGoals: sides[1].stats.goals,
    home: sides[0].stats,
    away: sides[1].stats,
    events,
    ratings: {},
  };
  result.ratings = computeRatings(result.events, home, away);
  return result;
}
