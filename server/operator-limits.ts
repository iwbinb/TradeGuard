import { isAddress } from "viem";

export interface OperatorEnv {
  EXECUTION_ENABLED?: string;
  EXECUTOR_SEED?: string;
  EXECUTION_OWNER_ALLOWLIST?: string;
  EXECUTION_EXPIRES_AT?: string;
  MODEL_CALL_LIMIT?: string;
  MONITOR_SECONDS?: string;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
) {
  const raw = value ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error("Invalid operator limit.");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum)
    throw new Error("Invalid operator limit.");
  return parsed;
}

export function operatorLimits(env: OperatorEnv) {
  return {
    modelCalls: boundedInteger(env.MODEL_CALL_LIMIT, 20, 20),
    monitorSeconds: boundedInteger(env.MONITOR_SECONDS, 86400, 86400),
  };
}

// Empty or malformed configuration is disabled, never permission for every owner.
export function executionAvailable(env: OperatorEnv, now = Date.now()) {
  try {
    operatorLimits(env);
    const expires = Number(env.EXECUTION_EXPIRES_AT);
    const owners = (env.EXECUTION_OWNER_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim());
    return (
      env.EXECUTION_ENABLED === "true" &&
      !!env.EXECUTOR_SEED &&
      Number.isSafeInteger(expires) &&
      expires * 1000 > now &&
      expires * 1000 <= now + 86400000 &&
      owners.length <= 20 &&
      owners.every(
        (owner) =>
          isAddress(owner, { strict: false }) && !/^0x0{40}$/.test(owner),
      )
    );
  } catch {
    return false;
  }
}

export function executionOwnerAllowed(
  env: OperatorEnv,
  owner: string,
  now = Date.now(),
) {
  return (
    executionAvailable(env, now) &&
    (env.EXECUTION_OWNER_ALLOWLIST ?? "")
      .split(",")
      .some((allowed) => allowed.trim().toLowerCase() === owner.toLowerCase())
  );
}

export function monitorDeadline(
  env: OperatorEnv,
  previous: number | undefined,
  now = Date.now(),
) {
  return Math.min(
    previous ?? Infinity,
    now + operatorLimits(env).monitorSeconds * 1000,
    Number(env.EXECUTION_EXPIRES_AT) * 1000,
  );
}
