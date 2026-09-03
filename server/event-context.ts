import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  formatUnits,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import {
  SOMNIA_TESTNET_ADDRESSES,
  SOMNIA_TESTNET_PRICE_FEED,
  binaryModuleReadAbi,
} from "@somnia-chain/markets-sdk";
import { z } from "zod";
import type { Market, ModelEventContext } from "../shared/types";
import { boundedJson, HttpError } from "./http";
import { MODULE, rpc, type ProtocolConfig } from "./protocol";

export const oracleContextAbi = parseAbi([
  "function pullNumericAnswer(uint256 oracleQuestionId) view returns (int256 numericValue, bool voided)",
  "function PRICE_DECIMALS() view returns (uint256)",
]);
const uint = z.string().regex(/^\d{1,78}$/);
const id = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const metadataSchema = z.object({
  data: z.object({
    markets: z
      .array(
        z.object({
          id,
          asset: z.string().regex(/^[A-Z0-9]{1,12}$/),
          question: z.string().max(600).nullable(),
          strike: uint.nullable(),
          oracleQuestionId: uint,
          tradingStart: uint,
          expiry: uint,
        }),
      )
      .max(1),
    references: z
      .array(z.object({ market_id: id, referenceQuestionId: uint }))
      .max(2),
  }),
});
const feedSchema = z.object({
  data: z.object({
    Feed: z
      .array(
        z.object({
          symbol: z.string().max(40),
          base: z.string(),
          quote: z.string(),
          decimals: z.number().int().min(0).max(30),
          latestSpot: uint.nullable(),
          latestUpdatedAtMs: uint.nullable(),
          latestSourceUpdatedAtMs: uint.nullable(),
        }),
      )
      .max(2),
  }),
});
async function gql(
  url: string,
  query: string,
  variables: Record<string, string>,
) {
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new HttpError(502, "Event context source is unavailable.");
  return boundedJson(response, 32768);
}
export function contextMode(
  strike: string | null,
  referenceQuestionId: string | null,
): ModelEventContext["mode"] {
  // Zero is a convention for opening-reference mode, never a zero-dollar strike.
  if (strike === "0") return referenceQuestionId ? "reference" : "unknown";
  return strike && BigInt(strike) > 0n ? "fixed" : "unknown";
}
export function freshSpot(spot: ModelEventContext["spot"], now = Date.now()) {
  return (
    !!spot &&
    [spot.oracleUpdatedAtMs, spot.sourceUpdatedAtMs].every(
      (time) =>
        Number.isSafeInteger(time) &&
        time > 0 &&
        time <= now + 5000 &&
        now - time <= 15000,
    )
  );
}
export function modelContextReady(market: Market, now = Date.now()) {
  const c = market.eventContext;
  return (
    !!c &&
    c.state === "ready" &&
    c.expiry === market.expiry &&
    c.expiry * 1000 > now + 30000 &&
    c.tradingStart * 1000 <= now &&
    freshSpot(c.spot, now)
  );
}
export function oracleScale(
  adapter: string,
  getter: bigint | null,
  getterAbsent: boolean,
) {
  if (getter !== null && getter >= 0n && getter <= 30n)
    return { decimals: Number(getter), source: "adapter-getter" as const };
  // SDK 0.29.0 documents two decimals for this pinned OracleHub, not for arbitrary adapters.
  if (
    getterAbsent &&
    adapter.toLowerCase() === SOMNIA_TESTNET_ADDRESSES.oracleHub?.toLowerCase()
  )
    return { decimals: 2, source: "pinned-sdk-hub-convention" as const };
  return { decimals: null, source: null };
}
function absentGetter(error: unknown) {
  if (!(error instanceof BaseError)) return false;
  const cause = error.walk(
    (e) =>
      e instanceof ContractFunctionRevertedError ||
      e instanceof ContractFunctionZeroDataError,
  );
  return (
    cause instanceof ContractFunctionRevertedError ||
    cause instanceof ContractFunctionZeroDataError
  );
}
export async function enrichModelMarket(
  config: ProtocolConfig,
  market: Market,
): Promise<Market> {
  const priceQuote = SOMNIA_TESTNET_PRICE_FEED.quote;
  if (!priceQuote)
    throw new HttpError(502, "The price-feed quote is not configured.");
  const client = rpc(config);
  const rec = await client.readContract({
    address: MODULE,
    abi: binaryModuleReadAbi,
    functionName: "markets",
    args: [market.id as Hex],
  });
  if (
    rec[8].toLowerCase() !== market.market.toLowerCase() ||
    rec[9].toLowerCase() !== market.pool.toLowerCase() ||
    Number(rec[13]) !== market.expiry
  )
    throw new HttpError(
      409,
      "Market identity changed during event-context read.",
    );
  const c: ModelEventContext = {
    state: "incomplete",
    question: null,
    definitionSource: "official-indexer",
    mode: "unknown",
    upCondition: null,
    tradingStart: Number(rec[12]),
    expiry: Number(rec[13]),
    oracleQuestionId: rec[0].toString(),
    oracleAdapter: rec[6],
    referenceQuestionId: null,
    referenceLinkSource: "official-indexer",
    baseline: null,
    spot: null,
    missing: [],
    warnings: [
      "The question text and reference link are indexed metadata, not independently proven resolution code.",
      "The live price feed is contextual data, not the final settlement oracle answer.",
    ],
  };
  const metadata = await gql(
    config.INDEXER_URL,
    "query($id:String!) { markets: Market(where:{id:{_eq:$id}},limit:1) {id asset question strike oracleQuestionId tradingStart expiry} references: MarketReferenceLink(where:{market_id:{_eq:$id}},limit:2) {market_id referenceQuestionId} }",
    { id: market.id },
  )
    .then((value) => metadataSchema.parse(value).data)
    .catch(() => null);
  const row = metadata?.markets[0];
  if (
    !row ||
    row.id.toLowerCase() !== market.id.toLowerCase() ||
    row.oracleQuestionId !== c.oracleQuestionId ||
    Number(row.tradingStart) !== c.tradingStart ||
    Number(row.expiry) !== c.expiry
  ) {
    c.missing.push("event-metadata-unavailable-or-identity-mismatch");
    return { ...market, eventContext: c };
  }
  c.question = row.question;
  const reference =
    metadata.references.length === 1 ? metadata.references[0] : null;
  if (reference?.market_id.toLowerCase() === market.id.toLowerCase())
    c.referenceQuestionId = reference.referenceQuestionId;
  c.mode = contextMode(row.strike, c.referenceQuestionId);
  if (
    c.mode === "reference" &&
    row.question === `${row.asset} closes at or above its opening price`
  )
    c.upCondition =
      "Closing oracle price >= opening oracle price; equality belongs to Up. A voided reference does not define a winning side.";
  if (!c.upCondition)
    c.missing.push("resolution-rule-not-supported-or-confirmed");
  let getterAbsent = false;
  const [getter, opening, feed] = await Promise.all([
    client
      .readContract({
        address: rec[6],
        abi: oracleContextAbi,
        functionName: "PRICE_DECIMALS",
      })
      .catch((error) => {
        getterAbsent = absentGetter(error);
        return null;
      }),
    c.mode === "reference" && c.referenceQuestionId
      ? client
          .readContract({
            address: rec[6],
            abi: oracleContextAbi,
            functionName: "pullNumericAnswer",
            args: [BigInt(c.referenceQuestionId)],
          })
          .catch(() => null)
      : Promise.resolve(null),
    gql(
      SOMNIA_TESTNET_PRICE_FEED.url,
      "query($asset:String!,$quote:String!) { Feed(where:{base:{_eq:$asset},quote:{_eq:$quote}},limit:2) {symbol base quote decimals latestSpot latestUpdatedAtMs latestSourceUpdatedAtMs} }",
      { asset: row.asset, quote: priceQuote },
    )
      .then((value) => feedSchema.parse(value).data.Feed)
      .catch(() => null),
  ]);
  const scale = oracleScale(rec[6], getter, getterAbsent);
  if (scale.source === "pinned-sdk-hub-convention")
    c.warnings.push(
      "Opening-price decimals use the pinned SDK OracleHub convention (2), not an on-chain scale getter.",
    );
  const baseline =
    c.mode === "reference"
      ? (opening?.[0] ?? null)
      : c.mode === "fixed" && row.strike
        ? BigInt(row.strike)
        : null;
  if (baseline !== null)
    c.baseline = {
      raw: baseline.toString(),
      human:
        scale.decimals === null ? null : formatUnits(baseline, scale.decimals),
      decimals: scale.decimals,
      scaleSource: scale.source,
      source: c.mode === "reference" ? "oracle-adapter" : "indexed-strike",
      voided: opening?.[1] ?? false,
    };
  if (
    !c.baseline ||
    !c.baseline.human ||
    baseline === null ||
    baseline <= 0n ||
    c.baseline.voided
  )
    c.missing.push("baseline-unavailable-invalid-voided-or-unscaled");
  const f = feed?.length === 1 ? feed[0] : null;
  if (
    f &&
    f.base === row.asset &&
    f.quote === priceQuote &&
    f.latestSpot &&
    BigInt(f.latestSpot) > 0n &&
    f.latestUpdatedAtMs &&
    f.latestSourceUpdatedAtMs
  )
    c.spot = {
      symbol: f.symbol,
      quote: f.quote,
      raw: f.latestSpot,
      human: formatUnits(BigInt(f.latestSpot), f.decimals),
      decimals: f.decimals,
      oracleUpdatedAtMs: Number(f.latestUpdatedAtMs),
      sourceUpdatedAtMs: Number(f.latestSourceUpdatedAtMs),
      source: "official-testnet-price-feed",
    };
  if (!freshSpot(c.spot))
    c.missing.push("underlying-price-unavailable-or-stale");
  c.state = c.missing.length ? "incomplete" : "ready";
  return {
    ...market,
    asset: row.asset,
    intervalSec: c.expiry - c.tradingStart,
    label: `${row.asset} · ${Math.round((c.expiry - c.tradingStart) / 60)} min`,
    eventContext: c,
  };
}

export function modelMarketInput(market: Market, now = Date.now()) {
  const scale = 10n ** BigInt(market.decimals);
  const bid = market.bestBid === null ? null : BigInt(market.bestBid);
  const ask = market.bestAsk === null ? null : BigInt(market.bestAsk);
  return {
    network: "Somnia Shannon testnet",
    marketId: market.id,
    asset: market.asset,
    secondsRemaining: Math.max(0, market.expiry - Math.floor(now / 1000)),
    contractPrices: {
      unit: "tUSDC per outcome share, excluding fees",
      upAsk: ask === null ? null : formatUnits(ask, market.decimals),
      upBid: bid === null ? null : formatUnits(bid, market.decimals),
      downAskEstimate:
        bid !== null && bid > 0n && bid < scale
          ? formatUnits(scale - bid, market.decimals)
          : null,
      spread:
        ask !== null && bid !== null && ask >= bid
          ? formatUnits(ask - bid, market.decimals)
          : null,
    },
    takerFeeBps: formatUnits(BigInt(market.takerFee), 3),
    event: market.eventContext ?? null,
    contextReadyForAnalysis: modelContextReady(market, now),
    warning:
      "Outcome-share prices are not the underlying asset price. Reference feeds are not guaranteed settlement prices. Missing or stale event context requires abstention. No future price is available; testnet quotes may not reflect fair value.",
  };
}
