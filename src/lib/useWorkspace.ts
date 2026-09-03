import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import type {
  Market,
  Mode,
  PolicyInput,
  PublicConfig,
  Snapshot,
  Strategy,
} from "../../shared/types";
import {
  demoMarket,
  seedSimulation,
  simulationClaim,
  simulationOrder,
  simulationPolicy,
  simulationRevoke,
  simulationSettle,
  simulationWithdraw,
} from "../../shared/simulation";
import { getAccount, getConfig, getMarkets, post } from "./api";
import type { WalletAction } from "./wallet";
import { snapshotSchema } from "../../shared/validation";
import { policyState } from "../../shared/policy";
import {
  pendingFor,
  savePending,
  clearPending,
  requireTransactionStorage,
} from "./pending";

const STORAGE = "tradeguard-simulation-v1";
function readDemo(): Snapshot {
  try {
    const raw = localStorage.getItem(STORAGE);
    const parsed = snapshotSchema.safeParse(raw ? JSON.parse(raw) : null);
    if (parsed.success && parsed.data.mode === "simulation") return parsed.data;
  } catch {
    /* Invalid local sample state is discarded, never used for a live account. */
  }
  return seedSimulation();
}
function emptyLive(owner: Address | null): Snapshot {
  return {
    version: 1,
    mode: "live",
    owner,
    account: null,
    balance: "0",
    decimals: 6,
    policy: null,
    history: [],
    activities: [],
    positions: [],
    runner: {
      running: false,
      strategy: "reference",
      message: "Connect your wallet to view the account.",
    },
    now: Math.floor(Date.now() / 1000),
    fetchedAt: 0,
    marketIds: [],
  };
}
export function useWorkspace() {
  const [mode, setMode] = useState<Mode>("simulation");
  const [demo, setDemo] = useState(readDemo);
  const [owner, setOwner] = useState<Address | null>(null);
  const [live, setLive] = useState<Snapshot>(() => emptyLive(null));
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [executor, setExecutor] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Hex | null>(null);
  const generation = useRef(0);
  const refreshSequence = useRef(0);
  const busyRef = useRef(false);
  const accountVerified = useRef(false);
  useEffect(() => {
    void getConfig()
      .then(setConfig)
      .catch(() =>
        setError(
          "The application service is unavailable. Simulation still works.",
        ),
      );
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(demo));
    } catch {
      /* Simulation can remain usable without browser storage. */
    }
  }, [demo]);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (mode !== "live") return;
      const current = generation.current;
      const sequence = ++refreshSequence.current;
      setLoading(true);
      setError("");
      try {
        const results = await Promise.allSettled([
          getMarkets(signal),
          owner ? getAccount(owner, signal) : Promise.resolve(null),
        ]);
        if (
          current !== generation.current ||
          sequence !== refreshSequence.current ||
          signal?.aborted
        )
          return;
        const marketResult = results[0];
        if (marketResult.status === "fulfilled")
          setMarkets(marketResult.value.markets);
        else
          setError(
            "Live market data is unavailable. No simulated prices will be substituted.",
          );
        const accountResult = results[1];
        if (accountResult.status === "fulfilled" && accountResult.value) {
          accountVerified.current = true;
          setLive(accountResult.value.snapshot);
          setExecutor(accountResult.value.executor);
          setAuthenticated(accountResult.value.authenticated);
        } else if (owner) {
          accountVerified.current = false;
          setError(
            "Account data could not be verified. Refresh before any transaction.",
          );
        }
      } finally {
        if (
          current === generation.current &&
          sequence === refreshSequence.current
        )
          setLoading(false);
      }
    },
    [mode, owner],
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer =
      mode === "live"
        ? setInterval(() => {
            void refresh(controller.signal);
          }, 30000)
        : undefined;
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [mode, owner, refresh]);
  useEffect(() => {
    const p = window.ethereum;
    if (!p?.on) return;
    const changed = () => {
      generation.current++;
      accountVerified.current = false;
      setOwner(null);
      setLive(emptyLive(null));
      setAuthenticated(false);
      setExecutor(null);
      setPending(null);
      setNotice("Wallet context changed. Connect and review again.");
      void post("/api/auth/logout").catch(() => {});
    };
    p.on("accountsChanged", changed);
    p.on("chainChanged", changed);
    return () => {
      p.removeListener?.("accountsChanged", changed);
      p.removeListener?.("chainChanged", changed);
    };
  }, []);
  async function run(label: string, task: () => Promise<void> | void) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await task();
      return true;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The action could not be completed.",
      );
      return false;
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }
  const snapshot = mode === "simulation" ? demo : live;
  function selectMode(next: Mode) {
    generation.current++;
    accountVerified.current = false;
    setMode(next);
    setMarkets([]);
    setLive(emptyLive(owner));
    setError("");
    setNotice("");
    try {
      setPending(owner ? pendingFor(owner) : null);
    } catch (err) {
      setError(String(err));
    }
  }
  function requireFreshAccount() {
    if (
      !accountVerified.current ||
      !live.fetchedAt ||
      Date.now() / 1000 - live.fetchedAt > 45
    )
      throw new Error(
        "Refresh and verify the live account before increasing permissions, funding it, or starting execution.",
      );
  }
  async function transaction(action: WalletAction) {
    if (!config || !owner) throw new Error("Connect an owner wallet first.");
    requireTransactionStorage();
    if (pending || pendingFor(owner))
      throw new Error(
        "A transaction is still pending. Check it before sending another.",
      );
    const current = generation.current;
    const capturedOwner = owner;
    const wallet = await import("./wallet");
    if (["create", "policy", "deposit", "approve"].includes(action.type))
      requireFreshAccount();
    const hash = await wallet.sendAction(
      config,
      owner,
      live.account as Address | null,
      action,
    );
    // Preserve the reference even if the account or mode changed while the wallet was open.
    try {
      savePending(capturedOwner, hash, action.type);
    } catch {
      if (current === generation.current) setPending(hash);
      throw new Error(
        "Submitted transaction " +
          hash +
          ". Saving its reference failed; check the explorer before retrying.",
      );
    }
    if (current !== generation.current) return;
    setPending(hash);
    setNotice("Submitted. Waiting for on-chain confirmation.");
    try {
      await wallet.waitReceipt(config, hash);
    } catch (err) {
      if (err instanceof wallet.ConfirmedRevert) {
        clearPending(capturedOwner, hash);
        if (current === generation.current) setPending(null);
        throw err;
      }
      setNotice(
        "Keep the transaction reference and check the explorer before retrying.",
      );
      throw err;
    }
    clearPending(capturedOwner, hash);
    if (current !== generation.current) return;
    setPending(null);
    setNotice("Transaction confirmed on Somnia Shannon.");
    await refresh();
  }
  return {
    mode,
    snapshot,
    markets: mode === "simulation" ? [demoMarket(demo.now)] : markets,
    config,
    owner,
    executor,
    authenticated,
    busy,
    loading,
    notice,
    error,
    pending,
    dismiss: () => {
      setError("");
      setNotice("");
    },
    selectMode,
    refresh,
    connect: () =>
      run("Connecting wallet", async () => {
        const address = await (await import("./wallet")).connectWallet();
        const stored = pendingFor(address);
        generation.current++;
        accountVerified.current = false;
        setOwner(address);
        setPending(stored);
        setLive(emptyLive(address));
        setMode("live");
      }),
    signIn: () =>
      run("Signing in", async () => {
        if (!owner) throw new Error("Connect your owner wallet.");
        const current = generation.current;
        await (await import("./wallet")).login(owner);
        if (current !== generation.current) return;
        setAuthenticated(true);
        await refresh();
      }),
    reset: () => {
      setDemo(seedSimulation());
      setNotice("Simulation reset. No real account was changed.");
    },
    createAccount: () =>
      run("Creating account", () => transaction({ type: "create" })),
    faucet: () =>
      run("Requesting test collateral", () => transaction({ type: "faucet" })),
    savePolicy: (input: PolicyInput) =>
      run("Saving permission", async () => {
        if (mode === "simulation") {
          setDemo(simulationPolicy(demo, input, crypto.randomUUID()));
          setNotice(
            "Simulation permission created. Start the agent when ready.",
          );
        } else await transaction({ type: "policy", input });
      }),
    revoke: () =>
      run("Revoking permission", async () => {
        if (mode === "simulation") {
          setDemo(simulationRevoke(demo, crypto.randomUUID()));
          setNotice(
            "Simulation permission revoked. Existing positions remain.",
          );
        } else await transaction({ type: "revoke" });
      }),
    pause: () =>
      run("Pausing agent", async () => {
        if (mode === "simulation")
          setDemo((s) => ({
            ...s,
            runner: {
              ...s.runner,
              running: false,
              message: "Paused. On-chain permission would still be active.",
            },
          }));
        else {
          await post("/api/runner/pause");
          await refresh();
        }
      }),
    start: (strategy: Strategy) =>
      run("Starting agent", async () => {
        if (mode === "simulation") {
          if (policyState(demo.policy, demo.now) !== "active")
            throw new Error(
              "Create an active permission before starting the agent.",
            );
          setDemo((s) => ({
            ...s,
            runner: {
              running: true,
              strategy,
              message: "Simulation monitoring. No model calls or transactions.",
            },
          }));
        } else {
          requireFreshAccount();
          await post("/api/runner/start", { strategy });
          await refresh();
        }
      }),
    stopAutomation: () =>
      run("Stopping automation", async () => {
        if (mode === "live") {
          await post("/api/runner/stop");
          await refresh();
        }
      }),
    simulateOrder: (value: bigint, side: "up" | "down" = "up") =>
      run("Testing request", () => {
        if (mode !== "simulation")
          throw new Error(
            "Controlled requests are only available in Simulation.",
          );
        setDemo(simulationOrder(demo, value, side, crypto.randomUUID()));
      }),
    settle: (side: "up" | "down" | "void") => {
      if (mode === "simulation")
        setDemo(simulationSettle(demo, side, crypto.randomUUID()));
    },
    advance: () => {
      if (mode === "simulation")
        setDemo((s) => ({
          ...s,
          now: (s.policy?.validUntil ?? s.now) + 1,
          runner: {
            ...s.runner,
            running: false,
            message: "Simulation clock advanced beyond permission expiry.",
          },
        }));
    },
    claim: (marketId?: string) =>
      run("Redeeming positions", async () => {
        if (mode === "simulation")
          setDemo(simulationClaim(demo, crypto.randomUUID()));
        else if (marketId)
          await transaction({ type: "claim", marketId: marketId as Hex });
      }),
    withdraw: (value: bigint) =>
      run("Withdrawing available funds", async () => {
        if (mode === "simulation")
          setDemo(simulationWithdraw(demo, value, crypto.randomUUID()));
        else await transaction({ type: "withdraw", amount: value });
      }),
    deposit: (value: bigint) =>
      run("Depositing test collateral", () =>
        transaction({ type: "deposit", amount: value }),
      ),
    approveDeposit: (value: bigint) =>
      run("Approving test collateral", () =>
        transaction({ type: "approve", amount: value }),
      ),
    recoverCredit: (
      marketId: string,
      kind: "poolCredit" | "settlementCredit",
    ) =>
      run("Recovering protocol credit", () =>
        transaction({ type: kind, marketId: marketId as Hex }),
      ),
    recoverPosition: (marketId: string, outcome: 0 | 1, value: bigint) =>
      run("Recovering outcome tokens", () =>
        transaction({
          type: "recover",
          marketId: marketId as Hex,
          outcome,
          amount: value,
        }),
      ),
    reconcile: () =>
      run("Checking transaction", async () => {
        if (pending && config && owner) {
          const current = generation.current;
          const wallet = await import("./wallet");
          try {
            await wallet.waitReceipt(config, pending);
          } catch (err) {
            if (!(err instanceof wallet.ConfirmedRevert)) throw err;
            clearPending(owner, pending);
            if (current === generation.current) setPending(null);
            throw err;
          }
          clearPending(owner, pending);
          if (current === generation.current) {
            setPending(null);
            await refresh();
          }
        } else if (mode === "live" && authenticated) {
          await post("/api/runner/reconcile");
          await refresh();
        }
      }),
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
