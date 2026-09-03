import { bytesToHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
export type AppEnv = Env & {
  EXECUTOR_SEED?: string;
  MODEL_API_KEY?: string;
  MODEL_CHECK_TOKEN?: string;
};
export async function executorFor(seed: string, account: Address) {
  if (!/^[a-fA-F0-9]{64}$/.test(seed) || /^0+$/.test(seed))
    throw new Error("Executor seed is not configured securely.");
  const raw = Uint8Array.from(seed.match(/../g)!, (x) => parseInt(x, 16));
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  for (let counter = 0; counter < 8; counter++) {
    const derived = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(
          `tradeguard:50312:${account.toLowerCase()}:${counter}`,
        ),
      ),
    );
    try {
      return privateKeyToAccount(bytesToHex(derived));
    } catch {
      /* Reject the negligible invalid scalar case deterministically. */
    }
  }
  throw new Error("Unable to derive executor.");
}
