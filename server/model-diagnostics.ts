import { DurableObject } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Market } from "../shared/types";
import type { AppEnv } from "./secrets";
import { HttpError } from "./http";
import {
  modelDecision,
  ModelProviderError,
  type Decision,
  type ModelMetrics,
} from "./strategy";

export const diagnosticRequest = z
  .object({ requestId: z.string().uuid() })
  .strict();
const MAX_ATTEMPTS = 3;
const RESERVE_MICRO_USD = 30000;
const BUDGET_MICRO_USD = 100000;

function enabled(env: AppEnv) {
  const expires = Number(env.MODEL_CHECK_EXPIRES_AT);
  return (
    /^[a-f0-9-]{36}$/.test(env.MODEL_CHECK_RUN_ID ?? "") &&
    Number.isSafeInteger(expires) &&
    expires > Date.now() &&
    env.EXECUTION_ENABLED === "false"
  );
}
export async function requireModelDiagnostic(request: Request, env: AppEnv) {
  if (!enabled(env) || !/^[a-f0-9]{64}$/.test(env.MODEL_CHECK_TOKEN ?? ""))
    throw new HttpError(404, "Model diagnostic is disabled.");
  const provided = request.headers
    .get("authorization")
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!provided) throw new HttpError(401, "Diagnostic authorization required.");
  const bytes = new TextEncoder();
  const [one, two] = await Promise.all([
    crypto.subtle.digest("SHA-256", bytes.encode(provided)),
    crypto.subtle.digest("SHA-256", bytes.encode(env.MODEL_CHECK_TOKEN)),
  ]);
  if (!timingSafeEqual(new Uint8Array(one), new Uint8Array(two)))
    throw new HttpError(401, "Diagnostic authorization required.");
}
interface DiagnosticRecord {
  requestId: string;
  state: "running" | "complete" | "failed";
  startedAt: number;
  finishedAt: number | null;
  model: string;
  market: {
    id: string;
    asset: string;
    expiry: number;
    fetchedAt: number;
    bestAsk: string;
    bestBid: string;
  };
  decision: Decision | null;
  metrics: ModelMetrics | null;
  error: {
    kind: string;
    providerStatus?: number;
    providerCode?: string | null;
  } | null;
  dryRun: true;
  orderSubmitted: false;
}

// One object per explicitly enabled diagnostic budget. No wallet, executor,
// runner, alarm, transaction preparation or broadcast is reachable here.
export class ModelDiagnostics extends DurableObject<AppEnv> {
  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS diagnostic_attempts (id TEXT PRIMARY KEY, reserved INTEGER NOT NULL, result TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS diagnostic_control (id INTEGER PRIMARY KEY CHECK(id=1), closed INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO diagnostic_control(id,closed) VALUES(1,0)",
    );
  }
  status() {
    const records = this.ctx.storage.sql
      .exec<{ result: string }>(
        "SELECT result FROM diagnostic_attempts ORDER BY rowid",
      )
      .toArray()
      .map((row) => JSON.parse(row.result) as DiagnosticRecord);
    const budget = this.ctx.storage.sql
      .exec<{ count: number; reserved: number }>(
        "SELECT COUNT(*) AS count, COALESCE(SUM(reserved),0) AS reserved FROM diagnostic_attempts",
      )
      .one();
    return {
      runId: this.env.MODEL_CHECK_RUN_ID,
      closed: !!this.ctx.storage.sql
        .exec<{ closed: number }>(
          "SELECT closed FROM diagnostic_control WHERE id=1",
        )
        .one().closed,
      attempts: budget.count,
      maxAttempts: MAX_ATTEMPTS,
      reservedMicroUsd: budget.reserved,
      budgetMicroUsd: BUDGET_MICRO_USD,
      records,
    };
  }
  close() {
    this.ctx.storage.sql.exec(
      "UPDATE diagnostic_control SET closed=1 WHERE id=1",
    );
    return this.status();
  }
  async run(requestId: string, market: Market) {
    diagnosticRequest.parse({ requestId });
    if (
      !enabled(this.env) ||
      this.env.MODEL_ENDPOINT !==
        "https://api.openai.com/v1/chat/completions" ||
      this.env.MODEL_NAME !== "gpt-5.6-luna" ||
      !this.env.MODEL_API_KEY
    )
      return {
        httpStatus: 409,
        error: "Diagnostic configuration is unavailable.",
      };
    const previous = this.status();
    if (previous.closed)
      return { httpStatus: 410, error: "Diagnostic is closed." };
    const existing = previous.records.find(
      (row) => row.requestId === requestId,
    );
    if (existing)
      return {
        httpStatus: existing.state === "running" ? 202 : 200,
        replayed: true,
        record: existing,
      };
    if (previous.records.some((row) => row.state === "running"))
      return {
        httpStatus: 409,
        error: "A diagnostic outcome is pending; no new request was sent.",
      };
    if (
      previous.attempts >= MAX_ATTEMPTS ||
      previous.reservedMicroUsd + RESERVE_MICRO_USD > BUDGET_MICRO_USD
    )
      return {
        httpStatus: 429,
        error: "Diagnostic call or budget limit reached.",
      };
    const now = Math.floor(Date.now() / 1000);
    if (
      market.status !== 1 ||
      market.expiry <= now + 30 ||
      market.fetchedAt < now - 30 ||
      market.fetchedAt > now + 5 ||
      !market.bestAsk ||
      !market.bestBid
    )
      return {
        httpStatus: 409,
        error: "Fresh executable market data is unavailable.",
      };
    const record: DiagnosticRecord = {
      requestId,
      state: "running",
      startedAt: Date.now(),
      finishedAt: null,
      model: "gpt-5.6-luna",
      market: {
        id: market.id,
        asset: market.asset,
        expiry: market.expiry,
        fetchedAt: market.fetchedAt,
        bestAsk: market.bestAsk,
        bestBid: market.bestBid,
      },
      decision: null,
      metrics: null,
      error: null,
      dryRun: true,
      orderSubmitted: false,
    };
    // Synchronous reservation precedes external I/O; a crash retains the running
    // record and its reservation. Retrying an ID never reissues the model call.
    this.ctx.storage.sql.exec(
      "INSERT INTO diagnostic_attempts(id,reserved,result) VALUES(?,?,?)",
      requestId,
      RESERVE_MICRO_USD,
      JSON.stringify(record),
    );
    try {
      record.decision = await modelDecision(
        market,
        this.env.MODEL_ENDPOINT,
        this.env.MODEL_NAME,
        this.env.MODEL_API_KEY,
        (metrics) => {
          record.metrics = metrics;
        },
      );
      record.state = "complete";
    } catch (error) {
      record.state = "failed";
      record.error =
        error instanceof ModelProviderError
          ? {
              kind: "provider_rejected",
              providerStatus: error.status,
              providerCode: error.code,
            }
          : { kind: "response_incomplete_invalid_or_unavailable" };
    }
    record.finishedAt = Date.now();
    this.ctx.storage.sql.exec(
      "UPDATE diagnostic_attempts SET result=? WHERE id=?",
      JSON.stringify(record),
      requestId,
    );
    return {
      httpStatus: record.state === "complete" ? 200 : 502,
      replayed: false,
      record,
    };
  }
}
