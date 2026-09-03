import { env, SELF, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { executorFor } from "../../server/secrets";
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
const origin = "https://tradeguard.test";
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  SELF.fetch(origin + path, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
describe("Workers API safety", () => {
  it("limits repeated public sign-in requests before creating challenges", async () => {
    const requests = [];
    for (let i = 0; i < 13; i++)
      requests.push(
        await post(
          "/api/auth/challenge",
          { address: "invalid" },
          {
            "CF-Connecting-IP": "192.0.2.31",
          },
        ),
      );
    expect(requests.at(-1)!.status).toBe(429);
    expect(requests.at(-1)!.headers.get("retry-after")).toBe("60");
  });
  it("reports disabled execution honestly", async () => {
    const r = await SELF.fetch(origin + "/api/config");
    const body = await r.json<{
      liveConfigured: boolean;
      executionConfigured: boolean;
    }>();
    expect(body.liveConfigured).toBe(false);
    expect(body.executionConfigured).toBe(false);
  });
  it("keeps unknown API routes as JSON errors", async () => {
    const r = await SELF.fetch(origin + "/api/not-a-route");
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toMatch(/json/);
  });
  it("rejects cross-origin writes", async () => {
    const r = await post(
      "/api/runner/start",
      { strategy: "reference" },
      { Origin: "https://other.test" },
    );
    expect(r.status).toBe(403);
  });
  it("requires owner sign-in for runner controls", async () => {
    const r = await post("/api/runner/pause", {});
    expect(r.status).toBe(401);
  });
  it("rejects malformed addresses", async () => {
    const r = await post("/api/auth/challenge", { address: "someone" });
    expect(r.status).toBe(400);
  });
});
describe("owner challenge and session isolation", () => {
  it("verifies possession and consumes a challenge", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const challengeResponse = await post("/api/auth/challenge", {
      address: account.address,
    });
    const challenge = await challengeResponse.json<{
      nonce: string;
      message: string;
    }>();
    expect(challenge.message).toContain("Sign-in only");
    const signature = await account.signMessage({ message: challenge.message });
    const result = await post("/api/auth/login", {
      address: account.address,
      nonce: challenge.nonce,
      signature,
    });
    expect(result.status).toBe(200);
    const cookie = result.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    const replay = await post("/api/auth/login", {
      address: account.address,
      nonce: challenge.nonce,
      signature,
    });
    expect(replay.status).not.toBe(200);
    const logout = await post(
      "/api/auth/logout",
      {},
      { Cookie: cookie.split(";")[0] },
    );
    expect(logout.status).toBe(200);
  });
  it("binds signature to origin", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const auth = env.AUTH.getByName(account.address.toLowerCase());
    const challenge = await auth.challenge(account.address, origin);
    const signature = await account.signMessage({ message: challenge.message });
    const rejected = await SELF.fetch("https://other.test/api/auth/login", {
      method: "POST",
      headers: {
        Origin: "https://other.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address: account.address,
        nonce: challenge.nonce,
        signature,
      }),
    });
    expect(rejected.status).not.toBe(200);
  });
  it("reuses a pending challenge for repeated public requests", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const auth = env.AUTH.getByName(account.address.toLowerCase());
    const one = await auth.challenge(account.address, origin);
    const two = await auth.challenge(account.address, origin);
    expect(one.nonce).toBe(two.nonce);
  });
  it("isolates execution keys by account", async () => {
    const seed = generatePrivateKey().slice(2);
    const a = privateKeyToAccount(generatePrivateKey()).address;
    const b = privateKeyToAccount(generatePrivateKey()).address;
    const [one, two, repeat] = await Promise.all([
      executorFor(seed, a),
      executorFor(seed, b),
      executorFor(seed, a),
    ]);
    expect(one.address).not.toBe(two.address);
    expect(one.address).toBe(repeat.address);
  });
  it("rejects a weak execution seed", async () => {
    await expect(
      executorFor(
        "0".repeat(64),
        privateKeyToAccount(generatePrivateKey()).address,
      ),
    ).rejects.toThrow();
  });
});
describe("Durable Object defaults", () => {
  it("persists pause independently for separate accounts", async () => {
    const a = env.RUNNERS.getByName(crypto.randomUUID());
    const b = env.RUNNERS.getByName(crypto.randomUUID());
    await a.pause();
    expect((await a.status()).message).toContain("Paused");
    expect((await b.status()).message).toBe("Agent stopped.");
  });
  it("retains a pending transaction across pause and stop without exposing signed bytes", async () => {
    const runner = env.RUNNERS.getByName(crypto.randomUUID());
    const hash = "0x" + "1".repeat(64);
    await runInDurableObject(runner, async (_instance, ctx) => {
      ctx.storage.sql.exec(
        "INSERT INTO state(id,json) VALUES(1,?)",
        JSON.stringify({
          running: true,
          monitoring: true,
          strategy: "reference",
          message: "Pending",
          generation: 1,
          failures: 0,
          pending: { hash, raw: "test-signed-bytes", preparedAt: Date.now() },
        }),
      );
    });
    await runner.pause();
    expect((await runner.status()).pendingTx).toBe(hash);
    expect((await runner.status()).running).toBe(false);
    expect((await runner.status()).monitoring).toBe(true);
    await runner.stopMonitoring();
    const status = await runner.status();
    expect(status.pendingTx).toBe(hash);
    expect(status.monitoring).toBe(false);
    expect(JSON.stringify(status)).not.toContain("test-signed-bytes");
  });
  it("disables an already persisted runner when execution is off", async () => {
    const runner = env.RUNNERS.getByName(crypto.randomUUID());
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS activity(account TEXT,id TEXT,at INTEGER,payload TEXT,PRIMARY KEY(account,id));",
    );
    await runInDurableObject(runner, async (instance, ctx) => {
      ctx.storage.sql.exec(
        "INSERT INTO state(id,json) VALUES(1,?)",
        JSON.stringify({
          owner: "0x1111111111111111111111111111111111111111",
          account: "0x2222222222222222222222222222222222222222",
          running: true,
          monitoring: true,
          strategy: "reference",
          message: "Running",
          generation: 1,
          failures: 0,
          monitorUntil: Date.now() + 86400000,
        }),
      );
      await instance.alarm();
    });
    const status = await runner.status();
    expect(status.running).toBe(false);
    expect(status.monitoring).toBe(false);
    expect(status.error).toContain("disabled");
  });
});
