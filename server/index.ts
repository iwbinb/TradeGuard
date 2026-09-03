import { z } from "zod";
import { isAddress, type Address, type Hex } from "viem";
import { addressSchema } from "../shared/policy";
import {
  accountFor,
  COLLATERAL,
  EXPLORER,
  listMarkets,
  MODULE,
  readAccount,
} from "./protocol";
import { cookieCredentials, requireOwner } from "./auth";
import { boundedJson, assertSameOrigin, HttpError, json } from "./http";
import { executorFor, type AppEnv } from "./secrets";
import { limitApiRequest } from "./rate-limit";
import { diagnosticRequest, requireModelDiagnostic } from "./model-diagnostics";
export { AuthSession } from "./auth";
export { TradingRunner } from "./runner";
export { ModelDiagnostics } from "./model-diagnostics";

const hexSignature = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
async function api(request: Request, env: AppEnv) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!["GET", "POST"].includes(request.method))
    throw new HttpError(405, "Method not allowed.");
  if (request.method === "POST") assertSameOrigin(request);
  if (path.startsWith("/api/diagnostics/model/")) {
    await requireModelDiagnostic(request, env);
    const probe = env.MODEL_CHECKS.getByName(env.MODEL_CHECK_RUN_ID);
    if (path === "/api/diagnostics/model/status" && request.method === "GET")
      return json(await probe.status());
    if (path === "/api/diagnostics/model/close" && request.method === "POST")
      return json(await probe.close());
    if (path === "/api/diagnostics/model/run" && request.method === "POST") {
      const { requestId } = diagnosticRequest.parse(
        await boundedJson(request, 1024),
      );
      const { markets } = await listMarkets(env);
      const now = Math.floor(Date.now() / 1000);
      const market = markets.find(
        (m) =>
          m.status === 1 &&
          m.expiry > now + 60 &&
          m.bestAsk &&
          m.bestBid &&
          m.fetchedAt >= now - 30,
      );
      if (!market)
        throw new HttpError(
          503,
          "No fresh two-sided testnet market is available.",
        );
      const result = await probe.run(requestId, market);
      return json(result, result.httpStatus);
    }
    throw new HttpError(404, "Diagnostic route not found.");
  }
  if (path === "/api/config" && request.method === "GET")
    return json({
      chainId: 50312,
      network: "Somnia Shannon",
      factory: isAddress(env.FACTORY_ADDRESS) ? env.FACTORY_ADDRESS : null,
      module: MODULE,
      collateral: COLLATERAL,
      explorer: EXPLORER,
      liveConfigured: isAddress(env.FACTORY_ADDRESS),
      executionConfigured:
        env.EXECUTION_ENABLED === "true" && !!env.EXECUTOR_SEED,
      modelConfigured: !!(
        env.MODEL_API_KEY &&
        env.MODEL_NAME &&
        env.MODEL_ENDPOINT
      ),
      publicRpc: "https://api.infra.testnet.somnia.network",
    });
  if (path === "/api/health")
    return json({
      ok: true,
      network: "testnet",
      executionEnabled: env.EXECUTION_ENABLED === "true",
    });
  if (path === "/api/markets" && request.method === "GET") {
    const result = await listMarkets(env);
    return json({
      ...result,
      source: "live-testnet",
      fetchedAt: Math.floor(Date.now() / 1000),
    });
  }
  if (path === "/api/auth/challenge" && request.method === "POST") {
    const { address } = z
      .object({ address: addressSchema })
      .strict()
      .parse(await boundedJson(request, 2048));
    return json(
      env.AUTH
        ? await env.AUTH.getByName(address.toLowerCase()).challenge(
            address,
            url.origin,
          )
        : {},
    );
  }
  if (path === "/api/auth/login" && request.method === "POST") {
    const input = z
      .object({
        address: addressSchema,
        nonce: z.string().uuid(),
        signature: hexSignature,
      })
      .strict()
      .parse(await boundedJson(request, 4096));
    const result = await env.AUTH.getByName(input.address.toLowerCase()).login(
      input.address,
      input.nonce,
      input.signature as Hex,
      url.origin,
    );
    if (!result.ok) throw new HttpError(401, result.error);
    const secure = url.protocol === "https:" ? "; Secure" : "";
    return json({ address: result.address }, 200, {
      "Set-Cookie": `tg_session=${result.address}:${result.token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=7200${secure}`,
    });
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    const credentials = cookieCredentials(request);
    if (credentials)
      await env.AUTH.getByName(credentials.address).logout(credentials.token);
    return json({ ok: true }, 200, {
      "Set-Cookie":
        "tg_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0",
    });
  }
  if (path === "/api/account" && request.method === "GET") {
    const owner = addressSchema.parse(url.searchParams.get("owner")) as Address;
    const snapshot = await readAccount(env, owner);
    const credentials = cookieCredentials(request);
    const authenticated =
      credentials?.address === owner.toLowerCase() &&
      (await env.AUTH.getByName(credentials.address).authenticate(
        credentials.token,
      ));
    const executor =
      snapshot.account && env.EXECUTOR_SEED
        ? (await executorFor(env.EXECUTOR_SEED, snapshot.account as Address))
            .address
        : null;
    if (snapshot.account && authenticated) {
      const runner = env.RUNNERS.getByName(
        `50312:${snapshot.account.toLowerCase()}`,
      );
      snapshot.runner = await runner.status();
      snapshot.activities = await runner.events();
    }
    return json({
      snapshot,
      executor,
      authenticated: !!authenticated,
      historyCoverage:
        "Service-recorded activity only; not complete address history.",
    });
  }
  if (path.startsWith("/api/runner/") && request.method === "POST") {
    const owner = await requireOwner(request, env);
    const account = await accountFor(env, owner);
    if (!account)
      throw new HttpError(409, "Create a deployed TradeGuard account first.");
    const runner = env.RUNNERS.getByName(`50312:${account.toLowerCase()}`);
    if (path === "/api/runner/start") {
      const { strategy } = z
        .object({ strategy: z.enum(["reference", "model"]) })
        .strict()
        .parse(await boundedJson(request, 1024));
      return json(await runner.start(owner, account, strategy));
    }
    if (path === "/api/runner/pause") return json(await runner.pause());
    if (path === "/api/runner/stop") return json(await runner.stopMonitoring());
    if (path === "/api/runner/reconcile") return json(await runner.reconcile());
  }
  throw new HttpError(404, "API route not found.");
}
export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      try {
        await limitApiRequest(request, env);
        return await api(request, env);
      } catch (error) {
        if (error instanceof HttpError)
          return json(
            { error: error.message },
            error.status,
            error.status === 429 ? { "Retry-After": "60" } : {},
          );
        if (error instanceof z.ZodError)
          return json({ error: "The request contains invalid fields." }, 400);
        console.error(
          JSON.stringify({ event: "request_failed", id: crypto.randomUUID() }),
        );
        return json(
          {
            error:
              "This operation could not be completed. No success has been assumed.",
          },
          503,
        );
      }
    }
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<AppEnv>;
