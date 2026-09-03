import { describe, expect, it } from "vitest";
import { SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import {
  contextMode,
  freshSpot,
  modelContextReady,
  modelMarketInput,
  oracleScale,
} from "../../server/event-context";
import { demoMarket } from "../../shared/simulation";
import type { Market, ModelEventContext } from "../../shared/types";
function contextual(now: number): Market {
  const expiry = Math.floor(now / 1000) + 600;
  const context: ModelEventContext = {
    state: "ready",
    question: "BTC closes at or above its opening price",
    definitionSource: "official-indexer",
    mode: "reference",
    upCondition: "close >= opening",
    tradingStart: Math.floor(now / 1000) - 300,
    expiry,
    oracleQuestionId: "20",
    oracleAdapter: SOMNIA_TESTNET_ADDRESSES.oracleHub!,
    referenceQuestionId: "10",
    referenceLinkSource: "official-indexer",
    baseline: {
      raw: "7762760",
      human: "77627.6",
      decimals: 2,
      scaleSource: "pinned-sdk-hub-convention",
      source: "oracle-adapter",
      voided: false,
    },
    spot: {
      symbol: "BTC/USDC",
      quote: "USDC",
      raw: "77800000000000000000000",
      human: "77800",
      decimals: 18,
      oracleUpdatedAtMs: now - 500,
      sourceUpdatedAtMs: now - 800,
      source: "official-testnet-price-feed",
    },
    missing: [],
    warnings: [],
  };
  return {
    ...demoMarket(),
    expiry,
    fetchedAt: Math.floor(now / 1000),
    bestAsk: "562000",
    bestBid: "532000",
    eventContext: context,
  };
}
describe("event context provenance and units", () => {
  it("never treats strike zero as a zero-dollar threshold", () => {
    expect(contextMode("0", "12")).toBe("reference");
    expect(contextMode("0", null)).toBe("unknown");
    expect(contextMode(null, "12")).toBe("unknown");
    expect(contextMode("7500000", null)).toBe("fixed");
  });
  it("limits the documented two-decimal convention to the pinned hub and absent getter", () => {
    expect(
      oracleScale(SOMNIA_TESTNET_ADDRESSES.oracleHub!, null, true),
    ).toEqual({ decimals: 2, source: "pinned-sdk-hub-convention" });
    expect(
      oracleScale("0x1111111111111111111111111111111111111111", null, true)
        .decimals,
    ).toBeNull();
    expect(
      oracleScale(SOMNIA_TESTNET_ADDRESSES.oracleHub!, null, false).decimals,
    ).toBeNull();
    expect(
      oracleScale(SOMNIA_TESTNET_ADDRESSES.oracleHub!, 18n, false).decimals,
    ).toBe(18);
  });
  it("normalizes outcome quotes separately from underlying prices", () => {
    const now = Date.now();
    const input = modelMarketInput(contextual(now), now);
    expect(input.contractPrices.upAsk).toBe("0.562");
    expect(input.contractPrices.spread).toBe("0.03");
    expect(input.contractPrices.downAskEstimate).toBe("0.468");
    expect(input.event?.baseline?.human).toBe("77627.6");
    expect(input.event?.spot?.human).toBe("77800");
    expect(input.contextReadyForAnalysis).toBe(true);
  });
  it("rejects stale underlying source data even while oracle writes are fresh", () => {
    const now = Date.now();
    const market = contextual(now);
    market.eventContext!.spot!.sourceUpdatedAtMs = now - 20000;
    expect(freshSpot(market.eventContext!.spot, now)).toBe(false);
    expect(modelContextReady(market, now)).toBe(false);
  });
  it("rejects expired or incomplete context and does not invent missing fields", () => {
    const now = Date.now();
    const market = contextual(now);
    expect(modelContextReady(market, now + 700000)).toBe(false);
    market.eventContext!.state = "incomplete";
    expect(modelContextReady(market, now)).toBe(false);
    expect(modelMarketInput(demoMarket(), now).event).toBeNull();
  });
});
