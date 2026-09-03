import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { encodeDeployData, erc20Abi, type Hex } from "viem";
import { MODULE, COLLATERAL, rpc } from "../server/protocol";
const client = rpc({ RPC_URL: "https://api.infra.testnet.somnia.network" });
const [chain, code, decimals] = await Promise.all([
  client.getChainId(),
  client.getCode({ address: MODULE }),
  client.readContract({
    address: COLLATERAL,
    abi: erc20Abi,
    functionName: "decimals",
  }),
]);
if (chain !== 50312 || !code || code === "0x" || decimals !== 6)
  throw new Error("Testnet identity check failed.");
const artifact = JSON.parse(
  readFileSync(
    ".artifacts/contracts/TradeGuardFactory.sol/TradeGuardFactory.json",
    "utf8",
  ),
);
const data = encodeDeployData({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object as Hex,
  args: [MODULE, COLLATERAL],
});
mkdirSync(".artifacts", { recursive: true });
writeFileSync(
  ".artifacts/factory-deployment.json",
  JSON.stringify(
    {
      unsigned: true,
      broadcast: false,
      chainId: 50312,
      value: "0",
      contract: "TradeGuardFactory",
      module: MODULE,
      collateral: COLLATERAL,
      data,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Prepared unsigned factory data in .artifacts/factory-deployment.json. Nothing signed or broadcast.",
);
