import type { Account, PageId } from "./types";

export interface ProviderMeta {
  name: string;
  note: string;
  mark: string;
}

export const PROVIDERS: Record<string, ProviderMeta> = {
  claude: { name: "Claude", note: "Anthropic account", mark: "claude" },
  codex: { name: "Codex", note: "ChatGPT plan", mark: "codex" },
  antigravity: {
    name: "Antigravity",
    note: "Google account",
    mark: "antigravity",
  },
  xai: { name: "xAI", note: "Grok account", mark: "xai" },
  kimi: { name: "Kimi", note: "kimi.com", mark: "kimi" },
  "kimi-ai": {
    name: "Kimi",
    note: "kimi.ai, international",
    mark: "kimi",
  },
  devin: { name: "Devin", note: "Cognition account", mark: "devin" },
  meta: { name: "Meta", note: "Meta AI account", mark: "meta" },
};

export const QUOTA_PROVIDERS = ["codex", "claude", "antigravity"] as const;

export const MODEL_COLORS = [
  "#82aafa",
  "#e59a75",
  "#7dd3a8",
  "#c4a7e7",
  "#f2c179",
  "#7ec8e3",
];

export const KEY_USAGE_RANGES: Record<number, string> = {
  24: "last 24 hours",
  168: "last 7 days",
  336: "last 14 days",
  720: "last 30 days",
  2160: "last 90 days",
};

export const PAGES: PageId[] = ["quotas", "accounts", "keys", "logs"];

export const PAGE_TITLES: Record<PageId, string> = {
  quotas: "Quota management",
  accounts: "Accounts",
  keys: "Keys",
  logs: "Logs",
};

export function pagePath(page: PageId): string {
  return page === "quotas" ? "/dashboard/" : `/dashboard/${page}`;
}

export function pageFromPath(pathname = location.pathname): PageId {
  const page = pathname.replace(/^\/dashboard\/?/, "").replace(/\/$/, "");
  return (PAGES as string[]).includes(page) ? (page as PageId) : "quotas";
}

export function pName(p: string): string {
  return PROVIDERS[p]?.name || p;
}

export function planLabel(plan?: string): string {
  if (!plan) return "";
  const map: Record<string, string> = {
    prolite: "Pro 100",
    pro: "Pro 200",
    go: "Go",
    plus: "Plus",
    free: "Free",
    team: "Team",
    enterprise: "Enterprise",
  };
  return map[plan] || plan;
}

export function fmtPct(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n)
    ? `${n.toFixed(n % 1 ? 1 : 0)}%`
    : "—";
}

export function relative(ts?: number): string {
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

export function dateLabel(ts?: number, withTime = true): string {
  if (!ts) return "Unknown";
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

export function age(ts?: number): string {
  if (!ts) return "Not checked";
  const n = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));
  if (n === 0) return "just now";
  if (n < 60) return `${n}m ago`;
  if (n < 1440) return `${Math.floor(n / 60)}h ago`;
  return `${Math.floor(n / 1440)}d ago`;
}

export function accountLabel(a: Account, i: number): string {
  return a.email || `${pName(a.provider)} account ${i + 1}`;
}

export function status(a: Account): [string, string] {
  if (a.disabled) return ["Paused", ""];
  if (a.requires_sign_in) return ["Sign-in needed", "bad"];
  if (a.cooldowns.some((c) => c.reason === "model_not_supported"))
    return ["Model restriction", "warning"];
  if (a.unavailable)
    return [a.cooldowns.length ? "Cooling down" : "Unavailable", "warning"];
  if (a.quota_error) return ["Quota unavailable", "warning"];
  return ["Ready", "good"];
}

export function statusReason(a: Account, now: number): string {
  if (a.disabled) return "Excluded from account selection.";
  if (a.requires_sign_in) return "Sign in again to reconnect this account.";
  const unsupported = a.cooldowns.filter(
    (c) => c.reason === "model_not_supported",
  );
  if (unsupported.length)
    return `This plan cannot use ${unsupported.map((c) => c.model_key).join(", ")}.`;
  if (a.quota_error) return a.quota_error;
  if (
    a.unavailable &&
    a.cooldowns.some((c) => ["quota", "credential_quota"].includes(c.reason))
  ) {
    const exhausted = a.windows.filter(
      (w) =>
        w.remaining === 0 &&
        now - (a.quota_at || 0) <= 900 &&
        (!w.reset_at || w.reset_at > now),
    );
    if (exhausted.length)
      return exhausted.map((w) => w.label).join(", ") + " exhausted.";
  }
  if (a.unavailable)
    return a.cooldowns.length
      ? "The proxy will retry eligible requests after cooldown."
      : "The proxy reports this account is unavailable.";
  return "The proxy selects this account automatically.";
}

export function canResetCooldown(a: Account): boolean {
  return Boolean(
    a.unavailable ||
      a.cooldowns?.length ||
      (a.cooldown_until && a.cooldown_until > Date.now() / 1000),
  );
}

export function fmtSize(n: number): string {
  return n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
}

export function fmtTokens(n: number): string {
  const num = Number(n) || 0;
  for (const [size, suffix] of [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ] as const) {
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
  const mult: Record<string, number> = {
    "": 1,
    k: 1e3,
    m: 1e6,
    b: 1e9,
    t: 1e12,
  };
  const n = Math.round(Number(m[1]) * mult[m[2]]);
  return n <= 1e15 ? n : NaN;
}

export function modelPattern(p: string): RegExp {
  return new RegExp(
    `^${p
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    "i",
  );
}

export type SecretClient = "curl" | "claude" | "codex" | "openai";

export interface SecretPayload {
  base: string;
  secret: string;
  model: string;
}

export function secretSnippet(
  client: SecretClient,
  payload: SecretPayload | null,
): { code: string; help: string } {
  if (!payload) return { code: "", help: "" };
  const { base, secret, model } = payload;
  if (client === "claude") {
    return {
      code: `export ANTHROPIC_BASE_URL="${base}"\nexport ANTHROPIC_AUTH_TOKEN="${secret}"\nclaude`,
      help: "Run in your shell before launching Claude Code.",
    };
  }
  if (client === "codex") {
    return {
      code: `# ~/.codex/config.toml\nmodel_provider = "prox"\n\n[model_providers.prox]\nname = "prox"\nbase_url = "${base}/v1"\nenv_key = "PROX_API_KEY"\nwire_api = "responses"\n\n# shell\nexport PROX_API_KEY="${secret}"`,
      help: "Configure the custom provider once, then export PROX_API_KEY before running codex.",
    };
  }
  if (client === "openai") {
    return {
      code: `export OPENAI_BASE_URL="${base}/v1"\nexport OPENAI_API_KEY="${secret}"`,
      help: "Works with OpenAI-compatible SDKs and editors (Cursor, Cline, Roo Code, OpenCode, Aider).",
    };
  }
  return {
    code: `curl ${base}/v1/chat/completions \\\n  -H "Authorization: Bearer ${secret}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`,
    help: "Send the key as Authorization: Bearer …. OpenAI-style clients take the base URL with /v1.",
  };
}
