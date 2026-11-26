import type { Account, HistoryRow, QuotaWindow, SnapshotData } from "./types";

export const MAX_WINDOW_TABS = 4;

export interface ChartPoint {
  ts: number;
  value: number;
  projected?: boolean;
}

export interface AccountWindowItem {
  a: Account;
  w: QuotaWindow;
}

export function allWindows(accounts: Account[]): QuotaWindow[] {
  const map = new Map<string, QuotaWindow>();
  accounts.forEach((a) =>
    a.windows.forEach((w) => {
      if (!map.has(w.id)) map.set(w.id, { ...w });
    }),
  );
  const groups = [...new Set([...map.values()].map((w) => w.group))];
  return [...map.values()].sort(
    (a, b) =>
      groups.indexOf(a.group) - groups.indexOf(b.group) ||
      (a.period ?? Infinity) - (b.period ?? Infinity),
  );
}

export function windowName(w: Pick<QuotaWindow, "group" | "label">): string {
  return (w.group ? w.label.replace(`${w.group} · `, "") : w.label).replace(
    / limit$/i,
    "",
  );
}

export function defaultWindowFor(
  provider: string,
  accounts: Account[],
  saved?: string,
): string | undefined {
  const list = allWindows(accounts);
  if (saved && list.some((w) => w.id === saved)) return saved;
  if (provider === "codex")
    return list.find((w) => w.id === "rate_limit:5h")?.id || list[0]?.id;
  if (provider === "claude")
    return list.find((w) => w.id === "five_hour")?.id || list[0]?.id;
  return (
    list.find((w) => /gemini/i.test(w.group || "") && w.period === 5 * 3600)
      ?.id || list[0]?.id
  );
}

export function accountWindow(a: Account, metric: string): AccountWindowItem[] {
  const w = a.windows.find((win) => win.id === metric);
  return w ? [{ a, w }] : [];
}

export function drainFor(
  data: SnapshotData,
  a: Account,
  metric: string,
  burnHours: number,
  now = data.now,
): number | null {
  const gap = Math.max(900, 2.5 * (data.history_bucket || 0));
  const rows = data.history
    .filter(
      (r) =>
        r.account === a.id &&
        r.metric === metric &&
        r.ts >= now - burnHours * 3600 &&
        r.ts <= now,
    )
    .sort((x, y) => x.ts - y.ts);
  if (
    rows.length < 2 ||
    rows[rows.length - 1].ts - rows[0].ts < 600 ||
    now - rows[rows.length - 1].ts > 900
  )
    return null;
  let consumed = 0;
  let seconds = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const next = rows[i];
    if (
      next.ts - prev.ts > gap ||
      next.remaining > prev.remaining + 0.5 ||
      (prev.reset_at && prev.reset_at > prev.ts && prev.reset_at <= next.ts)
    )
      continue;
    consumed += Math.max(0, prev.remaining - next.remaining);
    seconds += next.ts - prev.ts;
  }
  return seconds >= 600 ? (consumed / seconds) * 3600 : null;
}

export function historyPoints(
  data: SnapshotData,
  accounts: Account[],
  metric: string,
): ChartPoint[] {
  const ids = new Set(accounts.map((a) => a.id));
  const gap = Math.max(900, 2.5 * (data.history_bucket || 0));
  const latest = new Map<string, HistoryRow>();
  const out: ChartPoint[] = [];
  const rows = data.history
    .filter((r) => ids.has(r.account) && r.metric === metric)
    .sort((a, b) => a.ts - b.ts);
  rows.forEach((r, i) => {
    latest.set(r.account, r);
    if (rows[i + 1]?.ts === r.ts) return;
    const values = [...latest.values()];
    if (latest.size === ids.size && values.every((v) => r.ts - v.ts <= gap)) {
      out.push({ ts: r.ts, value: values.reduce((s, v) => s + v.remaining, 0) });
    }
  });
  return out;
}

export function forecastPoints(
  data: SnapshotData,
  items: AccountWindowItem[],
  metric: string,
  burnHours: number,
  showForecast: boolean,
  now: number,
  end: number,
): ChartPoint[] {
  const rates = items.map(({ a }) => drainFor(data, a, metric, burnHours, now));
  if (
    !showForecast ||
    !items.length ||
    rates.some((r) => r === null) ||
    items.some(
      ({ a, w }) =>
        a.quota_error ||
        now - (a.quota_at || 0) > 900 ||
        (w.reset_at && w.reset_at <= now && (a.quota_at || 0) < w.reset_at),
    )
  )
    return [];
  const times = new Set<number>([now, end]);
  for (let t = now; t < end; t += (end - now) / 100) times.add(t);
  items.forEach(({ w }) => {
    if (w.reset_at && w.reset_at > now && w.reset_at < end) {
      times.add(w.reset_at - 0.01);
      times.add(w.reset_at);
    }
  });
  return [...times]
    .sort((a, b) => a - b)
    .map((ts) => ({
      ts,
      value: items.reduce((sum, { w }, i) => {
        let last = now;
        let remaining = w.remaining;
        if (w.reset_at && ts >= w.reset_at && w.reset_at > now) {
          last = w.reset_at;
          remaining = 100;
        }
        return (
          sum + Math.max(0, remaining - ((rates[i] as number) * (ts - last)) / 3600)
        );
      }, 0),
    }));
}

export function monotonePath(
  arr: ChartPoint[],
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  const p = arr.map((r) => [x(r.ts), y(r.value)] as const);
  const n = p.length;
  const f = (v: number) => v.toFixed(2);
  if (n < 3)
    return p.map(([px, py], i) => `${i ? "L" : "M"}${f(px)},${f(py)}`).join(" ");
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = p[i + 1][0] - p[i][0];
    d.push(dx ? (p[i + 1][1] - p[i][1]) / dx : 0);
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++)
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (!d[i]) {
      m[i] = m[i + 1] = 0;
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
  tsInput: number,
): ChartPoint {
  const first = (points[0] || forecast[0]).ts;
  const last = (forecast[forecast.length - 1] || points[points.length - 1]).ts;
  const ts = Math.min(last, Math.max(first, tsInput));
  if (forecast.length && ts >= forecast[0].ts) {
    if (forecast.length === 1) return { ...forecast[0], projected: true };
    const idx = Math.max(
      1,
      forecast.findIndex((p) => p.ts >= ts),
    );
    const a = forecast[idx - 1];
    const b = forecast[idx];
    const k = (ts - a.ts) / (b.ts - a.ts || 1);
    return { ts, value: a.value + (b.value - a.value) * k, projected: true };
  }
  const nearest = points.reduce((a, b) =>
    Math.abs(a.ts - ts) < Math.abs(b.ts - ts) ? a : b,
  );
  return { ...nearest, projected: false };
}
