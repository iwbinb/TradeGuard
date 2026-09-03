# TradeGuard

Let AI trade within limits you control.

[Open application](https://tradeguard.iwbinb.workers.dev) · [Inspect recorded receipts](https://tradeguard.iwbinb.workers.dev/#/proof)

TradeGuard is a **Somnia Shannon testnet** application for bounded event-contract trading on DreamDEX. The owner sets a market allowlist, per-order limit, total spending budget, outcome-price ceiling and expiry. A restricted executor can request IOC buys but cannot change permissions or withdraw to itself.

This is experimental, unaudited software. A spending budget is **not** a loss guarantee. Test tUSDC is not redeemable money. No mainnet is supported.

## Features

- Responsive web application: Overview, Permissions, four-step policy review, Activity, Proof Center, positions/funds, documentation and introduction.
- Light/dark appearance and reduced transparency, with an Apple-inspired modular interface.
- Isolated, resettable Simulation with clear sample-data labels; live testnet reads never fall back to sample prices.
- Owner wallet connection and sign-in, account creation, exact token approval, deposit, owner-only withdrawal and revocation.
- Non-upgradeable account and factory; actual debit accounting includes pool credits, temporary approvals are cleared, market IDs/nonces prevent stale pool reuse, and intents cannot replay.
- Reference strategy and structured-output model adapter behind the same guard contract. Cloudflare Durable Objects retain execution state and signed transaction references before broadcast.
- Automatic settlement redemption into the account; separate recovery for settlement credits, pool credits and outcome tokens. All automation can be stopped.
- Receipt-derived activity, partial/no fills, explicit unknown outcomes, per-owner durable browser transaction references and independent recovery instructions.
- Read-only historical receipt examples, kept separate from the current account and Simulation. Each transaction links to the testnet explorer.

## Run locally

Requires Node.js 22.12+ and Foundry (`forge`).

```sh
npm ci
npm run contracts:build
npm run db:local
npm run dev -- --host 127.0.0.1 --port 4186 --strictPort
```

Open `http://127.0.0.1:4186/`. This starts the frontend plus a **local** Worker on port 8787. Default mode is Simulation. No wallet, model credential, cloud account or funds are needed to explore it.

Cloud bindings are local, but Live mode reads the official public testnet RPC/indexer. A local Worker is not a public deployment. `EXECUTION_ENABLED` defaults to `false`.

## Verify

```sh
npm run check
npm run check:protocol
npm run test:fork
npm run check:deploy
```

- `check`: generated contract interfaces, types, unit/UI tests, Solidity tests, isolated Worker tests and production frontend build.
- `check:protocol`: read-only chain, token and current-market identity checks.
- `test:fork`: uses real testnet state on a local EVM fork, including protocol IOC fills and revoked-policy rejection. It never broadcasts. Network availability and current liquidity are prerequisites.
- `check:deploy`: Cloudflare production packaging dry run; uploads nothing.

Offline Solidity runs explicitly skip the two live-fork tests. The dedicated fork command runs them against a pinned block. Generated ABI files are committed source artifacts and are regenerated from compiler output, never edited by hand.

## Architecture

```text
Owner wallet → TradeGuardAccount → DreamDEX binary pool / settlement
                      ↑
Web UI → Worker API → account-scoped Durable Object → restricted executor
             ↓                 ↓
       signed owner session   durable receipt/activity records → D1 mirror
```

The model proposes a direction; it does not authorize a trade. The Worker enforces additional operational limits; the Solidity account independently enforces owner-approved spending constraints.

## Deployment status and scope

The application and account factory are deployed on Somnia Shannon. The Proof Center includes a recorded real model-driven order, confirmed revocation, settlement result and owner withdrawal. That particular AI prediction lost; its zero payout is shown explicitly. Historical receipts are not current account state, performance guarantees or a security audit.

A separate paired integration example verifies positive **owner-triggered** redemption after revocation and withdrawal of all available collateral. It made no model calls and is not evidence of profitable prediction or unattended automatic recovery. Actual protocol payout, total debit and the net test result are shown separately.

Automatic execution is disabled by default and after bounded acceptance runs. Live trading requires a funded account, an explicit owner permission and an operator-allowlisted, time-limited execution service. The interface reports unavailable configuration explicitly. A successful local test is not evidence of a public-chain transaction.

The v1 account supports at most 16 markets per policy and 64 distinct markets over its lifetime. It does not auto-roll into future market windows, place persistent orders, sell early, reinvest profits or hold mainnet assets. Activity/history coverage is explicitly limited to what the service records; it is not a full address indexer.

See [deployment](docs/DEPLOYMENT.md), [recovery](docs/RECOVERY.md), [protocol integration](docs/PROTOCOL.md), and [security](SECURITY.md).

License: MIT. Dependencies retain their own licenses. Apple-style visual inspiration does not imply Apple affiliation; the web UI is not the native Apple Liquid Glass framework.
