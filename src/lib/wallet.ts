import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
  type Hex,
  erc20Abi,
  parseAbi,
} from "viem";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { TradeGuardAccountAbi } from "../../shared/generated/TradeGuardAccount";
import { TradeGuardFactoryAbi } from "../../shared/generated/TradeGuardFactory";
import type { PolicyInput, PublicConfig } from "../../shared/types";
import { post } from "./api";

export type BrowserProvider = EIP1193Provider;
declare global {
  interface Window {
    ethereum?: BrowserProvider;
  }
}
export const provider = () => {
  if (!window.ethereum)
    throw new Error(
      "Open this site in a browser with an EVM wallet, such as MetaMask or Rabby.",
    );
  return window.ethereum;
};
export async function connectWallet(): Promise<Address> {
  const addresses = await provider().request({ method: "eth_requestAccounts" });
  if (!addresses[0]) throw new Error("No wallet selected.");
  return addresses[0];
}
export async function ensureWallet(expected: Address) {
  const p = provider();
  const addresses = await p.request({ method: "eth_accounts" });
  if (addresses[0]?.toLowerCase() !== expected.toLowerCase())
    throw new Error("Wallet changed. Connect and review again.");
  const chain = await p.request({ method: "eth_chainId" });
  if (Number(chain) !== 50312)
    throw new Error(
      "Switch your wallet to Somnia Shannon testnet (50312) before signing.",
    );
  return createWalletClient({
    chain: somniaShannon,
    account: expected,
    transport: custom(p),
  });
}
export async function switchNetwork() {
  try {
    await provider().request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xc488" }],
    });
  } catch (error) {
    if (
      typeof error !== "object" ||
      !error ||
      !("code" in error) ||
      error.code !== 4902
    )
      throw error;
    await provider().request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0xc488",
          chainName: "Somnia Shannon Testnet",
          nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
          rpcUrls: ["https://api.infra.testnet.somnia.network"],
          blockExplorerUrls: ["https://shannon-explorer.somnia.network"],
        },
      ],
    });
  }
}
export async function login(owner: Address) {
  const client = await ensureWallet(owner);
  const challenge = await post<{ nonce: string; message: string }>(
    "/api/auth/challenge",
    { address: owner },
  );
  const signature = await client.signMessage({ message: challenge.message });
  await ensureWallet(owner);
  return post("/api/auth/login", {
    address: owner,
    nonce: challenge.nonce,
    signature,
  });
}
export type WalletAction =
  | { type: "create" }
  | { type: "faucet" }
  | { type: "policy"; input: PolicyInput }
  | { type: "revoke" }
  | { type: "deposit" | "withdraw"; amount: bigint }
  | { type: "claim"; marketId: Hex }
  | { type: "poolCredit" | "settlementCredit"; marketId: Hex }
  | { type: "approve"; amount: bigint }
  | { type: "recover"; marketId: Hex; outcome: 0 | 1; amount: bigint };
export async function sendAction(
  config: PublicConfig,
  owner: Address,
  account: Address | null,
  action: WalletAction,
): Promise<Hex> {
  const wallet = await ensureWallet(owner);
  if (action.type === "faucet")
    return wallet.writeContract({
      address: config.collateral as Address,
      abi: parseAbi(["function faucet(uint256 amount)"]),
      functionName: "faucet",
      args: [20000000n],
    });
  if (action.type === "create") {
    if (!config.factory)
      throw new Error("The testnet factory has not been configured.");
    return wallet.writeContract({
      address: config.factory as Address,
      abi: TradeGuardFactoryAbi,
      functionName: "createAccount",
    });
  }
  if (!account) throw new Error("Create your TradeGuard account first.");
  if (action.type === "approve")
    return approveDeposit(config, owner, account, action.amount);
  if (action.type === "poolCredit" || action.type === "settlementCredit")
    return wallet.writeContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName:
        action.type === "poolCredit"
          ? "recoverPoolCredit"
          : "recoverSettlementCredit",
      args: [action.marketId],
    });
  if (action.type === "policy") {
    const p = action.input;
    return wallet.writeContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName: "setPolicy",
      args: [
        p.executor as Address,
        BigInt(p.perOrder),
        BigInt(p.budget),
        BigInt(p.validAfter),
        BigInt(p.validUntil),
        p.maxPriceBps,
        p.marketIds as Hex[],
      ],
    });
  }
  if (action.type === "revoke")
    return wallet.writeContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName: "revoke",
    });
  if (action.type === "withdraw")
    return wallet.writeContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName: "withdraw",
      args: [action.amount],
    });
  if (action.type === "claim")
    return wallet.writeContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName: "claim",
      args: [action.marketId],
    });
  if (action.type === "recover")
    return wallet.writeContract({
      address: account,
      abi: TradeGuardAccountAbi,
      functionName: "recoverPosition",
      args: [action.marketId, action.outcome, action.amount],
    });
  // Deposits require a separately visible token-approval transaction. The UI exposes that step.
  if (action.type !== "deposit") throw new Error("Unsupported wallet action.");
  return wallet.writeContract({
    address: account,
    abi: TradeGuardAccountAbi,
    functionName: "deposit",
    args: [action.amount],
  });
}
export async function approveDeposit(
  config: PublicConfig,
  owner: Address,
  account: Address,
  value: bigint,
) {
  const wallet = await ensureWallet(owner);
  return wallet.writeContract({
    address: config.collateral as Address,
    abi: erc20Abi,
    functionName: "approve",
    args: [account, value],
  });
}
export class ConfirmedRevert extends Error {}
export async function waitReceipt(config: PublicConfig, hash: Hex) {
  const client = createPublicClient({
    chain: somniaShannon,
    transport: http(config.publicRpc, { timeout: 10000, retryCount: 0 }),
  });
  const receipt = await client.waitForTransactionReceipt({
    hash,
    timeout: 60000,
  });
  if (receipt.status !== "success")
    throw new ConfirmedRevert(
      "The transaction reverted. Review the explorer receipt; gas is separate.",
    );
  return receipt;
}
