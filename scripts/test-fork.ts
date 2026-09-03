import { spawnSync } from "node:child_process";
import { listMarkets, rpc, MODULE, COLLATERAL } from "../server/protocol";
import { quoteBuy } from "../server/strategy";
const config = {
  RPC_URL: "https://api.infra.testnet.somnia.network",
  INDEXER_URL: "https://dev.smk.somnia.host/v1/graphql",
  FACTORY_ADDRESS: "",
};
const { markets } = await listMarkets(config);
const now = Math.floor(Date.now() / 1000);
const market = markets.find(
  (m) => m.expiry > now + 90 && m.bestAsk && BigInt(m.bestAsk) < 900000n,
);
if (!market)
  throw new Error(
    "No suitable live book for a reproducible local fork. Retry later; do not substitute mocked data.",
  );
const quote = quoteBuy(
  market,
  {
    version: 1,
    executor: MODULE,
    budget: "10000000",
    perOrder: "5000000",
    spent: "0",
    validAfter: now,
    validUntil: now + 3600,
    maxPriceBps: 9500,
    revoked: false,
    marketIds: [market.id],
  },
  "up",
  500000n,
);
const block = await rpc(config).getBlockNumber();
console.log(
  JSON.stringify({
    localForkOnly: true,
    broadcasts: false,
    block: block.toString(),
    market: market.id,
    label: market.label,
    quantity: quote.quantity.toString(),
    yesPrice: quote.yesPrice.toString(),
  }),
);
const result = spawnSync(
  "forge",
  ["test", "--match-contract", "SomniaForkTest", "-vv"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      TRADEGUARD_FORK_RPC: config.RPC_URL,
      TRADEGUARD_FORK_BLOCK: block.toString(),
      TRADEGUARD_MODULE: BigInt(MODULE).toString(),
      TRADEGUARD_COLLATERAL: BigInt(COLLATERAL).toString(),
      TRADEGUARD_FORK_MARKET: market.id,
      TRADEGUARD_FORK_PRICE: quote.yesPrice.toString(),
      TRADEGUARD_FORK_QUANTITY: quote.quantity.toString(),
    },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
