# StealthBridge SDK — Developer Integration Guide

## 1. Available read-only capabilities

`StealthBridgeClient` supports `health()`, `network()`, `capabilities()`, `corridors()`, `corridor(id)` and `transaction(hash)`. They call the Rust backend and return actual observed or configured records, or raise explicit errors. This is **not a wallet, confidential-note store, signer, prover, issuer interface or settlement client**.

```ts
import { StealthBridgeClient } from "@stealthbridge/sdk";
const client = new StealthBridgeClient({
  network: "testnet",
  apiBaseUrl: serverUrlFromYourDeployment,
  timeoutMs: 10000,
  maxRetries: 2, // opt-in GET retries (default 0)
  retryBackoffMs: 100, // initial backoff delay
});
const state = await client.network();
const corridors = await client.corridors({ maxRetries: 1 });
if(corridors.length) {
  const verifiedConfiguration = await client.corridor(corridors[0].id);
}
```

The read-only client rejects remote plaintext HTTP, URLs with embedded credentials, non-Testnet configuration, invalid IDs/hashes, malformed or oversized response bodies (> 64 KB), wrong response content-types (non-JSON), and incompatible response schemas. Requests accept optional per-request `AbortSignal` and have bounded timeouts (`timeoutMs`).

### Error taxonomy and retryability
- **400 (Bad Request)**: Invalid parameters or UUID/hash format. Non-retryable; throws `ApiError(400)`.
- **404 (Not Found)**: Unknown transaction hash or disabled corridor. Non-retryable; throws `ApiError(404)`. Never synthesizes fake state.
- **429 (Too Many Requests)**: Rate limiting. Retryable up to `maxRetries` with exponential backoff (`retryBackoffMs * 2^attempt`). Throws `ApiError(429)` if retries are exhausted.
- **502 (Bad Gateway)**: Malformed/oversized payload, invalid Content-Type, failed shape validation, or wrong Testnet passphrase. Retryable up to `maxRetries`. Throws `ApiError(502)` if retries are exhausted.
- **503 (Service Unavailable)**: Database or upstream service down. Retryable up to `maxRetries` with exponential backoff. Throws `ApiError(503)` if retries are exhausted.

Retries are opt-in, bounded (0–5 attempts), apply strictly to read-only GET requests, and honor caller `AbortSignal` cancellations immediately without fabricating any pending or successful payment states. No implicit retries exist for future signing or settlement operations.

## 2. Exact-value amount arithmetic

`AssetAmount.parse(asset, decimalString)` stores minor units as `bigint`, never JavaScript `number`. `add`, `subtract`, `compare`, `format` and `toJSON` validate exact asset identity and precision. The supplied `asset.identifier` and `asset.decimals` must originate from an actual verified asset/contract configuration, not hardcoded guesses. Parsing does not perform fiat exchange or ascertain a stablecoin's redeemability.

## 3. Contract artifact validation

`parseDeploymentManifest(manifest)` accepts only schema version 1 and a Testnet declaration. `getVerifiedContract(manifest,name)` rejects the current legitimate undeployed manifest instead of inventing a contract ID. Local manifest-format validation is *not* independent chain attestation and must be supplemented by WASM code hash and Stellar RPC verification.

## 4. Consumer support

The package is ESM, Node 22+ and modern-browser fetch-targeted. The source emits TypeScript declarations and exports through `dist/index.js`. The packaging suite installs a local npm tarball into isolated Node ESM, TypeScript, browser-esbuild and Next.js consumers.

```sh
npm ci
npm run verify
```

CI checks package integrity, types, browser safety, offline fixtures, response validation and public export resolution. Budget changes must be accompanied by measured build output rather than claimed numbers.

## 5. Security and operational boundaries

Never include wallet secrets, ZK witnesses, KYC data, protected amounts or confidential note keys in public API observations or logs. The SDK exposes no `send`, `sign`, `withdraw`, `mint`, `quote` or `payout` method until the underlying protocol and compliance controls are independently verified and approved.

See [compatibility](../specs/COMPATIBILITY.md), [backend OpenAPI](https://github.com/stealthbridge-labs/stealthbridge-backend/blob/main/api/openapi.yaml), and [SDK roadmap](../ROADMAP.md).

## Bounded client responses and opt-in retries

Every GET has a total configurable timeout, optional AbortSignal, and a 64 KiB **streamed byte limit**. Oversized responses are rejected as upstream errors before the full body is accumulated, and malformed or unexpected response types are not transformed into fictional data. Retries are **off by default**; to explicitly retry only 429/502/503 GET failures, pass \`{retries: 1}\` or \`{retries: 2}\`. A single overall timeout/AbortSignal covers retries and exponential backoff. Client-side financial mutation methods do not exist and will never inherit this retry policy implicitly.

## Bounded corridor discovery

\`client.corridorsPage({limit:25})\` calls the backend's **read-only** keyset endpoint. Use \`page.next_cursor\` as \`after\` for the next request. Page sizes are restricted to 1–100 and both incoming cursors and returned records are validated. An empty page is a genuine empty database result, not an invented corridor. Concurrent operator changes may affect subsequent pages; pagination is not a transactionally frozen snapshot.

\`\`\`ts
const first = await client.corridorsPage({limit:25});
if(first.next_cursor){
  const second = await client.corridorsPage({after:first.next_cursor,limit:25});
}
\`\`\`

This method is separate from the backwards-compatible \`corridors()\` listing; it never creates quote, payment or partner relationships.

## Opt-in ledger observer support

The backend can persist a monotonic **public Testnet ledger head** after independently checking RPC network identity. With an operator-managed database and explicit observer activation, \`client.observerHead()\` reads that last stored checkpoint. An absent checkpoint returns HTTP 404, unavailable storage 503, and malformed schema a rejected protocol response. This **does not prove a payment occurred** and does not contain transaction XDR, a settlement receipt, account data or a fiat payout. The field may be stale if the observer is stopped.

## Pure settlement lifecycle interpretation

The SDK exports \`allowedSettlementTransitions\`, \`canTransitionSettlement(from,to)\`, \`assertSettlementTransition(from,to)\`, \`isSettlementState(value)\` and \`isTerminalSettlementState(state)\`. These mirror the backend's explicit **domain state machine**; they are for rendering and validating lifecycle information, not creating/approving/executing financial operations.

In particular, \`chain_finalized\` **cannot** advance directly to \`payout_completed\`; external payout confirmation and reconciliation are distinct. Terminal state is not synonymous with successful payment (e.g. \`expired\` and \`rejected\` are terminal). Versions must remain aligned across backend/SDK; CI tests fail on invalid transitions. No client-side transition is proof of actual chain or payout evidence.

### Strict public response integrity

Corridor responses now reject malformed UUIDs, same-country pairs, unsupported privacy rails, oversize/invalid asset identifiers, and malformed issuer strings. Transaction summaries require a genuine 64-character hash, positive ledger sequence, a latest-ledger not earlier than inclusion, numeric Unix close-time and recognized status. Network readings similarly reject invalid protocol/sequence and close-time fields. These checks prevent invalid upstream data from silently becoming trusted frontend state; they **cannot prove a payout provider, private transfer or stablecoin issuer is genuine**.

## Service dependency readiness

\`client.readiness()\` reads the backend's \`GET /ready\` route, and validates the relationship between \`status\`, \`stellar_rpc\`, \`database\`, and an explicitly **disabled payments** capability. A fully connected process can report \`ready\` for its observation dependencies while **payments remain disabled**. Absent/unavailable dependencies cause the backend's HTTP 503 and are not rewritten to success by the SDK.

## Bounded streaming corridor scans

The SDK now offers `scanCorridors({pageSize:25,maxPages:20,signal})`, an asynchronous iterator over **real** configured records. It limits the number of HTTP requests, supports caller cancellation and bounded GET retry settings, checks UUID cursor progress, ordering and duplicate records, and terminates when the backend returns a null cursor. The default cap is at most 20 requests, not an exhaustive scan guarantee; use `corridorsPage` with explicit cursors for larger catalogs. No data is fabricated, and no transfer or payout operation is performed.

## Canonical cross-repository contract discovery

`client.contracts()` retrieves `GET /v1/contracts` from the Rust backend. The backend embeds the **real**, currently `not-deployed` Testnet manifest from the Soroban contracts repository. An automated backend CI check compares its snapshot with the canonical contracts repo so source drift fails early. The SDK validates schema, network, record emptiness and explicit `on_chain_verified=false` / `payment_execution_enabled=false`. It rejects any premature deployed/verified claim; no contract ID or payment capability is conjured. After an independently verified Soroban deployment, this interface must be extended with actual chain attestation before enabling contract operations. The SDK does not sign or simulate fund movement.

### Source-level registry ABI inventory

`contracts().public_interface` contains the read method names, argument shapes and explicitly separated administrator writes for both current Soroban registry sources. The authoritative snapshot lives at `stealthbridge-contracts/integrations/public-soroban-interface.v1.json`; the backend compares its mirrored copy in CI and serves it to SDK clients. The SDK validates the read names against the pinned source interface and rejects unknown read capabilities. This is a method inventory only: without a real deployed Contract ID and independent chain attestation, no Soroban invocation can run. No wallet seed or private proof is accepted here.

**Strict address rule:** `getVerifiedContract()` intentionally refuses to resolve addresses from a manifest claim alone, even if `status=deployed` and `verified=true`. Real on-chain attestation of the contract ID, code hash, source version and Testnet passphrase must be implemented first. This avoids treating JSON metadata or syntactically valid-looking StrKeys as real deployed code.
