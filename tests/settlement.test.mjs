import {test} from "node:test";
import assert from "node:assert/strict";
import {
 allowedSettlementTransitions,canTransitionSettlement,assertSettlementTransition,
 isSettlementState,isTerminalSettlementState,SettlementTransitionError
} from "../dist/index.js";
test("backend-defined states and transitions are explicit",()=>{
 const states=["draft","quoted","authorized","submitted","chain_finalized","payout_pending",
  "payout_completed","expired","rejected","chain_failed","payout_failed",
  "refund_pending","refunded","manual_review"];
 assert.deepEqual(Object.keys(allowedSettlementTransitions).sort(),states.sort());
 assert.ok(states.every(isSettlementState));
 assert.equal(isSettlementState("paid"),false);
 assert.equal(isSettlementState(null),false);
});
test("chain finality can never skip external payout reconciliation",()=>{
 assert.equal(canTransitionSettlement("submitted","chain_finalized"),true);
 assert.equal(canTransitionSettlement("chain_finalized","payout_pending"),true);
 assert.equal(canTransitionSettlement("chain_finalized","payout_completed"),false);
 assert.throws(()=>assertSettlementTransition("chain_finalized","payout_completed"),SettlementTransitionError);
 assert.equal(assertSettlementTransition("payout_pending","payout_completed"),"payout_completed");
});
test("failure paths and terminal states are not fabricated successes",()=>{
 assert.equal(canTransitionSettlement("chain_failed","refund_pending"),true);
 assert.equal(canTransitionSettlement("payout_failed","payout_pending"),true);
 assert.equal(isTerminalSettlementState("payout_completed"),true);
 assert.equal(isTerminalSettlementState("expired"),true);
 assert.equal(isTerminalSettlementState("refunded"),true);
 assert.equal(isTerminalSettlementState("manual_review"),false);
 assert.equal(isTerminalSettlementState("chain_finalized"),false);
 assert.equal(isTerminalSettlementState("chain_failed"),false);
});
