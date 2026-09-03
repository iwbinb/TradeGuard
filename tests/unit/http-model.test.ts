import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedJson, assertSameOrigin } from "../../server/http";
import { modelDecision, ModelProviderError } from "../../server/strategy";
import { demoMarket } from "../../shared/simulation";
afterEach(() => vi.unstubAllGlobals());
describe("bounded requests", () => {
  it("rejects oversized JSON", async () => {
    await expect(
      boundedJson(
        new Response(JSON.stringify({ data: "a".repeat(1000) })),
        100,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("rejects malformed JSON", async () => {
    await expect(boundedJson(new Response("not json"))).rejects.toMatchObject({
      status: 400,
    });
  });
  it("rejects absent and foreign origins", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://tradeguard.example/api/test", { method: "POST" }),
      ),
    ).toThrow();
    expect(() =>
      assertSameOrigin(
        new Request("https://tradeguard.example/api/test", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
    expect(() =>
      assertSameOrigin(
        new Request("https://tradeguard.example/api/test", {
          method: "POST",
          headers: { Origin: "https://tradeguard.example" },
        }),
      ),
    ).not.toThrow();
  });
});
describe("model adapter", () => {
  it("does not send oversized prompts", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      modelDecision(
        { ...demoMarket(), asset: "x".repeat(9000) },
        "https://model.example",
        "m",
        "test-only",
      ),
    ).rejects.toThrow(/bounded/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports safe provider error codes without echoing provider text", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            {
              error: {
                code: "model_not_found",
                message: "sensitive-provider-body",
              },
            },
            { status: 404 },
          ),
        ),
    );
    await expect(
      modelDecision(demoMarket(), "https://model.example", "m", "test-only"),
    ).rejects.toMatchObject({ status: 404, code: "model_not_found" });
    expect(
      new ModelProviderError(404, "model_not_found").message,
    ).not.toContain("sensitive-provider-body");
  });
  it("uses structured output and validates responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                decision: "abstain",
                side: "up",
                confidence: 0.3,
                reason: "No evidence of an edge.",
              }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await modelDecision(
      demoMarket(),
      "https://model.example/v1/chat/completions",
      "configured-model",
      "test-only",
    );
    expect(result.decision).toBe("abstain");
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body).not.toHaveProperty("tools");
  });
  it("stops on refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ message: { content: null, refusal: "Declined" } }],
        }),
      ),
    );
    await expect(
      modelDecision(demoMarket(), "https://model.example", "m", "test-only"),
    ).rejects.toThrow(/declined/);
  });
  it("sets bounded Luna inference and rejects incomplete decisions", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: "length",
            message: {
              content: JSON.stringify({
                decision: "buy",
                side: "up",
                confidence: 0.5,
                reason: "Truncated output.",
              }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      modelDecision(
        demoMarket(),
        "https://api.openai.com/v1/chat/completions",
        "gpt-5.6-luna",
        "test-only",
      ),
    ).rejects.toThrow(/incomplete/);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.reasoning_effort).toBe("low");
    expect(body.max_completion_tokens).toBe(1200);
    expect(body).not.toHaveProperty("tools");
  });
  it("rejects insecure endpoints", async () => {
    await expect(
      modelDecision(demoMarket(), "http://model.example", "m", "test-only"),
    ).rejects.toThrow(/secure/);
  });
});
