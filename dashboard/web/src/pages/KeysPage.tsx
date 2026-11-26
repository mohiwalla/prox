import * as React from "react";
import {
  AlertTriangleIcon,
  BarChart3Icon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIcon,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Switch,
} from "@/components/ui";
import { apiGet, apiPost } from "@/lib/api";
import { fmtTokens, pName, PROVIDERS } from "@/lib/format";
import type {
  ClientKey,
  ClientKeyOptions,
  ClientKeysResponse,
  ClientKeySecretResponse,
  ClientKeyUpdateResponse,
  ProviderId,
  Snapshot,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { KeyFormDialog } from "@/pages/keys/KeyFormDialog";
import {
  KeySecretDialog,
  type KeySecretPayload,
} from "@/pages/keys/KeySecretDialog";
import { KeyUsageDialog } from "@/pages/keys/KeyUsageDialog";

export interface KeysPageProps {
  snapshot: Snapshot | null;
  onMetaChange?: (meta: string | null) => void;
}

interface ScopeChip {
  key: string;
  kind: "provider" | "account" | "model";
  label: string;
  title: string;
  provider?: string;
}

function buildScopeChips(
  clientKey: ClientKey,
  accountLabels: Map<string, string>,
): ScopeChip[] {
  const chips: ScopeChip[] = [];
  for (const p of clientKey.providers) {
    chips.push({
      key: `p:${p}`,
      kind: "provider",
      label: pName(p),
      title: `Provider: ${pName(p)}`,
      provider: p,
    });
  }
  for (const a of clientKey.accounts) {
    const label = accountLabels.get(a) ?? a;
    chips.push({
      key: `a:${a}`,
      kind: "account",
      label,
      title: `Account: ${label}`,
    });
  }
  for (const m of clientKey.models) {
    chips.push({
      key: `m:${m}`,
      kind: "model",
      label: m,
      title: `Model: ${m}`,
    });
  }
  return chips;
}

export function KeysPage({ snapshot, onMetaChange }: KeysPageProps) {
  const [keys, setKeys] = React.useState<ClientKey[] | null>(null);
  const [baseUrl, setBaseUrl] = React.useState<string>(
    () => window.location.origin,
  );
  const [options, setOptions] = React.useState<ClientKeyOptions | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingToggleIds, setPendingToggleIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  // Modal states
  const [usageKeyId, setUsageKeyId] = React.useState<string | null>(null);
  const [formState, setFormState] = React.useState<{
    open: boolean;
    editingKey: ClientKey | null;
  }>({ open: false, editingKey: null });
  const [secretPayload, setSecretPayload] =
    React.useState<KeySecretPayload | null>(null);
  const [confirmState, setConfirmState] = React.useState<{
    action: "rotate" | "delete";
    key: ClientKey;
  } | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);

  const loadSeqRef = React.useRef(0);

  const loadKeys = React.useCallback(async () => {
    const seq = ++loadSeqRef.current;
    try {
      const [listRes, optionsRes] = await Promise.all([
        apiGet<ClientKeysResponse>("keys"),
        apiGet<ClientKeyOptions>("keys/options"),
      ]);
      if (seq !== loadSeqRef.current) return;
      const nextList = listRes.keys ?? [];
      setKeys(nextList);
      setBaseUrl(listRes.base_url || window.location.origin);
      setOptions(optionsRes);
      setError(null);
      setRefreshTick((t) => t + 1);
      setUsageKeyId((current) =>
        current && !nextList.some((k) => k.id === current) ? null : current,
      );
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(err instanceof Error ? err.message : "Could not load keys.");
    }
  }, []);

  // Load keys on mount and refresh whenever a new snapshot arrives.
  const snapshotUpdatedAt = snapshot?.updated_at ?? null;
  React.useEffect(() => {
    void loadKeys();
  }, [loadKeys, snapshotUpdatedAt]);

  // Keep header meta synchronized with key count & enabled count.
  React.useEffect(() => {
    if (keys === null) {
      onMetaChange?.("Loading keys…");
      return;
    }
    const enabledCount = keys.filter((k) => k.enabled).length;
    onMetaChange?.(
      `${keys.length} key${keys.length === 1 ? "" : "s"} · ${enabledCount} enabled`,
    );
  }, [keys, onMetaChange]);

  React.useEffect(() => {
    return () => onMetaChange?.(null);
  }, [onMetaChange]);

  const accountLabels = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const acc of options?.accounts ?? []) {
      map.set(acc.id, acc.label || acc.id);
    }
    return map;
  }, [options]);

  const activeUsageKey = React.useMemo(
    () => (usageKeyId && keys ? keys.find((k) => k.id === usageKeyId) ?? null : null),
    [usageKeyId, keys],
  );

  async function handleToggleEnabled(target: ClientKey, nextEnabled: boolean) {
    if (pendingToggleIds.has(target.id)) return;
    setPendingToggleIds((prev) => {
      const next = new Set(prev);
      next.add(target.id);
      return next;
    });

    // Optimistic update; revert if the proxy rejects.
    setKeys((prev) =>
      prev
        ? prev.map((k) =>
            k.id === target.id ? { ...k, enabled: nextEnabled } : k,
          )
        : prev,
    );

    try {
      const res = await apiPost<ClientKeyUpdateResponse>("keys/update", {
        id: target.id,
        enabled: nextEnabled,
      });
      setKeys((prev) =>
        prev
          ? prev.map((k) => (k.id === target.id ? res.key : k))
          : prev,
      );
      toast.success(nextEnabled ? "Key enabled" : "Key disabled", {
        description: nextEnabled
          ? `${target.name} can make requests again.`
          : `Requests with ${target.name} are refused.`,
      });
    } catch (err) {
      setKeys((prev) =>
        prev
          ? prev.map((k) =>
              k.id === target.id ? { ...k, enabled: !nextEnabled } : k,
            )
          : prev,
      );
      toast.error("Couldn't update the key", {
        description: err instanceof Error ? err.message : "Request failed.",
      });
    } finally {
      setPendingToggleIds((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
    }
  }

  async function handleConfirmAction() {
    if (!confirmState) return;
    const { action, key } = confirmState;
    if (action === "rotate") {
      try {
        const res = await apiPost<ClientKeySecretResponse>("keys/rotate", {
          id: key.id,
        });
        setKeys((prev) =>
          prev ? prev.map((k) => (k.id === key.id ? res.key : k)) : prev,
        );
        setSecretPayload({
          key: res.key,
          secret: res.secret,
          reason: "rotated",
        });
      } catch (err) {
        toast.error("Couldn't rotate the key", {
          description: err instanceof Error ? err.message : "Request failed.",
        });
      }
      return;
    }

    try {
      await apiPost("keys/delete", { id: key.id });
      toast.success("Key deleted", {
        description: `${key.name} no longer works.`,
      });
      if (usageKeyId === key.id) setUsageKeyId(null);
      await loadKeys();
    } catch (err) {
      toast.error("Couldn't delete the key", {
        description: err instanceof Error ? err.message : "Request failed.",
      });
    }
  }

  function openCreateDialog() {
    setFormState({ open: true, editingKey: null });
  }

  function openEditDialog(clientKey: ClientKey) {
    setFormState({ open: true, editingKey: clientKey });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Each client uses its own key. The proxy enforces each key&rsquo;s
          restrictions and weekly limit.
        </p>
        {keys && keys.length > 0 ? (
          <Button variant="default" size="sm" onClick={openCreateDialog}>
            <PlusIcon className="size-4" aria-hidden="true" />
            New key
          </Button>
        ) : null}
      </div>

      {/* Error banner */}
      {error ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Main content */}
      {keys === null ? (
        !error ? (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2Icon
                className="size-4 animate-spin"
                aria-hidden="true"
              />
              <span>Loading keys…</span>
            </CardContent>
          </Card>
        ) : null
      ) : keys.length === 0 ? (
        <Card className="mx-auto max-w-md text-center">
          <CardHeader className="flex-col items-center">
            <CardTitle>No client keys yet</CardTitle>
            <CardDescription>
              Give each client its own key to limit which providers, accounts
              and models it uses, cap its weekly tokens and see its usage.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button variant="default" onClick={openCreateDialog}>
              <PlusIcon className="size-4" aria-hidden="true" />
              New key
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {keys.map((k) => {
              const chips = buildScopeChips(k, accountLabels);
              const visibleChips = chips.slice(0, 4);
              const overflowCount = Math.max(0, chips.length - 4);
              const limit = k.weekly_token_limit;
              const used = k.weekly_tokens;
              const share = limit > 0 ? Math.min(1, used / limit) : 0;
              const isToggling = pendingToggleIds.has(k.id);

              return (
                <article
                  key={k.id}
                  data-enabled={String(k.enabled)}
                  className={cn(
                    "grid grid-cols-1 items-center gap-x-4 gap-y-3 px-5 py-4 transition-colors hover:bg-secondary/20",
                    "lg:grid-cols-[minmax(180px,1.2fr)_minmax(180px,1.5fr)_minmax(180px,1fr)_auto]",
                    !k.enabled && "bg-background/30",
                  )}
                >
                  {/* Identity */}
                  <div
                    className={cn(
                      "flex min-w-0 flex-col items-start gap-0.5",
                      !k.enabled && "opacity-65",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setUsageKeyId(k.id)}
                      title={`View usage for ${k.name}`}
                      className="max-w-full cursor-pointer truncate rounded-sm text-left text-sm font-medium text-foreground transition-colors hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {k.name}
                    </button>
                    <code className="font-mono text-xs text-muted-foreground">
                      cpk_…{k.hint}
                    </code>
                  </div>

                  {/* Scope chips */}
                  <div
                    className={cn(
                      "flex min-w-0 flex-wrap items-center gap-1.5",
                      !k.enabled && "opacity-65",
                    )}
                  >
                    {chips.length === 0 ? (
                      <Badge
                        variant="outline"
                        title="Any provider, account and model"
                        className="text-muted-foreground"
                      >
                        Any
                      </Badge>
                    ) : (
                      <>
                        {visibleChips.map((chip) => (
                          <Badge
                            key={chip.key}
                            variant="outline"
                            title={chip.title}
                            className={cn(
                              "max-w-[180px] gap-1 text-xs",
                              chip.kind === "model" && "font-mono text-[11px]",
                            )}
                          >
                            {chip.kind === "provider" &&
                            chip.provider &&
                            chip.provider in PROVIDERS ? (
                              <ProviderIcon
                                provider={chip.provider as ProviderId}
                                className="size-3 shrink-0"
                              />
                            ) : null}
                            {chip.kind === "account" ? (
                              <UsersIcon
                                className="size-3 shrink-0 text-muted-foreground"
                                aria-hidden="true"
                              />
                            ) : null}
                            <span className="truncate">{chip.label}</span>
                          </Badge>
                        ))}
                        {overflowCount > 0 ? (
                          <Badge
                            variant="outline"
                            title={chips
                              .slice(4)
                              .map((c) => c.title)
                              .join("\n")}
                            className="text-muted-foreground"
                          >
                            +{overflowCount}
                          </Badge>
                        ) : null}
                      </>
                    )}
                  </div>

                  {/* Weekly usage meter */}
                  <div
                    className={cn(
                      "flex min-w-0 flex-col gap-1.5",
                      !k.enabled && "opacity-65",
                    )}
                    title={
                      limit > 0
                        ? `${used.toLocaleString()} of ${limit.toLocaleString()} tokens in the last 7 days`
                        : `${used.toLocaleString()} tokens in the last 7 days`
                    }
                  >
                    {limit > 0 ? (
                      <>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn(
                              "h-full rounded-full transition-[width] duration-200 ease-out",
                              share >= 1
                                ? "bg-destructive"
                                : share >= 0.8
                                  ? "bg-warning"
                                  : "bg-foreground/80",
                            )}
                            style={{
                              width: `${Math.max(used > 0 ? 1.5 : 0, share * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          <strong className="font-medium text-foreground">
                            {fmtTokens(used)}
                          </strong>{" "}
                          / {fmtTokens(limit)}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        <strong className="font-medium text-foreground">
                          {fmtTokens(used)}
                        </strong>{" "}
                        this week · no limit
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2">
                    <Switch
                      checked={k.enabled}
                      disabled={isToggling}
                      aria-label={`Enable ${k.name}`}
                      title={
                        k.enabled
                          ? "Enabled"
                          : "Disabled: requests with this key are refused"
                      }
                      onCheckedChange={(checked) =>
                        void handleToggleEnabled(k, checked)
                      }
                    />

                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`More actions for ${k.name}`}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "icon-sm",
                        })}
                      >
                        <MoreHorizontalIcon
                          className="size-4"
                          aria-hidden="true"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setUsageKeyId(k.id)}
                        >
                          <DropdownMenuItemIcon>
                            <BarChart3Icon aria-hidden="true" />
                          </DropdownMenuItemIcon>
                          View usage
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => openEditDialog(k)}>
                          <DropdownMenuItemIcon>
                            <PencilIcon aria-hidden="true" />
                          </DropdownMenuItemIcon>
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            setConfirmState({ action: "rotate", key: k })
                          }
                        >
                          <DropdownMenuItemIcon>
                            <RefreshCwIcon aria-hidden="true" />
                          </DropdownMenuItemIcon>
                          Rotate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          destructive
                          onSelect={() =>
                            setConfirmState({ action: "delete", key: k })
                          }
                        >
                          <DropdownMenuItemIcon>
                            <Trash2Icon aria-hidden="true" />
                          </DropdownMenuItemIcon>
                          Delete key
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </article>
              );
            })}
          </div>
        </Card>
      )}

      {/* Key usage modal */}
      <KeyUsageDialog
        clientKey={activeUsageKey}
        options={options}
        refreshTick={refreshTick}
        onClose={() => setUsageKeyId(null)}
      />

      {/* Create / Edit key modal */}
      <KeyFormDialog
        open={formState.open}
        editingKey={formState.editingKey}
        options={options}
        onClose={() => setFormState({ open: false, editingKey: null })}
        onCreated={async (createdKey, secret) => {
          await loadKeys();
          setSecretPayload({
            key: createdKey,
            secret,
            reason: "created",
          });
        }}
        onUpdated={async () => {
          await loadKeys();
        }}
      />

      {/* Copy-key secret modal */}
      <KeySecretDialog
        payload={secretPayload}
        baseUrl={baseUrl}
        options={options}
        onClose={() => setSecretPayload(null)}
      />

      {/* Rotate / Delete confirmation dialog */}
      <ConfirmDialog
        open={confirmState !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmState(null);
        }}
        title={
          confirmState
            ? confirmState.action === "rotate"
              ? `Rotate ${confirmState.key.name}?`
              : `Delete ${confirmState.key.name}?`
            : ""
        }
        description={
          confirmState?.action === "rotate"
            ? "A new secret replaces this key's secret right away. Clients using the current one stop working until they get the new one."
            : "Clients using this key stop working right away and its usage history is deleted. This can't be undone."
        }
        confirmLabel={
          confirmState?.action === "rotate" ? "Rotate key" : "Delete key"
        }
        variant={
          confirmState?.action === "rotate" ? "default" : "destructive"
        }
        onConfirm={handleConfirmAction}
      />
    </div>
  );
}
