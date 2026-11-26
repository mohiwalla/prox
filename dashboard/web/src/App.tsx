import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "sonner";
import {
  AddLoginDialog,
  type OAuthRequest,
} from "./components/AddLoginDialog";
import { BrandSprite, Icon } from "./components/BrandSprite";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Layout } from "./components/Layout";
import { ResetDialog } from "./components/ResetDialog";
import { SignIn } from "./components/SignIn";
import { api, notify, setUnauthorizedHandler } from "./lib/api";
import {
  pageFromPath,
  pagePath,
  PAGES,
  PROVIDERS,
} from "./lib/format";
import { drainFor, forecastPoints, historyPoints } from "./lib/quotaMath";
import type {
  Account,
  ConfirmAction,
  PageId,
  SessionResponse,
  SnapshotData,
} from "./lib/types";
import { AccountsPage } from "./pages/AccountsPage";
import { KeysPage } from "./pages/KeysPage";
import { LogsPage } from "./pages/LogsPage";
import { QuotasPage } from "./pages/QuotasPage";

const PREFS_KEY = "prox:prefs";

interface Prefs {
  provider: string;
  view: "remaining" | "drain";
  hours: number;
  burn: number;
  forecast: boolean;
  windows: Record<string, string>;
  keyUsageHours: number;
  keyUsageUnit: "hour" | "day";
  logsTab: "errors" | "activity";
}

function loadPrefs(): Prefs {
  const defaults: Prefs = {
    provider: "all",
    view: "remaining",
    hours: 24,
    burn: 3,
    forecast: true,
    windows: {},
    keyUsageHours: 168,
    keyUsageUnit: "hour",
    logsTab: "errors",
  };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    const allowedProviders = ["all", ...Object.keys(PROVIDERS)];
    if (allowedProviders.includes(saved.provider))
      defaults.provider = saved.provider;
    if (saved.view === "remaining" || saved.view === "drain")
      defaults.view = saved.view;
    if ([24, 168, 336, 720, 2160].includes(saved.hours))
      defaults.hours = saved.hours;
    if ([1, 3, 6].includes(saved.burn)) defaults.burn = saved.burn;
    if (typeof saved.forecast === "boolean") defaults.forecast = saved.forecast;
    if (saved.windows && typeof saved.windows === "object") {
      for (const [k, v] of Object.entries(saved.windows)) {
        if (typeof v === "string") defaults.windows[k] = v;
      }
    }
    if ([24, 168, 336, 720, 2160].includes(saved.keyUsageHours))
      defaults.keyUsageHours = saved.keyUsageHours;
    if (saved.keyUsageUnit === "hour" || saved.keyUsageUnit === "day")
      defaults.keyUsageUnit = saved.keyUsageUnit;
    if (saved.logsTab === "errors" || saved.logsTab === "activity")
      defaults.logsTab = saved.logsTab;
  } catch {
    // ignore storage errors
  }
  return defaults;
}

export function App() {
  const [authState, setAuthState] = useState<"checking" | "login" | "app">(
    "checking",
  );
  const [tailnet, setTailnet] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [page, setPage] = useState<PageId>(() => {
    const hash = location.hash.slice(1);
    if ((PAGES as string[]).includes(hash)) {
      history.replaceState(null, "", pagePath(hash as PageId));
    }
    return pageFromPath();
  });

  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [data, setData] = useState<SnapshotData | null>(null);
  const [globalError, setGlobalError] = useState("");
  const [refreshingLocal, setRefreshingLocal] = useState(false);
  const [keysMeta, setKeysMeta] = useState("Loading keys…");
  const [keysRefreshTick, setKeysRefreshTick] = useState(0);

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(
    null,
  );
  const [resetTarget, setResetTarget] = useState<{
    account: Account;
    label: string;
  } | null>(null);
  const [oauthReq, setOauthReq] = useState<OAuthRequest | null>(null);

  const hoursRef = useRef(prefs.hours);
  hoursRef.current = prefs.hours;
  const authRef = useRef(authState);
  authRef.current = authState;
  const loadBusyRef = useRef(false);
  const pendingLoadRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);

  // Persist prefs.
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore storage errors
    }
  }, [prefs]);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const loadSnapshot = useCallback(async () => {
    if (authRef.current !== "app") return;
    if (loadBusyRef.current) {
      pendingLoadRef.current = true;
      return;
    }
    loadBusyRef.current = true;
    clearPoll();
    const requestedHours = hoursRef.current;
    try {
      const next = await api<SnapshotData>(`snapshot?hours=${requestedHours}`);
      if (requestedHours === hoursRef.current) {
        setData(next);
        setGlobalError(next.error || "");
        setRefreshingLocal(false);
        setKeysRefreshTick((t) => t + 1);
      } else {
        pendingLoadRef.current = true;
      }
      if (authRef.current === "app" && !pendingLoadRef.current) {
        pollTimerRef.current = window.setTimeout(
          () => loadSnapshot(),
          next.refreshing ? 2000 : 30000,
        );
      }
    } catch (err) {
      if (authRef.current === "app") {
        setGlobalError(
          err instanceof Error ? err.message : "Couldn't reach dashboard.",
        );
        pollTimerRef.current = window.setTimeout(() => loadSnapshot(), 30000);
      }
    } finally {
      loadBusyRef.current = false;
      if (authRef.current === "app" && pendingLoadRef.current) {
        pendingLoadRef.current = false;
        loadSnapshot();
      }
    }
  }, [clearPoll]);

  // Register global 401 handler.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearPoll();
      setAuthState("login");
      setData(null);
    });
    return () => setUnauthorizedHandler(null);
  }, [clearPoll]);

  // Initial session check.
  useEffect(() => {
    let active = true;
    api<SessionResponse>("session")
      .then((r) => {
        if (!active) return;
        setTailnet(Boolean(r.tailnet));
        setAuthState(r.authenticated ? "app" : "login");
      })
      .catch((err) => {
        if (!active) return;
        setLoginError(
          err instanceof Error ? err.message : "Failed to connect.",
        );
        setAuthState("login");
      });
    return () => {
      active = false;
    };
  }, []);

  // Load snapshot when entering app or changing hours.
  useEffect(() => {
    if (authState === "app") {
      loadSnapshot();
    } else {
      clearPoll();
    }
    return clearPoll;
  }, [authState, prefs.hours, loadSnapshot, clearPoll]);

  // Handle browser back/forward.
  useEffect(() => {
    const onPopState = () => setPage(pageFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Expose debug helper matching legacy dashboard tests.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).dashboard = {
      state: { data, page, ...prefs },
      parseHistory: (accounts: Account[], metric: string) =>
        data ? historyPoints(data, accounts, metric) : [],
      drainFor: (a: Account, metric: string, now?: number) =>
        data ? drainFor(data, a, metric, prefs.burn, now ?? data.now) : null,
      forecastPoints: (
        items: { a: Account; w: Account["windows"][number] }[],
        metric: string,
        now: number,
        end: number,
      ) =>
        data
          ? forecastPoints(
              data,
              items,
              metric,
              prefs.burn,
              prefs.forecast,
              now,
              end,
            )
          : [],
    };
  }, [data, page, prefs]);

  function navigate(nextPage: PageId) {
    if (!PAGES.includes(nextPage)) return;
    if (location.pathname !== pagePath(nextPage)) {
      history.pushState(null, "", pagePath(nextPage));
    }
    setPage(nextPage);
  }

  async function handleRefresh() {
    if (refreshingLocal || data?.refreshing) return;
    setRefreshingLocal(true);
    try {
      await api("refresh", {});
      setData((prev) => (prev ? { ...prev, refreshing: true } : prev));
      window.setTimeout(() => loadSnapshot(), 1200);
    } catch (err) {
      setRefreshingLocal(false);
      notify(
        err instanceof Error ? err.message : "Refresh failed.",
        "error",
      );
    }
  }

  async function handleLogout() {
    try {
      await api("logout", {});
      clearPoll();
      setData(null);
      setAuthState("login");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Sign-out failed.", "error");
    }
  }

  const presentProviders = useMemo(() => {
    const accounts = data?.accounts || [];
    return Object.keys(PROVIDERS).filter((p) =>
      accounts.some((a) => a.provider === p),
    );
  }, [data]);

  const effectiveProvider =
    prefs.provider !== "all" && !presentProviders.includes(prefs.provider)
      ? "all"
      : prefs.provider;

  const providerOptions = useMemo(() => {
    const accounts = data?.accounts || [];
    return [
      { id: "all", count: accounts.length },
      ...presentProviders.map((p) => ({
        id: p,
        count: accounts.filter((a) => a.provider === p).length,
      })),
    ];
  }, [data, presentProviders]);

  const count = data?.accounts.length ?? 0;
  const measured =
    data?.accounts.filter((a) => a.windows.length > 0).length ?? 0;
  const metaText = !data
    ? "Connecting…"
    : page === "keys"
      ? keysMeta
      : `${count} account${count === 1 ? "" : "s"} · ${measured} quotas loaded`;

  const isRefreshing = Boolean(refreshingLocal || data?.refreshing);

  return (
    <>
      <BrandSprite />
      <Toaster theme="dark" richColors position="bottom-right" />

      {authState === "login" && (
        <SignIn
          initialError={loginError}
          onSuccess={() => {
            setLoginError("");
            setAuthState("app");
          }}
        />
      )}

      {authState === "app" && (
        <Layout
          page={page}
          meta={metaText}
          accountCount={data ? count : null}
          tailnet={tailnet}
          refreshing={isRefreshing}
          globalError={globalError}
          onNavigate={navigate}
          onRefresh={handleRefresh}
          onAddLogin={() => setOauthReq({ mode: "add" })}
          onLogout={handleLogout}
        >
          {page === "keys" ? (
            <KeysPage
              refreshTick={keysRefreshTick}
              keyUsageHours={prefs.keyUsageHours}
              keyUsageUnit={prefs.keyUsageUnit}
              onKeyUsageHoursChange={(h) =>
                setPrefs((prev) => ({ ...prev, keyUsageHours: h }))
              }
              onKeyUsageUnitChange={(u) =>
                setPrefs((prev) => ({ ...prev, keyUsageUnit: u }))
              }
              onMetaChange={setKeysMeta}
              onConfirm={setConfirmAction}
            />
          ) : page === "logs" ? (
            <LogsPage
              tab={prefs.logsTab}
              onTabChange={(t) =>
                setPrefs((prev) => ({ ...prev, logsTab: t }))
              }
            />
          ) : !data ? null : !count ? (
            <div className="state-card">
              <h2>
                {data.error
                  ? "Waiting for the proxy"
                  : "Your account pool starts here"}
              </h2>
              <p>
                {data.error
                  ? "The connection will be checked automatically."
                  : "Add a login to start pooling accounts and tracking their quotas."}
              </p>
              <button
                type="button"
                className="primary"
                data-add=""
                onClick={() => setOauthReq({ mode: "add" })}
              >
                <Icon name="plus" />
                Add login
              </button>
            </div>
          ) : page === "quotas" ? (
            <QuotasPage
              data={data}
              provider={effectiveProvider}
              providerOptions={providerOptions}
              presentProviders={presentProviders}
              view={prefs.view}
              burn={prefs.burn}
              hours={prefs.hours}
              showForecast={prefs.forecast}
              windows={prefs.windows}
              onProviderChange={(p) =>
                setPrefs((prev) => ({ ...prev, provider: p }))
              }
              onViewChange={(v) => setPrefs((prev) => ({ ...prev, view: v }))}
              onBurnChange={(b) => setPrefs((prev) => ({ ...prev, burn: b }))}
              onHoursChange={(h) => setPrefs((prev) => ({ ...prev, hours: h }))}
              onForecastChange={(f) =>
                setPrefs((prev) => ({ ...prev, forecast: f }))
              }
              onWindowChange={(p, winId) =>
                setPrefs((prev) => ({
                  ...prev,
                  windows: { ...prev.windows, [p]: winId },
                }))
              }
              onNavigateAccounts={() => navigate("accounts")}
            />
          ) : (
            <AccountsPage
              data={data}
              provider={effectiveProvider}
              providerOptions={providerOptions}
              onProviderChange={(p) =>
                setPrefs((prev) => ({ ...prev, provider: p }))
              }
              onReload={loadSnapshot}
              onRelogin={(account, label) =>
                setOauthReq({
                  mode: "relogin",
                  accountId: account.id,
                  accountLabel: label,
                })
              }
              onReset={(account, label) => setResetTarget({ account, label })}
              onConfirm={setConfirmAction}
            />
          )}
        </Layout>
      )}

      <ConfirmDialog
        action={confirmAction}
        onClose={() => setConfirmAction(null)}
      />

      <ResetDialog
        account={resetTarget?.account || null}
        label={resetTarget?.label || ""}
        onClose={() => setResetTarget(null)}
        onSuccess={loadSnapshot}
      />

      <AddLoginDialog
        request={oauthReq}
        onClose={() => setOauthReq(null)}
        onConnected={() => {
          loadSnapshot();
          window.setTimeout(() => loadSnapshot(), 2000);
        }}
      />
    </>
  );
}
