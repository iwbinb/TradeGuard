export type Mode = "simulation" | "live";
export type Strategy = "reference" | "model";
export type HexAddress = `0x${string}`;
export type Outcome = "up" | "down";
export type ActivityStatus =
  | "confirmed"
  | "filled"
  | "partial"
  | "no-fill"
  | "pre-check"
  | "pending"
  | "reverted"
  | "unknown";
export interface Policy {
  version: number;
  executor: string;
  budget: string;
  perOrder: string;
  spent: string;
  validAfter: number;
  validUntil: number;
  maxPriceBps: number;
  revoked: boolean;
  marketIds: string[];
}
export interface Market {
  id: string;
  label: string;
  asset: string;
  intervalSec: number;
  expiry: number;
  pool: string;
  market: string;
  collateral: string;
  decimals: number;
  status: number;
  yesId: string;
  noId: string;
  outcomeToken: string;
  nonce: string;
  venueId: string;
  operatorId: number;
  bestAsk: string | null;
  bestBid: string | null;
  tickSize: string;
  lotSize: string;
  takerFee: string;
  minQuantity: string;
  fetchedAt: number;
}
export interface Activity {
  id: string;
  at: number;
  action: string;
  amount: string;
  status: ActivityStatus;
  source: "simulation" | "onchain" | "precheck";
  detail: string;
  marketId?: string;
  txHash?: string;
  paid?: string;
  filled?: string;
  policyVersion?: number;
}
export interface Position {
  marketId: string;
  label: string;
  up: string;
  down: string;
  cost: string;
  status: "trading" | "locked" | "resolved" | "voided";
  payout: [string, string];
  claimable: string;
}
export interface RunnerStatus {
  running: boolean;
  strategy: Strategy;
  message: string;
  pendingTx?: string;
  error?: string;
  lastRun?: number;
  monitoring?: boolean;
  modelCalls?: number;
  gasSpent?: string;
}
export interface Snapshot {
  version: 1;
  mode: Mode;
  owner: string | null;
  account: string | null;
  balance: string;
  decimals: number;
  policy: Policy | null;
  history: Policy[];
  activities: Activity[];
  positions: Position[];
  runner: RunnerStatus;
  now: number;
  fetchedAt: number;
  marketIds: string[];
  recoveries?: {
    marketId: string;
    poolCredit: string;
    settlementCredit: string;
  }[];
}
export interface PublicConfig {
  chainId: 50312;
  network: string;
  factory: string | null;
  collateral: string;
  module: string;
  explorer: string;
  liveConfigured: boolean;
  executionConfigured: boolean;
  modelConfigured: boolean;
  publicRpc: string;
}
export interface PolicyInput {
  executor: string;
  budget: string;
  perOrder: string;
  validAfter: number;
  validUntil: number;
  maxPriceBps: number;
  marketIds: string[];
}
