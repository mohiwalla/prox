import type { Account, HistoryHours, ProviderId, QuotaProviderId } from "@/lib/types";

export { ProviderIcon, ProxBrandIcon, type ProviderIconProps } from "@/components/ProviderIcon";

export interface ProviderMeta {
  name: string;
  note: string;
  mark: string;
  color: string;
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  claude: {
    name: "Claude",
    note: "Anthropic account",
    mark: "claude",
    color: "#d97757",
  },
  codex: {
    name: "Codex",
    note: "ChatGPT plan",
    mark: "codex",
    color: "#82aafa",
  },
  antigravity: {
    name: "Antigravity",
    note: "Google account",
    mark: "antigravity",
    color: "#e59a75",
  },
  xai: {
    name: "xAI",
    note: "Grok account",
    mark: "xai",
    color: "#f5f5f5",
  },
  kimi: {
    name: "Kimi",
    note: "kimi.com",
    mark: "kimi",
    color: "#027aff",
  },
  "kimi-ai": {
    name: "Kimi",
    note: "kimi.ai, international",
    mark: "kimi",
    color: "#027aff",
  },
  devin: {
    name: "Devin",
    note: "Cognition account",
    mark: "devin",
    color: "#a1a1a1",
  },
  meta: {
    name: "Meta",
    note: "Meta AI account",
    mark: "meta",
    color: "#0082fb",
  },
};

export const QUOTA_PROVIDERS: readonly QuotaProviderId[] = [
  "codex",
  "claude",
  "antigravity",
] as const;

export const MODEL_COLORS: readonly string[] = [
  "#82aafa",
  "#e59a75",
  "#7dd3a8",
  "#c4a7e7",
  "#f2c179",
  "#7ec8e3",
] as const;

export const KEY_USAGE_RANGES: Record<HistoryHours, string> = {
  24: "last 24 hours",
  168: "last 7 days",
  336: "last 14 days",
  720: "last 30 days",
  2160: "last 90 days",
};

export const HISTORY_RANGE_OPTIONS: readonly { value: HistoryHours; label: string }[] = [
  { value: 24, label: "24 hours" },
  { value: 168, label: "7 days" },
  { value: 336, label: "14 days" },
  { value: 720, label: "30 days" },
  { value: 2160, label: "90 days" },
];

export function pName(provider: string): string {
  return PROVIDERS[provider as ProviderId]?.name ?? provider;
}

export function providerColor(provider: string): string {
  return PROVIDERS[provider as ProviderId]?.color ?? "#a1a1a1";
}

export function fmtTokens(n: number | null | undefined): string {
  const num = Number(n) || 0;
  const units: readonly [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [size, suffix] of units) {
    if (num >= size) {
      const v = num / size;
      return `${+v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)}${suffix}`;
    }
  }
  return String(Math.round(num));
}

export function parseTokens(text: string): number {
  const t = String(text).toLowerCase().replace(/[\s,_]/g, "");
  if (!t) return 0;
  const m = /^(\d+(?:\.\d+)?|\.\d+)([kmbt]?)$/.exec(t);
  if (!m) return NaN;
  const multipliers: Record<string, number> = {
    "": 1,
    k: 1e3,
    m: 1e6,
    b: 1e9,
    t: 1e12,
  };
  const n = Math.round(Number(m[1]) * multipliers[m[2]]);
  return n <= 1e15 ? n : NaN;
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(n % 1 ? 1 : 0)}%`;
}

export function relative(ts: number | null | undefined): string {
  if (!ts) return "Unknown";
  const s = Math.max(0, ts - Date.now() / 1000);
  if (s < 60) return "Less than a minute";
  const m = Math.ceil(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  return h < 24
    ? `in ${h}h ${m % 60}m`
    : `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

export function dateLabel(ts: number | null | undefined, withTime = true): string {
  if (!ts) return "Unknown";
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

export function age(ts: number | null | undefined): string {
  if (!ts) return "Not checked";
  const n = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));
  if (n === 0) return "just now";
  if (n < 60) return `${n}m ago`;
  if (n < 1440) return `${Math.floor(n / 60)}h ago`;
  return `${Math.floor(n / 1440)}d ago`;
}

export function fmtSize(n: number | null | undefined): string {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function accountLabel(
  account: Pick<Account, "email" | "provider">,
  index = 0,
): string {
  return account.email || `${pName(account.provider)} account ${index + 1}`;
}

export type AccountStatusTone = "neutral" | "success" | "warning" | "destructive";

export function accountStatus(account: Account): {
  label: string;
  tone: AccountStatusTone;
} {
  if (account.disabled) return { label: "Paused", tone: "neutral" };
  if (account.requires_sign_in) return { label: "Sign-in needed", tone: "destructive" };
  if (account.cooldowns.some((c) => c.reason === "model_not_supported")) {
    return { label: "Model restriction", tone: "warning" };
  }
  if (account.unavailable) {
    return {
      label: account.cooldowns.length ? "Cooling down" : "Unavailable",
      tone: "warning",
    };
  }
  if (account.quota_error) return { label: "Quota unavailable", tone: "warning" };
  return { label: "Ready", tone: "success" };
}

export function accountStatusReason(account: Account, now = Date.now() / 1000): string {
  if (account.disabled) return "Excluded from account selection.";
  if (account.requires_sign_in) return "Sign in again to reconnect this account.";
  const unsupported = account.cooldowns.filter(
    (c) => c.reason === "model_not_supported",
  );
  if (unsupported.length) {
    return `This plan cannot use ${unsupported.map((c) => c.model_key).join(", ")}.`;
  }
  if (account.quota_error) return account.quota_error;
  if (
    account.unavailable &&
    account.cooldowns.some((c) => c.reason === "quota" || c.reason === "credential_quota")
  ) {
    const exhausted = account.windows.filter(
      (w) =>
        w.remaining === 0 &&
        account.quota_at !== null &&
        now - account.quota_at <= 900 &&
        (!w.reset_at || w.reset_at > now),
    );
    if (exhausted.length) {
      return `${exhausted.map((w) => w.label).join(", ")} exhausted.`;
    }
  }
  if (account.unavailable) {
    return account.cooldowns.length
      ? "The proxy will retry eligible requests after cooldown."
      : "The proxy reports this account is unavailable.";
  }
  return "The proxy selects this account automatically.";
}

export function planLabel(plan: string | null | undefined): string {
  if (!plan || plan.toLowerCase() === "unknown") return "";
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export function modelPattern(pattern: string): RegExp {
  return new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    "i",
  );
}
