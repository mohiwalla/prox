import * as React from "react";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  Card,
  CardContent,
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
import { pName } from "@/lib/format";
import type {
  Account,
  HistoryHours,
  HistorySample,
  QuotaWindow,
} from "@/lib/types";
import { AccountQuotaCard } from "./AccountQuotaCard";
import {
  MAX_WINDOW_TABS,
  allWindows,
  resolveSelectedWindow,
  windowName,
  type BurnHours,
  type QuotaMetricView,
} from "./model";

export interface ProviderQuotaSectionProps {
  provider: string;
  accounts: Account[];
  selectedWindowId: string | undefined;
  storedWindows: Record<string, string>;
  onSelectWindow: (provider: string, windowId: string) => void;
  history: HistorySample[];
  historyBucket: number;
  now: number;
  hours: HistoryHours;
  burn: BurnHours;
  view: QuotaMetricView;
  forecastEnabled: boolean;
  onRelogin: (account: Account) => void;
}

interface WindowPickerProps {
  provider: string;
  windows: QuotaWindow[];
  activeId: string | undefined;
  onSelect: (windowId: string) => void;
}

function WindowPicker({
  provider,
  windows,
  activeId,
  onSelect,
}: WindowPickerProps) {
  const providerTitle = pName(provider);

  if (windows.length < 2) {
    return (
      <span className="ml-auto max-w-[260px] truncate text-[13px] text-muted-foreground">
        {windows[0]?.label || "Quota unavailable"}
      </span>
    );
  }

  const current = windows.find((w) => w.id === activeId) ?? windows[0];
  const allGrouped = windows.every((w) => Boolean(w.group));
  const groups = [
    ...new Set(windows.map((w) => w.group).filter((g): g is string => Boolean(g))),
  ];

  // Grouped windows (e.g. Antigravity: Gemini / Claude & GPT each with 5-hour & weekly)
  if (allGrouped && groups.length > 1 && groups.length <= MAX_WINDOW_TABS) {
    const activeGroup = current.group ?? groups[0];
    const inGroup = windows.filter((w) => w.group === activeGroup);
    const currentShort = windowName(current);

    const handleGroupChange = (values: string[]) => {
      const nextGroup = values[0];
      if (!nextGroup) return;
      const options = windows.filter((w) => w.group === nextGroup);
      const match =
        options.find((w) => windowName(w) === currentShort) ?? options[0];
      if (match) onSelect(match.id);
    };

    return (
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <ToggleGroup
          value={[activeGroup]}
          deselectable={false}
          aria-label={`Model group for ${providerTitle}`}
          onValueChange={handleGroupChange}
        >
          {groups.map((group) => (
            <Toggle
              key={group}
              value={group}
              variant="segmented"
              title={group}
            >
              {group}
            </Toggle>
          ))}
        </ToggleGroup>

        {inGroup.length > 1 && inGroup.length <= MAX_WINDOW_TABS ? (
          <ToggleGroup
            value={[current.id]}
            deselectable={false}
            aria-label={`Quota window for ${providerTitle}`}
            onValueChange={(values) => {
              if (values[0]) onSelect(values[0]);
            }}
          >
            {inGroup.map((w) => (
              <Toggle
                key={w.id}
                value={w.id}
                variant="segmented"
                title={w.label}
              >
                {windowName(w)}
              </Toggle>
            ))}
          </ToggleGroup>
        ) : inGroup.length > MAX_WINDOW_TABS ? (
          <Select<string>
            value={current.id}
            itemToLabel={(id) =>
              inGroup.find((w) => w.id === id)?.label ?? id
            }
            onValueChange={(val) => {
              if (val) onSelect(val);
            }}
          >
            <SelectTrigger
              size="sm"
              className="max-w-[260px]"
              aria-label={`Quota window for ${providerTitle}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {inGroup.map((w) => (
                <SelectItem key={w.id} value={w.id} label={windowName(w)}>
                  {windowName(w)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    );
  }

  // Up to 4 flat windows render as segmented toggle tabs
  if (windows.length <= MAX_WINDOW_TABS) {
    return (
      <ToggleGroup
        value={[current.id]}
        deselectable={false}
        aria-label={`Quota window for ${providerTitle}`}
        className="ml-auto"
        onValueChange={(values) => {
          if (values[0]) onSelect(values[0]);
        }}
      >
        {windows.map((w) => (
          <Toggle
            key={w.id}
            value={w.id}
            variant="segmented"
            title={w.label}
          >
            {windowName(w)}
          </Toggle>
        ))}
      </ToggleGroup>
    );
  }

  // Long list of windows (e.g. Claude with many model-specific limits) uses Select
  return (
    <div className="ml-auto">
      <Select<string>
        value={current.id}
        itemToLabel={(id) => windows.find((w) => w.id === id)?.label ?? id}
        onValueChange={(val) => {
          if (val) onSelect(val);
        }}
      >
        <SelectTrigger
          size="sm"
          className="max-w-[260px]"
          aria-label={`Quota window for ${providerTitle}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {windows.map((w) => (
            <SelectItem key={w.id} value={w.id} label={w.label}>
              {w.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ProviderQuotaSection({
  provider,
  accounts,
  selectedWindowId,
  storedWindows,
  onSelectWindow,
  history,
  historyBucket,
  now,
  hours,
  burn,
  view,
  forecastEnabled,
  onRelogin,
}: ProviderQuotaSectionProps) {
  const windows = React.useMemo(() => allWindows(accounts), [accounts]);
  const activeMetric = React.useMemo(
    () =>
      selectedWindowId && windows.some((w) => w.id === selectedWindowId)
        ? selectedWindowId
        : resolveSelectedWindow(provider, windows, storedWindows),
    [provider, windows, selectedWindowId, storedWindows],
  );
  const selectedWindowMeta = React.useMemo(
    () => windows.find((w) => w.id === activeMetric),
    [windows, activeMetric],
  );

  return (
    <Card data-pool={provider}>
      <CardHeader className="gap-y-3 border-b border-border/80 pb-4">
        <div className="flex items-center gap-2.5">
          <ProviderIcon provider={provider} className="size-5" />
          <CardTitle>{pName(provider)}</CardTitle>
          <span className="text-sm tabular-nums text-muted-foreground">
            {accounts.length} account{accounts.length === 1 ? "" : "s"}
          </span>
        </div>

        <WindowPicker
          provider={provider}
          windows={windows}
          activeId={activeMetric}
          onSelect={(windowId) => onSelectWindow(provider, windowId)}
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-5 pt-4">
        {accounts.map((account, index) => (
          <AccountQuotaCard
            key={account.id}
            account={account}
            index={index}
            metric={activeMetric}
            selectedWindowMeta={selectedWindowMeta}
            history={history}
            historyBucket={historyBucket}
            now={now}
            hours={hours}
            burn={burn}
            view={view}
            forecastEnabled={forecastEnabled}
            onRelogin={onRelogin}
          />
        ))}
      </CardContent>
    </Card>
  );
}
