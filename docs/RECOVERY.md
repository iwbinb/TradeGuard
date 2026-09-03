# Independent recovery

These instructions concern **Somnia Shannon (50312)** only. Verify the chain, account address and `owner()` first. Do not send funds to an executor or a contract copied from an unverified message. All contract ABIs are in `shared/generated/`; source is in `contracts/src/`.

You do not need the TradeGuard backend or its executor secret to recover your own account. Use a trusted wallet-connected contract interface with the verified ABI and your owner wallet. Never enter the owner private key into a website.

## Stop new exposure

- `revoke()` from the owner wallet invalidates the current trading permission **after its receipt confirms**.
- Pause only stops the hosted strategy; it does not revoke the on-chain executor.
- Stop all automation also stops settlement monitoring. An already broadcast transaction cannot be canceled merely by stopping the website.
- If revocation races with a pending buy, inspect transaction ordering and receipts. A buy confirmed before revocation cannot be undone.

## Inspect funds

Read `collateral()`, `policy()`, `remaining()`, and the collateral token's `balanceOf(account)`. Balance and trading allowance are different. Read `trackedMarketCount()` / `trackedMarket(index)` and `bindings(marketId)` to recover archived market, pool, outcome token, outcome IDs, nonce and operator/venue identity.

Outcome holdings use ERC-6909: `balanceOf(account, yesId)` / `balanceOf(account, noId)`. Do not treat those quantities as withdrawable tUSDC. A market can be locked, unresolved, or delayed; the account cannot force the oracle to settle.

## Recovery entries

| Entry                                        | Caller | Result                                                                             |
| -------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `withdraw(amount)`                           | Owner  | Transfers available collateral only to the owner                                   |
| `claim(marketId)`                            | Anyone | Redeems eligible settled outcomes; collateral goes only to the account             |
| `recoverPoolCredit(marketId)`                | Owner  | Pulls the pool's withdrawable collateral credit into the account                   |
| `recoverSettlementCredit(marketId)`          | Anyone | Pulls failed-push settlement credit from the pinned settlement into the account    |
| `recoverPosition(marketId, outcome, amount)` | Owner  | Transfers outcome tokens to the owner; `0=Up`, `1=Down`; this is not a cash payout |

Claim uses the archived market identity, not whatever event currently occupies a recycled pool. It uses the actual payout vector, including non-uniform void distributions. A losing outcome can have zero entitlement. Displayed gross claimable amounts can differ from net receipt amounts due to fees and rounding.

If `claim()` reports zero received, inspect the pinned settlement's `owed(account, collateral)` before assuming no entitlement. If a pool has fallback credits, inspect `getWithdrawableBalance(account, collateral)`. Recover credits first, then withdraw available collateral to the owner. Recovered proceeds do not refill the trading budget.

## Unknown transactions

Keep the transaction hash. An RPC timeout is not evidence of failure. Check the explorer and independent receipt lookup before signing again. TradeGuard retains the exact signed executor bytes and hash and never creates a replacement order automatically. After five minutes of uncertainty, automation stops for manual review. Browser-owned transactions retain a per-owner pending hash across refreshes; reconnect the same owner and select **Check transaction**.

Do not clear browser storage to bypass a pending transaction until its outcome is independently known. After a confirmed revert, gas may be spent even though the trading budget is unchanged. If a receipt succeeded without the expected account event, do not infer a fill; investigate the actual transaction and contract identity.

## Limits and residual risks

Recovery cannot eliminate upstream protocol/token bugs, missing oracle resolution, insufficient settlement backing, RPC unavailability or wallet compromise. No upgrade administrator can repair an existing non-upgradeable account. Keep test exposure small and preserve the account/source/compiler references independently of this service.
