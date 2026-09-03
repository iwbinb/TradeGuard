import { DurableObject } from "cloudflare:workers";
import { verifyMessage, type Address, type Hex } from "viem";
import { HttpError } from "./http";
const encoder = new TextEncoder();
async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export class AuthSession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS challenges (nonce TEXT PRIMARY KEY, address TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, address TEXT NOT NULL, expires INTEGER NOT NULL)",
    );
  }
  challenge(address: string, origin: string) {
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM challenges WHERE expires < ?", now);
    const existing = this.ctx.storage.sql
      .exec<{ nonce: string; message: string; expires: number }>(
        "SELECT nonce,message,expires FROM challenges WHERE used = 0 AND expires > ? AND address = ?",
        now + 30000,
        address.toLowerCase(),
      )
      .toArray()
      .find((r) => r.message.includes(`URI: ${origin}\n`));
    if (existing) return existing;
    if (
      this.ctx.storage.sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM challenges WHERE used = 0",
        )
        .one().n >= 5
    )
      throw new Error("Too many pending login requests. Please wait.");
    const nonce = crypto.randomUUID();
    const expires = now + 300_000;
    const message = `${new URL(origin).host} wants you to sign in to TradeGuard.\n\nAddress: ${address}\nURI: ${origin}\nChain ID: 50312\nNonce: ${nonce}\nExpires: ${new Date(expires).toISOString()}\n\nSign-in only. This does not authorize spending or transactions.`;
    this.ctx.storage.sql.exec(
      "INSERT INTO challenges (nonce,address,message,expires) VALUES (?,?,?,?)",
      nonce,
      address.toLowerCase(),
      message,
      expires,
    );
    return { nonce, message, expires };
  }
  async login(address: string, nonce: string, signature: Hex, origin: string) {
    const row = this.ctx.storage.sql
      .exec<{
        address: string;
        message: string;
        expires: number;
        used: number;
      }>("SELECT * FROM challenges WHERE nonce = ?", nonce)
      .toArray()[0];
    if (
      !row ||
      row.used ||
      row.expires <= Date.now() ||
      row.address !== address.toLowerCase() ||
      !row.message.includes(`URI: ${origin}\n`)
    )
      return { ok: false as const, error: "Login challenge expired or used." };
    const valid = await verifyMessage({
      address: address as Address,
      message: row.message,
      signature,
    }).catch(() => false);
    if (!valid)
      return {
        ok: false as const,
        error: "Signature does not match the wallet.",
      };
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const hash = await digest(token);
    // No external I/O between the conditional consume and the session write.
    const updated = this.ctx.storage.sql
      .exec(
        "UPDATE challenges SET used = 1 WHERE nonce = ? AND used = 0 AND expires > ? RETURNING nonce",
        nonce,
        Date.now(),
      )
      .toArray();
    if (!updated.length)
      return { ok: false as const, error: "Login challenge expired or used." };
    this.ctx.storage.sql.exec(
      "DELETE FROM sessions WHERE expires < ?",
      Date.now(),
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO sessions (hash,address,expires) VALUES (?,?,?)",
      hash,
      address.toLowerCase(),
      Date.now() + 7_200_000,
    );
    return { ok: true as const, token, address: address.toLowerCase() };
  }
  async authenticate(token: string): Promise<string | null> {
    const hash = await digest(token);
    const row = this.ctx.storage.sql
      .exec<{ address: string; expires: number }>(
        "SELECT address,expires FROM sessions WHERE hash = ?",
        hash,
      )
      .toArray()[0];
    return row && row.expires > Date.now() ? row.address : null;
  }
  async logout(token: string) {
    this.ctx.storage.sql.exec(
      "DELETE FROM sessions WHERE hash = ?",
      await digest(token),
    );
  }
}
export function cookieCredentials(
  request: Request,
): { address: string; token: string } | null {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("tg_session="))
    ?.slice(11);
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const [address, token] = decoded.split(":");
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(address ?? "") ||
    !/^[0-9a-f-]{72}$/.test(token ?? "")
  )
    return null;
  return { address: address.toLowerCase(), token };
}
export async function requireOwner(
  request: Request,
  env: Env,
): Promise<Address> {
  const c = cookieCredentials(request);
  if (!c) throw new HttpError(401, "Sign in with your owner wallet first.");
  const owner = await env.AUTH.getByName(c.address).authenticate(c.token);
  if (!owner) throw new HttpError(401, "Your wallet session expired.");
  return owner as Address;
}
