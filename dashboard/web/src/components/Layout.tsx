import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PAGE_TITLES, pagePath } from "../lib/format";
import type { PageId } from "../lib/types";
import { Icon } from "./BrandSprite";
import { MorphText } from "./MorphText";

export function Layout({
  page,
  meta,
  accountCount,
  tailnet,
  refreshing,
  globalError,
  onNavigate,
  onRefresh,
  onAddLogin,
  onLogout,
  children,
}: {
  page: PageId;
  meta: string;
  accountCount: number | null;
  tailnet: boolean;
  refreshing: boolean;
  globalError: string;
  onNavigate: (page: PageId) => void;
  onRefresh: () => void;
  onAddLogin: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 760,
  );
  const sidebarGroupRef = useRef<HTMLDivElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth <= 760;
      setIsMobile(mobile);
      if (!mobile) setNavOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    el.inert = isMobile && !navOpen;
  }, [isMobile, navOpen]);

  // Sliding sidebar indicator matching dashboard.css [data-motion-indicator]
  useLayoutEffect(() => {
    const group = sidebarGroupRef.current;
    if (!group) return;
    const measure = () => {
      const active = group.querySelector<HTMLElement>(":scope > .active");
      if (!active || !group.offsetWidth) return;
      const x = active.offsetLeft;
      const y = active.offsetTop;
      const radius = parseFloat(getComputedStyle(active).borderRadius) || 0;
      group.style.setProperty(
        "--indicator-clip",
        `inset(${y}px ${group.clientWidth - x - active.offsetWidth}px ${group.clientHeight - y - active.offsetHeight}px ${x}px round ${radius}px)`,
      );
      if (!group.hasAttribute("data-motion-indicator")) {
        group.dataset.motionIndicator = "initial";
        requestAnimationFrame(() => {
          if (group.isConnected) group.dataset.motionIndicator = "ready";
        });
      }
    };
    measure();
    document.fonts?.ready.then(measure);
  }, [page, accountCount, navOpen]);

  function handleNavClick(e: React.MouseEvent<HTMLAnchorElement>, target: PageId) {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    e.preventDefault();
    setNavOpen(false);
    onNavigate(target);
  }

  return (
    <div id="app">
      <button
        id="nav-scrim"
        type="button"
        className="nav-scrim"
        aria-label="Close navigation"
        hidden={!navOpen}
        onClick={() => {
          setNavOpen(false);
          menuBtnRef.current?.focus();
        }}
      />
      <aside
        ref={sidebarRef}
        id="sidebar"
        className={`sidebar${navOpen ? " open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-header">
          <a
            className="brand"
            href="/dashboard/"
            data-page-link="quotas"
            onClick={(e) => handleNavClick(e, "quotas")}
          >
            <span className="brand-mark">
              <svg aria-hidden="true">
                <use href="#prox-brand" />
              </svg>
            </span>
            <span className="brand-text">
              <strong>prox</strong>
            </span>
          </a>
        </div>
        <nav className="sidebar-content">
          <div className="sidebar-group" ref={sidebarGroupRef}>
            <a
              className={`sidebar-item${page === "quotas" ? " active" : ""}`}
              href={pagePath("quotas")}
              data-page="quotas"
              aria-current={page === "quotas" ? "page" : undefined}
              onClick={(e) => handleNavClick(e, "quotas")}
            >
              <Icon name="gauge" />
              <span>Quota management</span>
            </a>
            <a
              className={`sidebar-item${page === "accounts" ? " active" : ""}`}
              href={pagePath("accounts")}
              data-page="accounts"
              aria-current={page === "accounts" ? "page" : undefined}
              onClick={(e) => handleNavClick(e, "accounts")}
            >
              <Icon name="accounts" />
              <span>Accounts</span>
              <span className="sidebar-badge" id="nav-account-count">
                {accountCount !== null ? <MorphText text={accountCount} /> : ""}
              </span>
            </a>
            <a
              className={`sidebar-item${page === "keys" ? " active" : ""}`}
              href={pagePath("keys")}
              data-page="keys"
              aria-current={page === "keys" ? "page" : undefined}
              onClick={(e) => handleNavClick(e, "keys")}
            >
              <Icon name="key" />
              <span>Keys</span>
            </a>
            <a
              className={`sidebar-item${page === "logs" ? " active" : ""}`}
              href={pagePath("logs")}
              data-page="logs"
              aria-current={page === "logs" ? "page" : undefined}
              onClick={(e) => handleNavClick(e, "logs")}
            >
              <Icon name="logs" />
              <span>Logs</span>
            </a>
          </div>
        </nav>
        <div className="sidebar-footer">
          <a
            className="sidebar-item"
            href="/dashboard/panel"
            target="_blank"
            rel="noopener"
          >
            <Icon name="out" />
            <span>Original panel</span>
          </a>
          <button
            id="logout"
            type="button"
            className="sidebar-item"
            hidden={tailnet}
            onClick={onLogout}
          >
            <Icon name="logout" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
      <main className="shell" id="main">
        <header className="topbar">
          <div className="heading">
            <button
              ref={menuBtnRef}
              id="menu"
              type="button"
              className="ghost icon-btn mobile-toggle"
              aria-label="Toggle navigation"
              aria-expanded={navOpen}
              onClick={() => setNavOpen((prev) => !prev)}
            >
              <Icon name="menu" />
            </button>
            <h1 id="page-title">
              <MorphText text={PAGE_TITLES[page]} />
            </h1>
            <span className="page-meta" id="page-meta">
              <MorphText text={meta} />
            </span>
          </div>
          <div className="actions">
            <button
              id="refresh"
              type="button"
              className="outline"
              title="Refresh all quotas"
              disabled={refreshing}
              onClick={onRefresh}
            >
              <Icon name="refresh" />
              <span className="button-label">
                <MorphText
                  text={refreshing ? "Refreshing…" : "Refresh all quotas"}
                />
              </span>
            </button>
            <button
              id="add-login"
              type="button"
              className="primary"
              title="Add login"
              onClick={onAddLogin}
            >
              <Icon name="plus" />
              <span className="button-label">Add login</span>
            </button>
          </div>
        </header>
        <div
          id="global-error"
          className="notice error"
          role="alert"
          hidden={!globalError}
        >
          {globalError}
        </div>
        <div id="page-body">{children}</div>
      </main>
    </div>
  );
}
