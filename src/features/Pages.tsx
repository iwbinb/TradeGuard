import { useState } from "react";
import {
  ArrowRight,
  FileCheck2,
  Plus,
  Shield,
  ShieldCheck,
  FlaskConical,
  ExternalLink,
} from "lucide-react";
import type { Activity, Strategy } from "../../shared/types";
import { policyState } from "../../shared/policy";
import type { Workspace } from "../lib/useWorkspace";
import { ActivityTable } from "../components/ActivityTable";
import { Button, CopyValue, Empty, Money, Status } from "../components/ui";

export function Permissions({
  ws,
  create,
  revoke,
  funds,
}: {
  ws: Workspace;
  create: () => void;
  revoke: () => void;
  funds: () => void;
}) {
  const p = ws.snapshot.policy;
  const state = policyState(p, ws.snapshot.now);
  const [strategy, setStrategy] = useState<Strategy>(
    ws.snapshot.runner.strategy,
  );
  if (!p)
    return (
      <section className="panel">
        <Empty
          title="Give your agent a clear boundary"
          action={
            <Button
              variant="primary"
              onClick={create}
              disabled={ws.mode === "live" && !ws.snapshot.account}
            >
              <Plus size={18} />
              Create policy
            </Button>
          }
        >
          Choose markets, a spending budget and an expiry. Nothing trades until
          you authorize it.
        </Empty>
        {ws.mode === "live" && !ws.snapshot.account ? (
          <p className="inline-note">
            Create a testnet account from Overview first. A deployed factory
            must be configured.
          </p>
        ) : null}
      </section>
    );
  return (
    <div className="page-stack">
      <section className="panel permission-detail">
        <div className="section-heading">
          <div>
            <div className="eyeline">
              <span />
              Policy {String(p.version).padStart(2, "0")}
            </div>
            <h2>Trading permission</h2>
          </div>
          <Status status={state === "active" ? "filled" : "confirmed"}>
            {state}
          </Status>
        </div>
        <div className="permission-amounts">
          <div>
            <small>Total spending budget</small>
            <Money value={p.budget} large />
          </div>
          <div>
            <small>Per order</small>
            <Money value={p.perOrder} />
          </div>
          <div>
            <small>Already spent</small>
            <Money value={p.spent} />
          </div>
        </div>
        <dl className="review-facts">
          <div>
            <dt>Maximum outcome price</dt>
            <dd>{p.maxPriceBps / 100}%</dd>
          </div>
          <div>
            <dt>Expiry</dt>
            <dd>{new Date(p.validUntil * 1000).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Allowed operation</dt>
            <dd>IOC buys only</dd>
          </div>
          <div>
            <dt>Budget reuse</dt>
            <dd>Profits do not refill the allowance</dd>
          </div>
        </dl>
        <CopyValue value={p.executor} label="Executor" />
        {p.marketIds.map((id) => (
          <CopyValue key={id} value={id} label="Authorized market ID" />
        ))}
        <div className="permission-boundary">
          <ShieldCheck size={24} />
          <p>
            The agent cannot change this permission, withdraw your funds, or
            authorize another operator. Trading can still lose the authorized
            amount.
          </p>
        </div>
        <div className="action-row">
          <Button variant="primary" onClick={create}>
            Review & update
          </Button>
          <Button onClick={funds}>Positions & funds</Button>
          <Button
            variant="text"
            className="danger-text"
            onClick={revoke}
            disabled={p.revoked}
          >
            Revoke trading permission
          </Button>
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Agent controls</h2>
            <p>Starting a strategy does not change its on-chain authority.</p>
          </div>
        </div>
        <div className="action-row">
          <label className="compact-field">
            Strategy
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as Strategy)}
            >
              <option value="reference">Reference strategy</option>
              <option value="model">Model-driven agent</option>
            </select>
          </label>
          {ws.snapshot.runner.running ? (
            <Button
              busy={!!ws.busy}
              onClick={() => {
                void ws.pause();
              }}
            >
              Pause agent
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={
                state !== "active" || (ws.mode === "live" && !ws.authenticated)
              }
              busy={!!ws.busy}
              onClick={() => {
                void ws.start(strategy);
              }}
            >
              Start agent
            </Button>
          )}
        </div>
        <p className="muted">
          {ws.mode === "simulation"
            ? "Both choices are simulated here; no model API is called."
            : !ws.authenticated
              ? "Sign in with the owner wallet to use private Agent controls."
              : "The live executor needs its own STT for gas. It does not receive the owner key."}
        </p>
        {ws.mode === "live" ? (
          <div className="automation-limits">
            <p className="caption">
              Each permission: at most 20 model requests, 0.05 STT reserved for
              automation gas, and 24 hours of monitoring. A pause stops new
              trades but keeps settlement recovery active. These are service
              limits, not contract permissions.
            </p>
            {ws.snapshot.runner.monitoring ? (
              <Button
                variant="text"
                busy={!!ws.busy}
                onClick={() => {
                  void ws.stopAutomation();
                }}
              >
                Stop all automation
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="panel">
        <h2>Permission history</h2>
        {ws.snapshot.history.length ? (
          ws.snapshot.history.map((old) => (
            <div className="history-row" key={old.version}>
              <span>Policy {old.version}</span>
              <Money value={old.budget} />
              <span>Replaced</span>
            </div>
          ))
        ) : (
          <p className="muted">
            No previous versions recorded in this workspace. Live history is not
            inferred from missing records.
          </p>
        )}
      </section>
    </div>
  );
}

export function ActivityPage({
  ws,
  select,
}: {
  ws: Workspace;
  select: (row: Activity) => void;
}) {
  const [filter, setFilter] = useState("all");
  const rows = ws.snapshot.activities.filter(
    (row) =>
      filter === "all" ||
      (filter === "blocked"
        ? ["pre-check", "reverted"].includes(row.status)
        : filter === "pending"
          ? ["pending", "unknown"].includes(row.status)
          : ["filled", "confirmed", "partial", "no-fill"].includes(row.status)),
  );
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Execution history</h2>
        <label className="filter-label">
          Show
          <select
            aria-label="Filter activity"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All activity</option>
            <option value="confirmed">Confirmed</option>
            <option value="blocked">Blocked & reverted</option>
            <option value="pending">Pending & unknown</option>
          </select>
        </label>
      </div>
      <ActivityTable rows={rows} select={select} />
      <p className="caption">
        {ws.mode === "simulation"
          ? "All records on this page are simulated. No transactions were broadcast."
          : "Service-recorded activity only. This is not a complete blockchain address history."}
      </p>
    </section>
  );
}

export function ProofCenter({
  ws,
  select,
}: {
  ws: Workspace;
  select: (row: Activity) => void;
}) {
  const evidence = ws.snapshot.activities.filter(
    (a) => a.source === "onchain" && a.txHash && a.status !== "pending",
  );
  return (
    <div className="page-stack">
      <section className="panel proof-intro">
        <div className="proof-title">
          <FileCheck2 size={32} />
          <div>
            <h2>Evidence you can inspect</h2>
            <p>
              A policy, a transaction, and an independently checkable result.
            </p>
          </div>
        </div>
        <div className="proof-columns">
          <div>
            <h3>Live testnet</h3>
            <p>
              Actual transactions and receipts. Success is not proof of profit
              or a security audit.
            </p>
          </div>
          <div>
            <h3>Recorded replay</h3>
            <p>
              Historical evidence keeps its original date and reference. It is
              never labeled live.
            </p>
          </div>
          <div>
            <h3>Simulation</h3>
            <p>
              Controlled learning scenarios. They do not create on-chain
              evidence.
            </p>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>Live transaction evidence</h2>
          <span className="muted">{evidence.length} records</span>
        </div>
        <ActivityTable rows={evidence} select={select} />
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>
              <FlaskConical size={22} />
              Controlled scenarios
            </h2>
            <p>Explore permission rules with isolated sample data.</p>
          </div>
          <span className="simulation-label">Simulation only</span>
        </div>
        {ws.mode !== "simulation" ? (
          <Empty
            title="Keep experiments separate"
            action={
              <Button onClick={() => ws.selectMode("simulation")}>
                Switch to Simulation
              </Button>
            }
          >
            These controls cannot modify your live account.
          </Empty>
        ) : (
          <>
            <div className="scenario-grid">
              <div>
                <h3>Within the limit</h3>
                <p>
                  Request a 1.00 tUSDC buy. Allowance decreases only if
                  accepted.
                </p>
                <Button
                  onClick={() => {
                    void ws.simulateOrder(1000000n);
                  }}
                >
                  Test valid request
                </Button>
              </div>
              <div>
                <h3>Above the limit</h3>
                <p>
                  Request 8.00 tUSDC against the default 5.00 per-order limit.
                </p>
                <Button
                  onClick={() => {
                    void ws.simulateOrder(8000000n);
                  }}
                >
                  Test oversized request
                </Button>
              </div>
              <div>
                <h3>Expired authority</h3>
                <p>Advance the simulation clock past the permission expiry.</p>
                <Button onClick={ws.advance}>Expire permission</Button>
              </div>
            </div>
            <div className="simulation-actions">
              <span>Controlled settlement:</span>
              <Button onClick={() => ws.settle("up")}>Resolve Up</Button>
              <Button onClick={() => ws.settle("down")}>Resolve Down</Button>
              <Button onClick={() => ws.settle("void")}>Void market</Button>
              <Button
                onClick={() => {
                  void ws.claim();
                }}
              >
                Redeem positions
              </Button>
            </div>
            <p className="muted">
              Illustrative outcomes, not real oracle decisions. Reset from the
              account menu to repeat the original scenario.
            </p>
          </>
        )}
      </section>
      <section className="panel">
        <h2>Verification boundaries</h2>
        <p>
          Application checks, read-only contract simulations, and actual
          reverted transactions are different evidence categories. TradeGuard
          never invents transaction hashes.
        </p>
        <a className="text-link" href="#/docs">
          Read the recovery and verification guide <ArrowRight size={16} />
        </a>
      </section>
    </div>
  );
}

export function Documentation() {
  return (
    <article className="panel documentation">
      <h2>Your account. Explicit authority.</h2>
      <p>
        TradeGuard is a testnet application for bounded AI trading on DreamDEX
        Event Contracts. The owner controls permissions and withdrawals. An
        executor can only request trades within the account contract's rules.
      </p>
      <h3>Before you start</h3>
      <p>
        Use a dedicated Somnia Shannon testnet wallet. Chain ID: 50312. Gas
        token: STT. Do not deposit mainnet funds or give your owner private key
        to an agent.
      </p>
      <h3>What the budget means</h3>
      <p>
        The budget limits cumulative trade spending, including applicable trade
        fees. It is not a loss guarantee. Gas is separate. Deposits, profits and
        redemptions do not refill the current permission.
      </p>
      <h3>Pause, revoke, withdraw</h3>
      <ul>
        <li>
          Pause stops this service from proposing trades; on-chain permission
          may remain active.
        </li>
        <li>
          Revoke changes trading authority after the transaction confirms.
          Previously confirmed trades remain.
        </li>
        <li>
          Withdraw returns available collateral to the owner. Existing positions
          may need to settle first.
        </li>
      </ul>
      <h3>Recover without the service</h3>
      <ol>
        <li>
          Verify the account's owner, module and collateral against the
          configured deployment.
        </li>
        <li>Call revoke from the owner wallet if needed.</li>
        <li>
          After settlement, call claim with the original market ID. Proceeds
          return to the account, not the caller.
        </li>
        <li>
          Call withdraw from the owner wallet. recoverPoolCredit handles pool
          fallback balances.
        </li>
        <li>
          The owner can use recoverPosition to transfer held outcome tokens to
          the owner for independent recovery.
        </li>
      </ol>
      <p>
        Verify network, address and ABI before signing. Recovery does not remove
        contract, oracle, stablecoin or protocol-upgrade risk.
      </p>
      <h3>Data and evidence</h3>
      <p>
        Simulation never submits a transaction. Live mode reports unavailable
        data honestly. The activity list is service-recorded history, not a
        complete address index.
      </p>
      <div className="resource-links">
        <a
          href="https://app.dreamdex.io/docs/developers/event-contracts"
          target="_blank"
          rel="noreferrer"
        >
          DreamDEX documentation <ExternalLink size={16} />
        </a>
        <a
          href="https://shannon-explorer.somnia.network"
          target="_blank"
          rel="noreferrer"
        >
          Somnia Shannon explorer <ExternalLink size={16} />
        </a>
      </div>
      <p className="inline-note">
        Not audited production software, financial advice, or a promise of
        profit. Mainnet execution is not enabled.
      </p>
    </article>
  );
}

export function Landing() {
  return (
    <article className="landing-content">
      <div className="landing-hero">
        <Shield size={50} />
        <h2>
          Let AI trade.
          <br />
          Keep control.
        </h2>
        <p>
          Choose the markets, set a spending budget, and give your agent a clear
          boundary. Every permission stays yours to revoke.
        </p>
        <div className="action-row">
          <a className="button button-primary" href="#/overview">
            Open app <ArrowRight size={17} />
          </a>
          <a className="button button-secondary" href="#/proof">
            Explore the proof
          </a>
        </div>
        <small>Built for Somnia Shannon testnet. No mainnet funds.</small>
      </div>
      <div className="landing-steps">
        {[
          [
            "01",
            "Set your limits",
            "Authorize an executor, market set, budget and expiry.",
          ],
          [
            "02",
            "Let the agent run",
            "The account checks each request before trading.",
          ],
          [
            "03",
            "Stay in control",
            "Inspect results, revoke authority, and recover funds.",
          ],
        ].map(([n, title, body]) => (
          <section key={n}>
            <span>{n}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </section>
        ))}
      </div>
      <p className="inline-note">
        TradeGuard constrains authority, not market outcomes. Trading can still
        lose the authorized amount.
      </p>
    </article>
  );
}
