import { env, SELF, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ModelDiagnostics,
  requireModelDiagnostic,
} from "../../server/model-diagnostics";
import { demoMarket } from "../../shared/simulation";
import type { AppEnv } from "../../server/secrets";

const token = "a".repeat(64);
function configured(): AppEnv {
  return {
    ...env,
    MODEL_CHECK_RUN_ID: crypto.randomUUID(),
    MODEL_CHECK_EXPIRES_AT: String(Date.now() + 60000),
    MODEL_CHECK_TOKEN: token,
    MODEL_API_KEY: "unit-test-only",
    MODEL_NAME: "gpt-5.6-luna",
    MODEL_ENDPOINT: "https://api.openai.com/v1/chat/completions",
    EXECUTION_ENABLED: "false",
  };
}
function market() {
  const now = Math.floor(Date.now() / 1000);
  return {
    ...demoMarket(),
    fetchedAt: now,
    expiry: now + 600,
    bestAsk: "520000",
    bestBid: "500000",
  };
}
const response = {
  model: "gpt-5.6-luna",
  usage: {
    prompt_tokens: 250,
    completion_tokens: 90,
    prompt_tokens_details: { cached_tokens: 0 },
  },
  choices: [
    {
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          decision: "abstain",
          side: "up",
          confidence: 0.2,
          reason: "No directional evidence.",
        }),
      },
    },
  ],
};
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(new Error("Unmocked network request is forbidden.")),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("protected model diagnostics", () => {
  it("is absent by default and never exposes credentials in public configuration", async () => {
    const result = await SELF.fetch(
      "https://tradeguard.test/api/diagnostics/model/status",
    );
    expect(result.status).toBe(404);
    const config = await SELF.fetch("https://tradeguard.test/api/config");
    const body = await config.text();
    expect(body).not.toContain("MODEL_CHECK_TOKEN");
    expect(body).not.toContain("MODEL_API_KEY");
  });
  it("requires the exact temporary credential and rejects expired or trading-enabled configurations", async () => {
    const config = configured();
    const request = (value: string) =>
      new Request("https://tradeguard.test/api/diagnostics/model/status", {
        headers: { Authorization: `Bearer ${value}` },
      });
    await expect(
      requireModelDiagnostic(request(token), config),
    ).resolves.toBeUndefined();
    await expect(
      requireModelDiagnostic(request("b".repeat(64)), config),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      requireModelDiagnostic(request(token), {
        ...config,
        MODEL_CHECK_EXPIRES_AT: "0",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      requireModelDiagnostic(request(token), {
        ...config,
        EXECUTION_ENABLED: "true",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("persists the three-call budget, replays without billing again and closes permanently", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () =>
        Response.json(response, {
          headers: { "x-request-id": "req_test_only" },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const stub = env.MODEL_CHECKS.getByName(crypto.randomUUID());
    await runInDurableObject(stub, async (_instance, ctx) => {
      const config = configured();
      const probe = new ModelDiagnostics(ctx, config);
      const id = crypto.randomUUID();
      const first = await probe.run(id, market());
      expect(first.httpStatus).toBe(200);
      expect(first.record?.metrics?.usage?.promptTokens).toBe(250);
      expect(first.record?.orderSubmitted).toBe(false);
      expect((await probe.run(id, market())).replayed).toBe(true);
      await probe.run(crypto.randomUUID(), market());
      await probe.run(crypto.randomUUID(), market());
      const restored = new ModelDiagnostics(ctx, config);
      expect(restored.status().attempts).toBe(3);
      expect(restored.status().reservedMicroUsd).toBe(90000);
      expect(
        (await restored.run(crypto.randomUUID(), market())).httpStatus,
      ).toBe(429);
      restored.close();
      expect(
        (await new ModelDiagnostics(ctx, config).run(id, market())).httpStatus,
      ).toBe(410);
      expect(JSON.stringify(restored.status())).not.toContain(token);
      expect(JSON.stringify(restored.status())).not.toContain("unit-test-only");
      expect(await ctx.storage.getAlarm()).toBeNull();
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("retains uncertain in-flight requests rather than starting another call", async () => {
    const stub = env.MODEL_CHECKS.getByName(crypto.randomUUID());
    await runInDurableObject(stub, async (_instance, ctx) => {
      const probe = new ModelDiagnostics(ctx, configured());
      const id = crypto.randomUUID();
      ctx.storage.sql.exec(
        "INSERT INTO diagnostic_attempts(id,reserved,result) VALUES(?,?,?)",
        id,
        30000,
        JSON.stringify({ requestId: id, state: "running" }),
      );
      expect((await probe.run(id, market())).httpStatus).toBe(202);
      expect((await probe.run(crypto.randomUUID(), market())).httpStatus).toBe(
        409,
      );
      expect(probe.status().attempts).toBe(1);
    });
  });
  it("rejects stale data and configuration changes before spending the budget", async () => {
    const stub = env.MODEL_CHECKS.getByName(crypto.randomUUID());
    await runInDurableObject(stub, async (_instance, ctx) => {
      const config = configured();
      const probe = new ModelDiagnostics(ctx, config);
      expect(
        (await probe.run(crypto.randomUUID(), { ...market(), fetchedAt: 0 }))
          .httpStatus,
      ).toBe(409);
      expect(
        (
          await new ModelDiagnostics(ctx, {
            ...config,
            MODEL_NAME: "different-model",
          }).run(crypto.randomUUID(), market())
        ).httpStatus,
      ).toBe(409);
      expect(probe.status().attempts).toBe(0);
    });
  });
});
