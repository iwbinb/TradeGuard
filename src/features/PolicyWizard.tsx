import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from "lucide-react";
import { amount, decimalInput, parseAmount } from "../../shared/money";
import { validatePolicy } from "../../shared/policy";
import { DEMO_EXECUTOR } from "../../shared/simulation";
import type { PolicyInput } from "../../shared/types";
import type { Workspace } from "../lib/useWorkspace";
import { Button, CopyValue } from "../components/ui";
const toInputDate = (seconds: number) => {
  const date = new Date(seconds * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function PolicyWizard({
  ws,
  done,
}: {
  ws: Workspace;
  done: () => void;
}) {
  const p = ws.snapshot.policy;
  const now = ws.snapshot.now;
  const [step, setStep] = useState(0);
  const [executor, setExecutor] = useState(
    p?.executor ??
      ws.executor ??
      (ws.mode === "simulation" ? DEMO_EXECUTOR : ""),
  );
  const [ids, setIds] = useState<string[]>(() =>
    (p?.marketIds ?? []).filter((id) =>
      ws.markets.some((m) => m.id === id && m.status === 1 && m.expiry > now),
    ),
  );
  const [perOrder, setPerOrder] = useState(p ? decimalInput(p.perOrder) : "5");
  const [budget, setBudget] = useState(p ? decimalInput(p.budget) : "20");
  const [price, setPrice] = useState(
    p ? (p.maxPriceBps / 100).toString() : "95",
  );
  const [until, setUntil] = useState(
    toInputDate(Math.max(p?.validUntil ?? 0, now + 3600)),
  );
  const [error, setError] = useState("");
  const [agree, setAgree] = useState(false);
  function input(): PolicyInput {
    return {
      executor,
      marketIds: ids,
      perOrder: parseAmount(perOrder).toString(),
      budget: parseAmount(budget).toString(),
      maxPriceBps: Number(parseAmount(price, 2)),
      validAfter: now,
      validUntil: Math.floor(new Date(until).getTime() / 1000),
    };
  }
  function next() {
    setError("");
    try {
      if (
        step === 0 &&
        (!/^0x[0-9a-fA-F]{40}$/.test(executor) ||
          /^0x0{40}$/.test(executor) ||
          !ids.length)
      )
        throw new Error(
          "Select at least one market and a non-zero executor address.",
        );
      if (step >= 1) {
        const problems = validatePolicy(input(), now);
        if (problems.length) throw new Error(problems[0]);
      }
      setStep((s) => Math.min(3, s + 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check these fields.");
    }
  }
  let current: PolicyInput | null = null;
  try {
    current = input();
  } catch {
    /* Invalid fields stay visible for correction. */
  }
  return (
    <div className="wizard">
      <ol className="stepper">
        {["Scope", "Limits", "Duration", "Review"].map((label, i) => (
          <li
            key={label}
            className={i === step ? "current" : i < step ? "complete" : ""}
          >
            <span>{i < step ? <Check size={14} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {step === 0 ? (
        <div className="form-section">
          <h3>Choose the scope</h3>
          <p>
            Your permission applies only to these specific markets. It does not
            roll into future windows.
          </p>
          <label>
            Executor address
            <input
              value={executor}
              onChange={(e) => setExecutor(e.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <fieldset>
            <legend>Allowed markets</legend>
            {ws.markets.length ? (
              ws.markets.map((m) => (
                <label className="market-choice" key={m.id}>
                  <input
                    type="checkbox"
                    checked={ids.includes(m.id)}
                    disabled={m.status !== 1 || m.expiry <= now}
                    onChange={(e) =>
                      setIds(
                        e.target.checked
                          ? [...ids, m.id]
                          : ids.filter((id) => id !== m.id),
                      )
                    }
                  />
                  <span>
                    <strong>{m.label}</strong>
                    <small>
                      Market ends{" "}
                      {new Date(m.expiry * 1000).toLocaleTimeString()} ·{" "}
                      {m.status === 1 ? "Trading" : "Closed"}
                    </small>
                    <code>
                      {m.id.slice(0, 12)}…{m.id.slice(-6)}
                    </code>
                  </span>
                </label>
              ))
            ) : (
              <p className="inline-note">
                No verified markets are available. Refresh live data before
                creating a permission.
              </p>
            )}
          </fieldset>
        </div>
      ) : null}
      {step === 1 ? (
        <div className="form-section">
          <h3>Set spending limits</h3>
          <p>
            The agent cannot increase these limits. Profits do not automatically
            become new allowance.
          </p>
          <div className="form-grid">
            <label>
              Per-order limit · tUSDC
              <input
                inputMode="decimal"
                value={perOrder}
                onChange={(e) => setPerOrder(e.target.value)}
              />
            </label>
            <label>
              Total spending budget · tUSDC
              <input
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </label>
          </div>
          <label>
            Maximum price per outcome · %
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <div className="inline-note">
            This limits trade spending, not net losses. Network gas is accounted
            for separately.
          </div>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="form-section">
          <h3>Choose an expiry</h3>
          <p>
            Trading stops when the permission expires. Existing positions remain
            available for settlement.
          </p>
          <label>
            Expires at · your local time
            <input
              type="datetime-local"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
          <p className="inline-note">
            Time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. A
            market may close before this permission expires.
          </p>
        </div>
      ) : null}
      {step === 3 && current ? (
        <div className="form-section">
          <div className="review-title">
            <ShieldCheck size={28} />
            <div>
              <h3>Review your authority</h3>
              <p>
                {ws.mode === "simulation"
                  ? "Simulation only. No wallet signature or transaction."
                  : "Read every field before confirming in your wallet."}
              </p>
            </div>
          </div>
          <dl className="review-facts">
            <div>
              <dt>Network</dt>
              <dd>Somnia Shannon · 50312</dd>
            </div>
            <div>
              <dt>Per order</dt>
              <dd>{amount(current.perOrder)} tUSDC</dd>
            </div>
            <div>
              <dt>Total budget</dt>
              <dd>{amount(current.budget)} tUSDC</dd>
            </div>
            <div>
              <dt>Maximum outcome price</dt>
              <dd>{current.maxPriceBps / 100}%</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{new Date(current.validUntil * 1000).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Allowed markets</dt>
              <dd>{current.marketIds.length}</dd>
            </div>
          </dl>
          <CopyValue value={current.executor} label="Executor" />
          <p className="inline-note">
            May buy approved Event Contracts within limits. Cannot withdraw,
            change permissions, grant operators, or call arbitrary contracts.{" "}
            {p
              ? "This replaces the previous trading permission; existing positions are preserved."
              : ""}
          </p>
          <label className="check-line">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            I reviewed these permissions and understand that trading can lose
            the authorized amount.
          </label>
        </div>
      ) : null}
      <div className="wizard-actions">
        <Button onClick={() => (step === 0 ? done() : setStep((s) => s - 1))}>
          <ArrowLeft size={16} />
          {step ? "Back" : "Cancel"}
        </Button>
        {step < 3 ? (
          <Button variant="primary" onClick={next}>
            Continue
            <ArrowRight size={16} />
          </Button>
        ) : (
          <Button
            variant="primary"
            busy={!!ws.busy}
            disabled={!agree || !current}
            onClick={() => {
              if (current)
                void ws.savePolicy(current).then((ok) => {
                  if (ok) done();
                });
            }}
          >
            {ws.mode === "simulation"
              ? "Create simulation policy"
              : "Confirm in wallet"}
          </Button>
        )}
      </div>
    </div>
  );
}
