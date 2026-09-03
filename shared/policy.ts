import { z } from "zod";
import type { Market, Policy, PolicyInput } from "./types";
export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((s) => !/^0x0{40}$/.test(s), "Use a non-zero address.");
export const rawAmountSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .refine((s) => BigInt(s) <= (1n << 128n) - 1n);
export const policyInputSchema = z
  .object({
    executor: addressSchema,
    budget: rawAmountSchema,
    perOrder: rawAmountSchema,
    validAfter: z.number().int().nonnegative(),
    validUntil: z.number().int().positive(),
    maxPriceBps: z.number().int().min(1).max(9999),
    marketIds: z
      .array(z.string().regex(/^0x[0-9a-fA-F]{64}$/))
      .min(1)
      .max(16),
  })
  .strict();
export function validatePolicy(input: PolicyInput, now: number): string[] {
  const parsed = policyInputSchema.safeParse(input);
  if (!parsed.success)
    return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const errors: string[] = [];
  if (BigInt(input.perOrder) <= 0n)
    errors.push("Per-order limit must be greater than zero.");
  if (BigInt(input.budget) < BigInt(input.perOrder))
    errors.push("Total budget must cover the per-order limit.");
  if (input.validUntil <= now || input.validUntil <= input.validAfter)
    errors.push("Choose a future expiry after the start time.");
  if (new Set(input.marketIds).size !== input.marketIds.length)
    errors.push("Each market can only appear once.");
  return errors;
}
export function policyState(
  policy: Policy | null,
  now: number,
): "none" | "revoked" | "scheduled" | "expired" | "exhausted" | "active" {
  if (!policy) return "none";
  if (policy.revoked) return "revoked";
  if (now < policy.validAfter) return "scheduled";
  if (now >= policy.validUntil) return "expired";
  if (BigInt(policy.spent) >= BigInt(policy.budget)) return "exhausted";
  return "active";
}
export function preflight(
  policy: Policy | null,
  market: Market,
  cost: bigint,
  now: number,
  balance: bigint,
): string | null {
  const state = policyState(policy, now);
  if (!policy || state !== "active") return `Trading permission is ${state}.`;
  if (!policy.marketIds.includes(market.id))
    return "This market is not in your permission.";
  if (market.status !== 1 || market.expiry <= now)
    return "This market is no longer trading.";
  if (now - market.fetchedAt > 60)
    return "Market data is stale. Refresh before trading.";
  if (cost <= 0n) return "Order amount must be greater than zero.";
  if (cost > BigInt(policy.perOrder))
    return "Order exceeds the per-order limit.";
  if (cost > BigInt(policy.budget) - BigInt(policy.spent))
    return "Order exceeds the remaining budget.";
  if (cost > balance) return "Insufficient available collateral.";
  return null;
}
