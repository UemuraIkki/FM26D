import { selectStartingXI } from "../sim/lineup.js";
import type { ClubDecisionMaker, LineupContext } from "./clubDecisionMaker.js";
import type { TeamSheet } from "../engine/index.js";

/** Default autonomous club brain used for every club in observation mode. */
export class AIDecisionMaker implements ClubDecisionMaker {
  constructor(readonly clubId: string) {}

  selectLineup(context: LineupContext): TeamSheet {
    return selectStartingXI(this.clubId, context.squad, context.roleBook, context.formation);
  }
}
