import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { TradeGuardAccountAbi } from "../../shared/generated/TradeGuardAccount";
import { receiptEvidence, reserveGas } from "../../server/execution";
const account = "0x1111111111111111111111111111111111111111" as Address;
const marketId = ("0x" + "1".repeat(64)) as Hex;
const intent = ("0x" + "2".repeat(64)) as Hex;
const pending = {
  kind: "buy" as const,
  marketId,
  intent,
  version: 1,
  quantity: "1000",
};
function fillLog(address = account, eventIntent = intent) {
  return {
    address,
    topics: encodeEventTopics({
      abi: TradeGuardAccountAbi,
      eventName: "BuyExecuted",
      args: { intentId: eventIntent, marketId, version: 1n },
    }),
    data: encodeAbiParameters(
      [
        { type: "bool" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint128" },
      ],
      [true, 300n, 600n, 0n],
    ),
  } as TransactionReceipt["logs"][number];
}
describe("authoritative receipt evidence", () => {
  it("decodes actual partial fill amounts", () => {
    expect(
      receiptEvidence(
        { status: "success", logs: [fillLog()] },
        account,
        pending,
      ),
    ).toMatchObject({ status: "partial", paid: "300", filled: "600" });
  });
  it("does not invent a no-fill when an event is absent", () => {
    expect(
      receiptEvidence({ status: "success", logs: [] }, account, pending).status,
    ).toBe("unknown");
  });
  it("rejects a foreign account event", () => {
    expect(
      receiptEvidence(
        {
          status: "success",
          logs: [fillLog("0x3333333333333333333333333333333333333333")],
        },
        account,
        pending,
      ).status,
    ).toBe("unknown");
  });
  it("rejects the wrong intent", () => {
    expect(
      receiptEvidence(
        { status: "success", logs: [fillLog(account, marketId)] },
        account,
        pending,
      ).status,
    ).toBe("unknown");
  });
  it("never counts logs from reverted execution", () => {
    expect(
      receiptEvidence(
        { status: "reverted", logs: [fillLog()] },
        account,
        pending,
      ).status,
    ).toBe("reverted");
  });
});
describe("automation gas safety", () => {
  it("reserves worst-case cost cumulatively", () =>
    expect(reserveGas("100", 100n, 2n, 10n, 1000n)).toBe("300"));
  it("enforces a total ceiling", () =>
    expect(() => reserveGas("50000000000000000", 1n, 1n, 10n, 1000n)).toThrow(
      /cap/,
    ));
  it("requires funded executor", () =>
    expect(() => reserveGas("0", 100n, 2n, 10n, 10n)).toThrow(/STT/));
  it("enforces gas price ceiling", () =>
    expect(() => reserveGas("0", 100n, 11n, 10n, 10000n)).toThrow(/ceiling/));
});
