import { describe, expect, it } from "vitest";
import {
  amount,
  decimalInput,
  parseAmount,
  spentPercent,
} from "../../shared/money";
import { preflight, validatePolicy, policyState } from "../../shared/policy";
import {
  demoMarket,
  seedSimulation,
  simulationOrder,
  simulationPolicy,
  simulationRevoke,
  simulationSettle,
  simulationClaim,
  simulationWithdraw,
} from "../../shared/simulation";
import {
  quoteBuy,
  referenceDecision,
  decisionSchema,
} from "../../server/strategy";

describe("exact amounts", () => {
  it("never rounds user input through floating point", () => {
    expect(parseAmount("16.800001")).toBe(16800001n);
    expect(parseAmount("0.000001")).toBe(1n);
  });
  it.each([
    "1e6",
    "-1",
    "NaN",
    "Infinity",
    "01",
    "1.0000001",
    "1,000",
    "",
    "0x10",
  ])("rejects %s", (value) => expect(() => parseAmount(value)).toThrow());
  it("formats and round trips raw values", () => {
    expect(amount("96800000")).toBe("96.80");
    expect(decimalInput("1234567")).toBe("1.234567");
    expect(spentPercent("3200000", "20000000")).toBe(16);
  });
  it("supports 18 decimals without precision loss", () =>
    expect(parseAmount("1.123456789123456789", 18)).toBe(1123456789123456789n));
});
describe("permission rules", () => {
  const seed = seedSimulation();
  it("distinguishes scheduled, expired, revoked and exhausted", () => {
    const p = seed.policy!;
    expect(policyState(null, seed.now)).toBe("none");
    expect(policyState(p, p.validAfter - 1)).toBe("scheduled");
    expect(policyState(p, p.validUntil)).toBe("expired");
    expect(policyState({ ...p, revoked: true }, seed.now)).toBe("revoked");
    expect(policyState({ ...p, spent: p.budget }, seed.now)).toBe("exhausted");
  });
  it("rejects inconsistent limits and duplicate markets", () => {
    const p = seed.policy!;
    const input = {
      executor: p.executor,
      budget: "1",
      perOrder: "2",
      validAfter: seed.now,
      validUntil: seed.now - 1,
      maxPriceBps: 9000,
      marketIds: [...p.marketIds, ...p.marketIds],
    };
    expect(validatePolicy(input, seed.now).length).toBe(3);
  });
  it("blocks stale data independently of budget", () => {
    const m = demoMarket(seed.now);
    m.fetchedAt -= 61;
    expect(preflight(seed.policy, m, 1000000n, seed.now, 100000000n)).toMatch(
      /stale/,
    );
  });
  it("does not authorize a different market", () => {
    const m = { ...demoMarket(seed.now), id: "other" };
    expect(preflight(seed.policy, m, 1000000n, seed.now, 100000000n)).toMatch(
      /not in/,
    );
  });
});
describe("isolated simulation", () => {
  it("charges accepted requests and preserves rejected budgets", () => {
    const seed = seedSimulation();
    const blocked = simulationOrder(seed, 8000000n, "up", "oversized");
    expect(blocked.balance).toBe(seed.balance);
    expect(blocked.policy?.spent).toBe("3200000");
    expect(blocked.activities[0].source).toBe("simulation");
    expect(blocked.activities[0].txHash).toBeUndefined();
    const filled = simulationOrder(blocked, 1000000n, "up", "normal");
    expect(filled.balance).toBe("95800000");
    expect(filled.policy?.spent).toBe("4200000");
    expect(() => simulationOrder(filled, 1000000n, "up", "normal")).toThrow(
      /already/,
    );
  });
  it("revocation keeps positions and allows recovery without a refill", () => {
    const seed = seedSimulation();
    const revoked = simulationRevoke(seed, "revoke");
    const blocked = simulationOrder(revoked, 1000000n, "up", "blocked");
    expect(blocked.policy?.spent).toBe(seed.policy?.spent);
    const claimed = simulationClaim(
      simulationSettle(blocked, "up", "resolved"),
      "claim",
    );
    expect(claimed.balance).toBe("103200000");
    expect(claimed.policy?.spent).toBe("3200000");
    expect(simulationClaim(claimed, "again").balance).toBe(claimed.balance);
    expect(
      simulationOrder(claimed, 1000000n, "up", "closed").activities[0].status,
    ).toBe("pre-check");
  });
  it("does not allow trading after settlement", () => {
    const settled = simulationSettle(seedSimulation(), "up", "settle");
    expect(
      simulationOrder(settled, 1000000n, "up", "after-settle").activities[0]
        .detail,
    ).toMatch(/no longer trading/);
  });
  it("has honest void and losing outcomes", () => {
    expect(
      simulationClaim(simulationSettle(seedSimulation(), "down", "s"), "c")
        .balance,
    ).toBe("96800000");
    expect(
      simulationClaim(simulationSettle(seedSimulation(), "void", "s"), "c")
        .balance,
    ).toBe("100000000");
  });
  it("withdrawal cannot spend unsettled positions or reset allowance", () => {
    const s = seedSimulation();
    expect(() => simulationWithdraw(s, 100000000n, "w")).toThrow();
    const next = simulationWithdraw(s, 1000000n, "w");
    expect(next.balance).toBe("95800000");
    expect(next.policy).toEqual(s.policy);
  });
  it("new permission preserves positions and stops the agent", () => {
    const s = seedSimulation();
    const p = s.policy!;
    const input = {
      executor: p.executor,
      budget: p.budget,
      perOrder: p.perOrder,
      validAfter: s.now,
      validUntil: s.now + 300,
      maxPriceBps: p.maxPriceBps,
      marketIds: p.marketIds,
    };
    const next = simulationPolicy(s, input, "new");
    expect(next.policy?.version).toBe(2);
    expect(next.policy?.spent).toBe("0");
    expect(next.positions).toEqual(s.positions);
    expect(next.runner.running).toBe(false);
  });
});
describe("strategy boundary", () => {
  it("limits and quantizes exact quantities", () => {
    const s = seedSimulation();
    const m = demoMarket(s.now);
    const q = quoteBuy(m, s.policy!, "up", 1000000n);
    expect(q.quantity % BigInt(m.lotSize)).toBe(0n);
    expect(q.maxSpend).toBe(1000000n);
    expect((q.quantity * q.yesPrice) / 1000000n).toBeLessThanOrEqual(
      q.maxSpend,
    );
  });
  it("converts down prices to the shared yes book", () => {
    const s = seedSimulation();
    const q = quoteBuy(demoMarket(s.now), s.policy!, "down", 1000000n);
    expect(q.up).toBe(false);
    expect(q.yesPrice).toBe(489000n);
  });
  it("abstains without liquidity", () =>
    expect(referenceDecision({ ...demoMarket(), bestAsk: null }).decision).toBe(
      "abstain",
    ));
  it("rejects model attempts to add authority", () =>
    expect(
      decisionSchema.safeParse({
        decision: "buy",
        side: "up",
        confidence: 1,
        reason: "x",
        budget: "1000000000",
      }).success,
    ).toBe(false));
  it("rejects invalid model confidence", () =>
    expect(
      decisionSchema.safeParse({
        decision: "buy",
        side: "up",
        confidence: 2,
        reason: "x",
      }).success,
    ).toBe(false));
});
