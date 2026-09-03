import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Check, Copy, LoaderCircle, X } from "lucide-react";
import { amount } from "../../shared/money";
import type { ActivityStatus } from "../../shared/types";
export function Button({
  variant = "secondary",
  busy,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "text";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button button-${variant} ${className}`}
    >
      {busy ? (
        <LoaderCircle className="spin" size={17} aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
}
export function Money({
  value,
  decimals = 6,
  large = false,
}: {
  value: string;
  decimals?: number;
  large?: boolean;
}) {
  return (
    <span className={large ? "money money-large" : "money"}>
      {amount(value, decimals)} <span className="unit">tUSDC</span>
    </span>
  );
}
const statusLabels: Record<ActivityStatus, string> = {
  confirmed: "Confirmed",
  filled: "Filled",
  partial: "Partial fill",
  "no-fill": "No fill",
  "pre-check": "Pre-check",
  pending: "Pending",
  reverted: "Reverted",
  unknown: "Unknown",
};
export function Status({
  status,
  children,
}: {
  status: string;
  children?: ReactNode;
}) {
  return (
    <span className={`status status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {children ?? statusLabels[status as ActivityStatus] ?? status}
    </span>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = ref.current;
    root
      ?.querySelector<HTMLElement>(
        "[data-initial-focus], button, input, select",
      )
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key !== "Tab" || !root) return;
      const items = [
        ...root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length > 0);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "modal-wide" : ""}`}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="copy-value">
      <span>
        <small>{label}</small>
        <code>{value}</code>
      </span>
      <button
        className="icon-button"
        aria-label={`Copy ${label}`}
        onClick={() => {
          setFailed(false);
          if (!navigator.clipboard) {
            setFailed(true);
            return;
          }
          void navigator.clipboard
            .writeText(value)
            .then(() => setCopied(true))
            .catch(() => setFailed(true));
        }}
      >
        {copied ? <Check size={17} /> : <Copy size={17} />}
      </button>
      {failed ? (
        <span role="status">Select and copy the value manually.</span>
      ) : null}
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
