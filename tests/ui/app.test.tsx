import { render, screen, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../../src/App";
function go(route: string) {
  act(() => {
    window.location.hash = "#/" + route;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}
describe("working product flows", () => {
  it("keeps the page usable after an excessive withdrawal", async () => {
    render(<App />);
    await userEvent.click(
      screen.getByRole("button", { name: "View positions & funds" }),
    );
    await userEvent.clear(screen.getByLabelText("Amount · tUSDC"));
    await userEvent.type(screen.getByLabelText("Amount · tUSDC"), "500");
    await userEvent.click(
      screen.getByRole("button", { name: "Withdraw available" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Choose an amount within your available balance.",
    );
    expect(
      screen.queryByRole("heading", { name: "Workspace needs a reload" }),
    ).not.toBeInTheDocument();
  });
  it("renders the design amounts and pause action", async () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Allowance remaining" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "16",
    );
    await userEvent.click(screen.getByRole("button", { name: "Pause agent" }));
    expect(
      await screen.findByRole("button", { name: "Start agent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/On-chain permission would still be active/),
    ).toBeInTheDocument();
  });
  it("confirms revocation and preserves recovery", async () => {
    render(<App />);
    go("permissions");
    await userEvent.click(
      screen.getByRole("button", { name: "Revoke trading permission" }),
    );
    const modal = screen.getByRole("dialog", {
      name: "Revoke trading permission?",
    });
    await userEvent.click(
      within(modal).getByRole("button", { name: "Revoke permission" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("revoked")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Positions & funds" }),
    ).toBeEnabled();
  });
  it("filters activity and labels non-chain evidence", async () => {
    render(<App />);
    go("activity");
    await userEvent.selectOptions(
      screen.getByLabelText("Filter activity"),
      "blocked",
    );
    expect(
      screen.queryByRole("button", { name: /17:03 BTC/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /17:04 Order blocked/ }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Simulation — not a transaction",
    );
    expect(
      screen.queryByRole("link", { name: /View transaction/ }),
    ).not.toBeInTheDocument();
  });
  it("requires all four steps before permission confirmation", async () => {
    render(<App />);
    go("permissions");
    await userEvent.click(
      screen.getByRole("button", { name: "Review & update" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }));
    const confirm = screen.getByRole("button", {
      name: "Create simulation policy",
    });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Policy 02")).toBeInTheDocument();
  });
  it("does not consume allowance on a rejected request", async () => {
    render(<App />);
    go("proof");
    await userEvent.click(
      screen.getByRole("button", { name: "Test oversized request" }),
    );
    go("overview");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "16",
    );
  });
  it("recovers malformed saved sample data", () => {
    localStorage.setItem("tradeguard-simulation-v1", "{invalid");
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Allowance remaining" }),
    ).toBeInTheDocument();
  });
});
