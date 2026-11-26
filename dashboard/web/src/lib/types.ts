export type ProviderId =
  | "claude"
  | "codex"
  | "antigravity"
  | "xai"
  | "kimi"
  | "kimi-ai"
  | "devin"
  | "meta";

export type QuotaProviderId = "codex" | "claude" | "antigravity";

export type HistoryHours = 24 | 168 | 336 | 720 | 2160;

export type DashboardPage = "quotas" | "accounts" | "keys" | "logs";

export interface SessionResponse {
  authenticated: boolean;
  tailnet: boolean;
}

export interface QuotaWindow {
  id: string;
  label: string;
  remaining: number;
  reset_at: number | null;
  period: number | null;
  group?: string;
}

export interface ResetItem {
  id: string;
  label: string;
  left: number;
  total: number;
  expires_at: number | null;
  reason: string | null;
}

export interface AccountResets {
  available: number;
  items: ResetItem[];
}

export interface AccountCooldown {
  scope: string | null;
  model_key: string | null;
  reason: string | null;
  retry_at: string | number | null;
  http_status: number | null;
}

export interface Account {
  id: string;
  provider: string;
  email: string;
  name: string;
  plan: string;
  disabled: boolean;
  status: string;
  unavailable: boolean;
  requires_sign_in: boolean;
  cooldowns: AccountCooldown[];
  success: number;
  failed: number;
  windows: QuotaWindow[];
  quota_at: number | null;
  quota_error: string | null;
  last_refresh: string | number | null;
  resets: AccountResets | null;
  cooldown_until: number | null;
}

export interface HistorySample {
  ts: number;
  account: string;
  provider: string;
  metric: string;
  remaining: number;
  reset_at: number | null;
  period: number | null;
}

export interface Snapshot {
  accounts: Account[];
  updated_at: number | null;
  refreshing: boolean;
  error: string | null;
  now: number;
  endpoint: string;
  history: HistorySample[];
  history_bucket: number;
}

export interface OAuthStartResponse {
  url: string;
  state: string;
}

export interface OAuthStatusResponse {
  status: string;
  error: string | null;
}

export interface ClientKey {
  id: string;
  name: string;
  hint: string;
  enabled: boolean;
  providers: string[];
  accounts: string[];
  models: string[];
  weekly_token_limit: number;
  weekly_tokens: number;
  created_at: string | number | null;
  updated_at: string | number | null;
}

export interface ClientKeysResponse {
  keys: ClientKey[];
  base_url: string;
}

export interface ClientKeyAccountOption {
  id: string;
  provider: string;
  label: string;
  disabled: boolean;
}

export interface ClientKeyModelOption {
  id: string;
  providers: string[];
}

export interface ClientKeyOptions {
  providers: string[];
  accounts: ClientKeyAccountOption[];
  models: ClientKeyModelOption[];
}

export interface ClientKeyUsageBucket {
  key_id: string;
  hour: number | null;
  provider: string;
  account: string;
  model: string;
  requests: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  tokens: number;
}

export interface ClientKeyUsageResponse {
  since: number | null;
  buckets: ClientKeyUsageBucket[];
}

export interface ClientKeyCreateInput {
  name: string;
  enabled?: boolean;
  providers?: string[];
  accounts?: string[];
  models?: string[];
  weekly_token_limit?: number;
}

export interface ClientKeyUpdateInput {
  id: string;
  name?: string;
  enabled?: boolean;
  providers?: string[];
  accounts?: string[];
  models?: string[];
  weekly_token_limit?: number;
}

export interface ClientKeySecretResponse {
  key: ClientKey;
  secret: string;
}

export interface ClientKeyUpdateResponse {
  key: ClientKey;
}

export interface ErrorLogEntry {
  name: string;
  size: number;
  modified: number;
}

export interface ErrorLogsResponse {
  files: ErrorLogEntry[];
}

export interface ErrorLogFileResponse {
  name: string;
  text: string;
  truncated: boolean;
}

export interface ActivityLogResponse {
  enabled: boolean;
  lines: string[];
  latest?: number | null;
  next_cursor?: string | null;
}

export interface OkResponse {
  ok?: boolean;
  status?: string;
  enabled?: boolean;
}
