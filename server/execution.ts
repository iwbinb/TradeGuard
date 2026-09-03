import {
  decodeEventLog,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { TradeGuardAccountAbi } from "../shared/generated/TradeGuardAccount";
import type { Activity } from "../shared/types";

// Conservative maximum gas reservation, not measured spend. It never resets on pause/retry.
export function reserveGas(
  spent: string,
  gas: bigint,
  price: bigint,
  priceLimit: bigint,
  balance: bigint,
): string {
  if (gas <= 0n || gas > 10_000_000n || price <= 0n || price > priceLimit)
    throw new Error("Gas estimate exceeds the configured ceiling.");
  const maximum = gas * price;
  if (balance < maximum)
    throw new Error("The dedicated executor needs more testnet STT for gas.");
  const next = BigInt(spent) + maximum;
  if (next > 50_000_000_000_000_000n)
    throw new Error(
      "The 0.05 STT automation gas cap is reached. Use owner-signed recovery.",
    );
  return next.toString();
}
export function receiptEvidence(
  receipt: Pick<TransactionReceipt, "status" | "logs">,
  account: Address,
  pending: {
    kind: "buy" | "claim" | "settlementCredit";
    marketId: Hex;
    intent: Hex;
    version: number;
    quantity?: string;
  },
): Pick<
  Activity,
  "action" | "amount" | "paid" | "filled" | "status" | "detail"
> {
  if (receipt.status === "reverted")
    return {
      action: "Transaction reverted",
      amount: "0",
      status: "reverted",
      detail:
        "The chain rejected the transaction. Gas is separate from the trading budget.",
    };
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== account.toLowerCase()) continue;
    try {
      const d = decodeEventLog({
        abi: TradeGuardAccountAbi,
        data: log.data,
        topics: log.topics,
      });
      if (
        pending.kind === "buy" &&
        d.eventName === "BuyExecuted" &&
        d.args.intentId === pending.intent &&
        d.args.marketId === pending.marketId &&
        d.args.version === BigInt(pending.version)
      ) {
        const paid = d.args.spent.toString(),
          filled = d.args.filled.toString();
        return {
          action: "Order confirmed",
          amount: paid,
          paid,
          filled,
          status:
            d.args.filled === 0n
              ? "no-fill"
              : pending.quantity && d.args.filled < BigInt(pending.quantity)
                ? "partial"
                : "filled",
          detail:
            "Confirmed account event. Paid collateral and received outcome tokens are actual on-chain amounts.",
        };
      }
      if (
        ((pending.kind === "claim" && d.eventName === "Claimed") ||
          (pending.kind === "settlementCredit" &&
            d.eventName === "SettlementCreditRecovered")) &&
        d.args.marketId === pending.marketId
      )
        return {
          action: "Recovery confirmed",
          amount: d.args.received.toString(),
          status: "confirmed",
          detail:
            "Actual collateral received by the TradeGuard account. A zero amount may mean settlement credit is pending; inspect Protocol credits.",
        };
    } catch {
      /* Unrelated protocol logs are not account evidence. */
    }
  }
  return {
    action: "Receipt needs review",
    amount: "0",
    status: "unknown",
    detail:
      "The receipt succeeded but the expected account event was not found. No fill or payout is assumed; automation is stopped.",
  };
}
