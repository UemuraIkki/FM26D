import type {
  EnginePlayer,
  EngineParams,
  EngineRng,
  MatchEvent,
  MatchResult,
  TeamMatchStats,
  TeamSheet,
  Zone,
} from "./types.js";
import { DEFAULT_PARAMS } from "./types.js";
import { computeRatings } from "./ratings.js";

/**
 * Possession-chain Markov match engine (requirement 3.3).
 * State: (ball-holding player, zone, phase implicit in zone). One tick is
 * ~7.5s of game time. Action success uses the unified logistic:
 *   P = 1 / (1 + exp(-(k * (att - def) + bias)))
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

function makeSide(sheet: TeamSheet, homeBonus: number): SideState {
  const gk = sheet.players.find((p) => p.position === "GK");
  if (!gk) throw new Error(`team ${sheet.teamId} has no GK`);
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

/** Line that presses the ball holder, from the defending side's perspective. */
function pressingLine(defending: SideState, zone: Zone): EnginePlayer[] {
  // Attacker in own DEF zone is pressed by opponent FWs, in MID by MFs, in ATT by DFs.
  const line = zone === "DEF" ? defending.byLine.FW : zone === "MID" ? defending.byLine.MF : defending.byLine.DF;
  return line.length > 0 ? line : defending.outfield;
}

/** Receiver candidates for an advancing pass from `zone`. */
function receiverPool(side: SideState, zone: Zone): EnginePlayer[] {
  const pool = zone === "DEF" ? side.byLine.MF : zone === "MID" ? side.byLine.FW : side.byLine.FW;
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
  const totalTicks = Math.round((90 * 60) / params.secondsPerTick);
  const halfTick = Math.floor(totalTicks / 2);

  const sides: [SideState, SideState] = [makeSide(home, params.homeAdvantage), makeSide(away, 0)];
  const events: MatchEvent[] = [];

  let possession = 0; // index into sides
  let zone: Zone = "MID";
  let holder: EnginePlayer = pickFrom(rng, sides[0].byLine.MF.length ? sides[0].byLine.MF : sides[0].outfield);
  let lastPasser: EnginePlayer | null = null;

  const minuteOf = (tick: number): number => Math.min(90, Math.floor((tick * params.secondsPerTick) / 60) + 1);

  const log = (tick: number, e: Omit<MatchEvent, "tick" | "minute">): void => {
    events.push({ tick, minute: minuteOf(tick), ...e });
  };

  const resetKickoff = (toSide: number): void => {
    possession = toSide;
    zone = "MID";
    const mfs = sides[toSide]!.byLine.MF;
    holder = pickFrom(rng, mfs.length ? mfs : sides[toSide]!.outfield);
    lastPasser = null;
  };

  log(0, { type: "KICKOFF", teamId: sides[0].sheet.teamId });

  for (let tick = 0; tick < totalTicks; tick++) {
    if (tick === halfTick) {
      log(tick, { type: "HALF_TIME", teamId: sides[0].sheet.teamId });
      resetKickoff(1); // away kicks off the second half
    }

    const att = sides[possession]!;
    const def = sides[1 - possession]!;
    att.stats.possessionTicks++;

    const action = chooseAction(rng, params, zone);
    const pressers = pressingLine(def, zone);
    const presser = pickFrom(rng, pressers);
    const defAbility = (presser.defending + presser.positioning) / 2;
    const bonus = att.homeBonus - def.homeBonus;

    switch (action) {
      case "ADVANCE_PASS":
      case "HOLD_PASS": {
        const isAdvance = action === "ADVANCE_PASS";
        const attAbility = (holder.passing + holder.decisions) / 2;
        const bias = isAdvance ? params.passBias : params.holdPassBias;
        const p = logistic(params.k * (attAbility - defAbility + bonus) + bias);
        att.stats.passesAttempted++;
        if (rng.next() < p) {
          const nextZone: Zone = isAdvance ? advanceZone(zone) : zone;
          const receiver = isAdvance
            ? pickFrom(rng, receiverPool(att, zone))
            : pickFrom(rng, att.outfield);
          att.stats.passesCompleted++;
          log(tick, { type: "PASS", teamId: att.sheet.teamId, playerId: holder.id, assistId: receiver.id, zone, success: true });
          lastPasser = holder;
          holder = receiver;
          zone = nextZone;
        } else {
          log(tick, { type: "PASS", teamId: att.sheet.teamId, playerId: holder.id, opponentId: presser.id, zone, success: false });
          log(tick, { type: "INTERCEPTION", teamId: def.sheet.teamId, playerId: presser.id, zone: mirrorZone(zone), success: true });
          possession = 1 - possession;
          zone = mirrorZone(zone);
          holder = presser;
          lastPasser = null;
        }
        break;
      }
      case "LONG_BALL": {
        const attAbility = (holder.passing + holder.decisions) / 2;
        const target = pickFrom(rng, att.byLine.FW.length ? att.byLine.FW : att.outfield);
        const duel = (target.aerial + target.strength) / 2 - (presser.aerial + presser.positioning) / 2;
        const p = logistic(params.k * ((attAbility - 50) * 0.4 + duel + bonus) + params.longBallBias);
        att.stats.passesAttempted++;
        if (rng.next() < p) {
          att.stats.passesCompleted++;
          log(tick, { type: "LONG_BALL", teamId: att.sheet.teamId, playerId: holder.id, assistId: target.id, zone, success: true });
          lastPasser = holder;
          holder = target;
          zone = "ATT";
        } else {
          log(tick, { type: "LONG_BALL", teamId: att.sheet.teamId, playerId: holder.id, opponentId: presser.id, zone, success: false });
          possession = 1 - possession;
          zone = mirrorZone(zone);
          holder = presser;
          lastPasser = null;
        }
        break;
      }
      case "DRIBBLE": {
        const attAbility = (holder.dribbling + holder.agility + holder.speed) / 3;
        const tacklerAbility = (presser.defending + presser.speed) / 2;
        const p = logistic(params.k * (attAbility - tacklerAbility + bonus) + params.dribbleBias);
        if (rng.next() < p) {
          log(tick, { type: "DRIBBLE", teamId: att.sheet.teamId, playerId: holder.id, opponentId: presser.id, zone, success: true });
          zone = advanceZone(zone);
        } else {
          log(tick, { type: "DRIBBLE", teamId: att.sheet.teamId, playerId: holder.id, opponentId: presser.id, zone, success: false });
          log(tick, { type: "TACKLE", teamId: def.sheet.teamId, playerId: presser.id, opponentId: holder.id, zone: mirrorZone(zone), success: true });
          possession = 1 - possession;
          zone = mirrorZone(zone);
          holder = presser;
          lastPasser = null;
        }
        break;
      }
      case "SHOT": {
        const gk = def.gk;
        const shooterAbility = (holder.shooting + holder.finishing) / 2;
        const keeperAbility = (gk.shotStopping + gk.agility) / 2;
        const p = logistic(params.k * (shooterAbility - (keeperAbility + defAbility) / 2 + bonus) + params.shotBias);
        att.stats.shots++;
        const assistId = lastPasser ? lastPasser.id : undefined;
        if (rng.next() < p) {
          att.stats.goals++;
          att.stats.shotsOnTarget++;
          log(tick, { type: "GOAL", teamId: att.sheet.teamId, playerId: holder.id, opponentId: gk.id, zone, success: true, ...(assistId ? { assistId } : {}) });
          resetKickoff(1 - possession);
        } else {
          // ~half of misses are on target and count as a save.
          const onTarget = rng.next() < 0.5;
          log(tick, { type: "SHOT", teamId: att.sheet.teamId, playerId: holder.id, opponentId: gk.id, zone, success: false });
          if (onTarget) {
            att.stats.shotsOnTarget++;
            log(tick, { type: "SAVE", teamId: def.sheet.teamId, playerId: gk.id, opponentId: holder.id, success: true });
          }
          // Goal kick / clearance: defenders restart.
          possession = 1 - possession;
          zone = "DEF";
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
  result.ratings = computeRatings(result, home, away);
  return result;
}
