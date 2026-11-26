import * as React from "react";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toggle,
  ToggleGroup,
} from "@/components/ui";
import { apiGet } from "@/lib/api";
import { fmtTokens, KEY_USAGE_RANGES, MODEL_COLORS } from "@/lib/format";
import type {
  ClientKey,
  ClientKeyOptions,
  ClientKeyUsageBucket,
  ClientKeyUsageResponse,
  HistoryHours,
} from "@/lib/types";
import {
  KeyUsageChart,
  type ChartModelSeries,
} from "@/pages/keys/KeyUsageChart";

export interface KeyUsageDialogProps {
  clientKey: ClientKey | null;
  options: ClientKeyOptions | null;
  refreshTick: number;
  onClose: () => void;
}

interface BreakdownRow {
  id: string;
  tokens: number;
  requests: number;
  failed: number;
  swatch?: string;
}

const USAGE_RANGE_ITEMS: { value: string; label: string; hours: HistoryHours }[] = [
  { value: "24", label: "Last 24 hours", hours: 24 },
  { value: "168", label: "Last 7 days", hours: 168 },
  { value: "336", label: "Last 14 days", hours: 336 },
  { value: "720", label: "Last 30 days", hours: 720 },
  { value: "2160", label: "Last 90 days", hours: 2160 },
];

function aggregateByField(
  buckets: ClientKeyUsageBucket[],
  field: "model" | "account",
): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const b of buckets) {
    const key = b[field] || "";
    const row = map.get(key) ?? { id: key, tokens: 0, requests: 0, failed: 0 };
    row.tokens += b.tokens;
    row.requests += b.requests;
    row.failed += b.failed;
    map.set(key, row);
  }
  return [...map.values()].sort(
    (a, b) => b.tokens - a.tokens || b.requests - a.requests,
  );
}

function BreakdownSection({
  title,
  rows,
  resolveLabel,
  rangeLabel,
}: {
  title: string;
  rows: BreakdownRow[];
  resolveLabel: (row: BreakdownRow) => string;
  rangeLabel: string;
}) {
  const totalTokens = rows.reduce((sum, r) => sum + r.tokens, 0);

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {rows.length > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
          </span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border/70 bg-background/40 px-3.5 py-3 text-xs text-muted-foreground">
          No requests in the {rangeLabel}.
        </p>
      ) : (
        <div className="divide-y divide-border/70 rounded-lg border border-border bg-background/40">
          {rows.map((row) => {
            const label = resolveLabel(row);
            const share = totalTokens > 0 ? Math.min(1, row.tokens / totalTokens) : 0;
            return (
              <div
                key={row.id || "__unknown__"}
                className="flex flex-col gap-1.5 px-3.5 py-2.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    {row.swatch ? (
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.swatch }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span
                      className="break-all text-sm font-medium text-foreground"
                      title={label}
                    >
                      {label}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-baseline gap-3 text-xs tabular-nums">
                    <span
                      className="font-medium text-foreground"
                      title={`${row.tokens.toLocaleString()} tokens`}
                    >
                      {fmtTokens(row.tokens)}
                    </span>
                    <span className="text-muted-foreground">
                      {row.requests.toLocaleString()} req
                      {row.failed > 0 ? (
                        <span className="text-destructive">
                          {" "}
                          · {row.failed.toLocaleString()} failed
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full transition-[width] duration-200 ease-out"
                    style={{
                      width: `${Math.max(share > 0 ? 1.5 : 0, share * 100)}%`,
                      backgroundColor: row.swatch ?? "var(--foreground)",
                      opacity: row.swatch ? 0.9 : 0.75,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function KeyUsageDialog({
  clientKey,
  options,
  refreshTick,
  onClose,
}: KeyUsageDialogProps) {
  const open = clientKey !== null;
  const [hours, setHours] = React.useState<HistoryHours>(168);
  const [unit, setUnit] = React.useState<"hour" | "day">("hour");
  const [buckets, setBuckets] = React.useState<ClientKeyUsageBucket[] | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const hourlyAllowed = hours <= 336;
  const effectiveUnit: "hour" | "day" = hourlyAllowed ? unit : "day";
  const rangeLabel =
    KEY_USAGE_RANGES[hours] ?? `last ${Math.round(hours / 24)} days`;

  const accountMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const acc of options?.accounts ?? []) {
      map.set(acc.id, acc.label || acc.id);
    }
    return map;
  }, [options]);

  const keyId = clientKey?.id ?? null;

  // Reset cached buckets when switching to a different key or changing range.
  React.useEffect(() => {
    if (!keyId) {
      setBuckets(null);
      setError(null);
      setLoading(false);
      return;
    }
    setBuckets(null);
    setError(null);
  }, [keyId, hours]);

  // Fetch usage buckets whenever key, range, or parent snapshot refresh tick changes.
  React.useEffect(() => {
    if (!keyId) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);

    void (async () => {
      try {
        const res = await apiGet<ClientKeyUsageResponse>(
          `keys/usage?hours=${encodeURIComponent(hours)}&key=${encodeURIComponent(keyId)}`,
          controller.signal,
        );
        if (!active || controller.signal.aborted) return;
        setBuckets(res.buckets ?? []);
        setError(null);
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        setError(
          err instanceof Error ? err.message : "Could not load key usage.",
        );
      } finally {
        if (active && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [keyId, hours, refreshTick]);

  const { byModel, byAccount, models, totals, cacheReads } =
    React.useMemo(() => {
      const list = buckets ?? [];
      const modelRows = aggregateByField(list, "model");
      const accountRows = aggregateByField(list, "account");

      const maxDirect =
        modelRows.length > MODEL_COLORS.length
          ? MODEL_COLORS.length - 1
          : MODEL_COLORS.length;
      const named = modelRows.slice(0, maxDirect);
      const series: ChartModelSeries[] = named.map((r, i) => ({
        id: r.id,
        name: r.id || "Unknown model",
        color: MODEL_COLORS[i],
      }));
      if (modelRows.length > named.length) {
        series.push({
          id: null,
          name: "Other models",
          color: "var(--muted-foreground)",
        });
      }

      const coloredModels: BreakdownRow[] = modelRows.map((r, i) => ({
        ...r,
        swatch: (series[i] ?? series[series.length - 1])?.color,
      }));

      const agg = modelRows.reduce(
        (acc, r) => ({
          tokens: acc.tokens + r.tokens,
          requests: acc.requests + r.requests,
          failed: acc.failed + r.failed,
        }),
        { tokens: 0, requests: 0, failed: 0 },
      );

      const cache = list.reduce((sum, b) => sum + b.cache_read_tokens, 0);

      return {
        byModel: coloredModels,
        byAccount: accountRows,
        models: series,
        totals: agg,
        cacheReads: cache,
      };
    }, [buckets]);

  function handleRangeChange(value: string | null) {
    if (!value) return;
    const match = USAGE_RANGE_ITEMS.find((item) => item.value === value);
    if (!match) return;
    setHours(match.hours);
    if (match.hours > 336) {
      setUnit("day");
    }
  }

  function handleUnitChange(values: ("hour" | "day")[]) {
    const next = values[0];
    if (!next) return;
    if (next === "hour" && !hourlyAllowed) return;
    setUnit(next);
  }

  const selectedRangeLabel =
    USAGE_RANGE_ITEMS.find((i) => i.hours === hours)?.label ?? "Last 7 days";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent
        initialFocus="content"
        className="w-[min(760px,calc(100vw-32px))] gap-5"
      >
        <DialogHeader className="pr-10">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <DialogTitle className="truncate">
              {clientKey?.name ?? "Key usage"}
            </DialogTitle>
            {clientKey ? (
              <code className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                cpk_…{clientKey.hint}
              </code>
            ) : null}
          </div>
        </DialogHeader>

        {/* Controls row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Range
            </span>
            <Select
              value={String(hours)}
              onValueChange={handleRangeChange}
              items={USAGE_RANGE_ITEMS.map(({ value, label }) => ({
                value,
                label,
              }))}
            >
              <SelectTrigger
                size="sm"
                aria-label="Usage time range"
                className="min-w-[148px]"
              >
                <SelectValue>{selectedRangeLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {USAGE_RANGE_ITEMS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    label={opt.label}
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ToggleGroup<"hour" | "day">
            value={[effectiveUnit]}
            deselectable={false}
            onValueChange={handleUnitChange}
            aria-label="Chart interval"
          >
            <Toggle
              variant="segmented"
              value="hour"
              disabled={!hourlyAllowed}
              title={
                hourlyAllowed
                  ? "Hourly buckets"
                  : "Hourly view is available for ranges up to 14 days"
              }
            >
              Hourly
            </Toggle>
            <Toggle variant="segmented" value="day">
              Daily
            </Toggle>
          </ToggleGroup>
        </div>

        {/* Body */}
        {error && !buckets ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : loading && !buckets ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            <span>Loading usage…</span>
          </div>
        ) : clientKey && buckets ? (
          <div className="flex flex-col gap-5">
            {error ? (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
              >
                <AlertTriangleIcon
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>{error}</span>
              </div>
            ) : null}

            {/* 4 Metric Stats */}
            <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-background/50 px-3.5 py-2.5">
                <dt className="text-xs text-muted-foreground">
                  Tokens, {rangeLabel}
                </dt>
                <dd className="mt-1 text-lg font-semibold tracking-tight tabular-nums text-foreground">
                  {totals.tokens.toLocaleString()}
                </dd>
              </div>

              <div className="rounded-lg border border-border bg-background/50 px-3.5 py-2.5">
                <dt className="text-xs text-muted-foreground">Weekly limit</dt>
                <dd className="mt-1 text-lg font-semibold tracking-tight tabular-nums text-foreground">
                  {clientKey.weekly_token_limit
                    ? clientKey.weekly_token_limit.toLocaleString()
                    : "No limit"}
                </dd>
              </div>

              <div className="rounded-lg border border-border bg-background/50 px-3.5 py-2.5">
                <dt className="text-xs text-muted-foreground">Requests</dt>
                <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-lg font-semibold tracking-tight tabular-nums text-foreground">
                  <span>{totals.requests.toLocaleString()}</span>
                  {totals.failed > 0 ? (
                    <span className="text-xs font-medium text-destructive">
                      · {totals.failed.toLocaleString()} failed
                    </span>
                  ) : null}
                </dd>
              </div>

              <div className="rounded-lg border border-border bg-background/50 px-3.5 py-2.5">
                <dt className="text-xs text-muted-foreground">Cache reads</dt>
                <dd className="mt-1 text-lg font-semibold tracking-tight tabular-nums text-foreground">
                  {cacheReads.toLocaleString()}
                </dd>
              </div>
            </dl>

            {/* Stacked SVG Bar Chart */}
            <KeyUsageChart
              buckets={buckets}
              models={models}
              hours={hours}
              unit={effectiveUnit}
            />

            {/* Single-column full-width breakdowns */}
            <div className="flex flex-col gap-5">
              <BreakdownSection
                title="By model"
                rows={byModel}
                resolveLabel={(r) => r.id || "Unknown model"}
                rangeLabel={rangeLabel}
              />
              <BreakdownSection
                title="By account"
                rows={byAccount}
                resolveLabel={(r) =>
                  r.id ? (accountMap.get(r.id) ?? r.id) : "Unknown account"
                }
                rangeLabel={rangeLabel}
              />
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
