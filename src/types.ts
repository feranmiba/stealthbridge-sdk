/** Public ledger and corridor models; not a home for payment witnesses or personal data. */
export type Network = "testnet";
export type PrivacyRail = "confidential-token" | "private-payments";
export type SettlementState =
  | "draft" | "quoted" | "authorized" | "submitted"
  | "chain_finalized" | "payout_pending" | "payout_completed"
  | "expired" | "rejected" | "chain_failed" | "payout_failed"
  | "refund_pending" | "refunded" | "manual_review";

export interface Capabilities {
  payments_enabled: boolean;
  confidential_token_verified: boolean;
  private_payments_verified: boolean;
  fiat_payouts_enabled: boolean;
}
export interface NetworkStatus {
  network: Network;
  passphrase: string;
  protocol_version: number;
  ledger_sequence: number;
  ledger_closed_at_unix: string;
  ledger_hash: string;
  source: "stellar-rpc";
}
export interface Corridor {
  id: string;
  origin_country: string;
  destination_country: string;
  asset_code: string;
  asset_issuer: string | null;
  privacy_rail: PrivacyRail;
}
export interface SettlementSummary {
  id: string;
  corridor_id: string;
  state: SettlementState;
  privacy_rail: PrivacyRail;
  chain_transaction_hash?: string;
  payout_reference?: string;
}

/** Public transaction inclusion status only. Never includes ledger XDR or private transfer details. */
export interface TransactionObservation {
  hash: string;
  status: "SUCCESS" | "FAILED";
  ledger: number;
  closed_at_unix: string;
  latest_ledger: number;
  source: "stellar-rpc";
}

/** Bounded, read-only operator configuration page. Never implies live liquidity. */
export interface CorridorPage { items:Corridor[]; next_cursor:string|null; }

/** Last persisted Testnet observer checkpoint. May be stale, never a payout receipt. */
export interface LedgerCheckpoint {
  ledger_sequence:number;
  ledger_hash:string;
  ledger_closed_at_unix:string;
  source:"stellar-rpc";
}

/** Service dependencies only; not a payment/issuer approval. */
export interface Readiness {
 status:"ready"|"degraded";
 stellar_rpc:"connected"|"unavailable";
 database:"connected"|"unavailable";
 payments:"disabled";
}

/** Deployed contract discovery is intentionally denied until independent RPC verification. */
export interface ContractDiscovery {
 network:"testnet";
 source:"stealthbridge-contracts/deployments/testnet/manifest.json";
 manifest:import("./manifest.js").DeploymentManifest;
 on_chain_verified:false;
 payment_execution_enabled:false;
}
