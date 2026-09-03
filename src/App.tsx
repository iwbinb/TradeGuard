import { useCallback, useEffect, useState } from "react";
import {
  FlaskConical,
  WalletCards,
  Network,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";
import { useWorkspace } from "./lib/useWorkspace";
import { amount, parseAmount } from "../shared/money";
import type { Activity } from "../shared/types";
import { Shell, type Page } from "./components/Shell";
import { Button, CopyValue, Modal, Money, Status } from "./components/ui";
import { Overview } from "./features/Overview";
import { PolicyWizard } from "./features/PolicyWizard";
import {
  Permissions,
  ActivityPage,
  ProofCenter,
  Documentation,
  Landing,
} from "./features/Pages";

type Dialog =
  "account" | "mode" | "network" | "policy" | "revoke" | "funds" | null;
function currentPage(): Page {
  const name = location.hash.replace("#/", "");
  return [
    "overview",
    "permissions",
    "activity",
    "proof",
    "docs",
    "home",
  ].includes(name)
    ? (name as Page)
    : "overview";
}
function setting(name: string, fallback: string) {
  try {
    return localStorage.getItem(name) ?? fallback;
  } catch {
    return fallback;
  }
}
export default function App() {
  const ws = useWorkspace();
  const [page, setPage] = useState(currentPage);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [fundAmount, setFundAmount] = useState("5");
  const [localError, setLocalError] = useState("");
  const [theme, setTheme] = useState(() =>
    setting("tradeguard-theme", "light"),
  );
  const [solid, setSolid] = useState(
    () => setting("tradeguard-solid", "false") === "true",
  );
  const close = useCallback(() => {
    setDialog(null);
    setSelected(null);
    setLocalError("");
  }, []);
  useEffect(() => {
    const fn = () => {
      if (location.hash === "#main-content") return;
      setPage(currentPage());
      close();
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, [close]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("tradeguard-theme", theme);
    } catch {
      /* Optional preference storage. */
    }
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.solid = String(solid);
    try {
      localStorage.setItem("tradeguard-solid", String(solid));
    } catch {
      /* Optional preference storage. */
    }
  }, [solid]);
  useEffect(() => {
    close();
  }, [ws.mode, ws.owner, close]);
  const open = (name: Dialog) => {
    setLocalError("");
    setDialog(name);
  };
  function changeMoney(type: "withdraw" | "deposit" | "approve") {
    setLocalError("");
    try {
      const value = parseAmount(fundAmount);
      if (value <= 0n) throw new Error("Enter an amount greater than zero.");
      if (type === "withdraw") void ws.withdraw(value);
      else if (type === "approve") void ws.approveDeposit(value);
      else void ws.deposit(value);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Check the amount.",
      );
    }
  }
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Shell
        page={page}
        ws={ws}
        openAccount={() => open("account")}
        openMode={() => open("mode")}
        openNetwork={() => open("network")}
      >
        {page === "overview" ? (
          <Overview ws={ws} select={setSelected} funds={() => open("funds")} />
        ) : null}
        {page === "permissions" ? (
          <Permissions
            ws={ws}
            create={() => open("policy")}
            revoke={() => open("revoke")}
            funds={() => open("funds")}
          />
        ) : null}
        {page === "activity" ? (
          <ActivityPage ws={ws} select={setSelected} />
        ) : null}
        {page === "proof" ? <ProofCenter ws={ws} select={setSelected} /> : null}
        {page === "docs" ? <Documentation /> : null}
        {page === "home" ? <Landing /> : null}
      </Shell>
      {dialog === "mode" ? (
        <Modal title="Choose your workspace" close={close}>
          <p className="muted">
            Simulation and live accounts are separate. Switching modes does not
            authorize a transaction.
          </p>
          <button
            className={`mode-choice ${ws.mode === "simulation" ? "chosen" : ""}`}
            onClick={() => {
              ws.selectMode("simulation");
              close();
            }}
          >
            <FlaskConical />
            <span>
              <strong>Simulation</strong>
              <small>Isolated sample data. No real funds or model calls.</small>
            </span>
          </button>
          <button
            className={`mode-choice ${ws.mode === "live" ? "chosen" : ""}`}
            onClick={() => {
              ws.selectMode("live");
              close();
            }}
          >
            <Network />
            <span>
              <strong>Live testnet</strong>
              <small>
                Actual Somnia Shannon data. Wallet approval is required for
                transactions.
              </small>
            </span>
          </button>
        </Modal>
      ) : null}
      {dialog === "network" ? (
        <Modal title="Somnia Shannon" close={close}>
          <p>
            This application supports testnet only. This panel does not switch
            to mainnet.
          </p>
          <dl className="review-facts">
            <div>
              <dt>Chain ID</dt>
              <dd>50312</dd>
            </div>
            <div>
              <dt>Gas token</dt>
              <dd>STT</dd>
            </div>
            <div>
              <dt>Trading collateral</dt>
              <dd>Test tUSDC</dd>
            </div>
          </dl>
          <a
            className="text-link"
            href="https://shannon-explorer.somnia.network"
            target="_blank"
            rel="noreferrer"
          >
            Open testnet explorer <ExternalLink size={16} />
          </a>
          {ws.owner ? (
            <Button
              onClick={() => {
                void import("./lib/wallet")
                  .then((wallet) => wallet.switchNetwork())
                  .catch((e) =>
                    setLocalError(
                      e instanceof Error
                        ? e.message
                        : "Network switch declined.",
                    ),
                  );
              }}
            >
              Switch wallet to Shannon
            </Button>
          ) : null}
          {localError ? (
            <p className="field-error" role="alert">
              {localError}
            </p>
          ) : null}
        </Modal>
      ) : null}
      {dialog === "account" ? (
        <Modal
          title={
            ws.mode === "simulation" ? "Demo account" : "Your wallet & account"
          }
          close={close}
        >
          {ws.mode === "simulation" ? (
            <>
              <div className="inline-note">
                Simulated data only. This workspace never receives your private
                key or sends transactions.
              </div>
              <Button
                variant="primary"
                busy={!!ws.busy}
                onClick={() => {
                  void ws.connect();
                }}
              >
                <WalletCards size={18} />
                Connect a testnet wallet
              </Button>
              <Button
                onClick={() => {
                  ws.reset();
                  close();
                }}
              >
                Reset simulation
              </Button>
            </>
          ) : (
            <>
              {ws.owner ? (
                <>
                  <CopyValue value={ws.owner} label="Owner wallet" />
                  {ws.snapshot.account ? (
                    <CopyValue
                      value={ws.snapshot.account}
                      label="TradeGuard account"
                    />
                  ) : null}
                  {ws.executor ? (
                    <CopyValue
                      value={ws.executor}
                      label="Restricted executor"
                    />
                  ) : null}
                  <Button
                    variant="primary"
                    busy={!!ws.busy}
                    onClick={() => {
                      void ws.signIn();
                    }}
                  >
                    {ws.authenticated
                      ? "Renew owner session"
                      : "Sign in for agent controls"}
                  </Button>
                  <p className="caption">
                    Sign-in is a message signature, not a spending permission.
                  </p>
                  <Button
                    busy={!!ws.busy}
                    onClick={() => {
                      void ws.faucet();
                    }}
                  >
                    Request 20 test tUSDC
                  </Button>
                  <p className="caption">
                    Test collateral is not money. Your wallet needs testnet STT
                    for gas. Deposit requires separate approval and
                    confirmation.
                  </p>
                </>
              ) : (
                <Button
                  variant="primary"
                  busy={!!ws.busy}
                  onClick={() => {
                    void ws.connect();
                  }}
                >
                  Connect wallet
                </Button>
              )}
            </>
          )}
          {ws.error ? (
            <p className="field-error" role="alert">
              {ws.error}
            </p>
          ) : null}
          <div className="settings-section">
            <h3>Display</h3>
            <label>
              Appearance
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={solid}
                onChange={(e) => setSolid(e.target.checked)}
              />
              Reduce transparency
            </label>
          </div>
          <a className="text-link" href="#/home">
            About TradeGuard
          </a>
        </Modal>
      ) : null}
      {dialog === "policy" ? (
        <Modal
          title={
            ws.snapshot.policy
              ? "Update trading permission"
              : "Create trading permission"
          }
          close={close}
          wide
        >
          <PolicyWizard ws={ws} done={close} />
          {ws.error ? (
            <p className="field-error" role="alert">
              {ws.error}
            </p>
          ) : null}
        </Modal>
      ) : null}
      {dialog === "revoke" ? (
        <Modal title="Revoke trading permission?" close={close}>
          <div className="dialog-warning">
            <ShieldAlert size={30} />
            <p>
              After confirmation, this permission cannot open new trades.
              Already confirmed trades and unsettled positions remain.
            </p>
          </div>
          <p>
            {ws.mode === "simulation"
              ? "This only changes the simulation account."
              : "Your owner wallet must confirm the revocation. Until it confirms, permission may still be active."}
          </p>
          <div className="action-row">
            <Button onClick={close} data-initial-focus>
              Keep permission
            </Button>
            <Button
              variant="danger"
              busy={!!ws.busy}
              onClick={() => {
                void ws.revoke().then((ok) => {
                  if (ok) close();
                });
              }}
            >
              Revoke permission
            </Button>
          </div>
          {ws.error ? (
            <p className="field-error" role="alert">
              {ws.error}
            </p>
          ) : null}
        </Modal>
      ) : null}
      {dialog === "funds" ? (
        <Modal title="Positions & available funds" close={close} wide>
          <div className="funds-total">
            <small>Available collateral</small>
            <Money value={ws.snapshot.balance} large />
          </div>
          <p className="muted">
            Unsettled positions are not immediately withdrawable. Payouts do not
            replenish the spending budget.
          </p>
          <div className="position-list">
            {ws.snapshot.positions.length ? (
              ws.snapshot.positions.map((p, i) => (
                <section className="position-row" key={`${p.marketId}-${i}`}>
                  <div>
                    <strong>{p.label}</strong>
                    <small>
                      {p.status} · Up {amount(p.up)} / Down {amount(p.down)}
                    </small>
                  </div>
                  <div>
                    <small>
                      {ws.mode === "live"
                        ? "Gross claimable estimate"
                        : "Claimable"}
                    </small>
                    <Money value={p.claimable} />
                  </div>
                  <Button
                    disabled={BigInt(p.claimable) === 0n}
                    busy={!!ws.busy}
                    onClick={() => {
                      void ws.claim(p.marketId);
                    }}
                  >
                    Redeem
                  </Button>
                  {ws.mode === "live" ? (
                    <details className="position-recovery">
                      <summary>Recover tokens</summary>
                      <p>
                        Transfers outcome tokens to your owner wallet, not cash.
                        Use if protocol redemption is unavailable.
                      </p>
                      <div className="action-row">
                        <Button
                          disabled={BigInt(p.up) === 0n}
                          busy={!!ws.busy}
                          onClick={() => {
                            void ws.recoverPosition(
                              p.marketId,
                              0,
                              BigInt(p.up),
                            );
                          }}
                        >
                          Recover Up
                        </Button>
                        <Button
                          disabled={BigInt(p.down) === 0n}
                          busy={!!ws.busy}
                          onClick={() => {
                            void ws.recoverPosition(
                              p.marketId,
                              1,
                              BigInt(p.down),
                            );
                          }}
                        >
                          Recover Down
                        </Button>
                      </div>
                    </details>
                  ) : null}
                </section>
              ))
            ) : (
              <p>No positions recorded.</p>
            )}
          </div>
          {ws.mode === "live" && ws.snapshot.recoveries?.length ? (
            <section className="recovery-credits">
              <h3>Protocol credits</h3>
              <p>
                These amounts are separate from available collateral. Recover
                them into your account before withdrawing.
              </p>
              {ws.snapshot.recoveries.map((credit) => (
                <div className="action-row" key={credit.marketId}>
                  {BigInt(credit.poolCredit) > 0n ? (
                    <Button
                      busy={!!ws.busy}
                      onClick={() => {
                        void ws.recoverCredit(credit.marketId, "poolCredit");
                      }}
                    >
                      Recover pool credit · {amount(credit.poolCredit)} tUSDC
                    </Button>
                  ) : null}
                  {BigInt(credit.settlementCredit) > 0n ? (
                    <Button
                      busy={!!ws.busy}
                      onClick={() => {
                        void ws.recoverCredit(
                          credit.marketId,
                          "settlementCredit",
                        );
                      }}
                    >
                      Recover settlement credit ·{" "}
                      {amount(credit.settlementCredit)} tUSDC
                    </Button>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}
          <label>
            Amount · tUSDC
            <input
              value={fundAmount}
              inputMode="decimal"
              onChange={(e) => setFundAmount(e.target.value)}
            />
          </label>
          <div className="action-row">
            <Button
              variant="primary"
              disabled={
                BigInt(ws.snapshot.balance) === 0n ||
                (ws.mode === "live" && !ws.snapshot.account)
              }
              busy={!!ws.busy}
              onClick={() => changeMoney("withdraw")}
            >
              Withdraw available
            </Button>
            {ws.mode === "live" ? (
              <>
                <Button
                  disabled={!ws.snapshot.account}
                  busy={!!ws.busy}
                  onClick={() => changeMoney("approve")}
                >
                  1. Approve deposit
                </Button>
                <Button
                  disabled={!ws.snapshot.account}
                  busy={!!ws.busy}
                  onClick={() => changeMoney("deposit")}
                >
                  2. Deposit
                </Button>
              </>
            ) : null}
          </div>
          {localError || ws.error ? (
            <p className="field-error" role="alert">
              {localError || ws.error}
            </p>
          ) : null}
          {ws.notice ? <p role="status">{ws.notice}</p> : null}
          <a className="text-link" href="#/docs">
            Independent recovery guide
          </a>
        </Modal>
      ) : null}
      {selected ? (
        <Modal title={selected.action} close={close}>
          <div className="detail-summary">
            <Money value={selected.amount} large />
            <Status status={selected.status} />
          </div>
          <p>{selected.detail}</p>
          <dl className="review-facts">
            <div>
              <dt>Evidence source</dt>
              <dd>
                {selected.source === "simulation"
                  ? "Simulation — not a transaction"
                  : selected.source === "precheck"
                    ? "Application pre-check"
                    : "On-chain transaction"}
              </dd>
            </div>
            <div>
              <dt>Recorded time</dt>
              <dd>{new Date(selected.at * 1000).toLocaleString()}</dd>
            </div>
            {selected.paid ? (
              <div>
                <dt>Actual payment</dt>
                <dd>{amount(selected.paid)} tUSDC</dd>
              </div>
            ) : null}
            {selected.filled ? (
              <div>
                <dt>Filled quantity</dt>
                <dd>{amount(selected.filled)} contracts</dd>
              </div>
            ) : null}
          </dl>
          {selected.marketId ? (
            <CopyValue value={selected.marketId} label="Market ID" />
          ) : null}
          {selected.txHash ? (
            <a
              className="button button-secondary"
              href={`https://shannon-explorer.somnia.network/tx/${selected.txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction <ExternalLink size={16} />
            </a>
          ) : (
            <p className="inline-note">
              No blockchain transaction reference exists for this record. It is
              not on-chain execution evidence.
            </p>
          )}
        </Modal>
      ) : null}
    </>
  );
}
