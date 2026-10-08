import assert from "node:assert/strict";
import { ApiError, StealthBridgeClient, AssetAmount, AmountError, assertAsset, ManifestError, parseDeploymentManifest, getVerifiedContract, canTransitionSettlement, assertSettlementTransition, isSettlementState, isTerminalSettlementState, allowedSettlementTransitions, SettlementTransitionError } from "@stealthbridge/sdk";

const hash = "0123456789abcdef".repeat(4);
const responses = {
  "/health": { service: "stealthbridge", status: "ok" },
  "/v1/network": {
    network: "testnet",
    passphrase: "Test SDF Network ; September 2015",
    protocol_version: 23,
    ledger_sequence: 123,
    ledger_closed_at_unix: "1760000000",
    ledger_hash: "ab".repeat(32),
    source: "stellar-rpc"
  },
  "/v1/capabilities": {
    payments_enabled: false,
    confidential_token_verified: false,
    private_payments_verified: false,
    fiat_payouts_enabled: false
  },
  "/v1/corridors": [],
  [`/v1/transactions/${hash}`]: {
    hash,
    status: "SUCCESS",
    ledger: 123,
    closed_at_unix: "1760000000",
    latest_ledger: 124,
    source: "stellar-rpc"
  }
};

const requested = [];
const client = new StealthBridgeClient({
  apiBaseUrl: "https://api.example",
  network: "testnet",
  fetchImpl: async (url, options) => {
    const path = new URL(url).pathname;
    requested.push([path, options.method]);
    const body = responses[path];
    return body
      ? new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("", { status: 404 });
  }
});

assert.equal((await client.health()).status, "ok");
assert.equal((await client.network()).network, "testnet");
assert.equal((await client.capabilities()).payments_enabled, false);
assert.deepEqual(await client.corridors(), []);
assert.equal((await client.transaction(hash)).status, "SUCCESS");
assert.deepEqual(requested.map(([path]) => path), Object.keys(responses));
assert.equal(new ApiError(503, "/health").status, 503);
assert.deepEqual(Object.keys(await import("@stealthbridge/sdk")).sort(), [
  "AmountError",
  "ApiError",
  "AssetAmount",
  "ManifestError",
  "SettlementTransitionError",
  "StealthBridgeClient",
  "allowedSettlementTransitions",
  "assertAsset",
  "assertSettlementTransition",
  "canTransitionSettlement",
  "getVerifiedContract",
  "isSettlementState",
  "isTerminalSettlementState",
  "parseDeploymentManifest"
]);

console.log("Node ESM consumer imported and exercised all read-only methods");
