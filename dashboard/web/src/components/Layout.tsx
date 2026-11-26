import * as React from "react";
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  GaugeIcon,
  KeyRoundIcon,
  LogOutIcon,
  MenuIcon,
  PlusIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { Toaster } from "sonner";
import { ProxBrandIcon } from "@/components/ProviderIcon";
import { Button } from "@/components/ui";
import type { DashboardPage } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface LayoutProps {
  page: DashboardPage;
  onNavigate: (page: DashboardPage) => void;
  title: string;
  meta: string;
  accountCount: number;
  refreshing: boolean;
  onRefresh: () => void;
  onAddLogin: () => void;
  showLogout: boolean;
  onLogout: () => void;
  globalError: string | null;
  children: React.ReactNode;
}

interface NavItem {
  id: DashboardPage;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: "quotas", label: "Quota management", href: "/dashboard/", icon: GaugeIcon },
  { id: "accounts", label: "Accounts", href: "/dashboard/accounts", icon: UsersIcon },
  { id: "keys", label: "Keys", href: "/dashboard/keys", icon: KeyRoundIcon },
  { id: "logs", label: "Logs", href: "/dashboard/logs", icon: ScrollTextIcon },
];

export function Layout({
  page,
  onNavigate,
  title,
  meta,
  accountCount,
  refreshing,
  onRefresh,
  onAddLogin,
  showLogout,
  onLogout,
  globalError,
  children,
}: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  React.useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  function handleNavClick(
    event: React.MouseEvent<HTMLAnchorElement>,
    target: DashboardPage,
  ) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    setMobileMenuOpen(false);
    onNavigate(target);
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Mobile drawer scrim */}
      <button
        type="button"
        aria-label="Close navigation"
        onClick={() => setMobileMenuOpen(false)}
        className={cn(
          "fixed inset-0 z-30 bg-black/60 backdrop-blur-[1px] transition-opacity duration-200 md:hidden",
          mobileMenuOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
        tabIndex={mobileMenuOpen ? 0 : -1}
      />

      {/* Sidebar */}
      <aside
        aria-label="Main navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-background p-2",
          "transition-transform duration-200 ease-out motion-reduce:transition-none",
          "md:translate-x-0",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between pb-2">
          <a
            href="/dashboard/"
            onClick={(e) => handleNavClick(e, "quotas")}
            className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-accent/50"
          >
            <ProxBrandIcon />
            <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">
              prox
            </span>
          </a>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close navigation"
            onClick={() => setMobileMenuOpen(false)}
            className="md:hidden"
          >
            <XIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = page === item.id;
              return (
                <a
                  key={item.id}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={(e) => handleNavClick(e, item.id)}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm leading-5 transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                  {item.id === "accounts" ? (
                    <span className="ml-auto min-w-5 text-center text-xs font-medium tabular-nums text-muted-foreground">
                      {accountCount}
                    </span>
                  ) : null}
                </a>
              );
            })}
          </div>
        </nav>

        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          <a
            href="/dashboard/panel"
            target="_blank"
            rel="noopener"
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm leading-5 text-muted-foreground transition-colors duration-150",
              "hover:bg-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            )}
          >
            <ExternalLinkIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Original panel</span>
          </a>

          {showLogout ? (
            <button
              type="button"
              onClick={onLogout}
              className={cn(
                "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm leading-5 text-muted-foreground transition-colors duration-150",
                "hover:bg-accent hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )}
            >
              <LogOutIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Sign out</span>
            </button>
          ) : null}
        </div>
      </aside>

      {/* Main shell */}
      <main className="min-w-0 p-4 sm:p-6 md:ml-64">
        <header className="mb-6 flex min-h-9 flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle navigation"
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="self-center md:hidden"
            >
              <MenuIcon className="size-4" aria-hidden="true" />
            </Button>
            <h1 className="text-2xl font-semibold leading-8 tracking-tight text-foreground">
              {title}
            </h1>
            <span className="text-sm tabular-nums text-muted-foreground">
              {meta}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onRefresh}
              disabled={refreshing}
              title="Refresh all quotas"
            >
              <RefreshCwIcon
                className={cn("size-4", refreshing && "animate-spin")}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">
                {refreshing ? "Refreshing…" : "Refresh all quotas"}
              </span>
            </Button>

            <Button
              variant="default"
              onClick={onAddLogin}
              title="Add login"
            >
              <PlusIcon className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Add login</span>
            </Button>
          </div>
        </header>

        {globalError ? (
          <div
            role="alert"
            className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
            <span>{globalError}</span>
          </div>
        ) : null}

        <div className="min-w-0">{children}</div>
      </main>

      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--popover)",
            border: "1px solid var(--border)",
            color: "var(--foreground)",
          },
        }}
      />
    </div>
  );
}
