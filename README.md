<div align="center"><img src="assets/stealthbridge-logo.svg" alt="StealthBridge — Confidential payments. Without borders." width="760" /></div>

# StealthBridge SDK

**Engineering roadmap:** [View the repository-specific plan](ROADMAP.md).

An initial **read-only TypeScript SDK** for live StealthBridge network and corridor metadata.

```ts
import { StealthBridgeClient } from "@stealthbridge/sdk";
const client = new StealthBridgeClient({ apiBaseUrl: "https://your-api.example", network: "testnet" });
const chain = await client.network();    // real observed Stellar ledger from backend
const corridors = await client.corridors(); // real PostgreSQL records or explicit 503
```

The public functions return network metadata, capability flags and actual configured corridors. A data-unavailable response is an error, **never replaced with demo values**. The API rejects non-HTTPS remote URLs.

## Security and status

No payment submission, signing, wallet custody, encrypted note management, ZK proof generation, mainnet, or fiat integration. This SDK is not a confidential transfer implementation.

See [compatibility matrix](specs/COMPATIBILITY.md), the [backend API](https://github.com/stealthbridge-labs/stealthbridge-backend/blob/main/api/openapi.yaml), [frontend](https://github.com/stealthbridge-labs/stealthbridge-frontend), and [contracts](https://github.com/stealthbridge-labs/stealthbridge-contracts).

## Runtime and package compatibility

The only public package entry point is `@stealthbridge/sdk`. It is native ESM and exports the runtime values `StealthBridgeClient` and `ApiError`, plus the TypeScript types `ClientConfig`, `Network`, `PrivacyRail`, `SettlementState`, `Capabilities`, `NetworkStatus`, `Corridor`, `SettlementSummary`, and `TransactionObservation`. Internal `dist/*` paths are not public exports.

- Node.js: 22 or newer, ESM only. CommonJS `require()` is not supported.
- Browsers: ES2022 with built-in `fetch`, `Response`, and `URL`, using a bundler that understands package `exports`. CI verifies this with esbuild and a pinned Next.js 16.4 App Router production build.
- TypeScript: declarations are generated beside the ESM output and resolved through the `types` export condition.
- Network: Stellar Testnet only. Browser calls are still subject to the backend's CORS policy.

The package remains private and unpublished while licensing and release approval are pending. To inspect the exact local package consumers without publishing:

```sh
npm ci
npm run verify
```

`npm run verify` type-checks and builds the source, creates `artifacts/stealthbridge-sdk-0.2.0.tgz`, validates SHA-256 plus npm's SHA-1/SHA-512 integrity metadata and contents, then installs that tarball into isolated Node.js, TypeScript, esbuild, and Next.js fixtures. The Next.js fixture proves the installed `dist/index.js` entry resolves in both a Server Component and a `"use client"` Client Component. It does not need a backend, wallet, credentials, or deployment. The fixture's pinned dependencies require registry access on a cold cache.

The measured baseline is approximately 4.4 KB packed / 10.5 KB unpacked, with a 1,189 B full minified browser ESM bundle, a 233 B `ApiError`-only bundle, and 1,452 B across the Next.js client chunks containing SDK code. CI ceilings allow deliberate headroom: 12,000 B packed, 30,000 B unpacked, 3,000 B full browser, 1,000 B tree-shaken, and 25,000 B for SDK-bearing Next.js client chunks. The Next.js fixture adds about 12.4 seconds locally on a warm dependency cache (6.0 seconds install and 6.4 seconds build). A size change that exceeds a ceiling requires review and an explicit budget update with fresh measurements.

## Consumer errors

- The constructor throws `Error` for a network other than `"testnet"`, a non-HTTP(S) URL, or non-local plaintext HTTP.
- `transaction(hash)` throws `TypeError` before any request unless the hash is exactly 64 hexadecimal characters.
- A completed non-2xx response throws `ApiError`; inspect its numeric `status` and requested `path`. A transaction 404 can also mean the RPC node no longer retains that transaction.
- Native URL, fetch, CORS, DNS, and connection failures pass through unchanged. The client does not retry or replace unavailable data with examples.

## On-chain observation, without leaking contract events

```ts
const observed = await client.transaction(realTransactionHash); // exact 64-hex hash
console.log(observed.status, observed.ledger);
```

The result verifies **chain inclusion only**. It does not prove private-payment anonymity, bank payout or token redemption; older hashes may be unavailable from RPC retention. The SDK has offline tests for URL restrictions, malformed hashes, missing transactions and safe read-only behavior. See [the engineering roadmap](ROADMAP.md).

## Exact-value asset operations

```ts
import { AssetAmount } from "@stealthbridge/sdk";
const verifiedAsset = {
  network: "testnet", kind: "soroban-token",
  identifier: assetIdFromYourVerifiedConfiguration,
  decimals: decimalsFromYourVerifiedContract
} as const;
const amount = AssetAmount.parse(verifiedAsset, valueEnteredAsDecimalString);
const total = amount.add(otherAmountOfSameAsset);
console.log(total.format(), total.minorUnits.toString());
```

This is a *pure amount utility*, not a conversion rate or transfer feature. It rejects floating-point inputs, ambiguous decimal strings, unsupported precision, negative values and cross-asset operations. Asset identity/decimals **must be verified from real chain/issuer metadata**; never assume precision or trusted issuer from this helper. Bigints serialize explicitly to minor-unit strings.

## Verified contract manifest parsing

Use `parseDeploymentManifest(input)` and `getVerifiedContract(manifest,name)` to prevent accidental use of unconfirmed or non-Testnet contract identifiers. Current actual manifest is explicitly `not-deployed` and must **not** be represented as a functioning protocol. This parser checks format and required evidence fields; it does **not** independently prove an on-chain deployment or attest to a token issuer. See `src/manifest.ts`.

## Resilient read-only client

The SDK validates actual response schemas for network identity, corridors, capabilities, health and transaction observations before returning them. Responses that are malformed, oversized (> 64 KB), missing JSON Content-Type headers, or incompatible with Stellar Testnet fail closed with `ApiError(502,path)`; no synthetic results are returned.

Set `timeoutMs` between 100 and 60000 milliseconds (10 seconds by default) and pass `{signal:AbortSignal}` to any read. Requests use `AbortSignal.any()` for cancellation and timeout. Opt-in bounded retries (`maxRetries` up to 5, default 0) with exponential backoff (`retryBackoffMs`, default 100ms) can be configured globally or per-request for GET reads encountering 429, 502, 503, 504, or network timeouts. Client 400 and 404 errors are non-retryable. **No money-moving method is exposed, and no implicit retries exist for non-GET operations.**

### Single corridor detail

`client.corridor(corridorId)` retrieves the actual enabled corridor record by UUID. Invalid identifiers fail before fetching; unknown, disabled or unavailable corridors raise HTTP errors. A database record is **not** evidence of active provider support, licensed payouts or a verified contract deployment.

## Detailed developer guide

[Read the implementation and integration guide](docs/DEVELOPER-GUIDE.md) for current API boundaries, usage, verification and security requirements.

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
