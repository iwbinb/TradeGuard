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
  {
    id: "positive-redemption",
    title: "Positive payout after trading was revoked",
    strategy:
      "Paired integration test · No model calls · Owner-triggered recovery",
    date: "September 3, 2026 · Somnia Shannon · Chain 50312",
    account: "0xd625780218D90AcC3CF71967fE454f68582EfB99",
    policyVersion: 3,
    summary:
      "A separate two-sided test verified recovery, not prediction accuracy. Trading authority was revoked before settlement. An owner-triggered claim paid 0.881 tUSDC into the account, then 1.883604 tUSDC was returned to Owner. The test spent 0.116396 tUSDC net, before gas: positive payout is not the same as profit. This was not an unattended automatic-recovery test.",
    facts: [
      { label: "Total actual debit", value: "0.997396 tUSDC" },
      { label: "Actual protocol payout", value: "0.881 tUSDC" },
      { label: "Returned to Owner", value: "1.883604 tUSDC" },
      { label: "Net result before gas", value: "−0.116396 tUSDC" },
    ],
    transactions: [
      {
        label: "Exact deposit",
        hash: "0x5306133657f8e192187ea0295989d2b5b1e635305638e5ca1e90132c2e9bdba0",
        block: "478604045",
        result: "2.00 tUSDC deposited into the owner-controlled account",
      },
      {
        label: "Paired-test permission",
        hash: "0xf4e5e98798dfd7fb481f0c5fe5d6bc38eb9de6fde553f44e11ab5530812117d0",
        block: "478604139",
        result: "Policy 3 · one market · 0.50 per order · 1.00 total tUSDC",
      },
      {
        label: "Up verification order",
        hash: "0xd378baf264a9456823e9915c640a60fbae92cb3a8d468cf3d58c23c3199f27ad",
        block: "478604228",
        result: "Paid 0.498646 tUSDC · received 0.881 Up shares",
      },
      {
        label: "Down verification order",
        hash: "0x93731bcd24a11f98e2c2d0a2c100c347a3d3a0959ec6245ca7d9429a42884023",
        block: "478604315",
        result: "Paid 0.498750 tUSDC · received 1.25 Down shares",
      },
      {
        label: "Paired-test revocation",
        hash: "0x073903e5dac16500b8b8add1e11c44806d65185070ff85b4ad391a558fbc8e26",
        block: "478604370",
        result: "New trading authority revoked before settlement",
      },
      {
        label: "Positive owner-triggered claim",
        hash: "0x779b8ec0ad3476fc60be8943fe07ec2ca51fd1af2fceaf416bc4cc33450a8fc8",
        block: "478611494",
        result:
          "0.881 tUSDC actually transferred into the account after revocation",
      },
      {
        label: "Post-redemption withdrawal",
        hash: "0xfb714d14e2c70bbb032e837bc08ce86412361312c5f6c7efd17a8efa4bd999e8",
        block: "478611531",
        result:
          "1.883604 tUSDC transferred to Owner · account collateral and allowance zero",
      },
    ],
  },
];

export const recordedRefusals = [
  { label: "Above per-order limit", result: "PerOrderExceeded" },
  { label: "Unapproved market", result: "UnknownMarket" },
  { label: "After confirmed revocation", result: "InactivePolicy" },
] as const;
