export interface RecordedEvidence {
  id: string;
  title: string;
  strategy: string;
  date: string;
  account: string;
  policyVersion: number;
  summary: string;
  facts: { label: string; value: string }[];
  transactions: {
    label: string;
    hash: string;
    block: string;
    result: string;
  }[];
}

// Historical public-chain evidence, not account state or a simulated trade.
export const recordedEvidence: RecordedEvidence[] = [
  {
    id: "ai-order",
    title: "A real AI order, within its permission",
    strategy: "OpenAI GPT-5.6 Luna · 1 request",
    date: "September 3, 2026 · Somnia Shannon · Chain 50312",
    account: "0xd625780218D90AcC3CF71967fE454f68582EfB99",
    policyVersion: 2,
    summary:
      "The model proposed BTC Up. The guard executed one bounded order. The market resolved Down: this test lost its 0.499044 tUSDC stake, paid out zero, and returned the unused collateral. It is not evidence of profitable prediction.",
    facts: [
      { label: "Actual debit", value: "0.499044 tUSDC" },
      { label: "Actual fill", value: "0.914 Up shares" },
      { label: "Settlement payout", value: "0 tUSDC" },
      { label: "Unused funds returned", value: "1.500956 tUSDC" },
    ],
    transactions: [
      {
        label: "Bounded permission",
        hash: "0x473f32f395c89fd9ab87ea29b4baf78378462de0c644649aedc3fadbe8a43ca1",
        block: "478552121",
        result: "One market · 0.50 per order · 1.00 total tUSDC",
      },
      {
        label: "AI order filled",
        hash: "0x2860cececefb5bfddf1ee436874d609a62e195a7f557004283b6dc01bffc86f1",
        block: "478552843",
        result: "Actual debit and received shares confirmed",
      },
      {
        label: "Permission revoked",
        hash: "0xd6df4ffd3576e48a39e6e259ffb33e2357ac0c9cbd6e9b34b7fe3746cbf9250a",
        block: "478553499",
        result: "Confirmed before market expiry",
      },
      {
        label: "Zero-payout claim",
        hash: "0x517d40ed8faf0f4ba40b4554433db54651e1f34903c53ebe6fda4458932ac0aa",
        block: "478556819",
        result: "Successful call; no payout invented",
      },
      {
        label: "Owner withdrawal",
        hash: "0x1d0ae11fa66a5f1343c54946183bcca65d8efcda1b8660328f732334fbc09406",
        block: "478556886",
        result: "All available collateral returned to Owner",
      },
    ],
  },
];

export const recordedRefusals = [
  { label: "Above per-order limit", result: "PerOrderExceeded" },
  { label: "Unapproved market", result: "UnknownMarket" },
  { label: "After confirmed revocation", result: "InactivePolicy" },
] as const;
