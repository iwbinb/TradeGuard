import type { Activity, Market, Outcome, PolicyInput, Snapshot } from "./types";
import { preflight, validatePolicy } from "./policy";
export const DEMO_MARKET = `0x${"1".padStart(64, "0")}`;
export const DEMO_EXECUTOR = `0x${"2".padStart(40, "0")}`;
export const DEMO_TIME = Date.parse("2026-09-02T09:05:00Z") / 1000;
export function demoMarket(now = DEMO_TIME): Market {
  return {
    id: DEMO_MARKET,
    label: "BTC · 15 min",
    asset: "BTC",
    intervalSec: 900,
    expiry: DEMO_TIME + 600,
    pool: "",
    market: "",
    collateral: "",
    decimals: 6,
    status: now < DEMO_TIME + 600 ? 1 : 2,
    yesId: "11",
    noId: "12",
    outcomeToken: "",
    nonce: "1",
    venueId: "",
    operatorId: 0,
    bestAsk: "500000",
    bestBid: "490000",
    tickSize: "1000",
    lotSize: "1000",
    minQuantity: "1000",
    takerFee: "0",
    fetchedAt: now,
  };
}
export function seedSimulation(): Snapshot {
  return {
    version: 1,
    mode: "simulation",
    owner: "Demo owner",
    account: "Demo account",
    balance: "96800000",
    decimals: 6,
    policy: {
      version: 1,
      executor: DEMO_EXECUTOR,
      budget: "20000000",
      perOrder: "5000000",
      spent: "3200000",
      validAfter: DEMO_TIME - 600,
      validUntil: DEMO_TIME + 3300,
      maxPriceBps: 9500,
      revoked: false,
      marketIds: [DEMO_MARKET],
    },
    history: [],
    runner: {
      running: true,
      strategy: "model",
      message: "Waiting for the next signal.",
    },
    now: DEMO_TIME,
    fetchedAt: DEMO_TIME,
    marketIds: [DEMO_MARKET],
    positions: [
      {
        marketId: DEMO_MARKET,
        label: "BTC · 15 min",
        up: "6400000",
        down: "0",
        cost: "3200000",
        status: "trading",
        payout: ["0", "0"],
        claimable: "0",
      },
    ],
    activities: [
      {
        id: "demo-3",
        at: DEMO_TIME - 60,
        action: "Order blocked",
        amount: "8000000",
        status: "pre-check",
        source: "simulation",
        detail:
          "The 8.00 tUSDC request exceeds the 5.00 per-order limit. No transaction was sent.",
      },
      {
        id: "demo-2",
        at: DEMO_TIME - 120,
        action: "BTC · Up",
        amount: "3200000",
        paid: "3200000",
        filled: "6400000",
        status: "filled",
        source: "simulation",
        detail:
          "Simulated IOC fill. 3.20 tUSDC paid for 6.40 Up contracts. No real funds.",
        marketId: DEMO_MARKET,
      },
      {
        id: "demo-1",
        at: DEMO_TIME - 600,
        action: "Policy created",
        amount: "20000000",
        status: "confirmed",
        source: "simulation",
        detail:
          "Simulated trading permission. The agent cannot change limits or withdraw funds.",
      },
    ],
  };
}
function add(
  snapshot: Snapshot,
  item: Omit<Activity, "at" | "source">,
): Snapshot {
  return {
    ...snapshot,
    activities: [
      { ...item, at: snapshot.now, source: "simulation" as const },
      ...snapshot.activities,
    ].slice(0, 100),
  };
}
export function simulationOrder(
  snapshot: Snapshot,
  amount: bigint,
  side: Outcome,
  intentId: string,
): Snapshot {
  if (snapshot.activities.some((a) => a.id === intentId))
    throw new Error("This intent was already processed.");
  const market = demoMarket(snapshot.now);
  const terminal = snapshot.positions.find(
    (p) =>
      p.marketId === market.id && ["resolved", "voided"].includes(p.status),
  );
  if (terminal) market.status = terminal.status === "resolved" ? 4 : 5;
  const error = preflight(
    snapshot.policy,
    market,
    amount,
    snapshot.now,
    BigInt(snapshot.balance),
  );
  if (error)
    return add(snapshot, {
      id: intentId,
      action: "Order blocked",
      amount: amount.toString(),
      status: "pre-check",
      detail: `${error} Simulation only; no transaction was sent.`,
    });
  const policy = snapshot.policy!;
  const positions = snapshot.positions.map((p) => ({ ...p }));
  let position = positions.find(
    (p) => p.marketId === market.id && p.status === "trading",
  );
  if (!position) {
    position = {
      marketId: market.id,
      label: market.label,
      up: "0",
      down: "0",
      cost: "0",
      status: "trading",
      payout: ["0", "0"],
      claimable: "0",
    };
    positions.push(position);
  }
  position[side] = (BigInt(position[side]) + amount * 2n).toString();
  position.cost = (BigInt(position.cost) + amount).toString();
  return add(
    {
      ...snapshot,
      balance: (BigInt(snapshot.balance) - amount).toString(),
      positions,
      policy: { ...policy, spent: (BigInt(policy.spent) + amount).toString() },
    },
    {
      id: intentId,
      action: `BTC · ${side === "up" ? "Up" : "Down"}`,
      amount: amount.toString(),
      paid: amount.toString(),
      filled: (amount * 2n).toString(),
      status: "filled",
      marketId: market.id,
      detail:
        "Simulated IOC fill at 0.50. Not a market forecast or a real transaction.",
    },
  );
}
export function simulationPolicy(
  snapshot: Snapshot,
  input: PolicyInput,
  id: string,
): Snapshot {
  const errors = validatePolicy(input, snapshot.now);
  if (errors.length) throw new Error(errors[0]);
  const version = (snapshot.policy?.version ?? 0) + 1;
  return add(
    {
      ...snapshot,
      policy: { ...input, spent: "0", revoked: false, version },
      history: snapshot.policy
        ? [snapshot.policy, ...snapshot.history]
        : snapshot.history,
      runner: {
        ...snapshot.runner,
        running: false,
        message: "Permission ready. Start the agent when you choose.",
      },
    },
    {
      id,
      action: "Policy created",
      amount: input.budget,
      status: "confirmed",
      detail:
        "Simulation: a new permission version replaces the old one. Existing positions remain.",
    },
  );
}
export function simulationRevoke(snapshot: Snapshot, id: string): Snapshot {
  return add(
    {
      ...snapshot,
      policy: snapshot.policy ? { ...snapshot.policy, revoked: true } : null,
      runner: {
        ...snapshot.runner,
        running: false,
        message: "Trading permission revoked. Existing positions remain.",
      },
    },
    {
      id,
      action: "Permission revoked",
      amount: "0",
      status: "confirmed",
      detail:
        "Simulation only. New orders are blocked; existing positions can still settle.",
    },
  );
}
export function simulationSettle(
  snapshot: Snapshot,
  outcome: Outcome | "void",
  id: string,
): Snapshot {
  const positions = snapshot.positions.map((p) => {
    if (p.status !== "trading" && p.status !== "locked") return p;
    const payout: [string, string] =
      outcome === "void"
        ? ["1", "1"]
        : outcome === "up"
          ? ["1", "0"]
          : ["0", "1"];
    const claimable =
      outcome === "void"
        ? (BigInt(p.up) + BigInt(p.down)) / 2n
        : BigInt(p[outcome]);
    return {
      ...p,
      status: outcome === "void" ? ("voided" as const) : ("resolved" as const),
      payout,
      claimable: claimable.toString(),
    };
  });
  return add(
    { ...snapshot, positions },
    {
      id,
      action: outcome === "void" ? "Market voided" : "Market resolved",
      amount: "0",
      status: "confirmed",
      detail:
        "Controlled simulation outcome. This does not alter a real market or its oracle.",
    },
  );
}
export function simulationClaim(snapshot: Snapshot, id: string): Snapshot {
  const received = snapshot.positions.reduce(
    (n, p) => n + BigInt(p.claimable),
    0n,
  );
  return add(
    {
      ...snapshot,
      balance: (BigInt(snapshot.balance) + received).toString(),
      positions: snapshot.positions.map((p) =>
        ["resolved", "voided"].includes(p.status)
          ? { ...p, up: "0", down: "0", claimable: "0" }
          : p,
      ),
    },
    {
      id,
      action: "Positions redeemed",
      amount: received.toString(),
      status: "confirmed",
      detail:
        "Simulation redemption. Receiving funds does not increase the trading budget.",
    },
  );
}
export function simulationWithdraw(
  snapshot: Snapshot,
  value: bigint,
  id: string,
): Snapshot {
  if (value <= 0n || value > BigInt(snapshot.balance))
    throw new Error("Choose an amount within your available balance.");
  return add(
    { ...snapshot, balance: (BigInt(snapshot.balance) - value).toString() },
    {
      id,
      action: "Funds withdrawn",
      amount: value.toString(),
      status: "confirmed",
      detail:
        "Simulation: only available funds are returned to the owner. Unsettled positions are unchanged.",
    },
  );
}
