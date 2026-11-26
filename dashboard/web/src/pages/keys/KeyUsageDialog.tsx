import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { Icon } from "../../components/BrandSprite";
import { MorphText } from "../../components/MorphText";
import { api } from "../../lib/api";
import { fmtTokens, KEY_USAGE_RANGES, MODEL_COLORS } from "../../lib/format";
import type {
  ClientKey,
  KeyOptions,
  KeyUsageBucket,
  KeyUsageResponse,
} from "../../lib/types";
import { KeyUsageChart, type ModelSeries } from "./KeyUsageChart";

interface BreakdownRow {
  id: string;
  tokens: number;
  requests: number;
  failed: number;
  swatch?: string;
}

function keyTotals(
  buckets: KeyUsageBucket[],
  field: "model" | "account",
): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const b of buckets) {
    const id = b[field] || "";
    const row = map.get(id) || { id, tokens: 0, requests: 0, failed: 0 };
    row.tokens += b.tokens;
    row.requests += b.requests;
    row.failed += b.failed;
    map.set(id, row);
  }
  return [...map.values()].sort(
    (a, b) => b.tokens - a.tokens || b.requests - a.requests,
  );
}

function BreakdownSection({
  title,
  rows,
  labelFor,
  rangeLabel,
}: {
  title: string;
  rows: BreakdownRow[];
  labelFor: (row: BreakdownRow) => string;
  rangeLabel: string;
}) {
  const total = rows.reduce((s, r) => s + r.tokens, 0);
  return (
    <div>
      <div className="breakdown-head">
        <span className="breakdown-title">{title}</span>
      </div>
      <div className="mini-accounts">
        {rows.length ? (
          rows.map((r) => {
            const lbl = labelFor(r);
            return (
              <div className="key-share" key={r.id || lbl}>
                <span className="mini-label" title={lbl}>
                  {r.swatch && (
                    <i
                      className="mini-swatch"
                      style={{ background: r.swatch }}
                    />
                  )}
                  {lbl}
                </span>
                <div className="meter">
                  <span
                    style={{
                      transform: `scaleX(${total ? r.tokens / total : 0})`,
                    }}
                  />
                </div>
                <span className="mini-value">{fmtTokens(r.tokens)}</span>
                <span className="key-requests">
                  {r.requests.toLocaleString()} req
                  {r.failed ? ` · ${r.failed} failed` : ""}
                </span>
              </div>
            );
          })
        ) : (
          <p className="key-empty">No requests in the {rangeLabel}.</p>
        )}
      </div>
    </div>
  );
}

export function KeyUsageDialog({
  clientKey,
  options,
  refreshSeq,
  onClose,
}: {
  clientKey: ClientKey | null;
  options: KeyOptions | null;
  refreshSeq: number;
  onClose: () => void;
}) {
  const [hours, setHours] = useState(168);
  const [unit, setUnit] = useState<"hour" | "day">("hour");
  const [buckets, setBuckets] = useState<KeyUsageBucket[] | null>(null);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const hourlyAllowed = hours <= 336;
  const effectiveUnit: "hour" | "day" = hourlyAllowed ? unit : "day";

  useEffect(() => {
    if (!clientKey) {
      setBuckets(null);
      setError("");
      return;
    }
    let active = true;
    setError("");
    api<KeyUsageResponse>(
      `keys/usage?hours=${encodeURIComponent(hours)}&key=${encodeURIComponent(clientKey.id)}`,
    )
      .then((r) => {
        if (!active) return;
        setBuckets(r.buckets || []);
        setError("");
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Couldn't load usage.");
      });
    return () => {
      active = false;
    };
  }, [clientKey?.id, hours, refreshSeq]);

  const accountLabelFor = (id: string) => {
    if (!id) return "Unknown account";
    return options?.accounts.find((a) => a.id === id)?.label || id;
  };

  const rangeLabel =
    KEY_USAGE_RANGES[hours] || `last ${Math.round(hours / 24)} days`;

  const derived = useMemo(() => {
    if (!buckets) return null;
    const byModel = keyTotals(buckets, "model");
    const named = byModel.slice(
      0,
      byModel.length > MODEL_COLORS.length
        ? MODEL_COLORS.length - 1
        : MODEL_COLORS.length,
    );
    const models: ModelSeries[] = named.map((r, i) => ({
      id: r.id,
      name: r.id || "Unknown model",
      color: MODEL_COLORS[i],
    }));
    if (byModel.length > named.length) {
      models.push({
        id: null,
        name: "Other models",
        color: "var(--muted-foreground)",
      });
    }
    byModel.forEach((r, i) => {
      r.swatch = (models[i] || models[models.length - 1]).color;
    });
    const total = byModel.reduce(
      (s, r) => ({
        tokens: s.tokens + r.tokens,
        requests: s.requests + r.requests,
        failed: s.failed + r.failed,
      }),
      { tokens: 0, requests: 0, failed: 0 },
    );
    const cache = buckets.reduce((s, b) => s + b.cache_read_tokens, 0);
    const byAccount = keyTotals(buckets, "account");
    return { byModel, byAccount, models, total, cache };
  }, [buckets]);

  return (
    <Dialog
      open={Boolean(clientKey)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent
        id="key-usage-dialog"
        className="ui-modal usage-dialog"
        initialFocus={() => closeRef.current}
      >
        <header className="dialog-header usage-dialog-head">
          <div className="usage-dialog-title-wrap">
            <DialogTitle id="key-usage-title">
              {clientKey?.name || "Key usage"}
            </DialogTitle>
            <code className="key-hint" id="key-usage-hint">
              {clientKey ? `cpk_…${clientKey.hint}` : ""}
            </code>
          </div>
          <DialogClose
            ref={closeRef}
            className="ghost icon-btn sm"
            id="key-usage-close"
            aria-label="Close usage"
          >
            <Icon name="close" />
          </DialogClose>
        </header>

        <div className="dialog-body">
          <div className="usage-dialog-controls">
            <label className="forecast-control">
              Range{" "}
              <select
                id="key-usage-range"
                aria-label="Usage time range"
                value={String(hours)}
                onChange={(e) => {
                  const nextHours = Number(e.target.value) || 168;
                  setHours(nextHours);
                  if (nextHours > 336) setUnit("day");
                  setError("");
                }}
              >
                <option value="24">Last 24 hours</option>
                <option value="168">Last 7 days</option>
                <option value="336">Last 14 days</option>
                <option value="720">Last 30 days</option>
                <option value="2160">Last 90 days</option>
              </select>
            </label>

            <SegmentedControl
              className="segmented"
              id="key-usage-unit"
              aria-label="Chart interval"
              value={effectiveUnit}
              onValueChange={(next) => {
                if (next === "hour" || next === "day") setUnit(next);
              }}
            >
              <SegmentedControlIndicator />
              <SegmentedControlItem value="hour" data-value="hour" disabled={!hourlyAllowed}>
                Hourly
              </SegmentedControlItem>
              <SegmentedControlItem value="day" data-value="day">Daily</SegmentedControlItem>
            </SegmentedControl>
          </div>

          <div id="key-usage-body">
            {error && !buckets ? (
              <div className="notice error">
                <Icon name="warning" />
                <span>{error}</span>
              </div>
            ) : !derived || !clientKey ? (
              <div className="logs-loading">
                <span className="loading-mark" />
                Loading usage…
              </div>
            ) : (
              <>
                <dl className="metrics">
                  <div className="metric">
                    <dt>Tokens, {rangeLabel}</dt>
                    <dd>
                      <MorphText text={derived.total.tokens.toLocaleString()} />
                    </dd>
                  </div>
                  <div className="metric">
                    <dt>Weekly limit</dt>
                    <dd>
                      <MorphText
                        text={
                          clientKey.weekly_token_limit
                            ? clientKey.weekly_token_limit.toLocaleString()
                            : "No limit"
                        }
                      />
                    </dd>
                  </div>
                  <div className="metric">
                    <dt>Requests</dt>
                    <dd>
                      <MorphText
                        text={`${derived.total.requests.toLocaleString()}${derived.total.failed ? ` · ${derived.total.failed} failed` : ""}`}
                      />
                    </dd>
                  </div>
                  <div className="metric">
                    <dt>Cache reads</dt>
                    <dd>
                      <MorphText text={derived.cache.toLocaleString()} />
                    </dd>
                  </div>
                </dl>

                <KeyUsageChart
                  buckets={buckets!}
                  models={derived.models}
                  hours={hours}
                  unit={effectiveUnit}
                />

                <div className="breakdown key-breakdowns">
                  <BreakdownSection
                    title="By model"
                    rows={derived.byModel}
                    labelFor={(r) => r.id || "Unknown model"}
                    rangeLabel={rangeLabel}
                  />
                  <BreakdownSection
                    title="By account"
                    rows={derived.byAccount}
                    labelFor={(r) => accountLabelFor(r.id)}
                    rangeLabel={rangeLabel}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
