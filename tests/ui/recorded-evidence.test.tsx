import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RecordedEvidence } from "../../src/features/RecordedEvidence";
import { recordedEvidence } from "../../shared/recorded-evidence";

describe("recorded public-chain examples", () => {
  it("does not present a historical losing order as live profit", async () => {
    render(<RecordedEvidence />);
    expect(screen.getByText("Read-only evidence")).toBeInTheDocument();
    expect(
      screen.getByText(/not evidence of profitable prediction/),
    ).toBeInTheDocument();
    expect(screen.getByText("0.499044 tUSDC")).toBeInTheDocument();
    expect(screen.getByText("1.500956 tUSDC")).toBeInTheDocument();
    await userEvent.click(
      screen.getByText("Inspect three permission-boundary checks"),
    );
    expect(
      screen.getByText(/not mined failed transactions/),
    ).toBeInTheDocument();
  });
  it("has only exact explorer references and no wallet transaction controls", () => {
    render(<RecordedEvidence />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(
        /^https:\/\/shannon-explorer\.somnia\.network\/(?:tx\/0x[0-9a-f]{64}|address\/0x[0-9a-fA-F]{40})$/,
      );
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
    expect(
      screen.queryByRole("button", { name: /sign|withdraw|redeem|connect/i }),
    ).not.toBeInTheDocument();
    for (const example of recordedEvidence)
      for (const tx of example.transactions) expect(tx.block).toMatch(/^\d+$/);
  });
});
