import {
  FileCheck2,
  OctagonAlert,
  TrendingUp,
  ChevronRight,
} from "lucide-react";
import type { Activity } from "../../shared/types";
import { Money, Status, Empty } from "./ui";
export function ActivityTable({
  rows,
  select,
}: {
  rows: Activity[];
  select: (activity: Activity) => void;
}) {
  if (!rows.length)
    return (
      <Empty title="No recorded activity yet">
        Transactions recorded by this workspace will appear here. This is not a
        complete address history.
      </Empty>
    );
  return (
    <div className="activity-table">
      <div className="activity-head">
        <span>Time</span>
        <span>Action</span>
        <span>Amount</span>
        <span>Status</span>
      </div>
      {rows.map((row) => (
        <button
          className="activity-row"
          key={row.id}
          aria-label={`${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(row.at * 1000)} ${row.action} · ${row.status}`}
          onClick={() => select(row)}
        >
          <time dateTime={new Date(row.at * 1000).toISOString()}>
            {new Intl.DateTimeFormat("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Shanghai",
            }).format(row.at * 1000)}
          </time>
          <span className="activity-action">
            {row.status === "pre-check" || row.status === "reverted" ? (
              <OctagonAlert className="amber" size={25} />
            ) : row.status === "filled" ? (
              <TrendingUp className="green" size={25} />
            ) : (
              <FileCheck2 size={24} />
            )}
            <span>{row.action}</span>
          </span>
          <Money value={row.amount} />
          <Status status={row.status} />
          <ChevronRight className="row-arrow" size={15} />
        </button>
      ))}
    </div>
  );
}
