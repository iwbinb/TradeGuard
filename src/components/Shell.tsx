import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  FlaskConical,
  House,
  Activity as ActivityIcon,
  FileCheck2,
  Shield,
  WalletCards,
  Network,
  Menu,
  X,
} from "lucide-react";
import { useState, useEffect, useRef, type ReactNode } from "react";
import type { Workspace } from "../lib/useWorkspace";
export type Page =
  "overview" | "permissions" | "activity" | "proof" | "docs" | "home";
const pages = [
  ["overview", "Overview", House],
  ["permissions", "Permissions", Shield],
  ["activity", "Activity", ActivityIcon],
  ["proof", "Proof Center", FileCheck2],
] as const;
const titles: Record<Page, [string, string]> = {
  overview: ["Overview", "Monitor your trading permissions."],
  permissions: ["Permissions", "Explicit authority. Always yours to change."],
  activity: ["Activity", "Follow every decision through to its outcome."],
  proof: ["Proof Center", "Inspect the evidence, not just the interface."],
  docs: [
    "Documentation",
    "Understand your account, permissions, and recovery options.",
  ],
  home: ["TradeGuard", "Your agent. Your limits."],
};
export function Shell({
  page,
  ws,
  children,
  openAccount,
  openMode,
  openNetwork,
}: {
  page: Page;
  ws: Workspace;
  children: ReactNode;
  openAccount: () => void;
  openMode: () => void;
  openNetwork: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const navigation = useRef<HTMLElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    navigation.current?.querySelector<HTMLElement>("a,button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(false);
      }
      if (event.key !== "Tab") return;
      const items = [
        ...(navigation.current?.querySelectorAll<HTMLElement>("a,button") ??
          []),
      ].filter((el) => el.getClientRects().length > 0);
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0]?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      menuTrigger.current?.focus();
    };
  }, [menu]);
  return (
    <div className="app-shell">
      {menu ? (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      ) : null}
      <aside
        ref={navigation}
        id="workspace-navigation"
        className={`sidebar ${menu ? "is-open" : ""}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") setMenu(false);
        }}
      >
        <a href="#/overview" className="brand" onClick={() => setMenu(false)}>
          <Shield size={38} strokeWidth={1.8} />
          <span>TradeGuard</span>
        </a>
        <button
          className="icon-button mobile-close"
          aria-label="Close menu"
          onClick={() => setMenu(false)}
        >
          <X />
        </button>
        <nav aria-label="Primary navigation">
          {pages.map(([key, label, Icon]) => (
            <a
              key={key}
              href={`#/${key}`}
              aria-current={page === key ? "page" : undefined}
              className={page === key ? "selected" : ""}
              onClick={() => setMenu(false)}
            >
              <Icon size={26} strokeWidth={1.7} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <button
          className="mobile-network button button-text"
          onClick={() => {
            setMenu(false);
            openNetwork();
          }}
        >
          <Network size={20} /> Somnia Shannon
        </button>
        <a
          className="documentation-link"
          href="#/docs"
          onClick={() => setMenu(false)}
        >
          <BookOpen size={26} />
          <span>Documentation</span>
        </a>
      </aside>
      <main
        className="main-content"
        id="main-content"
        tabIndex={-1}
        inert={menu}
      >
        <header className="page-header">
          <div className="header-title">
            <button
              className="icon-button menu-button"
              ref={menuTrigger}
              aria-label="Open navigation"
              aria-expanded={menu}
              aria-controls="workspace-navigation"
              onClick={() => setMenu(true)}
            >
              <Menu />
            </button>
            <div>
              <h1>{titles[page][0]}</h1>
              <p>{titles[page][1]}</p>
            </div>
          </div>
          <div className="header-tools">
            <button
              className={`tool-pill mode-pill ${ws.mode}`}
              onClick={openMode}
            >
              <FlaskConical size={19} />
              <span>
                {ws.mode === "simulation" ? "Simulation" : "Live testnet"}
              </span>
            </button>
            <button className="tool-pill network-pill" onClick={openNetwork}>
              <Network size={20} />
              <span>Somnia Shannon</span>
              <ChevronDown size={14} />
            </button>
            <button className="tool-pill account-pill" onClick={openAccount}>
              <WalletCards size={21} />
              <span>
                {ws.mode === "simulation"
                  ? "Demo account"
                  : ws.owner
                    ? `${ws.owner.slice(0, 6)}…${ws.owner.slice(-4)}`
                    : "Connect wallet"}
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="date-line">
            <CalendarDays size={20} />
            <span>
              {new Intl.DateTimeFormat("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "Asia/Shanghai",
              }).format(ws.snapshot.now * 1000)}
              <span className="date-dot">·</span>
              {new Intl.DateTimeFormat("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Shanghai",
              }).format(ws.snapshot.now * 1000)}{" "}
              UTC+8
            </span>
          </div>
        </header>
        {ws.error || ws.notice ? (
          <div
            className={`notice ${ws.error ? "notice-error" : ""}`}
            role={ws.error ? "alert" : "status"}
          >
            <span>{ws.error || ws.notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={ws.dismiss}
            >
              <X size={17} />
            </button>
          </div>
        ) : null}
        {ws.pending ? (
          <div className="notice" role="status">
            Transaction awaiting confirmation.{" "}
            <button
              className="text-button"
              onClick={() => {
                void ws.reconcile();
              }}
            >
              Check transaction
            </button>
          </div>
        ) : null}
        {children}
        <footer className="workspace-footer">
          {ws.mode === "simulation"
            ? "Simulation workspace · Simulated data · No real funds."
            : "Somnia Shannon testnet · Test assets only · No profit guarantee."}
        </footer>
      </main>
      <nav className="bottom-nav" aria-label="Mobile navigation" inert={menu}>
        {pages.map(([key, label, Icon]) => (
          <a
            key={key}
            href={`#/${key}`}
            aria-current={page === key ? "page" : undefined}
          >
            <Icon size={22} />
            <span>{key === "proof" ? "Proof" : label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
