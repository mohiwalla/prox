import * as React from "react";
import { toast } from "sonner";
import {
  AddLoginDialog,
  type OAuthDialogRequest,
} from "@/components/AddLoginDialog";
import { Layout } from "@/components/Layout";
import { SignIn } from "@/components/SignIn";
import { apiGet, apiPost, setUnauthorizedHandler } from "@/lib/api";
import type {
  Account,
  DashboardPage,
  HistoryHours,
  ProviderId,
  SessionResponse,
  Snapshot,
} from "@/lib/types";
import { AccountsPage } from "@/pages/AccountsPage";
import { KeysPage } from "@/pages/KeysPage";
import { LogsPage } from "@/pages/LogsPage";
import { QuotasPage } from "@/pages/QuotasPage";

const PAGES: readonly DashboardPage[] = ["quotas", "accounts", "keys", "logs"];
const VALID_HOURS: readonly HistoryHours[] = [24, 168, 336, 720, 2160];
const PREFS_KEY = "prox:prefs";

const PAGE_TITLES: Record<DashboardPage, string> = {
  quotas: "Quota management",
  accounts: "Accounts",
  keys: "Keys",
  logs: "Logs",
};

function pagePath(page: DashboardPage): string {
  return page === "quotas" ? "/dashboard/" : `/dashboard/${page}`;
}

function pageFromLocation(): DashboardPage {
  const hash = window.location.hash.slice(1) as DashboardPage;
  if (PAGES.includes(hash)) {
    window.history.replaceState(null, "", pagePath(hash));
    return hash;
  }
  const slug = window.location.pathname
    .replace(/^\/dashboard\/?/, "")
    .replace(/\/$/, "") as DashboardPage;
  return PAGES.includes(slug) ? slug : "quotas";
}

function readStoredHours(): HistoryHours {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    if (VALID_HOURS.includes(parsed.hours)) {
      return parsed.hours as HistoryHours;
    }
  } catch {
    // Ignore storage read errors.
  }
  return 24;
}

function persistHours(hours: HistoryHours): void {
  try {
    const current = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ ...current, hours }),
    );
  } catch {
    // Ignore storage write errors.
  }
}

export function App() {
  const [authState, setAuthState] = React.useState<
    "checking" | "unauthenticated" | "authenticated"
  >("checking");
  const [isTailnet, setIsTailnet] = React.useState(false);
  const [loginError, setLoginError] = React.useState("");

  const [page, setPage] = React.useState<DashboardPage>(() =>
    pageFromLocation(),
  );
  const [hours, setHoursState] = React.useState<HistoryHours>(() =>
    readStoredHours(),
  );
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [refreshRequested, setRefreshRequested] = React.useState(false);
  const [pageMetaOverride, setPageMetaOverride] = React.useState<string | null>(
    null,
  );
  const [oauthRequest, setOAuthRequest] =
    React.useState<OAuthDialogRequest | null>(null);

  const hoursRef = React.useRef<HistoryHours>(hours);
  hoursRef.current = hours;
  const loadAbortRef = React.useRef<AbortController | null>(null);
  const pollTimerRef = React.useRef<number | null>(null);
  const requestSeqRef = React.useRef(0);

  const clearPollTimer = React.useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Register global 401 handler.
  React.useEffect(() => {
    setUnauthorizedHandler(() => {
      clearPollTimer();
      loadAbortRef.current?.abort();
      setAuthState("unauthenticated");
      setSnapshot(null);
      setOAuthRequest(null);
    });
    return () => setUnauthorizedHandler(null);
  }, [clearPollTimer]);

  // Initial session check.
  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await apiGet<SessionResponse>("session");
        if (!active) return;
        setIsTailnet(Boolean(res.tailnet));
        setAuthState(res.authenticated ? "authenticated" : "unauthenticated");
      } catch (err) {
        if (!active) return;
        setAuthState("unauthenticated");
        setLoginError(
          err instanceof Error ? err.message : "Could not reach dashboard.",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // History popstate sync.
  React.useEffect(() => {
    const onPopState = () => {
      setPage(pageFromLocation());
      setPageMetaOverride(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = React.useCallback((nextPage: DashboardPage) => {
    if (!PAGES.includes(nextPage)) return;
    const nextPath = pagePath(nextPage);
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
    setPage(nextPage);
    setPageMetaOverride(null);
  }, []);

  const fetchSnapshot = React.useCallback(
    async (requestedHours: HistoryHours = hoursRef.current) => {
      clearPollTimer();
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      const seq = ++requestSeqRef.current;

      setLoading(true);
      let nextDelay = 30_000;

      try {
        const data = await apiGet<Snapshot>(
          `snapshot?hours=${requestedHours}`,
          controller.signal,
        );
        if (seq !== requestSeqRef.current || controller.signal.aborted) {
          return;
        }
        setSnapshot(data);
        setFetchError(null);
        setRefreshRequested(false);
        nextDelay = data.refreshing ? 2_000 : 30_000;
      } catch (err) {
        if (controller.signal.aborted || seq !== requestSeqRef.current) {
          return;
        }
        setFetchError(
          err instanceof Error ? err.message : "Failed to load snapshot.",
        );
      } finally {
        if (seq === requestSeqRef.current && !controller.signal.aborted) {
          setLoading(false);
          pollTimerRef.current = window.setTimeout(() => {
            void fetchSnapshot(hoursRef.current);
          }, nextDelay);
        }
      }
    },
    [clearPollTimer],
  );

  // Start / restart snapshot polling when authenticated or when `hours` changes.
  React.useEffect(() => {
    if (authState !== "authenticated") {
      clearPollTimer();
      loadAbortRef.current?.abort();
      return;
    }
    void fetchSnapshot(hours);
    return () => {
      clearPollTimer();
      loadAbortRef.current?.abort();
    };
  }, [authState, hours, fetchSnapshot, clearPollTimer]);

  const handleHoursChange = React.useCallback((nextHours: HistoryHours) => {
    setHoursState(nextHours);
    persistHours(nextHours);
  }, []);

  const handleRefreshAll = React.useCallback(async () => {
    if (refreshRequested || snapshot?.refreshing) return;
    setRefreshRequested(true);
    try {
      await apiPost("refresh", {});
      setSnapshot((prev) => (prev ? { ...prev, refreshing: true } : prev));
      clearPollTimer();
      pollTimerRef.current = window.setTimeout(() => {
        void fetchSnapshot(hoursRef.current);
      }, 1_200);
    } catch (err) {
      setRefreshRequested(false);
      toast.error(
        err instanceof Error ? err.message : "Could not refresh quotas.",
      );
    }
  }, [refreshRequested, snapshot?.refreshing, clearPollTimer, fetchSnapshot]);

  const handleLogout = React.useCallback(async () => {
    try {
      await apiPost("logout", {});
      clearPollTimer();
      loadAbortRef.current?.abort();
      setSnapshot(null);
      setOAuthRequest(null);
      setAuthState("unauthenticated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign out failed.");
    }
  }, [clearPollTimer]);

  const openAddLogin = React.useCallback((provider?: ProviderId) => {
    setOAuthRequest({ mode: "add", provider });
  }, []);

  const openRelogin = React.useCallback((account: Account) => {
    setOAuthRequest({ mode: "relogin", account });
  }, []);

  const reloadSnapshot = React.useCallback(async () => {
    await fetchSnapshot(hoursRef.current);
  }, [fetchSnapshot]);

  const handleOAuthSuccess = React.useCallback(async () => {
    await fetchSnapshot(hoursRef.current);
    window.setTimeout(() => {
      void fetchSnapshot(hoursRef.current);
    }, 2_000);
  }, [fetchSnapshot]);

  if (authState === "checking") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Connecting…
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <SignIn
        initialError={loginError}
        onAuthenticated={() => {
          setLoginError("");
          setAuthState("authenticated");
        }}
      />
    );
  }

  const accountCount = snapshot?.accounts.length ?? 0;
  const measuredCount =
    snapshot?.accounts.filter((a) => a.windows.length > 0).length ?? 0;
  const defaultMeta = snapshot
    ? `${accountCount} account${accountCount === 1 ? "" : "s"} · ${measuredCount} quotas loaded`
    : "Connecting…";
  const headerMeta = pageMetaOverride ?? defaultMeta;
  const isRefreshing = Boolean(refreshRequested || snapshot?.refreshing);
  const globalError = snapshot?.error ?? fetchError;

  return (
    <>
      <Layout
        page={page}
        onNavigate={navigate}
        title={PAGE_TITLES[page]}
        meta={headerMeta}
        accountCount={accountCount}
        refreshing={isRefreshing}
        onRefresh={() => void handleRefreshAll()}
        onAddLogin={() => openAddLogin()}
        showLogout={!isTailnet}
        onLogout={() => void handleLogout()}
        globalError={globalError}
      >
        {page === "quotas" && (
          <QuotasPage
            snapshot={snapshot}
            loading={loading}
            hours={hours}
            onHoursChange={handleHoursChange}
            onAddLogin={openAddLogin}
            onRelogin={openRelogin}
            onReload={reloadSnapshot}
          />
        )}
        {page === "accounts" && (
          <AccountsPage
            snapshot={snapshot}
            loading={loading}
            onAddLogin={openAddLogin}
            onRelogin={openRelogin}
            onReload={reloadSnapshot}
          />
        )}
        {page === "keys" && (
          <KeysPage
            snapshot={snapshot}
            onMetaChange={setPageMetaOverride}
          />
        )}
        {page === "logs" && (
          <LogsPage
            snapshot={snapshot}
            onMetaChange={setPageMetaOverride}
          />
        )}
      </Layout>

      <AddLoginDialog
        request={oauthRequest}
        onClose={() => setOAuthRequest(null)}
        onSuccess={handleOAuthSuccess}
      />
    </>
  );
}
export default App;
