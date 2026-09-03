import { describe, expect, it } from "vitest";
import { pendingFor, savePending, clearPending } from "../../src/lib/pending";
import { snapshotSchema } from "../../shared/validation";
import { seedSimulation } from "../../shared/simulation";
const a = "0x1111111111111111111111111111111111111111";
const b = "0x2222222222222222222222222222222222222222";
const hash = ("0x" + "1".repeat(64)) as `0x${string}`;
describe("durable client transaction references", () => {
  it("isolates saved pending hashes by owner", () => {
    savePending(a, hash, "deposit");
    expect(pendingFor(a)).toBe(hash);
    expect(pendingFor(b)).toBeNull();
  });
  it("does not clear a different owner pending hash", () => {
    savePending(a, hash, "policy");
    clearPending(b, hash);
    expect(pendingFor(a)).toBe(hash);
  });
  it("only clears the confirmed reference", () => {
    savePending(a, hash, "policy");
    clearPending(a, hash);
    expect(pendingFor(a)).toBeNull();
  });
  it("fails closed on corrupt pending state", () => {
    localStorage.setItem("tradeguard-pending-50312-" + a, "{}");
    expect(() => pendingFor(a)).toThrow();
  });
  it("accepts valid simulation and rejects corrupt balances", () => {
    expect(snapshotSchema.safeParse(seedSimulation()).success).toBe(true);
    expect(
      snapshotSchema.safeParse({
        ...seedSimulation(),
        positions: [{ ...seedSimulation().positions[0], claimable: "bad" }],
      }).success,
    ).toBe(false);
  });
});
