# Security and limitations

TradeGuard v0.1 is testnet-only and **not independently audited**. Do not use real-value funds. Automated tests, local forks and code review do not establish complete security.

## Protected boundaries

- Owner-only permission changes, revocation, withdrawal and outcome-token recovery.
- Immutable owner/module/collateral and chain 50312; no upgrade path or generic external-call executor.
- Explicit markets/versions/nonces, replay rejection, expiry, single-order and cumulative spending caps, and purchased-outcome price limits.
- Atomic actual-debit checks include pool vault credits; reentrancy guard and exact temporary approvals.
- Fixed-destination redemption/settlement recovery cannot pay the triggering caller.
- Origin-bound signed sessions, same-origin POST checks, bounded JSON, strict input schemas, private account-scoped task state, and no secrets exposed through public configuration.
- Signed transaction persistence before broadcast, same-byte retries, retained unknown outcomes, and owner-scoped pending browser references.
- Model call cap, conservative aggregate gas cap and finite monitoring window per permission; fail-closed execution defaults.

## Trust and residual risk

The upstream protocol, token, oracle, settlement and RPC can fail or be compromised. An authorized executor can intentionally choose losing trades within the permission. Owner wallet compromise bypasses owner-only protections. A transaction confirmed before revocation remains final. Model-provider costs and retention are external concerns. Monitor gas and API spending independently.

The current service is intended for controlled testnet evaluation, not unbounded public production. Edge bindings limit API requests and sign-in attempts per client IP. These per-location, eventually consistent limits are abuse mitigation, not a global billing ceiling; maintain secret access controls and review provider quotas. Public account reads are inherently public on-chain data, but private runner activity requires the owner session. Do not publish activity/model reasons without owner consent.

Claims of complete address history, guaranteed exact gross-to-net payout, continuous availability or guaranteed fast settlement are not supported. This v1 account is limited to 64 distinct tracked markets; migrating to a new account/factory after that limit requires a deliberate owner decision. Deposits of unsupported assets are not supported.

## Reporting

Do not publish private keys, seed material, session cookies or user activity in a public issue. Until a dedicated security contact is configured, contact the maintainer through the repository's private reporting channel if enabled. No bug-bounty payment is promised.

Use [independent recovery](docs/RECOVERY.md) if the service is unavailable. Any suspected permission or accounting issue should stop hosted execution and trigger owner review before new trades.
