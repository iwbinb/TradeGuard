import {
  createPublicClient,
  http,
  erc20Abi,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import {
  SOMNIA_TESTNET_ADDRESSES,
  binaryModuleReadAbi,
  erc6909Abi,
  binarySettlementAbi,
} from "@somnia-chain/markets-sdk";
import { z } from "zod";
import { TradeGuardAccountAbi } from "../shared/generated/TradeGuardAccount";
import { TradeGuardFactoryAbi } from "../shared/generated/TradeGuardFactory";
import type { Market, Snapshot } from "../shared/types";
import { addressSchema } from "../shared/policy";
import { boundedJson, HttpError } from "./http";

export const NETWORK = somniaShannon;
export const MODULE = SOMNIA_TESTNET_ADDRESSES.binaryModule!;
export const COLLATERAL = SOMNIA_TESTNET_ADDRESSES.collateral!;
export const EXPLORER = "https://shannon-explorer.somnia.network";
// These read signatures are differential-tested against the installed official SDK.
export const poolAbi = parseAbi([
  "function getBinaryPoolParams() view returns ((address collateralToken,address market,address outcomeToken,uint256 yesId,uint256 noId,uint256 oneCollateral,uint256 setBacking,address feeRecipient,uint256 makerFeeBpsTimes1k,uint256 takerFeeBpsTimes1k,uint256 maxBuilderFeeBpsTimes1k,uint256 settlementFeeBpsTimes1k,address settlement,uint64 marketNonce,bool finalized))",
  "function getOrderBookParameters() view returns ((uint256 tickSize,uint256 minQuantity,uint256 lotSize))",
  "function getBookLevels(bool isBid,uint64 numLevels) view returns ((uint256 price,uint256 quantity)[])",
  "function getWithdrawableBalance(address account,address token) view returns (uint256)",
]);
const marketAbi = parseAbi([
  "function status() view returns (uint8)",
  "function payoutNumerators() view returns (uint256[])",
]);
export interface ProtocolConfig {
  RPC_URL: string;
  INDEXER_URL: string;
  FACTORY_ADDRESS: string;
}
export const rpc = (config: Pick<ProtocolConfig, "RPC_URL">) =>
  createPublicClient({
    chain: NETWORK,
    transport: http(config.RPC_URL, {
      timeout: 10000,
      retryCount: 0,
      batch: { batchSize: 30, wait: 5 },
    }),
  });
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const rowSchema = z.object({
  id: bytes32,
  asset: z.string().nullable(),
  intervalSec: z.union([z.string(), z.number()]).nullable(),
});
const indexSchema = z.object({
  data: z.object({ Market: z.array(rowSchema).max(24) }),
});

export async function readMarket(
  config: ProtocolConfig,
  id: Hex,
  asset = "Event",
  interval = 900,
): Promise<Market> {
  const client = rpc(config);
  if ((await client.getChainId()) !== 50312)
    throw new HttpError(502, "The RPC is on an unexpected network.");
  const rec = await client.readContract({
    address: MODULE,
    abi: binaryModuleReadAbi,
    functionName: "markets",
    args: [id],
  });
  if (
    !addressSchema.safeParse(rec[8]).success ||
    rec[3].toLowerCase() !== COLLATERAL.toLowerCase()
  )
    throw new HttpError(422, "Unsupported or unknown event market.");
  const [params, status, grid, bids, asks] = await Promise.all([
    client.readContract({
      address: rec[9],
      abi: poolAbi,
      functionName: "getBinaryPoolParams",
    }),
    client.readContract({
      address: rec[8],
      abi: marketAbi,
      functionName: "status",
    }),
    client.readContract({
      address: rec[9],
      abi: poolAbi,
      functionName: "getOrderBookParameters",
    }),
    client.readContract({
      address: rec[9],
      abi: poolAbi,
      functionName: "getBookLevels",
      args: [true, 5n],
    }),
    client.readContract({
      address: rec[9],
      abi: poolAbi,
      functionName: "getBookLevels",
      args: [false, 5n],
    }),
  ]);
  if (
    params.market.toLowerCase() !== rec[8].toLowerCase() ||
    params.yesId !== rec[10] ||
    params.noId !== rec[11]
  )
    throw new HttpError(
      409,
      "This pool has rolled to a different market. Refresh the market list.",
    );
  return {
    id,
    label: `${asset} · ${Math.round(interval / 60)} min`,
    asset,
    intervalSec: interval,
    expiry: Number(rec[13]),
    pool: rec[9],
    market: rec[8],
    collateral: rec[3],
    decimals: 6,
    status,
    yesId: rec[10].toString(),
    noId: rec[11].toString(),
    outcomeToken: params.outcomeToken,
    nonce: params.marketNonce.toString(),
    venueId: rec[5],
    operatorId: rec[4],
    bestAsk: asks[0]?.price.toString() ?? null,
    bestBid: bids[0]?.price.toString() ?? null,
    tickSize: grid.tickSize.toString(),
    lotSize: grid.lotSize.toString(),
    minQuantity: grid.minQuantity.toString(),
    takerFee: params.takerFeeBpsTimes1k.toString(),
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}
export async function listMarkets(
  config: ProtocolConfig,
): Promise<{ markets: Market[]; unavailable: number }> {
  // Uses the official indexer's Market schema; all executable identities are re-read on-chain.
  const response = await fetch(config.INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query TradeGuardMarkets { Market(where: {marketType: {_eq: "BINARY"}, clobStatus: {_eq: "Trading"}, expiry: {_gt: ${Math.floor(Date.now() / 1000)}}}, limit: 12, order_by: {expiry: asc}) { id asset intervalSec } }`,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new HttpError(502, "The market indexer is unavailable.");
  const parsed = indexSchema.safeParse(await boundedJson(response, 262144));
  if (!parsed.success)
    throw new HttpError(502, "The market response could not be verified.");
  const results = await Promise.allSettled(
    parsed.data.data.Market.map((r) =>
      readMarket(
        config,
        r.id as Hex,
        r.asset ?? "Event",
        Number(r.intervalSec ?? 900),
      ),
    ),
  );
  const verified = results.flatMap((r) =>
    r.status === "fulfilled" ? [r.value] : [],
  );
  if (results.length && !verified.length)
    throw new HttpError(502, "No market could be verified against the chain.");
  const markets = verified.filter(
    (m) => m.status === 1 && m.expiry > Math.floor(Date.now() / 1000),
  );
  return { markets, unavailable: results.length - markets.length };
}

export async function accountFor(
  config: ProtocolConfig,
  owner: Address,
): Promise<Address | null> {
  if (!addressSchema.safeParse(config.FACTORY_ADDRESS).success) return null;
  const client = rpc(config);
  if ((await client.getChainId()) !== 50312)
    throw new HttpError(502, "Unexpected network.");
  const account = await client.readContract({
    address: config.FACTORY_ADDRESS as Address,
    abi: TradeGuardFactoryAbi,
    functionName: "accountOf",
    args: [owner],
  });
  return /^0x0{40}$/.test(account) ? null : account;
}
export async function readAccount(
  config: ProtocolConfig,
  owner: Address,
): Promise<Snapshot> {
  const now = Math.floor(Date.now() / 1000);
  const account = await accountFor(config, owner);
  const empty: Snapshot = {
    version: 1,
    mode: "live",
    owner,
    account,
    balance: "0",
    decimals: 6,
    policy: null,
    history: [],
    activities: [],
    positions: [],
    runner: {
      running: false,
      strategy: "reference",
      message:
        "Sign in to inspect private execution status. On-chain permission may remain active.",
    },
    now,
    fetchedAt: now,
    marketIds: [],
  };
  if (!account) return empty;
  const client = rpc(config);
  const [onchainOwner, token, mod, p, balance, count] = await Promise.all([
    client.readContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName: "owner",
    }),
    client.readContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName: "collateral",
    }),
    client.readContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName: "module",
    }),
    client.readContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName: "policy",
    }),
    client.readContract({
      address: COLLATERAL,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    }),
    client.readContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName: "trackedMarketCount",
    }),
  ]);
  if (
    onchainOwner.toLowerCase() !== owner.toLowerCase() ||
    token.toLowerCase() !== COLLATERAL.toLowerCase() ||
    mod.toLowerCase() !== MODULE.toLowerCase()
  )
    throw new HttpError(
      422,
      "Account deployment does not match the expected protocol.",
    );
  // Bound work per response, without claiming full history when the account exceeds this page.
  if (count > 64n)
    throw new HttpError(
      422,
      "This account exceeds the supported market history limit. Use the recovery guide.",
    );
  const ids = await Promise.all(
    Array.from({ length: Number(count) }, (_, i) =>
      client.readContract({
        address: account,
        abi: TradeGuardAccountAbi,
        functionName: "trackedMarket",
        args: [BigInt(i)],
      }),
    ),
  );
  const positions: Snapshot["positions"] = [];
  const recoveries: NonNullable<Snapshot["recoveries"]> = [];
  const seenPools = new Set<string>();
  const seenSettlements = new Set<string>();
  const allowed: string[] = [];
  for (const id of ids) {
    const b = await client.readContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName: "bindings",
      args: [id],
    });
    if (Number(b[8]) === Number(p[6])) allowed.push(id);
    const settlement = await client.readContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName: "settlements",
      args: [id],
    });
    const [poolCredit, settlementCredit] = await Promise.all([
      seenPools.has(b[1].toLowerCase())
        ? 0n
        : client.readContract({
            address: b[1],
            abi: poolAbi,
            functionName: "getWithdrawableBalance",
            args: [account, COLLATERAL],
          }),
      seenSettlements.has(settlement.toLowerCase())
        ? 0n
        : client.readContract({
            address: settlement,
            abi: binarySettlementAbi,
            functionName: "owed",
            args: [account, COLLATERAL],
          }),
    ]);
    seenPools.add(b[1].toLowerCase());
    seenSettlements.add(settlement.toLowerCase());
    if (poolCredit > 0n || settlementCredit > 0n)
      recoveries.push({
        marketId: id,
        poolCredit: poolCredit.toString(),
        settlementCredit: settlementCredit.toString(),
      });
    const [up, down, status, vector] = await Promise.all([
      client.readContract({
        address: b[2],
        abi: erc6909Abi,
        functionName: "balanceOf",
        args: [account, b[4]],
      }),
      client.readContract({
        address: b[2],
        abi: erc6909Abi,
        functionName: "balanceOf",
        args: [account, b[5]],
      }),
      client.readContract({
        address: b[0],
        abi: marketAbi,
        functionName: "status",
      }),
      client.readContract({
        address: b[0],
        abi: marketAbi,
        functionName: "payoutNumerators",
      }),
    ]);
    if (up === 0n && down === 0n) continue;
    const total = vector.reduce((a, v) => a + v, 0n);
    // Gross entitlement is not represented as withdrawable collateral before redemption.
    positions.push({
      marketId: id,
      label: `Event ${id.slice(0, 8)}…`,
      up: up.toString(),
      down: down.toString(),
      cost: "0",
      status:
        status === 5
          ? "voided"
          : status === 4
            ? "resolved"
            : status === 1
              ? "trading"
              : "locked",
      payout: [(vector[0] ?? 0n).toString(), (vector[1] ?? 0n).toString()],
      claimable:
        total > 0n && status >= 4
          ? (
              (up * (vector[0] ?? 0n) + down * (vector[1] ?? 0n)) /
              total
            ).toString()
          : "0",
    });
  }
  return {
    ...empty,
    balance: balance.toString(),
    positions,
    recoveries,
    marketIds: allowed,
    policy:
      Number(p[6]) === 0
        ? null
        : {
            executor: p[0],
            perOrder: p[1].toString(),
            budget: p[2].toString(),
            spent: p[3].toString(),
            validAfter: Number(p[4]),
            validUntil: Number(p[5]),
            version: Number(p[6]),
            maxPriceBps: p[7],
            revoked: p[8],
            marketIds: allowed,
          },
  };
}
