export type PageId = "quotas" | "accounts" | "keys" | "logs";

export interface QuotaWindow {
  id: string;
  label: string;
  group?: string;
  period?: number;
  remaining: number;
  reset_at?: number;
}

export interface Cooldown {
  reason: string;
  model_key?: string;
}

export interface ResetGrant {
  id: string;
  label: string;
  left: number;
  total: number;
  expires_at?: number;
  reason?: string;
}

export interface AccountResets {
  available: number;
  items: ResetGrant[];
}

export interface Account {
  id: string;
  provider: string;
  email?: string;
  plan?: string;
  disabled: boolean;
  requires_sign_in: boolean;
  unavailable: boolean;
  quota_error?: string | null;
  quota_at?: number;
  cooldown_until?: number | null;
  cooldowns: Cooldown[];
  windows: QuotaWindow[];
  resets?: AccountResets | null;
  success: number;
}

export interface HistoryRow {
  account: string;
  metric: string;
  ts: number;
  remaining: number;
  reset_at?: number;
}

export interface SnapshotData {
  now: number;
  refreshing: boolean;
  error?: string;
  endpoint?: string;
  history_bucket?: number;
  accounts: Account[];
  history: HistoryRow[];
}

export interface SessionResponse {
  authenticated: boolean;
  tailnet?: boolean;
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
  created_at?: number | null;
  updated_at?: number | null;
}

export interface KeyOptionAccount {
  id: string;
  provider: string;
  label: string;
  disabled?: boolean;
  missing?: boolean;
}

export interface KeyOptionModel {
  id: string;
  providers: string[];
}

export interface KeyOptions {
  providers: string[];
  accounts: KeyOptionAccount[];
  models: KeyOptionModel[];
}

export interface KeysListResponse {
  keys: ClientKey[];
  base_url?: string;
}

export interface KeyUsageBucket {
  key_id: string;
  hour: number;
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

export interface KeyUsageResponse {
  since: number;
  buckets: KeyUsageBucket[];
}

export interface ErrorLogFile {
  name: string;
  modified: number;
  size: number;
}

export interface ActivityLogResponse {
  enabled: boolean;
  lines: string[];
  next_cursor?: string;
}

export interface OAuthSession {
  state: string;
  url: string;
}

export interface ConfirmAction {
  title: string;
  description: string;
  label: string;
  busy: string;
  failure: string;
  returnFocus?: () => HTMLElement | null;
  run: () => Promise<unknown>;
  done: (result: unknown) => void | Promise<void>;
}
