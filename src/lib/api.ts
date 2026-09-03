import {
  configSchema,
  marketsResponseSchema,
  accountResponseSchema,
} from "../../shared/validation";
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(20000),
  });
  const payload: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      typeof payload === "object" && payload && "error" in payload
        ? String(payload.error)
        : "The service is unavailable.",
    );
  return payload as T;
}
export const getConfig = async () =>
  configSchema.parse(await request("/api/config"));
export const getMarkets = async (signal?: AbortSignal) =>
  marketsResponseSchema.parse(await request("/api/markets", { signal }));
export const getAccount = async (owner: string, signal?: AbortSignal) => {
  const result = accountResponseSchema.parse(
    await request(`/api/account?owner=${encodeURIComponent(owner)}`, {
      signal,
    }),
  );
  if (result.snapshot.owner?.toLowerCase() !== owner.toLowerCase())
    throw new Error("Account response identity mismatch.");
  return result;
};
export const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
