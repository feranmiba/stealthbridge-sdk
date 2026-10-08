/**
 * Presentation-only settlement lifecycle semantics, synchronized with the
 * backend's src/settlement.rs. No endpoint, signing or fund movement.
 */
import type {SettlementState} from "./types.js";

export const allowedSettlementTransitions:Readonly<Record<SettlementState,readonly SettlementState[]>> = Object.freeze({
 draft:["quoted","rejected"],
 quoted:["authorized","expired","rejected"],
 authorized:["submitted","rejected"],
 submitted:["chain_finalized","chain_failed","manual_review"],
 chain_finalized:["payout_pending","manual_review"],
 payout_pending:["payout_completed","payout_failed","manual_review"],
 payout_completed:[],
 expired:[],
 rejected:[],
 chain_failed:["refund_pending","manual_review"],
 payout_failed:["payout_pending","refund_pending","manual_review"],
 refund_pending:["refunded","manual_review"],
 refunded:[],
 manual_review:["payout_pending","refund_pending"]
});

export class SettlementTransitionError extends Error {
 constructor(public readonly from:SettlementState,public readonly to:SettlementState){
  super("Invalid settlement transition "+from+" -> "+to);
  this.name="SettlementTransitionError";
 }
}
export function isSettlementState(value:unknown):value is SettlementState {
 return typeof value==="string" &&
   Object.prototype.hasOwnProperty.call(allowedSettlementTransitions,value);
}
export function canTransitionSettlement(from:SettlementState,to:SettlementState):boolean{
 return allowedSettlementTransitions[from].includes(to);
}
/** Validates a state change for display and test tooling, never executes it. */
export function assertSettlementTransition(from:SettlementState,to:SettlementState):SettlementState {
 if(!canTransitionSettlement(from,to))throw new SettlementTransitionError(from,to);
 return to;
}
/** Terminal means no backend-defined outgoing transitions, not successful payout. */
export function isTerminalSettlementState(state:SettlementState):boolean {
 return allowedSettlementTransitions[state].length===0;
}
