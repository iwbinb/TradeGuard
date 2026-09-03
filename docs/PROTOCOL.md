# Protocol integration and trust boundaries

The integration is pinned to `@somnia-chain/markets-sdk` **0.29.0**, not a generic prediction-market ABI. The package publishes [official source](https://github.com/somnia-chain/somnia-markets/tree/main/packages/sdk). Project contracts use OpenZeppelin 5.6.1 and Solidity 0.8.28 with optimizer 200, via-IR and Cancun EVM.

Network/address constants are imported from the official SDK. `scripts/check-protocol.ts` checks chain 50312, module code, collateral decimals and current markets. Never copy a pool address as a permanent market identity.

## Data boundary

The official indexer discovers binary market IDs. The API filters by expiry and then re-reads registry identity, pool parameters, market status and the order book from the chain. A stale indexer `Trading` label alone cannot authorize execution. A failed real-data read produces an error or unavailable state, not a sample quote.

The hosted implementation deliberately uses bounded HTTP polling and official SDK ABIs/constants. It does **not** claim to implement the SDK's reactive websocket engine or Somnia native Reactive Contracts. Indexed asset/interval labels are display metadata; on-chain authorization uses explicit immutable event identity.

## Model event context

The model path also reads the official event question and opening-reference link, checks the indexed question ID/window against the module record, and reads the opening answer from the bound oracle adapter. A zero strike is treated as an opening-reference convention, never as a zero-price threshold. Unsupported event rules and unavailable/voided baselines remain explicit missing data.

Oracle price precision comes from `PRICE_DECIMALS` when available. Only the SDK-pinned testnet OracleHub may use the SDK 0.29.0 documented two-decimal convention after a missing/reverting getter; that convention is labeled, not presented as an on-chain getter result. Transport errors and unknown adapters never silently inherit this scale. Indexed question text/reference links are not independent proof of settlement code.

Underlying context comes from the SDK's official testnet USDC-quoted feed. It remains distinct from outcome-share quotes and the final settlement oracle. Both the oracle write time and the upstream source time must be fresh. The model receives human-readable prices and explicit units/provenance. Missing/stale context blocks model-driven buys; filling the fields does not establish a profitable strategy.

## Contract boundary

The guard pins market ID, market, pool, outcome token, YES/NO token IDs, venue, operator, pool nonce, market expiry and policy version. Every buy rechecks the registry and pool. It refuses reused/recycled bindings, an expired/closed market, a revoked/expired permission, the wrong executor, repeated intents, excessive amount and excessive purchased-outcome price.

IOC order kinds are `BUY_YES=0`, `BUY_NO=2`, with order type `2`; price is encoded on the YES side for both. The purchased Down price is the complement of YES price. Quantities are rounded down to the published lot size; costs/fees are rounded conservatively. No persistent order or arbitrary-call entry exists.

The executor requests at most 0.50 tUSDC per hosted cycle. This service default is distinct from the owner-signed contract limits. Quote generation is not a guarantee of liquidity or fill.

Before/after spend uses collateral wallet balance **plus pool withdrawable credits**, preventing vault-first funds from bypassing the budget. Temporary approval is restricted to the requested max spend and reset to zero after execution. The whole transaction reverts if measured debit exceeds a limit or contradicts received outcome tokens. Only measured debit consumes allowance; gas is separate.

## Settlement boundary

Redemption is a separate fixed-destination action. It uses an archived market record, not the recycled pool's current event, and reads the actual payout vector. ERC-6909 module operator approval exists only during redemption and is then cleared. A settlement push failure can create an owed balance; the separate pinned-settlement recovery entry retrieves it into the account. Neither recovery entry expands trade authority.

The account trusts the pinned upstream module, pool, token and settlement implementations. Their correctness, admin powers, oracle resolution and backing are outside the guard's guarantee. Spending limits do not make an unsafe protocol safe.

## Evidence boundary

The executor stores the same signed bytes and hash before sending. Confirmation is decoded only from the expected guard account and intent/version/market event. Success without that event is unknown, not a fabricated fill. Partial fill, no fill, reverted receipt and precheck rejection remain distinct.

`tests/unit/abi.test.ts` compares compiler interface signatures/output layouts with the published SDK, including pool-vault and settlement ABIs. The static market struct and SDK mapping getter encode the same ordered ABI words. `tests/unit/execution.test.ts` rejects foreign/missing evidence. The live-fork test invokes the actual deployed testnet protocol on a local fork.

## Operational boundary

Each guard account has its own HMAC-derived executor and Durable Object, avoiding shared-executor nonce races. Sessions use origin-bound, expiring owner signatures and server-side hashed session tokens. POST routes enforce same origin. This version expects an EOA owner; smart-account EIP-1271 sign-in is not implemented.

The strategy provider has no tools, keys or permission-edit action. Output is strictly parsed. Model failure/refusal, stale data, RPC uncertainty, gas exhaustion or counter limits stop new trading. Service controls do not replace the contract's checks. A compromised server/executor can still spend up to the owner's active allowance in authorized markets.
