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
