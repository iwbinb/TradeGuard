import { DurableObject } from "cloudflare:workers";
import { encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { TradeGuardAccountAbi } from "../shared/generated/TradeGuardAccount";
import type { Activity, RunnerStatus, Strategy } from "../shared/types";
import { preflight, policyState } from "../shared/policy";
import { min } from "../shared/money";
import { readAccount, readMarket, rpc } from "./protocol";
import { executorFor, type AppEnv } from "./secrets";
import { modelDecision, quoteBuy, referenceDecision } from "./strategy";
import { receiptEvidence, reserveGas } from "./execution";

interface Pending {
  raw: Hex;
  hash: Hex;
  intent: Hex;
  marketId: Hex;
  version: number;
  kind: "buy" | "claim" | "settlementCredit";
  preparedAt: number;
  quantity?: string;
}
interface State extends RunnerStatus {
  owner?: Address;
  account?: Address;
  generation: number;
  policyVersion?: number;
  pending?: Pending;
  failures: number;
  monitorUntil?: number;
}
const stopped = (): State => ({
  running: false,
  monitoring: false,
  strategy: "reference",
  message: "Agent stopped.",
  generation: 0,
  failures: 0,
  modelCalls: 0,
  gasSpent: "0",
});

export class TradingRunner extends DurableObject<AppEnv> {
  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at INTEGER NOT NULL, json TEXT NOT NULL)",
    );
  }
  private state(): State {
    const row = this.ctx.storage.sql
      .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
      .toArray()[0];
    return row ? JSON.parse(row.json) : stopped();
  }
  private save(state: State) {
    this.ctx.storage.sql.exec(
      "INSERT INTO state(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
      JSON.stringify(state),
    );
  }
  status(): RunnerStatus {
    const {
      running,
      monitoring,
      strategy,
      message,
      pending,
      error,
      lastRun,
      modelCalls,
      gasSpent,
    } = this.state();
    return {
      running,
      monitoring,
      strategy,
      message,
      pendingTx: pending?.hash,
      error,
      lastRun,
      modelCalls,
      gasSpent,
    };
  }
  events(): Activity[] {
    return this.ctx.storage.sql
      .exec<{ json: string }>(
        "SELECT json FROM events ORDER BY at DESC LIMIT 100",
      )
      .toArray()
      .map((r) => JSON.parse(r.json));
  }
  private record(event: Activity) {
    this.ctx.storage.sql.exec(
      "INSERT INTO events(id,at,json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET at=excluded.at,json=excluded.json",
      event.id,
      event.at,
      JSON.stringify(event),
    );
    const account = this.state().account;
    if (account)
      this.ctx.waitUntil(
        this.env.DB.prepare(
          "INSERT INTO activity(account,id,at,payload) VALUES(?,?,?,?) ON CONFLICT(account,id) DO UPDATE SET at=excluded.at,payload=excluded.payload",
        )
          .bind(
            account.toLowerCase(),
            event.id,
            event.at,
            JSON.stringify(event),
          )
          .run()
          .catch(() => {
            console.warn(
              JSON.stringify({ event: "activity_mirror_unavailable" }),
            );
          }),
      );
  }
  async start(owner: Address, account: Address, strategy: Strategy) {
    if (this.env.EXECUTION_ENABLED !== "true" || !this.env.EXECUTOR_SEED)
      throw new Error("Live execution is not enabled.");
    if (
      strategy === "model" &&
      (!this.env.MODEL_API_KEY ||
        !this.env.MODEL_ENDPOINT ||
        !this.env.MODEL_NAME)
    )
      throw new Error("Model provider is not configured.");
    const previous = this.state();
    if (
      previous.account &&
      previous.account.toLowerCase() !== account.toLowerCase()
    )
      throw new Error("Runner identity mismatch.");
    if (previous.pending)
      throw new Error("A transaction is still awaiting reconciliation.");
    const snapshot = await readAccount(this.env, owner);
    const executor = await executorFor(this.env.EXECUTOR_SEED, account);
    if (
      snapshot.account?.toLowerCase() !== account.toLowerCase() ||
      !snapshot.policy ||
      snapshot.policy.executor.toLowerCase() !==
        executor.address.toLowerCase() ||
      policyState(snapshot.policy, snapshot.now) !== "active"
    )
      throw new Error(
        "An active permission for this execution address is required.",
      );
    if (this.state().generation !== previous.generation || this.state().pending)
      throw new Error("Runner state changed. Refresh before starting.");
    const samePolicy = previous.policyVersion === snapshot.policy.version;
    this.save({
      owner,
      account,
      running: true,
      monitoring: true,
      strategy,
      policyVersion: snapshot.policy.version,
      message:
        "Monitoring authorized markets. Automatic redemption remains active when trading is paused.",
      generation: previous.generation + 1,
      failures: 0,
      modelCalls: samePolicy ? (previous.modelCalls ?? 0) : 0,
      gasSpent: samePolicy ? (previous.gasSpent ?? "0") : "0",
      monitorUntil: samePolicy
        ? (previous.monitorUntil ?? Date.now() + 86400000)
        : Date.now() + 86400000,
    });
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    return this.status();
  }
  async pause() {
    const state = this.state();
    this.save({
      ...state,
      running: false,
      generation: state.generation + 1,
      message: state.monitoring
        ? "Trading paused. Settlement monitoring continues; on-chain permission may remain active."
        : "Paused. On-chain trading permission may still be active.",
    });
    if (state.pending || state.monitoring)
      await this.ctx.storage.setAlarm(Date.now() + 5000);
    else await this.ctx.storage.deleteAlarm();
    return this.status();
  }
  async stopMonitoring() {
    const state = this.state();
    this.save({
      ...state,
      running: false,
      monitoring: false,
      generation: state.generation + 1,
      message:
        "All automation stopped. Pending transactions still need confirmation. Manual recovery remains available.",
    });
    if (state.pending) await this.ctx.storage.setAlarm(Date.now() + 5000);
    else await this.ctx.storage.deleteAlarm();
    return this.status();
  }
  async reconcile() {
    if (this.state().pending)
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    return this.status();
  }
  private unchanged(state: State) {
    return (
      this.state().generation === state.generation && !this.state().pending
    );
  }
  private async later(state: State, message: string, delay = 60000) {
    if (!this.unchanged(state)) return;
    this.save({ ...state, lastRun: Date.now(), message });
    if (state.running || state.monitoring)
      await this.ctx.storage.setAlarm(Date.now() + delay);
  }
  async alarm() {
    let state = this.state();
    if (!state.account || !state.owner) return;
    try {
      if (state.pending) {
        await this.reconcilePending(state);
        return;
      }
      if (!state.running && !state.monitoring) return;
      if (this.env.EXECUTION_ENABLED !== "true" || !this.env.EXECUTOR_SEED)
        throw new Error("Execution disabled by the operator.");
      if (Date.now() >= (state.monitorUntil ?? 0))
        throw new Error(
          "The 24-hour automation window has ended. Manual redemption remains available.",
        );
      const snapshot = await readAccount(this.env, state.owner);
      if (!this.unchanged(state)) return;
      if (snapshot.account?.toLowerCase() !== state.account.toLowerCase())
        throw new Error("Account identity changed.");
      const claim = snapshot.positions.find(
        (p) =>
          ["resolved", "voided"].includes(p.status) && BigInt(p.claimable) > 0n,
      );
      const credit = snapshot.recoveries?.find(
        (r) => BigInt(r.settlementCredit) > 0n,
      );
      // Recovery is independent from trading authority and always pays the guard account.
      if (claim || credit) {
        const marketId = (claim?.marketId ?? credit!.marketId) as Hex;
        const kind = claim ? "claim" : "settlementCredit";
        const data = encodeFunctionData({
          abi: TradeGuardAccountAbi,
          functionName: claim ? "claim" : "recoverSettlementCredit",
          args: [marketId],
        });
        await this.submit(state, data, {
          kind,
          marketId,
          intent: ("0x" + "0".repeat(64)) as Hex,
          version: snapshot.policy?.version ?? 0,
          action: claim
            ? "Redeem settled position"
            : "Recover settlement credit",
          amount: claim?.claimable ?? credit!.settlementCredit,
          detail:
            "Automatic recovery into the owner-controlled account; this is not a new trade.",
        });
        return;
      }
      if (!state.running) {
        await this.later(
          state,
          "Trading paused. Watching existing positions for settlement.",
        );
        return;
      }
      if (
        !snapshot.policy ||
        policyState(snapshot.policy, snapshot.now) !== "active"
      ) {
        state = { ...state, running: false };
        await this.later(
          state,
          "Trading permission ended. Existing positions are still monitored for settlement.",
        );
        return;
      }
      if (snapshot.policy.version !== state.policyVersion) {
        state = { ...state, running: false };
        await this.later(
          state,
          "Permission changed. Review and restart trading explicitly.",
        );
        return;
      }
      const executor = await executorFor(this.env.EXECUTOR_SEED, state.account);
      if (
        snapshot.policy.executor.toLowerCase() !==
        executor.address.toLowerCase()
      )
        throw new Error("The configured executor is not authorized.");
      const markets = await Promise.allSettled(
        snapshot.policy.marketIds.map((id) => readMarket(this.env, id as Hex)),
      );
      if (!this.unchanged(state)) return;
      const market = markets
        .flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
        .find((m) => m.status === 1 && m.expiry > snapshot.now + 30);
      if (!market) {
        await this.later(
          state,
          "No authorized market is currently executable.",
        );
        return;
      }
      if (state.strategy === "model") {
        if ((state.modelCalls ?? 0) >= 20) {
          await this.later(
            { ...state, running: false },
            "Model request limit reached (20 per permission). Settlement monitoring continues.",
          );
          return;
        }
        // Reserve before the external call, including provider failures.
        state = { ...state, modelCalls: (state.modelCalls ?? 0) + 1 };
        this.save(state);
      }
      const decision =
        state.strategy === "model"
          ? await modelDecision(
              market,
              this.env.MODEL_ENDPOINT,
              this.env.MODEL_NAME,
              this.env.MODEL_API_KEY ?? "",
            )
          : referenceDecision(market);
      if (!this.unchanged(state) || !this.state().running) return;
      if (decision.decision === "abstain") {
        await this.later(state, decision.reason);
        return;
      }
      const spend = min(
        500000n,
        BigInt(snapshot.policy.perOrder),
        BigInt(snapshot.policy.budget) - BigInt(snapshot.policy.spent),
      );
      const error = preflight(
        snapshot.policy,
        market,
        spend,
        Math.floor(Date.now() / 1000),
        BigInt(snapshot.balance),
      );
      if (error) throw new Error(error);
      const quote = quoteBuy(market, snapshot.policy, decision.side, spend);
      const intent = keccak256(
        new TextEncoder().encode(
          state.account +
            ":" +
            snapshot.policy.version +
            ":" +
            crypto.randomUUID(),
        ),
      );
      const buy = {
        ...quote,
        intentId: intent,
        marketId: market.id as Hex,
        policyVersion: BigInt(snapshot.policy.version),
        deadline: BigInt(
          Math.min(
            market.expiry,
            snapshot.policy.validUntil,
            Math.floor(Date.now() / 1000) + 60,
          ),
        ),
      };
      await this.submit(
        state,
        encodeFunctionData({
          abi: TradeGuardAccountAbi,
          functionName: "executeBuy",
          args: [buy],
        }),
        {
          kind: "buy",
          marketId: buy.marketId,
          intent,
          version: snapshot.policy.version,
          quantity: quote.quantity.toString(),
          action:
            market.asset + " · " + (decision.side === "up" ? "Up" : "Down"),
          amount: spend.toString(),
          detail: decision.reason,
        },
      );
    } catch (error) {
      const latest = this.state();
      if (latest.pending) {
        this.save({
          ...latest,
          message:
            "Submission outcome unknown. Checking the existing transaction.",
          error: "No replacement order will be created.",
        });
        await this.ctx.storage.setAlarm(Date.now() + 10000);
      } else if (latest.generation === state.generation) {
        const message =
          error instanceof Error &&
          error.message.length < 180 &&
          !/https?:|0x[a-fA-F0-9]{64}/.test(error.message)
            ? error.message
            : "The execution could not be verified. No new order was submitted.";
        this.save({
          ...latest,
          running: false,
          monitoring: false,
          error: message,
          message: "Needs attention",
          failures: latest.failures + 1,
        });
        this.record({
          id: crypto.randomUUID(),
          at: Math.floor(Date.now() / 1000),
          action: "Agent stopped",
          amount: "0",
          status: "pre-check",
          source: "precheck",
          detail: message,
        });
      }
    }
  }
  private async submit(
    state: State,
    data: Hex,
    action: {
      kind: Pending["kind"];
      marketId: Hex;
      intent: Hex;
      version: number;
      quantity?: string;
      action: string;
      amount: string;
      detail: string;
    },
  ) {
    if (!state.account || !this.env.EXECUTOR_SEED) return;
    const executor = await executorFor(this.env.EXECUTOR_SEED, state.account);
    const client = rpc(this.env);
    const [estimate, gasPrice, nonce, balance] = await Promise.all([
      client.estimateGas({
        account: executor.address,
        to: state.account,
        data,
      }),
      client.getGasPrice(),
      client.getTransactionCount({
        address: executor.address,
        blockTag: "pending",
      }),
      client.getBalance({ address: executor.address }),
    ]);
    const gas = (estimate * 12n) / 10n;
    const gasSpent = reserveGas(
      state.gasSpent ?? "0",
      gas,
      gasPrice,
      BigInt(this.env.MAX_GAS_PRICE_WEI),
      balance,
    );
    const raw = await executor.signTransaction({
      chainId: 50312,
      to: state.account,
      data,
      gas,
      gasPrice,
      nonce,
      type: "legacy",
    });
    if (
      !this.unchanged(state) ||
      (action.kind === "buy" && !this.state().running)
    )
      return;
    const hash = keccak256(raw);
    this.save({
      ...state,
      gasSpent,
      lastRun: Date.now(),
      message: "Transaction awaiting confirmation.",
      pending: {
        raw,
        hash,
        intent: action.intent,
        marketId: action.marketId,
        version: action.version,
        kind: action.kind,
        quantity: action.quantity,
        preparedAt: Date.now(),
      },
    });
    this.record({
      id: hash,
      at: Math.floor(Date.now() / 1000),
      action: action.action,
      amount: action.amount,
      status: "pending",
      source: "onchain",
      detail: action.detail,
      txHash: hash,
      policyVersion: action.version,
      marketId: action.marketId,
    });
    // Signed bytes, nonce and hash are durable BEFORE broadcast. Never replace an unknown order.
    await client.sendRawTransaction({ serializedTransaction: raw });
    await this.ctx.storage.setAlarm(Date.now() + 3000);
  }
  private async reconcilePending(state: State) {
    if (!state.pending || !state.account) return;
    const pending = state.pending;
    const client = rpc(this.env);
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: pending.hash });
    } catch {
      if (
        Date.now() - pending.preparedAt < 60000 &&
        this.env.EXECUTION_ENABLED === "true"
      ) {
        try {
          await client.sendRawTransaction({
            serializedTransaction: pending.raw,
          });
        } catch {
          /* Same bytes only. */
        }
      }
      if (Date.now() - pending.preparedAt > 300000) {
        this.save({
          ...this.state(),
          running: false,
          monitoring: false,
          message:
            "Transaction outcome unknown. Manual reconciliation required.",
        });
        return;
      }
      await this.ctx.storage.setAlarm(Date.now() + 10000);
      return;
    }
    const evidence = receiptEvidence(receipt, state.account, pending);
    const latest = this.state();
    const verified =
      receipt.status === "success" && evidence.status !== "unknown";
    this.save({
      ...latest,
      pending: undefined,
      running: verified && latest.running,
      monitoring: verified && latest.monitoring,
      error: verified ? undefined : evidence.detail,
      message: verified
        ? "Confirmed. Waiting for the next check."
        : "Transaction needs review. Automation is stopped.",
    });
    this.record({
      id: pending.hash,
      at: Math.floor(Date.now() / 1000),
      source: "onchain",
      txHash: pending.hash,
      marketId: pending.marketId,
      policyVersion: pending.version,
      ...evidence,
    });
    if (this.state().running || this.state().monitoring)
      await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
}
