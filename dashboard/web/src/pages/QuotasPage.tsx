import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { Icon, ProviderIcon } from "../components/BrandSprite";
import { MorphText } from "../components/MorphText";
import { ProviderTabs, type ProviderTabOption } from "../components/ProviderTabs";
import {
  accountLabel,
  dateLabel,
  fmtPct,
  pName,
  planLabel,
  QUOTA_PROVIDERS,
  relative,
  status,
  statusReason,
} from "../lib/format";
import {
  accountWindow,
  allWindows,
  defaultWindowFor,
  drainFor,
  forecastPoints,
  MAX_WINDOW_TABS,
  windowName,
} from "../lib/quotaMath";
import type { Account, QuotaWindow, SnapshotData } from "../lib/types";
import { QuotaChart } from "./QuotaChart";

const RANGE_OPTIONS = [
  { hours: 24, label: "24h" },
  { hours: 168, label: "7d" },
  { hours: 336, label: "14d" },
  { hours: 720, label: "30d" },
  { hours: 2160, label: "90d" },
];

function WindowPicker({
  provider,
  list,
  metric,
  onSelect,
}: {
  provider: string;
  list: QuotaWindow[];
  metric: string;
  onSelect: (windowId: string) => void;
}) {
  if (list.length < 2) {
    return (
      <span className="pool-window">
        {list[0]?.label || "Quota unavailable"}
      </span>
    );
  }
  const current = list.find((w) => w.id === metric) || list[0];
  const groups = [
    ...new Set(list.map((w) => w.group).filter((g): g is string => Boolean(g))),
  ];

  if (groups.length > 1 && groups.length <= MAX_WINDOW_TABS) {
    const inGroup = list.filter((w) => w.group === current.group);
    const groupOptions = groups.map((g) => {
      const options = list.filter((w) => w.group === g);
      const match =
        options.find((w) => windowName(w) === windowName(current)) || options[0];
      return { id: match.id, group: g, text: g, title: g };
    });
    const activeGroup =
      list.find(
        (w) =>
          w.group === current.group && windowName(w) === windowName(current),
      )?.id || current.id;

    return (
      <div className="pool-pickers">
        <SegmentedControl
          className="segmented sm pool-windows"
          aria-label={`Model group for ${pName(provider)}`}
          value={activeGroup}
          onValueChange={(next) => {
            if (next) onSelect(next);
          }}
        >
          <SegmentedControlIndicator />
          {groupOptions.map((o) => (
            <SegmentedControlItem
              key={o.group}
              value={o.id}
              data-window={provider}
              data-window-group={o.group}
              data-window-id={o.id}
              title={o.title}
            >
              {o.text}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>

        {inGroup.length > 1 && (
          <SegmentedControl
            className="segmented sm pool-windows"
            aria-label={`Quota window for ${pName(provider)}`}
            value={current.id}
            onValueChange={(next) => {
              if (next) onSelect(next);
            }}
          >
            <SegmentedControlIndicator />
            {inGroup.map((w) => (
              <SegmentedControlItem
                key={w.id}
                value={w.id}
                data-window={provider}
                data-window-id={w.id}
                title={w.label}
              >
                {windowName(w)}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        )}
      </div>
    );
  }

  if (list.length <= MAX_WINDOW_TABS) {
    return (
      <SegmentedControl
        className="segmented sm pool-windows"
        aria-label={`Quota window for ${pName(provider)}`}
        value={current.id}
        onValueChange={(next) => {
          if (next) onSelect(next);
        }}
      >
        <SegmentedControlIndicator />
        {list.map((w) => (
          <SegmentedControlItem
            key={w.id}
            value={w.id}
            data-window={provider}
            data-window-id={w.id}
            title={w.label}
          >
            {windowName(w)}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    );
  }

  return (
    <>
      <label className="sr-only" htmlFor={`window-${provider}`}>
        Quota window for {pName(provider)}
      </label>
      <select
        id={`window-${provider}`}
        className="sm"
        data-window={provider}
        value={metric}
        onChange={(e) => onSelect(e.target.value)}
      >
        {list.map((w) => (
          <option key={w.id} value={w.id}>
            {w.label}
          </option>
        ))}
      </select>
    </>
  );
}

function AccountQuotaCard({
  provider,
  account,
  index,
  metric,
  list,
  data,
  view,
  hours,
  burn,
  showForecast,
}: {
  provider: string;
  account: Account;
  index: number;
  metric: string;
  list: QuotaWindow[];
  data: SnapshotData;
  view: "remaining" | "drain";
  hours: number;
  burn: number;
  showForecast: boolean;
}) {
  const items = accountWindow(account, metric);
  const w = items[0]?.w;
  const now = data.now;
  const label = accountLabel(account, index);
  const stale =
    Boolean(account.quota_error) ||
    !account.quota_at ||
    now - account.quota_at > 900 ||
    Boolean(w?.reset_at && w.reset_at <= now && account.quota_at < w.reset_at);
  const routing = status(account);
  const quotaCooldown =
    routing[0] === "Cooling down" &&
    account.cooldowns.every((c) =>
      ["credential_quota", "quota"].includes(c.reason),
    );
  const [tagLabel, tagTone] =
    w && !stale && (routing[0] === "Ready" || quotaCooldown)
      ? w.remaining > 0
        ? ["Quota available", "good"]
        : ["Limit reached", "warning"]
      : routing;

  if (!w) {
    const winMeta = list.find((item) => item.id === metric) || { label: "such" };
    return (
      <div className="account-pool" data-account={account.id}>
        <div className="account-pool-head">
          <span className="mini-name">
            <span className="mini-label" title={label}>
              {label}
            </span>
            <span className="mini-plan">{planLabel(account.plan)}</span>
          </span>
          <span className={`tag ${tagTone}`} title={statusReason(account, now)}>
            <MorphText text={tagLabel} />
          </span>
        </div>
        <p className="mini-none">
          {account.windows.length
            ? `No ${windowName(winMeta).toLowerCase()} limit on this plan`
            : "Quota not measured yet"}
        </p>
      </div>
    );
  }

  const rate = drainFor(data, account, metric, burn, now);
  const forecasts = forecastPoints(
    data,
    items,
    metric,
    burn,
    showForecast,
    now,
    now + hours * 0.7 * 3600,
  );
  const empty = forecasts.find((r) => r.value <= 0.01);

  return (
    <div className="account-pool" data-account={account.id}>
      <div className="account-pool-head">
        <span className="mini-name">
          <span className="mini-label" title={label}>
            {label}
          </span>
          <span className="mini-plan">{planLabel(account.plan)}</span>
        </span>
        <span className={`tag ${tagTone}`} title={statusReason(account, now)}>
          <MorphText text={tagLabel} />
        </span>
      </div>

      <div className="pool-total">
        <div>
          <div className="big-number">
            <MorphText text={fmtPct(w.remaining)} />
            <small>remaining</small>
          </div>
          {stale && <div className="capacity-note">Last known quota</div>}
        </div>
        <dl className="metrics">
          <div className="metric">
            <dt>Runs out</dt>
            <dd>
              <MorphText
                text={
                  empty
                    ? dateLabel(empty.ts)
                    : forecasts.length
                      ? "Beyond this view"
                      : "Collecting history"
                }
              />
            </dd>
          </div>
          <div className="metric">
            <dt>Next reset</dt>
            <dd title={dateLabel(w.reset_at)}>
              <MorphText
                text={
                  w.reset_at && w.reset_at > now
                    ? relative(w.reset_at)
                    : "Not reported"
                }
              />
            </dd>
          </div>
          <div className="metric">
            <dt>Burn, last {burn}h</dt>
            <dd>
              <MorphText text={rate !== null ? `${fmtPct(rate)}/h` : "—"} />
            </dd>
          </div>
        </dl>
      </div>

      {view === "remaining" ? (
        <QuotaChart
          chartKey={`${provider}-${index}`}
          label={label}
          data={data}
          items={items}
          metric={metric}
          hours={hours}
          burn={burn}
          showForecast={showForecast}
        />
      ) : (
        <div className="rate-card">
          <div className="big-number">
            <MorphText text={rate !== null ? fmtPct(rate) : "—"} />
            <small>/ hour</small>
          </div>
          <p>
            {rate !== null
              ? `Measured consumption over the last ${burn} hours. Quota reset increases are excluded.`
              : "Drain rate will appear after at least 10 minutes of samples. No usage rate is assumed before then."}
          </p>
        </div>
      )}
    </div>
  );
}

export function QuotasPage({
  data,
  provider,
  providerOptions,
  presentProviders,
  view,
  burn,
  hours,
  showForecast,
  windows,
  onProviderChange,
  onViewChange,
  onBurnChange,
  onHoursChange,
  onForecastChange,
  onWindowChange,
  onNavigateAccounts,
}: {
  data: SnapshotData;
  provider: string;
  providerOptions: ProviderTabOption[];
  presentProviders: string[];
  view: "remaining" | "drain";
  burn: number;
  hours: number;
  showForecast: boolean;
  windows: Record<string, string>;
  onProviderChange: (p: string) => void;
  onViewChange: (v: "remaining" | "drain") => void;
  onBurnChange: (b: number) => void;
  onHoursChange: (h: number) => void;
  onForecastChange: (show: boolean) => void;
  onWindowChange: (provider: string, windowId: string) => void;
  onNavigateAccounts: () => void;
}) {
  const restricted = data.accounts.filter((a) =>
    a.cooldowns.some((c) => c.reason === "model_not_supported"),
  );

  const visibleQuotaProviders = QUOTA_PROVIDERS.filter(
    (p) =>
      presentProviders.includes(p) && (provider === "all" || p === provider),
  );

  return (
    <>
      <ProviderTabs
        value={provider}
        options={providerOptions}
        onChange={onProviderChange}
      />

      <div className="controls">
        <SegmentedControl
          className="segmented"
          aria-label="Chart metric"
          value={view}
          onValueChange={(next) => {
            if (next === "remaining" || next === "drain") onViewChange(next);
          }}
        >
          <SegmentedControlIndicator />
          <SegmentedControlItem value="remaining" data-view="remaining">
            Remaining
          </SegmentedControlItem>
          <SegmentedControlItem value="drain" data-view="drain">
            Drain rate
          </SegmentedControlItem>
        </SegmentedControl>

        <div className="control-group burn-control">
          <span className="toolbar-label">Burn</span>
          <SegmentedControl
            className="segmented"
            aria-label="Burn rate lookback"
            value={String(burn)}
            onValueChange={(next) => {
              const n = Number(next);
              if (n) onBurnChange(n);
            }}
          >
            <SegmentedControlIndicator />
            {[1, 3, 6].map((h) => (
              <SegmentedControlItem
                key={h}
                value={String(h)}
                data-burn={String(h)}
              >
                {h}h
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>

        <label className="forecast-control">
          Future usage{" "}
          <select
            id="forecast"
            className="sm"
            value={showForecast ? "on" : "off"}
            onChange={(e) => onForecastChange(e.target.value === "on")}
          >
            <option value="on">Same as recent</option>
            <option value="off">Hide forecast</option>
          </select>
        </label>

        <div className="control-group range-group">
          <SegmentedControl
            className="segmented"
            aria-label="Chart time range"
            value={String(hours)}
            onValueChange={(next) => {
              const n = Number(next);
              if (n) onHoursChange(n);
            }}
          >
            <SegmentedControlIndicator />
            {RANGE_OPTIONS.map((opt) => (
              <SegmentedControlItem
                key={opt.hours}
                value={String(opt.hours)}
                data-hours={String(opt.hours)}
              >
                {opt.label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
      </div>

      {restricted.length > 0 && provider !== "antigravity" && (
        <div className="notice">
          <Icon name="warning" />
          <span>
            {restricted.length} Codex account
            {restricted.length === 1 ? " has" : "s have"} a model restriction.
            Available quota does not guarantee access to every model.
          </span>
          <button
            type="button"
            data-go="accounts"
            className="ghost sm"
            onClick={onNavigateAccounts}
          >
            View accounts
          </button>
        </div>
      )}

      {visibleQuotaProviders.map((p) => {
        const accounts = data.accounts.filter((a) => a.provider === p);
        if (!accounts.length) return null;
        const list = allWindows(accounts);
        const metric = defaultWindowFor(p, accounts, windows[p]) || "";
        return (
          <section className={`pool provider-${p}`} data-pool={p} key={p}>
            <div className="pool-top">
              <ProviderIcon provider={p} />
              <h2>{pName(p)}</h2>
              <span className="muted">
                {accounts.length} account{accounts.length === 1 ? "" : "s"}
              </span>
              <WindowPicker
                provider={p}
                list={list}
                metric={metric}
                onSelect={(winId) => onWindowChange(p, winId)}
              />
            </div>
            {accounts.map((a, i) => (
              <AccountQuotaCard
                key={a.id}
                provider={p}
                account={a}
                index={i}
                metric={metric}
                list={list}
                data={data}
                view={view}
                hours={hours}
                burn={burn}
                showForecast={showForecast}
              />
            ))}
          </section>
        );
      })}
    </>
  );
}
