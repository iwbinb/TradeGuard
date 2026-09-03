export function parseAmount(input: string, decimals = 6): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("Unsupported asset precision.");
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(input.trim()))
    throw new Error("Enter a positive decimal amount.");
  const [whole, fraction = ""] = input.trim().split(".");
  if (fraction.length > decimals)
    throw new Error(`Use no more than ${decimals} decimal places.`);
  const result =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (result > (1n << 128n) - 1n) throw new Error("Amount is too large.");
  return result;
}
export function amount(raw: string | bigint, decimals = 6, places = 2): string {
  const value = BigInt(raw);
  const sign = value < 0n ? "-" : "";
  const n = value < 0n ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = (n / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (n % scale)
    .toString()
    .padStart(decimals, "0")
    .slice(0, places)
    .padEnd(places, "0");
  return `${sign}${whole}${places ? `.${fraction}` : ""}`;
}
export const min = (...values: bigint[]) =>
  values.reduce((a, b) => (a < b ? a : b));
export const ceilDiv = (n: bigint, d: bigint) => {
  if (d <= 0n) throw new Error("Invalid divisor");
  return (n + d - 1n) / d;
};
export function spentPercent(spent: string, budget: string): number {
  const b = BigInt(budget);
  return b === 0n
    ? 0
    : Math.min(100, Number((BigInt(spent) * 10000n) / b) / 100);
}
export function decimalInput(raw: string, decimals = 6): string {
  const n = BigInt(raw);
  const s = 10n ** BigInt(decimals);
  const fraction = (n % s)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${n / s}${fraction ? `.${fraction}` : ""}`;
}
