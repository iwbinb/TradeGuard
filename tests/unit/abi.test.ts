import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatAbiItem } from "viem/utils";
import type { Abi, AbiFunction } from "viem";
import {
  binaryModuleReadAbi,
  binaryModuleWriteAbi,
  binarySettlementAbi,
  erc6909Abi,
} from "@somnia-chain/markets-sdk";
import {
  binaryPoolReadAbi,
  erc20VaultReadAbi,
} from "../../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js";
import {
  binaryPoolWriteAbi,
  erc20VaultWriteAbi,
} from "../../node_modules/@somnia-chain/markets-sdk/dist/tradeAbi.js";
const abi = (name: string): Abi =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../.artifacts/contracts/IDreamDex.sol/" + name + ".json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).abi;
const canonical = (item: AbiFunction) => {
  // A single all-static return struct has the same ABI words as the public mapping getter's flat tuple.
  const output =
    item.name === "markets" &&
    item.outputs.length === 1 &&
    item.outputs[0].type === "tuple" &&
    "components" in item.outputs[0]
      ? item.outputs[0].components
      : item.outputs;
  return {
    inputs: formatAbiItem(item),
    outputs: JSON.parse(
      JSON.stringify(output, (k, v) =>
        k === "name" || k === "internalType" ? undefined : v,
      ),
    ),
  };
};
describe("compiler interfaces match official SDK 0.29.0", () => {
  for (const [name, official] of [
    ["IBinaryModule", [...binaryModuleReadAbi, ...binaryModuleWriteAbi]],
    [
      "IBinaryPool",
      [
        ...binaryPoolReadAbi,
        ...binaryPoolWriteAbi,
        ...erc20VaultReadAbi,
        ...erc20VaultWriteAbi,
      ],
    ],
    ["IBinarySettlement", binarySettlementAbi],
    ["IOutcomeToken", erc6909Abi],
  ] as const) {
    for (const fn of abi(name).filter(
      (f): f is AbiFunction => f.type === "function",
    )) {
      it(name + "." + fn.name, () => {
        const source = (official as Abi).find(
          (f) => f.type === "function" && f.name === fn.name,
        ) as AbiFunction | undefined;
        expect(source, "SDK signature exists").toBeDefined();
        expect(canonical(fn)).toEqual(canonical(source!));
      });
    }
  }
});
