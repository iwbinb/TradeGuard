import { listMarkets, rpc, MODULE, COLLATERAL } from "../server/protocol";
import { erc20Abi } from "viem";
const config = {
  RPC_URL: process.env.RPC_URL ?? "https://api.infra.testnet.somnia.network",
  INDEXER_URL:
    process.env.INDEXER_URL ?? "https://dev.smk.somnia.host/v1/graphql",
  FACTORY_ADDRESS: "",
};
const client = rpc(config);
const [chainId, block, code, decimals] = await Promise.all([
  client.getChainId(),
  client.getBlockNumber(),
  client.getCode({ address: MODULE }),
  client.readContract({
    address: COLLATERAL,
    abi: erc20Abi,
    functionName: "decimals",
  }),
]);
if (chainId !== 50312 || !code || code === "0x" || decimals !== 6)
  throw new Error("Protocol identity check failed.");
const result = await listMarkets(config);
console.log(
  JSON.stringify(
    {
      readOnly: true,
      chainId,
      block: block.toString(),
      collateral: COLLATERAL,
      decimals,
      moduleHasCode: true,
      markets: result.markets.map((m) => ({
        id: m.id,
        label: m.label,
        status: m.status,
        venueId: m.venueId,
        expiry: m.expiry,
        bestAsk: m.bestAsk,
      })),
      unavailable: result.unavailable,
    },
    null,
    2,
  ),
);
