# Deploying TradeGuard

## Separate release surfaces

The app/API runs on **Cloudflare Workers + Static Assets + Durable Objects + D1**. The account factory runs on **Somnia Shannon, chain 50312**. Deploying either one does not deploy the other.

The bundled `worker/index.js` and Sites packaging files are a static-preview compatibility layer, not the trading backend. For the complete application use `wrangler.jsonc`, whose entry is `server/index.ts`. A static-only Pages/Sites upload cannot replace this backend. The present code is designed for Workers hosting; an additional frontend/backend split would need explicit origin/auth configuration.

## Operator configuration

Use a dedicated Cloudflare project and a dedicated testnet owner wallet. Keep owner keys out of the execution service and model prompts. Store service credentials only in server-side secret storage, never frontend configuration.

Use a new test-only wallet. Fund only bounded testnet STT/tUSDC; do not fund this application on mainnet.

## 1. Local acceptance

```sh
npm ci
npm run check
npm run check:protocol
npm run test:fork
npm run check:deploy
```

Local database: `npm run db:local`. It applies only the migration in `migrations/` to the local emulator. Existing local data is not reset.

Compatibility date is pinned to `2026-08-22`, the common date supported by the installed development and isolated-test runtimes. Both use the same date. Advance it only with a fresh complete test run.

## 2. Prepare and deploy the factory

`npm run prepare:deployment` reads official protocol identities and creates `.artifacts/factory-deployment.json`: unsigned deployment data, chain ID and constructor parameters. It neither signs nor broadcasts. Verify the target chain, deployed module/collateral bytecode and resulting factory source before signing.

Deploy `TradeGuardFactory` with the module and collateral returned by the installed official SDK, using a hardware wallet or encrypted local keystore. Do not pass a private key on the command line. A transaction and its gas require owner approval. Verify the confirmed factory's `module()` and `collateral()` values, and publish/verify source plus exact compiler settings.

Set `FACTORY_ADDRESS` in the intended environment only after confirmation. The frontend will continue to show the factory as unconfigured until this is done.

## 3. Cloudflare resources and secrets

After confirming the target Cloudflare account, create a D1 database, copy the returned database ID into the **production** D1 binding, and apply the migration:

```sh
npx wrangler d1 create tradeguard-production
npx wrangler d1 migrations apply tradeguard-production --remote --env production
```

These commands create cloud resources. The database ID must refer to your own database. Durable Object classes and SQLite migrations are declared in the config and are created on deployment.

Required secrets for execution:

- `EXECUTOR_SEED`: 32 cryptographically random bytes encoded as 64 hex characters, generated locally and backed up securely. This derives a separate executor per account. Losing/rotating it changes the corresponding execution identities; owners must grant new permissions.
- `MODEL_API_KEY`: only needed for the model-driven strategy. The reference strategy does not call a model.

Set secrets interactively using `wrangler secret put NAME --env production`, or use the Cloudflare secret UI. Do not commit `.dev.vars`, `.env`, cloud tokens, executor seeds, private logs or provider responses. Do not use any `VITE_*` variable for secrets.

For a local live integration, put secrets in ignored `.dev.vars` manually. Never reuse production credentials for demos.

Model configuration uses `MODEL_ENDPOINT` (an HTTPS Chat Completions-compatible endpoint with strict JSON-schema support) and `MODEL_NAME`. For OpenAI, use `https://api.openai.com/v1/chat/completions`, `gpt-5.6-luna`, and a server-side `MODEL_API_KEY` secret. The endpoint receives a small market snapshot, never owner keys. Provider pricing, quotas and data retention must be confirmed separately. `store:false` is requested but does not override provider policy.

## 4. Publish in a disabled state

Keep `EXECUTION_ENABLED=false`, build and dry-run the production target. Then publish the disabled service:

```sh
npm run build
npx wrangler deploy --env production
```

Verify the real URL, HTTPS, `/api/health`, `/api/config`, live-market freshness, correct factory identity, same-origin session flow and wallet-network checks. Keep both configured rate-limit bindings: 60 API requests and 12 sign-in attempts per minute per client IP at each Cloudflare location. These mitigate abuse but are not a strict global quota or billing ceiling.

## 5. Owner-signed live acceptance

1. Connect the dedicated owner wallet to chain 50312; obtain test STT and request test tUSDC.
2. Create the account and confirm its owner/module/collateral.
3. Approve an exact collateral deposit, wait for its receipt, then deposit in a separate transaction.
4. Sign in for agent controls. Fund the displayed **restricted executor** with a small bounded quantity of test STT.
5. Create a narrow policy for currently open explicit markets. Review every field before signing.
6. Only after this review, set an explicit comma-separated `EXECUTION_OWNER_ALLOWLIST`, an `EXECUTION_EXPIRES_AT` Unix timestamp no more than 24 hours ahead, and enable server execution. An empty, malformed or expired scope is disabled. Start only the reviewed strategy; model use requires its own bounded provider budget.
7. Verify an actual fill, a rejected permission request, confirmed revocation, settlement, redemption and owner withdrawal. Record exact network, block, market, account and transaction references.
8. Test stale RPC, rejected signatures, refresh during pending confirmation, permission replacement, service restarts and executor gas exhaustion.

Per policy, the service defaults to 20 model requests, at most 0.05 STT reserved for automation gas, and 24 hours of monitoring. Operators can reduce `MODEL_CALL_LIMIT` (1–20) and `MONITOR_SECONDS` (1–86400). The operator expiry also ends execution, including new automatic recovery transactions; manual recovery remains available. Invalid limits fail closed. Pause/restart cannot extend the existing monitoring deadline or reset counters for the same policy. These are per-policy limits, not an account-wide billing cap: review new policies separately and restrict allowed owners. The total gas reservation is conservative, not measured gas expenditure.

Decision records explicitly distinguish AI decisions from reference-strategy decisions. They remain separate from receipt-confirmed fills; an abstention or a decision to buy is not proof that a transaction was submitted or filled.

Distinguish local-fork results, `eth_call`, prechecks and Simulation from public-chain receipts. Publish account activity or model reasons only with the owner's consent. Successful deployment does not establish that a model call, order, fill or settlement has occurred.
