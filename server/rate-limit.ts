import type { AppEnv } from "./secrets";
import { HttpError } from "./http";

export async function limitApiRequest(request: Request, env: AppEnv) {
  // This header is supplied by Cloudflare on public ingress. Local emulation
  // has no trusted client IP; bypass only outside the production environment.
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip && env.APP_ENV !== "production") return;
  if (!ip || !env.API_LIMITER || !env.AUTH_LIMITER)
    throw new HttpError(503, "Request protection is unavailable.");
  const overall = await env.API_LIMITER.limit({ key: `tradeguard:api:${ip}` });
  if (!overall.success)
    throw new HttpError(429, "Too many requests. Try again in a minute.");
  const path = new URL(request.url).pathname;
  if (path === "/api/auth/challenge" || path === "/api/auth/login") {
    const auth = await env.AUTH_LIMITER.limit({ key: `tradeguard:auth:${ip}` });
    if (!auth.success)
      throw new HttpError(
        429,
        "Too many sign-in attempts. Try again in a minute.",
      );
  }
}
