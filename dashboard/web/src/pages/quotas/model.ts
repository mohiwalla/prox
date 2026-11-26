import {
  PROVIDERS,
  QUOTA_PROVIDERS,
  accountStatus,
  pName,
  planLabel,
  type AccountStatusTone,
} from "@/lib/format";
import type {
  Account,
  HistoryHours,
  HistorySample,
  QuotaProviderId,
  QuotaWindow,
} from "@/lib/types";

export type QuotaMetricView = "remaining" | "drain";
export type BurnHours = 1 | 3 | 6;

export interface QuotaPrefs {
  provider: string;
  view: QuotaMetricView;
  burn: BurnHours;
  forecast: boolean;
  windows: Record<string, string>;
}

export interface ChartPoint {
  ts: number;
  value: number;
  projected?: boolean;
}

export const PREFS_KEY = "prox:prefs";
export const MAX_WINDOW_TABS = 4;

export const BURN_OPTIONS: readonly { value: BurnHours; label: string }[] = [
  { value: 1, label: "1h" },
  { value: 3, label: "3h" },
  { value: 6, label: "6h" },
] as const;

export const RANGE_SHORT_OPTIONS: readonly {
  value: HistoryHours;
  label: string;
  title: string;
}[] = [
  { value: 24, label: "24h", title: "Last 24 hours" },
  { value: 168, label: "7d", title: "Last 7 days" },
  { value: 336, label: "14d", title: "Last 14 days" },
  { value: 720, label: "30d", title: "Last 30 days" },
  { value: 2160, label: "90d", title: "Last 90 days" },
] as const;

const DEFAULT_PREFS: QuotaPrefs = {
  provider: "all",
  view: "remaining",
  burn: 3,
  forecast: true,
  windows: {},
};

const VALID_VIEWS: readonly QuotaMetricView[] = ["remaining", "drain"];
const VALID_BURNS: readonly BurnHours[] = [1, 3, 6];

export function readQuotaPrefs(): QuotaPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS, windows: {} };
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const provider =
      typeof saved.provider === "string" &&
      (saved.provider === "all" || saved.provider in PROVIDERS)
        ? saved.provider
        : DEFAULT_PREFS.provider;
    const view = VALID_VIEWS.includes(saved.view as QuotaMetricView)
      ? (saved.view as QuotaMetricView)
      : DEFAULT_PREFS.view;
    const burn = VALID_BURNS.includes(saved.burn as BurnHours)
      ? (saved.burn as BurnHours)
      : DEFAULT_PREFS.burn;
    const forecast =
      typeof saved.forecast === "boolean"
        ? saved.forecast
        : DEFAULT_PREFS.forecast;
    const windows: Record<string, string> = {};
    if (saved.windows && typeof saved.windows === "object") {
      for (const [k, v] of Object.entries(
        saved.windows as Record<string, unknown>,
      )) {
        if (typeof v === "string") windows[k] = v;
      }
    }
    return { provider, view, burn, forecast, windows };
  } catch {
    return { ...DEFAULT_PREFS, windows: {} };
  }
}

export function writeQuotaPrefs(prefs: QuotaPrefs): void {
  try {
    const current = JSON.parse(
      localStorage.getItem(PREFS_KEY) || "{}",
    ) as Record<string, unknown>;
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        ...current,
        provider: prefs.provider,
        view: prefs.view,
        burn: prefs.burn,
        forecast: prefs.forecast,
        windows: prefs.windows,
      }),
    );
  } catch {
    // Ignore storage write errors.
  }
}

export function presentProviders(accounts: Account[]): string[] {
  const seen = new Set(accounts.map((a) => a.provider));
  const ordered = Object.keys(PROVIDERS).filter((p) => seen.has(p));
  for (const p of seen) {
    if (!ordered.includes(p)) ordered.push(p);
  }
  return ordered;
}

export function isQuotaProvider(provider: string): provider is QuotaProviderId {
  return (QUOTA_PROVIDERS as readonly string[]).includes(provider);
}

export function allWindows(accounts: Account[]): QuotaWindow[] {
  const map = new Map<string, QuotaWindow>();
  for (const account of accounts) {
    for (const w of account.windows) {
      if (!map.has(w.id)) {
        map.set(w.id, { ...w });
      }
    }
  }
  const values = [...map.values()];
  // Shortest window first within each group, preserving group appearance order.
  const groups = [...new Set(values.map((w) => w.group ?? ""))];
  return values.sort(
    (a, b) =>
      groups.indexOf(a.group ?? "") - groups.indexOf(b.group ?? "") ||
      (a.period ?? Infinity) - (b.period ?? Infinity),
  );
}

export function windowName(w: Pick<QuotaWindow, "label" | "group">): string {
  const base = w.group ? w.label.replace(`${w.group} · `, "") : w.label;
  return base.replace(/ limit$/i, "");
}

export function resolveSelectedWindow(
  provider: string,
  windows: QuotaWindow[],
  storedWindows: Record<string, string>,
): string | undefined {
  if (!windows.length) return undefined;
  const stored = storedWindows[provider];
  if (stored && windows.some((w) => w.id === stored)) {
    return stored;
  }
  if (provider === "codex") {
    return windows.find((w) => w.id === "rate_limit:5h")?.id ?? windows[0].id;
  }
  if (provider === "claude") {
    return windows.find((w) => w.id === "five_hour")?.id ?? windows[0].id;
  }
  return (
    windows.find(
      (w) => /gemini/i.test(w.group ?? "") && w.period === 5 * 3600,
    )?.id ?? windows[0].id
  );
}

const PLAN_LABELS: Record<string, string> = {
  prolite: "Pro 100",
  pro: "Pro 200",
  go: "Go",
  plus: "Plus",
  free: "Free",
  team: "Team",
  enterprise: "Enterprise",
};

export function planDisplayLabel(plan: string | null | undefined): string {
  if (!plan || plan.toLowerCase() === "unknown") return "";
  return PLAN_LABELS[plan.toLowerCase()] ?? planLabel(plan);
}

export function accountSubtitle(account: Account): string {
  const parts = [planDisplayLabel(account.plan), pName(account.provider)];
  return parts
    .filter((v, idx, arr) => Boolean(v) && arr.indexOf(v) === idx)
    .join(" · ");
}

export function isWindowStale(
  account: Account,
  window: QuotaWindow | undefined,
  now: number,
): boolean {
  if (account.quota_error || !account.quota_at) return true;
  if (now - account.quota_at > 900) return true;
  if (
    window?.reset_at &&
    window.reset_at <= now &&
    account.quota_at < window.reset_at
  ) {
    return true;
  }
  return false;
}

export function accountQuotaBadge(
  account: Account,
  window: QuotaWindow | undefined,
  now: number,
): { label: string; tone: AccountStatusTone; stale: boolean } {
  const stale = isWindowStale(account, window, now);
  const routing = accountStatus(account);
  const quotaCooldown =
    routing.label === "Cooling down" &&
    account.cooldowns.length > 0 &&
    account.cooldowns.every(
      (c) => c.reason === "credential_quota" || c.reason === "quota",
    );

  if (window && !stale && (routing.label === "Ready" || quotaCooldown)) {
    return window.remaining > 0
      ? { label: "Quota available", tone: "success", stale }
      : { label: "Limit reached", tone: "warning", stale };
  }
  return { ...routing, stale };
}

export function drainFor(
  account: Account,
  metric: string,
  history: HistorySample[],
  historyBucket: number,
  burnHours: BurnHours,
  now: number,
): number | null {
  const gap = Math.max(900, 2.5 * (historyBucket || 0));
  const cutoff = now - burnHours * 3600;
  const rows = history
    .filter(
      (r) =>
        r.account === account.id &&
        r.metric === metric &&
        r.ts >= cutoff &&
        r.ts <= now,
    )
    .sort((a, b) => a.ts - b.ts);

  if (
    rows.length < 2 ||
    rows[rows.length - 1].ts - rows[0].ts < 600 ||
    now - rows[rows.length - 1].ts > 900
  ) {
    return null;
  }

  let consumed = 0;
  let seconds = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const next = rows[i];
    if (
      next.ts - prev.ts > gap ||
      next.remaining > prev.remaining + 0.5 ||
      (prev.reset_at && prev.reset_at > prev.ts && prev.reset_at <= next.ts)
    ) {
      continue;
    }
    consumed += Math.max(0, prev.remaining - next.remaining);
    seconds += next.ts - prev.ts;
  }
  return seconds >= 600 ? (consumed / seconds) * 3600 : null;
}

export function accountHistoryPoints(
  account: Account,
  window: QuotaWindow,
  metric: string,
  history: HistorySample[],
  start: number,
  now: number,
): ChartPoint[] {
  const rows = history
    .filter(
      (r) =>
        r.account === account.id && r.metric === metric && r.ts >= start,
    )
    .sort((a, b) => a.ts - b.ts);

  const points: ChartPoint[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (rows[i + 1]?.ts === r.ts) continue;
    points.push({ ts: r.ts, value: r.remaining });
  }

  const actualAt = account.quota_at || now;
  if (actualAt >= start && !account.quota_error) {
    const latest: ChartPoint = { ts: actualAt, value: window.remaining };
    const last = points[points.length - 1];
    if (!last || Math.abs(last.ts - latest.ts) > 1) {
      points.push(latest);
    }
  }
  return points;
}

export function accountForecastPoints(
  account: Account,
  window: QuotaWindow,
  rate: number | null,
  forecastEnabled: boolean,
  now: number,
  end: number,
): ChartPoint[] {
  if (
    !forecastEnabled ||
    rate === null ||
    account.quota_error ||
    !account.quota_at ||
    now - account.quota_at > 900 ||
    (window.reset_at &&
      window.reset_at <= now &&
      account.quota_at < window.reset_at)
  ) {
    return [];
  }

  const times = new Set<number>([now, end]);
  const step = (end - now) / 100;
  if (step > 0) {
    for (let t = now; t < end; t += step) {
      times.add(t);
    }
  }
  if (window.reset_at && window.reset_at > now && window.reset_at < end) {
    times.add(window.reset_at - 0.01);
    times.add(window.reset_at);
  }

  return [...times]
    .sort((a, b) => a - b)
    .map((ts) => {
      let last = now;
      let remaining = window.remaining;
      if (window.reset_at && ts >= window.reset_at && window.reset_at > now) {
        last = window.reset_at;
        remaining = 100;
      }
      return {
        ts,
        value: Math.max(0, remaining - (rate * (ts - last)) / 3600),
        projected: true,
      };
    });
}

// Monotone cubic Hermite spline (d3 curveMonotoneX): passes through every
// sample without overshooting between them.
export function monotonePath(
  arr: ChartPoint[],
  xScale: (ts: number) => number,
  yScale: (v: number) => number,
): string {
  const n = arr.length;
  if (n === 0) return "";
  const p = arr.map((r) => [xScale(r.ts), yScale(r.value)] as const);
  const f = (v: number) => v.toFixed(2);
  if (n < 3) {
    return p
      .map(([px, py], i) => `${i ? "L" : "M"}${f(px)},${f(py)}`)
      .join(" ");
  }

  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const dx = p[i + 1][0] - p[i][0];
    d.push(dx ? (p[i + 1][1] - p[i][1]) / dx : 0);
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (!d[i]) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }

  let out = `M${f(p[0][0])},${f(p[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (p[i + 1][0] - p[i][0]) / 3;
    out += ` C${f(p[i][0] + dx)},${f(p[i][1] + m[i] * dx)} ${f(p[i + 1][0] - dx)},${f(p[i + 1][1] - m[i + 1] * dx)} ${f(p[i + 1][0])},${f(p[i + 1][1])}`;
  }
  return out;
}

export function seriesAt(
  points: ChartPoint[],
  forecast: ChartPoint[],
  rawTs: number,
): ChartPoint | null {
  if (!points.length && !forecast.length) return null;
  const first = (points[0] ?? forecast[0]).ts;
  const last = (forecast[forecast.length - 1] ?? points[points.length - 1]).ts;
  const ts = Math.min(last, Math.max(first, rawTs));

  if (forecast.length && ts >= forecast[0].ts) {
    if (forecast.length === 1) {
      return { ...forecast[0], projected: true };
    }
    const found = forecast.findIndex((p) => p.ts >= ts);
    const i = found <= 0 ? (found === -1 ? forecast.length - 1 : 1) : found;
    const a = forecast[i - 1];
    const b = forecast[i];
    const k = (ts - a.ts) / (b.ts - a.ts || 1);
    return {
      ts,
      value: a.value + (b.value - a.value) * k,
      projected: true,
    };
  }

  if (!points.length) return null;
  let nearest = points[0];
  let bestDist = Math.abs(nearest.ts - ts);
  for (let i = 1; i < points.length; i++) {
    const dist = Math.abs(points[i].ts - ts);
    if (dist < bestDist) {
      bestDist = dist;
      nearest = points[i];
    }
  }
  return { ...nearest, projected: false };
}
