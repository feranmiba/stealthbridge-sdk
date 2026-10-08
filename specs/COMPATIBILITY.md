# StealthBridge integration compatibility — v0.3

| Component | Interface | Status |
| --- | --- | --- |
| Backend | `/health`, `/v1/network`, `/v1/capabilities`, `/v1/corridors` | Rust implementation committed, deployment pending |
| Source network | Stellar Testnet RPC `getNetwork` + `getLatestLedger` | Live upstream API required |
| Corridors | Operator-configured PostgreSQL `corridors` | Empty until real configuration |
| SDK | Typed read-only `StealthBridgeClient`; Node.js 22+ native ESM; browser ES2022 bundle | Code and offline package consumers committed |
| Frontend | Same-origin Next.js API proxy | Code committed, requires backend URL |
| Contracts | CorridorRegistry WASM | No deployment or confidential transfer |
| SPP | Alpha SDK | Not integrated or verified |
| Confidential Tokens | Developer preview | Not integrated or verified |

## Invariants
- Backend must fail closed if a configured RPC reports another network.
- Do not fabricate corridor records, asset identities, exchange rates, partner integrations, or transaction success.
- Testnet RPC is not a confidential payment protocol. Never claim a value transfer until an actual audited/verified solution supports it.
- SDK has no server-side signing or wallet secret handling.
- When backend schema changes, update types and consumer compatibility tests atomically.

## Package compatibility and integrity

`@stealthbridge/sdk` exposes only its root entry point. Package exports resolve `dist/index.js` for ESM runtime consumers and `dist/index.d.ts` for TypeScript. The supported runtime contract is Node.js 22 or newer and browser applications targeting ES2022 with the standard Fetch and URL APIs. CommonJS and direct `dist/*` subpath imports are not supported.

The deterministic package test builds the SDK, creates the npm tarball without publishing it, verifies SHA-256 plus its npm-reported SHA-1 and SHA-512 digests, checks the exact file allowlist, and installs the tarball—not the repository source—into isolated Node ESM, TypeScript, esbuild, and Next.js consumers. The pinned Next.js 16.4 App Router fixture asserts that resolution ends at the installed `node_modules/@stealthbridge/sdk/dist/index.js`, then runs a production build containing both a Server Component and a `"use client"` Client Component. Browser metadata and output are rejected if they reference Node built-ins, CommonJS runtime globals, or wallet-secret identifiers. An `ApiError`-only consumer must remove the client and endpoint strings, remain below half of the full bundle size, and satisfy its absolute byte ceiling.

Current measured baselines are approximately 4.4 KB packed, 10.5 KB unpacked, 1,189 B for the full minified browser ESM bundle, 233 B for the tree-shaken `ApiError` bundle, and 1,452 B across SDK-bearing Next.js client chunks. Enforced ceilings are respectively 12,000 B, 30,000 B, 3,000 B, 1,000 B, and 25,000 B. The headroom avoids platform and framework chunking noise while making a material dependency or tree-shaking regression fail CI. The pinned Next.js fixture added about 12.4 seconds in the measured local run; a cold npm cache also incurs its dependency download time.

These checks establish packaging compatibility, not production readiness, backend availability, privacy, transfer correctness, settlement, or audit status.

## v0.3 transaction observation compatibility

The backend OpenAPI v0.3 defines `GET /v1/transactions/{hash}` for a user-supplied 64-character hex hash. The TypeScript client now exposes `transaction(hash)` returning `TransactionObservation` with status SUCCESS/FAILED, ledger and RPC source; 404 means not present in the node's retained history, **not** proof the transaction never existed. We intentionally omit raw envelope/result XDR, events and confidential payment data. Tests run offline with synthetic mocked fetch responses only.

The backend also includes a tenant-scoped internal intent journal (`src/store.rs`) but **there is no public authenticated mutation endpoint or SDK write method**. Preserve this boundary until wallet auth, proof verification, FX and payout reconciliation are independently implemented.

### Contract artifact resolution

Only schema version 1 and `network=testnet` are recognized. The current contracts manifest declares `not-deployed`. Only explicitly verified, deployment-shaped manifests can resolve a contract name. This local validation is not independent network attestation; consumers must still verify contract IDs, code hashes and source provenance against Stellar.

### Read-only transport invariants

Every SDK read has a bounded timeout, optional caller AbortSignal, maximum JSON response size, and runtime shape validation. The Testnet passphrase is verified in the client response, in addition to the backend RPC check. Unsupported data is rejected as an API protocol error, not converted into a payment success state. Cross-platform tests use native fetch and `AbortSignal.any` (Node.js 22+ / modern browsers).

The backend additionally provides `GET /v1/corridors/{id}`, with 400 for malformed UUIDs, 404 for disabled/missing records, and 503 for unavailable PostgreSQL. The SDK `corridor(id)` mirrors these checks and never synthesizes missing asset metadata.
