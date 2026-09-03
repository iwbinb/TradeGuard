import { CopyValue, Empty } from "../components/ui";
import { amount } from "../../shared/money";
import type { Workspace } from "../lib/useWorkspace";
export function LiveMarkets({ ws }: { ws: Workspace }) {
  if (ws.mode !== "live") return null;
  return (
    <section className="panel live-markets">
      <div className="section-heading">
        <div>
          <h2>Verified testnet markets</h2>
          <p>
            Read-only order-book quotes, checked against the chain. No wallet
            required.
          </p>
        </div>
        <span className="status status-confirmed">
          {ws.markets.length} markets
        </span>
      </div>
      {ws.markets.length ? (
        <div className="market-grid">
          {ws.markets.map((market) => (
            <article key={market.id} className="market-card">
              <h3>{market.label}</h3>
              <p className="caption">
                Ends{" "}
                {new Intl.DateTimeFormat("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: "Asia/Shanghai",
                }).format(market.expiry * 1000)}{" "}
                UTC+8
              </p>
              <dl>
                <div>
                  <dt>Up ask</dt>
                  <dd>
                    {market.bestAsk
                      ? amount(market.bestAsk, 6, 3) + " tUSDC"
                      : "No ask liquidity"}
                  </dd>
                </div>
                <div>
                  <dt>Down ask estimate</dt>
                  <dd>
                    {market.bestBid
                      ? amount(1000000n - BigInt(market.bestBid), 6, 3) +
                        " tUSDC"
                      : "No bid liquidity"}
                  </dd>
                </div>
              </dl>
              <p className="caption">
                {Date.now() / 1000 - market.fetchedAt > 60
                  ? "Stale — refresh before use"
                  : "Chain-verified quote"}
                . Quotes exclude fees and are not promises of execution.
              </p>
              <CopyValue value={market.id} label="Market ID" />
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={
            ws.loading
              ? "Verifying current markets…"
              : "No verified market data available"
          }
        >
          Only live testnet data is shown here. Use Refresh live data to retry;
          sample data is never substituted.
        </Empty>
      )}
    </section>
  );
}
