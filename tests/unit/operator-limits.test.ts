import { describe, expect, it } from "vitest";
import {
  executionAvailable,
  executionOwnerAllowed,
  monitorDeadline,
  operatorLimits,
} from "../../server/operator-limits";

const now = 1800000000000;
const owner = "0x1111111111111111111111111111111111111111";
const scope = {
  EXECUTION_ENABLED: "true",
  EXECUTOR_SEED: "test",
  EXECUTION_OWNER_ALLOWLIST: owner,
  EXECUTION_EXPIRES_AT: String(now / 1000 + 1800),
  MODEL_CALL_LIMIT: "5",
  MONITOR_SECONDS: "1800",
};

describe("bounded operator execution", () => {
  it("allows only exact approved identities within the absolute window", () => {
    expect(executionOwnerAllowed(scope, owner, now)).toBe(true);
    expect(
      executionOwnerAllowed(
        scope,
        "0x2222222222222222222222222222222222222222",
        now,
      ),
    ).toBe(false);
    expect(executionOwnerAllowed(scope, owner, now + 1800000)).toBe(false);
  });
  it.each(["", "*", owner + ",invalid", "0x" + "0".repeat(40)])(
    "rejects unsafe allowlist %s",
    (value) => {
      expect(
        executionAvailable({ ...scope, EXECUTION_OWNER_ALLOWLIST: value }, now),
      ).toBe(false);
    },
  );
  it.each(["0", "-1", "NaN", "Infinity", "1800086401"])(
    "rejects unsafe expiry %s",
    (value) => {
      expect(
        executionAvailable({ ...scope, EXECUTION_EXPIRES_AT: value }, now),
      ).toBe(false);
    },
  );
  it.each(["0", "21", "1.5", "1e1", "", "NaN"])(
    "rejects invalid model limit %s",
    (value) => {
      expect(
        executionAvailable({ ...scope, MODEL_CALL_LIMIT: value }, now),
      ).toBe(false);
    },
  );
  it("retains tighter prior deadlines and applies reduced limits", () => {
    expect(operatorLimits(scope)).toEqual({
      modelCalls: 5,
      monitorSeconds: 1800,
    });
    expect(monitorDeadline(scope, now + 30000, now)).toBe(now + 30000);
    expect(monitorDeadline(scope, undefined, now)).toBe(now + 1800000);
    expect(
      executionAvailable({ ...scope, MONITOR_SECONDS: "86401" }, now),
    ).toBe(false);
    expect(
      executionAvailable({ ...scope, EXECUTION_ENABLED: "false" }, now),
    ).toBe(false);
  });
});
