import * as React from "react";
import {
  AlertTriangleIcon,
  LayoutGridIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toggle,
  ToggleGroup,
} from "@/components/ui";
import { QUOTA_PROVIDERS, pName } from "@/lib/format";
import type { Account, HistoryHours, ProviderId, Snapshot } from "@/lib/types";
import { ProviderQuotaSection } from "./quotas/ProviderQuotaSection";
import {
  BURN_OPTIONS,
  RANGE_SHORT_OPTIONS,
  presentProviders,
  readQuotaPrefs,
  writeQuotaPrefs,
  type BurnHours,
  type QuotaMetricView,
  type QuotaPrefs,
} from "./quotas/model";

export interface QuotasPageProps {
  snapshot: Snapshot | null;
  loading: boolean;
  hours: HistoryHours;
  onHoursChange: (hours: HistoryHours) => void;
  onAddLogin: (provider?: ProviderId) => void;
  onRelogin: (account: Account) => void;
  onReload: () => Promise<void>;
}

const FORECAST_LABELS: Record<"on" | "off", string> = {
  on: "Same as recent",
  off: "Hide forecast",
};

function navigateToAccounts(event: React.MouseEvent<HTMLAnchorElement>) {
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
  if (window.location.pathname !== "/dashboard/accounts") {
    window.history.pushState(null, "", "/dashboard/accounts");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

export function QuotasPage({
  snapshot,
  loading,
  hours,
  onHoursChange,
  onAddLogin,
  onRelogin,
  onReload,
}: QuotasPageProps) {
  const [prefs, setPrefs] = React.useState<QuotaPrefs>(() => readQuotaPrefs());

  const updatePrefs = React.useCallback(
    (updater: (prev: QuotaPrefs) => QuotaPrefs) => {
      setPrefs((prev) => {
        const next = updater(prev);
        writeQuotaPrefs(next);
        return next;
      });
    },
    [],
  );

  const accounts = snapshot?.accounts ?? [];
  const providers = React.useMemo(
    () => presentProviders(accounts),
    [accounts],
  );

  // Fall back to "all" when the stored provider has no accounts in the pool.
  const activeProvider =
    prefs.provider === "all" || providers.includes(prefs.provider)
      ? prefs.provider
      : "all";

  const providerCounts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const account of accounts) {
      map.set(account.provider, (map.get(account.provider) ?? 0) + 1);
    }
    return map;
  }, [accounts]);

  const visibleQuotaProviders = React.useMemo(
    () =>
      QUOTA_PROVIDERS.filter((p) => providers.includes(p)).filter(
        (p) => activeProvider === "all" || p === activeProvider,
      ),
    [providers, activeProvider],
  );

  const restrictedCodexCount = React.useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.provider === "codex" &&
          a.cooldowns.some((c) => c.reason === "model_not_supported"),
      ).length,
    [accounts],
  );

  const handleSelectWindow = React.useCallback(
    (provider: string, windowId: string) => {
      updatePrefs((prev) => ({
        ...prev,
        windows: { ...prev.windows, [provider]: windowId },
      }));
    },
    [updatePrefs],
  );

  // Initial loading state before first snapshot arrives
  if (loading && !snapshot) {
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <CardTitle>Quota management</CardTitle>
            <CardDescription>Loading quota snapshot…</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[240px] w-full animate-pulse rounded-lg bg-secondary/40" />
        </CardContent>
      </Card>
    );
  }

  // Empty state when no accounts exist at all
  if (!loading && snapshot && accounts.length === 0) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardHeader className="flex-col items-center">
          <CardTitle>
            {snapshot.error
              ? "Waiting for the proxy"
              : "Your account pool starts here"}
          </CardTitle>
          <CardDescription>
            {snapshot.error
              ? "The connection will be checked automatically."
              : "Add a login to start pooling accounts and tracking their quotas."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center gap-2">
          {snapshot.error ? (
            <Button variant="outline" onClick={() => void onReload()}>
              <RefreshCwIcon className="size-4" aria-hidden="true" />
              Retry
            </Button>
          ) : null}
          <Button variant="default" onClick={() => onAddLogin()}>
            <PlusIcon className="size-4" aria-hidden="true" />
            Add login
          </Button>
        </CardContent>
      </Card>
    );
  }

  const now = snapshot?.now ?? Math.floor(Date.now() / 1000);
  const history = snapshot?.history ?? [];
  const historyBucket = snapshot?.history_bucket ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Provider filter tabs */}
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ToggleGroup
          value={[activeProvider]}
          deselectable={false}
          aria-label="Filter provider"
          className="border-none bg-transparent p-0 gap-1"
          onValueChange={(values) => {
            const next = values[0];
            if (next) updatePrefs((prev) => ({ ...prev, provider: next }));
          }}
        >
          <Toggle value="all" variant="default" className="h-9 px-3">
            <LayoutGridIcon className="size-4" aria-hidden="true" />
            <span>All</span>
            <span className="tabular-nums text-muted-foreground">
              {accounts.length}
            </span>
          </Toggle>
          {providers.map((provider) => (
            <Toggle
              key={provider}
              value={provider}
              variant="default"
              className="h-9 px-3"
            >
              <ProviderIcon provider={provider} className="size-4" />
              <span>{pName(provider)}</span>
              <span className="tabular-nums text-muted-foreground">
                {providerCounts.get(provider) ?? 0}
              </span>
            </Toggle>
          ))}
        </ToggleGroup>
      </div>

      {/* Controls toolbar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Metric toggle */}
        <ToggleGroup<QuotaMetricView>
          value={[prefs.view]}
          deselectable={false}
          aria-label="Chart metric"
          onValueChange={(values) => {
            const next = values[0];
            if (next) updatePrefs((prev) => ({ ...prev, view: next }));
          }}
        >
          <Toggle value="remaining" variant="segmented">
            Remaining
          </Toggle>
          <Toggle value="drain" variant="segmented">
            Drain rate
          </Toggle>
        </ToggleGroup>

        {/* Burn rate lookback */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Burn</span>
          <ToggleGroup
            value={[String(prefs.burn)]}
            deselectable={false}
            aria-label="Burn rate lookback"
            onValueChange={(values) => {
              const next = Number(values[0]) as BurnHours;
              if (next === 1 || next === 3 || next === 6) {
                updatePrefs((prev) => ({ ...prev, burn: next }));
              }
            }}
          >
            {BURN_OPTIONS.map((opt) => (
              <Toggle
                key={opt.value}
                value={String(opt.value)}
                variant="segmented"
              >
                {opt.label}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>

        {/* Future usage forecast select */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Future usage</span>
          <Select<"on" | "off">
            value={prefs.forecast ? "on" : "off"}
            itemToLabel={(v) => FORECAST_LABELS[v]}
            onValueChange={(val) => {
              if (val === "on" || val === "off") {
                updatePrefs((prev) => ({
                  ...prev,
                  forecast: val === "on",
                }));
              }
            }}
          >
            <SelectTrigger
              size="sm"
              className="min-w-[144px]"
              aria-label="Future usage forecast"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="on" label={FORECAST_LABELS.on}>
                {FORECAST_LABELS.on}
              </SelectItem>
              <SelectItem value="off" label={FORECAST_LABELS.off}>
                {FORECAST_LABELS.off}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Time range toggle */}
        <div className="sm:ml-auto">
          <ToggleGroup
            value={[String(hours)]}
            deselectable={false}
            aria-label="Chart time range"
            onValueChange={(values) => {
              const next = Number(values[0]) as HistoryHours;
              if (
                next === 24 ||
                next === 168 ||
                next === 336 ||
                next === 720 ||
                next === 2160
              ) {
                onHoursChange(next);
              }
            }}
          >
            {RANGE_SHORT_OPTIONS.map((opt) => (
              <Toggle
                key={opt.value}
                value={String(opt.value)}
                variant="segmented"
                title={opt.title}
              >
                {opt.label}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {/* Model restriction warning banner for Codex accounts */}
      {restrictedCodexCount > 0 &&
      (activeProvider === "all" || activeProvider === "codex") ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm leading-5"
        >
          <AlertTriangleIcon
            className="size-4 shrink-0 text-warning"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 text-foreground">
            {restrictedCodexCount} Codex account
            {restrictedCodexCount === 1 ? " has" : "s have"} a model
            restriction. Available quota does not guarantee access to every
            model.
          </span>
          <a
            href="/dashboard/accounts"
            onClick={navigateToAccounts}
            className="ml-auto inline-flex h-8 shrink-0 items-center rounded-md px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            View accounts
          </a>
        </div>
      ) : null}

      {/* Per-provider quota cards */}
      {visibleQuotaProviders.length > 0 ? (
        <div className="flex flex-col gap-4">
          {visibleQuotaProviders.map((provider) => (
            <ProviderQuotaSection
              key={provider}
              provider={provider}
              accounts={accounts.filter((a) => a.provider === provider)}
              selectedWindowId={prefs.windows[provider]}
              storedWindows={prefs.windows}
              onSelectWindow={handleSelectWindow}
              history={history}
              historyBucket={historyBucket}
              now={now}
              hours={hours}
              burn={prefs.burn}
              view={prefs.view}
              forecastEnabled={prefs.forecast}
              onRelogin={onRelogin}
            />
          ))}
        </div>
      ) : (
        <Card className="mx-auto max-w-md text-center">
          <CardHeader className="flex-col items-center">
            <CardTitle>
              {activeProvider === "all"
                ? "No quota-tracked accounts yet"
                : `No quota metrics for ${pName(activeProvider)}`}
            </CardTitle>
            <CardDescription>
              {activeProvider === "all"
                ? "Add a Codex, Claude, or Antigravity login to monitor remaining quota and usage forecasts."
                : `${pName(activeProvider)} accounts do not report quota windows. Switch to All or add a Codex, Claude, or Antigravity login.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-2">
            {activeProvider !== "all" ? (
              <Button
                variant="outline"
                onClick={() =>
                  updatePrefs((prev) => ({ ...prev, provider: "all" }))
                }
              >
                Show all providers
              </Button>
            ) : null}
            <Button variant="default" onClick={() => onAddLogin()}>
              <PlusIcon className="size-4" aria-hidden="true" />
              Add login
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
