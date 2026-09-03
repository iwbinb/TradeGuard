import { z } from "zod";
import { addressSchema, policyInputSchema } from "./policy";

export const uintString = z
  .string()
  .max(78)
  .regex(/^(0|[1-9]\d*)$/);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const text = z.string().max(2000);
const policy = policyInputSchema
  .extend({
    version: time,
    spent: uintString,
    revoked: z.boolean(),
  })
  .refine((p) => BigInt(p.spent) <= BigInt(p.budget), "Spent exceeds budget");
export const snapshotSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["simulation", "live"]),
  owner: text.nullable(),
  account: text.nullable(),
  balance: uintString,
  decimals: z.literal(6),
  policy: policy.nullable(),
  history: z.array(policy).max(100),
  activities: z
    .array(
      z.object({
        id: text,
        at: time,
        action: text,
        amount: uintString,
        status: z.enum([
          "confirmed",
          "filled",
          "partial",
          "no-fill",
          "pre-check",
          "pending",
          "reverted",
          "unknown",
        ]),
        source: z.enum(["simulation", "onchain", "precheck"]),
        detail: text,
        marketId: id.optional(),
        txHash: id.optional(),
        paid: uintString.optional(),
        filled: uintString.optional(),
        policyVersion: time.optional(),
      }),
    )
    .max(100),
  positions: z
    .array(
      z.object({
        marketId: id,
        label: text,
        up: uintString,
        down: uintString,
        cost: uintString,
        status: z.enum(["trading", "locked", "resolved", "voided"]),
        payout: z.tuple([uintString, uintString]),
        claimable: uintString,
      }),
    )
    .max(128),
  runner: z.object({
    running: z.boolean(),
    strategy: z.enum(["reference", "model"]),
    message: text,
    pendingTx: id.optional(),
    error: text.optional(),
    lastRun: time.optional(),
    monitoring: z.boolean().optional(),
    modelCalls: time.optional(),
    gasSpent: uintString.optional(),
  }),
  now: time,
  fetchedAt: time,
  marketIds: z.array(id).max(64),
  recoveries: z
    .array(
      z.object({
        marketId: id,
        poolCredit: uintString,
        settlementCredit: uintString,
      }),
    )
    .max(64)
    .optional(),
});
export const configSchema = z.object({
  chainId: z.literal(50312),
  network: text,
  factory: addressSchema.nullable(),
  collateral: addressSchema,
  module: addressSchema,
  explorer: z.literal("https://shannon-explorer.somnia.network"),
  publicRpc: z.literal("https://api.infra.testnet.somnia.network"),
  liveConfigured: z.boolean(),
  executionConfigured: z.boolean(),
  modelConfigured: z.boolean(),
});
export const marketSchema = z.object({
  id,
  label: text,
  asset: text,
  intervalSec: time,
  expiry: time,
  pool: addressSchema,
  market: addressSchema,
  collateral: addressSchema,
  outcomeToken: addressSchema,
  decimals: z.literal(6),
  status: z.number().int().min(0).max(5),
  yesId: uintString,
  noId: uintString,
  nonce: uintString,
  venueId: id,
  operatorId: time,
  bestAsk: uintString.nullable(),
  bestBid: uintString.nullable(),
  tickSize: uintString,
  lotSize: uintString,
  takerFee: uintString,
  minQuantity: uintString,
  fetchedAt: time,
});
export const marketsResponseSchema = z.object({
  markets: z.array(marketSchema).max(24),
  unavailable: time,
  source: z.literal("live-testnet"),
  fetchedAt: time,
});
export const accountResponseSchema = z.object({
  snapshot: snapshotSchema.refine(
    (s) =>
      s.mode === "live" &&
      !!s.owner &&
      addressSchema.safeParse(s.owner).success &&
      (s.account === null || addressSchema.safeParse(s.account).success),
  ),
  executor: addressSchema.nullable(),
  authenticated: z.boolean(),
  historyCoverage: text,
});
