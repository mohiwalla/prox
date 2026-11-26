import * as React from "react";
import { Badge, Button, type BadgeVariant } from "@/components/ui";
import {
  accountLabel,
  accountStatusReason,
  dateLabel,
  fmtPct,
  providerColor,
  relative,
  type AccountStatusTone,
} from "@/lib/format";
import type {
  Account,
  HistoryHours,
  HistorySample,
  QuotaWindow,
} from "@/lib/types";
import { QuotaChart } from "./QuotaChart";
import {
  accountForecastPoints,
  accountHistoryPoints,
  accountQuotaBadge,
  accountSubtitle,
  drainFor,
  windowName,
  type BurnHours,
  type QuotaMetricView,
} from "./model";

export interface AccountQuotaCardProps {
  account: Account;
  index: number;
  metric: string | undefined;
  selectedWindowMeta: QuotaWindow | undefined;
  history: HistorySample[];
  historyBucket: number;
  now: number;
  hours: HistoryHours;
  burn: BurnHours;
  view: QuotaMetricView;
  forecastEnabled: boolean;
  onRelogin: (account: Account) => void;
}

function toneToBadgeVariant(tone: AccountStatusTone): BadgeVariant {
  switch (tone) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "destructive":
      return "destructive";
    case "neutral":
    default:
      return "secondary";
  }
}

export function AccountQuotaCard({
  account,
  index,
  metric,
  selectedWindowMeta,
  history,
  historyBucket,
  now,
  hours,
  burn,
  view,
  forecastEnabled,
  onRelogin,
}: AccountQuotaCardProps) {
  const label = accountLabel(account, index);
  const subtitle = accountSubtitle(account);
  const color = providerColor(account.provider);
  const win = metric
    ? account.windows.find((w) => w.id === metric)
    : undefined;

  const badge = accountQuotaBadge(account, win, now);
  const reason = accountStatusReason(account, now);

  const rangeSeconds = hours * 3600;
  const start = now - rangeSeconds * (forecastEnabled ? 0.3 : 1);
  const end = forecastEnabled ? now + rangeSeconds * 0.7 : now;

  const rate = React.useMemo(
    () =>
      win && metric
        ? drainFor(account, metric, history, historyBucket, burn, now)
        : null,
    [account, win, metric, history, historyBucket, burn, now],
  );

  const points = React.useMemo(
    () =>
      win && metric
        ? accountHistoryPoints(account, win, metric, history, start, now)
        : [],
    [account, win, metric, history, start, now],
  );

  const forecast = React.useMemo(
    () =>
      win
        ? accountForecastPoints(
            account,
            win,
            rate,
            forecastEnabled,
            now,
            end,
          )
        : [],
    [account, win, rate, forecastEnabled, now, end],
  );

  const emptyPoint = React.useMemo(
    () => forecast.find((p) => p.value <= 0.01),
    [forecast],
  );

  const runsOutText = !forecastEnabled
    ? "Forecast hidden"
    : emptyPoint
      ? dateLabel(emptyPoint.ts)
      : forecast.length
        ? "Beyond this view"
        : "Collecting history";

  const nextResetText =
    win?.reset_at && win.reset_at > now
      ? relative(win.reset_at)
      : "Not reported";

  return (
    <div
      data-account={account.id}
      className="border-t border-border pt-4 first:border-t-0 first:pt-0"
    >
      {/* Account header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span
            className="truncate text-sm font-medium leading-5 text-foreground"
            title={label}
          >
            {label}
          </span>
          {subtitle ? (
            <span className="truncate text-xs leading-4 text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {account.requires_sign_in ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRelogin(account)}
            >
              Sign in again
            </Button>
          ) : null}
          <Badge variant={toneToBadgeVariant(badge.tone)} title={reason}>
            {badge.label}
          </Badge>
        </div>
      </div>

      {/* Missing window message */}
      {!win ? (
        <p className="mt-2.5 text-sm text-muted-foreground">
          {account.windows.length
            ? `No ${windowName(selectedWindowMeta ?? { label: "such" }).toLowerCase()} limit on this plan`
            : "Quota not measured yet"}
        </p>
      ) : (
        <>
          {/* Headline number + key metrics */}
          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <div className="text-4xl font-semibold leading-10 tracking-tight tabular-nums text-foreground">
                {fmtPct(win.remaining)}
                <small className="ml-2 text-sm font-normal tracking-normal text-muted-foreground">
                  remaining
                </small>
              </div>
              {badge.stale ? (
                <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
                  Last known quota
                </div>
              ) : null}
            </div>

            <dl className="m-0 flex flex-wrap gap-x-8 gap-y-3">
              <div className="min-w-[112px]">
                <dt className="mb-1 text-xs leading-4 text-muted-foreground">
                  Runs out
                </dt>
                <dd className="m-0 text-sm font-medium leading-5 tabular-nums text-foreground">
                  {runsOutText}
                </dd>
              </div>
              <div className="min-w-[112px]">
                <dt className="mb-1 text-xs leading-4 text-muted-foreground">
                  Next reset
                </dt>
                <dd
                  className="m-0 text-sm font-medium leading-5 tabular-nums text-foreground"
                  title={dateLabel(win.reset_at)}
                >
                  {nextResetText}
                </dd>
              </div>
              <div className="min-w-[112px]">
                <dt className="mb-1 text-xs leading-4 text-muted-foreground">
                  Burn, last {burn}h
                </dt>
                <dd className="m-0 text-sm font-medium leading-5 tabular-nums text-foreground">
                  {rate !== null ? `${fmtPct(rate)}/h` : "—"}
                </dd>
              </div>
            </dl>
          </div>

          {/* Remaining chart or Drain rate view */}
          {view === "remaining" ? (
            <QuotaChart
              label={label}
              color={color}
              points={points}
              forecast={forecast}
              resetAt={win.reset_at}
              now={now}
              start={start}
              end={end}
              hours={hours}
              forecastEnabled={forecastEnabled}
            />
          ) : (
            <div className="mt-4 mb-2 rounded-lg border border-border/60 bg-background/40 px-4 py-11 text-center">
              <div className="text-4xl font-semibold leading-10 tracking-tight tabular-nums text-foreground">
                {rate !== null ? fmtPct(rate) : "—"}
                <small className="ml-2 text-sm font-normal tracking-normal text-muted-foreground">
                  / hour
                </small>
              </div>
              <p className="mx-auto mt-2 max-w-[420px] text-sm leading-5 text-muted-foreground">
                {rate !== null
                  ? `Measured consumption over the last ${burn} hour${burn === 1 ? "" : "s"}. Quota reset increases are excluded.`
                  : "Drain rate will appear after at least 10 minutes of samples. No usage rate is assumed before then."}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
