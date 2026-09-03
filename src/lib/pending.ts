import type { Address, Hex } from "viem";
import { z } from "zod";
const record = z.object({
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  at: z.number(),
  action: z.string().max(50),
});
const key = (owner: Address) =>
  "tradeguard-pending-50312-" + owner.toLowerCase();
export function pendingFor(owner: Address): Hex | null {
  const raw = localStorage.getItem(key(owner));
  if (!raw) return null;
  const parsed = record.safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new Error(
      "The saved transaction reference is invalid. Review your wallet history before clearing browser storage.",
    );
  return parsed.data.hash as Hex;
}
export function savePending(owner: Address, hash: Hex, action: string) {
  localStorage.setItem(
    key(owner),
    JSON.stringify({ hash, action, at: Date.now() }),
  );
}
export function clearPending(owner: Address, hash: Hex) {
  if (pendingFor(owner) === hash) localStorage.removeItem(key(owner));
}
export function requireTransactionStorage() {
  try {
    const k = "tradeguard-storage-probe";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
  } catch {
    throw new Error(
      "Browser storage is unavailable. Enable it before submitting transactions so pending references survive a refresh.",
    );
  }
}
