import { useState } from "react";
import { ExternalLink, FileCheck2 } from "lucide-react";
import {
  recordedEvidence,
  recordedRefusals,
} from "../../shared/recorded-evidence";

export function RecordedEvidence() {
  const [selected, setSelected] = useState(recordedEvidence[0].id);
  const example =
    recordedEvidence.find((item) => item.id === selected) ??
    recordedEvidence[0];
  return (
    <section
      className="panel recorded-proof"
      id="recorded-example"
      aria-labelledby="recorded-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="recorded-title">
            <FileCheck2 size={22} /> Recorded testnet receipts
          </h2>
          <p>
            Historical evidence, independent of your selected workspace. No
            wallet connection or transaction is required.
          </p>
        </div>
        <span className="recorded-label">Read-only evidence</span>
      </div>
      <div className="recorded-tabs" role="group" aria-label="Recorded example">
        {recordedEvidence.map((item) => (
          <button
            key={item.id}
            className={selected === item.id ? "selected" : ""}
            aria-pressed={selected === item.id}
            onClick={() => setSelected(item.id)}
          >
            {item.id === "ai-order" ? "AI order" : "Positive redemption"}
          </button>
        ))}
      </div>
      <div className="recorded-heading">
        <small>{example.date}</small>
        <p className="caption">
          Account{" "}
          <a
            href={`https://shannon-explorer.somnia.network/address/${example.account}`}
            target="_blank"
            rel="noreferrer"
          >
            {example.account.slice(0, 8)}…{example.account.slice(-6)}
          </a>{" "}
          · Policy {example.policyVersion}
        </p>
        <h3>{example.title}</h3>
        <p className="recorded-strategy">{example.strategy}</p>
        <p>{example.summary}</p>
      </div>
      <dl className="recorded-facts">
        {example.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      <ol className="receipt-list">
        {example.transactions.map((tx) => (
          <li key={tx.hash}>
            <div>
              <strong>{tx.label}</strong>
              <small>{tx.result}</small>
            </div>
            <a
              href={`https://shannon-explorer.somnia.network/tx/${tx.hash}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Inspect ${tx.label.toLowerCase()} receipt`}
            >
              Block {tx.block} <ExternalLink size={15} />
            </a>
          </li>
        ))}
      </ol>
      <details className="recorded-refusals">
        <summary>Inspect three permission-boundary checks</summary>
        <p>
          These were read-only calls against real chain state, not mined failed
          transactions. The revocation check was performed before expiry.
        </p>
        <ul>
          {recordedRefusals.map((check) => (
            <li key={check.result}>
              <span>{check.label}</span>
              <code>{check.result}</code>
            </li>
          ))}
        </ul>
      </details>
      <p className="caption">
        Experimental testnet software. A spending budget is not a profit or
        net-loss guarantee. Test tUSDC is not redeemable money.
      </p>
    </section>
  );
}
