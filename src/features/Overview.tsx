import { ChevronRight, Info, Pause, Play, RefreshCw } from "lucide-react";
import type { Activity } from "../../shared/types";
import { amount, spentPercent } from "../../shared/money";
import { policyState } from "../../shared/policy";
import type { Workspace } from "../lib/useWorkspace";
import { Button, Empty, Money, Status } from "../components/ui";
import { ActivityTable } from "../components/ActivityTable";
import { LiveMarkets } from "./LiveMarkets";
export function Overview({
  ws,
  select,
  funds,
}: {
  ws: Workspace;
  select: (item: Activity) => void;
  funds: () => void;
}) {
  const s = ws.snapshot;
  const p = s.policy;
  const state = policyState(p, s.now);
  const remaining = p ? (BigInt(p.budget) - BigInt(p.spent)).toString() : "0";
  const claimable = s.positions
    .reduce((n, v) => n + BigInt(v.claimable), 0n)
    .toString();
  return (
    <>
      <div className="overview-grid">
        <section
          className="panel allowance-panel"
          aria-label="Trading allowance"
        >
          {p ? (
            <>
              <div
                className={`eyeline ${state !== "active" ? "eyeline-muted" : ""}`}
              >
                <span />
                {state === "active"
                  ? "Active policy"
                  : `${state[0].toUpperCase()}${state.slice(1)} policy`}
              </div>
              <h2 className="allowance-label">Allowance remaining</h2>
              <Money value={remaining} large />
              <p className="spent-line">
                {amount(p.spent)} spent of {amount(p.budget)} authorized
              </p>
              <div
                className="budget-progress"
                role="progressbar"
                aria-label="Spending budget used"
                aria-valuenow={spentPercent(p.spent, p.budget)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${spentPercent(p.spent, p.budget)}%` }}>
                  {spentPercent(p.spent, p.budget) >= 10
                    ? `${Math.round(spentPercent(p.spent, p.budget))}%`
                    : null}
                </span>
              </div>
              <dl className="policy-facts">
                <div>
                  <dt>Per order</dt>
                  <dd>
                    <Money value={p.perOrder} />
                  </dd>
                </div>
                <div>
                  <dt>Market</dt>
                  <dd>
                    {ws.markets.find((m) => m.id === p.marketIds[0])?.label ??
                      `${p.marketIds.length} authorized market${p.marketIds.length === 1 ? "" : "s"}`}
                  </dd>
                </div>
                <div>
                  <dt>Policy expires</dt>
                  <dd>
                    {new Intl.DateTimeFormat("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Shanghai",
                    }).format(p.validUntil * 1000)}{" "}
                    UTC+8
                  </dd>
                </div>
              </dl>
              <a
                className="button button-primary manage-permissions"
                href="#/permissions"
              >
                Manage permissions
              </a>
              <p className="budget-help">
                Spending budget, not a loss guarantee.
              </p>
            </>
          ) : (
            <Empty
              title={
                ws.mode === "live" && !s.account
                  ? "Your account, your authority"
                  : "Set your first permission"
              }
              action={
                ws.mode === "live" && !s.account ? (
                  <Button
                    variant="primary"
                    disabled={!ws.owner || !ws.config?.liveConfigured}
                    busy={!!ws.busy}
                    onClick={() => {
                      void ws.createAccount();
                    }}
                  >
                    Create testnet account
                  </Button>
                ) : (
                  <a className="button button-primary" href="#/permissions">
                    Create policy
                  </a>
                )
              }
            >
              {ws.mode === "live" && !ws.config?.liveConfigured
                ? "The testnet factory is not configured yet. Real data remains separate from Simulation."
                : "Choose exactly where your agent may trade and how much it may spend."}
            </Empty>
          )}
        </section>
        <section className="panel agent-panel" aria-label="Agent and funds">
          <h2 className="section-label">Agent status</h2>
          <div className="agent-heading">
            <Status
              status={
                s.runner.error
                  ? "reverted"
                  : s.runner.running && state === "active"
                    ? "filled"
                    : "confirmed"
              }
            >
              {ws.mode === "live" && !ws.authenticated
                ? "Not verified"
                : s.runner.error
                  ? "Needs attention"
                  : s.runner.running && state === "active"
                    ? "Monitoring"
                    : "Paused"}
            </Status>
          </div>
          <p className="agent-description">{s.runner.message}</p>
          <div className="strategy-label">
            {s.runner.strategy === "model"
              ? "AI strategy"
              : "Reference strategy"}{" "}
            <Info
              size={14}
              aria-label="Strategy suggestions cannot change your permission"
            />
          </div>
          {s.runner.running ? (
            <Button
              className="agent-button"
              busy={!!ws.busy}
              onClick={() => {
                void ws.pause();
              }}
            >
              <Pause size={17} />
              Pause agent
            </Button>
          ) : (
            <Button
              className="agent-button"
              disabled={
                state !== "active" || (ws.mode === "live" && !ws.authenticated)
              }
              busy={!!ws.busy}
              onClick={() => {
                void ws.start(s.runner.strategy);
              }}
            >
              <Play size={17} />
              Start agent
            </Button>
          )}
          <div className="funds-summary">
            <div className="funds-heading">
              <h2 className="section-label">Funds summary</h2>
              <button
                className="funds-open"
                aria-label="View positions & funds"
                title="View positions & funds"
                onClick={funds}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <dl>
              <div>
                <dt>Available balance</dt>
                <dd>
                  {ws.mode === "live" && !s.account ? (
                    "—"
                  ) : (
                    <Money value={s.balance} />
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  {ws.mode === "live" ? "Claimable (gross)" : "Claimable"}
                </dt>
                <dd>
                  {ws.mode === "live" && !s.account ? (
                    "—"
                  ) : (
                    <Money value={claimable} />
                  )}
                </dd>
              </div>
            </dl>
            <p>
              {ws.mode === "live" && !ws.authenticated
                ? "Sign in to check pending execution."
                : s.runner.pendingTx
                  ? "Transaction pending confirmation."
                  : "No pending transaction."}
            </p>
          </div>
        </section>
      </div>
      <section className="panel recent-panel">
        <div className="section-heading">
          <h2>Recent activity</h2>
          <a href="#/activity">
            View all activity <ChevronRight size={18} />
          </a>
        </div>
        <ActivityTable rows={s.activities.slice(0, 3)} select={select} />
      </section>
      {ws.mode === "live" ? (
        <div className="overview-actions">
          <Button
            variant="text"
            busy={ws.loading}
            onClick={() => {
              void ws.refresh();
            }}
          >
            <RefreshCw size={16} />
            Refresh live data
          </Button>
        </div>
      ) : null}
      <LiveMarkets ws={ws} />
    </>
  );
}
