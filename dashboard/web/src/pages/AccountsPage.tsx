import * as React from "react";
import {
  LayersIcon,
  Loader2Icon,
  LogInIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  Badge,
  type BadgeVariant,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIcon,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Switch,
  Tabs,
  TabsList,
  TabsTab,
  buttonVariants,
} from "@/components/ui";
import { apiPost } from "@/lib/api";
import {
  PROVIDERS,
  type AccountStatusTone,
  accountLabel,
  accountStatus,
  accountStatusReason,
  age,
  dateLabel,
  fmtPct,
  pName,
  planLabel,
  providerColor,
  relative,
} from "@/lib/format";
import type {
  Account,
  AccountResets,
  OkResponse,
  ProviderId,
  ResetItem,
  Snapshot,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export interface AccountsPageProps {
  snapshot: Snapshot | null;
  loading: boolean;
  onAddLogin: (provider?: ProviderId) => void;
  onRelogin: (account: Account) => void;
  onReload: () => Promise<void>;
}

const STATUS_TONE_VARIANT: Record<AccountStatusTone, BadgeVariant> = {
  neutral: "secondary",
  success: "success",
  warning: "warning",
  destructive: "destructive",
};

function canResetCooldown(account: Account, now: number): boolean {
  return Boolean(
    account.unavailable ||
      account.cooldowns.length > 0 ||
      (account.cooldown_until !== null && account.cooldown_until > now),
  );
}

function accountSubtitle(account: Account): string {
  const parts = [planLabel(account.plan), pName(account.provider)];
  return parts
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .join(" · ");
}

function formatExpiryRelative(ts: number): string {
  const days = Math.round((ts - Date.now() / 1000) / 86400);
  return days >= 1 ? `in ${days} day${days === 1 ? "" : "s"}` : relative(ts);
}

interface ResetDialogState {
  account: Account;
  label: string;
  resets: AccountResets | null;
  loading: boolean;
  submitting: boolean;
  selectedGrant: string;
  error: string;
  retrySame: boolean;
}

interface RemoveTargetState {
  account: Account;
  label: string;
}

export function AccountsPage({
  snapshot,
  loading,
  onAddLogin,
  onRelogin,
  onReload,
}: AccountsPageProps) {
  const accounts = snapshot?.accounts ?? [];
  const now = snapshot?.now ?? Date.now() / 1000;

  const [providerFilter, setProviderFilter] = React.useState<string>("all");
  const [pendingDisabled, setPendingDisabled] = React.useState<
    Record<string, boolean>
  >({});
  const [resettingCooldownId, setResettingCooldownId] = React.useState<
    string | null
  >(null);
  const [removeTarget, setRemoveTarget] =
    React.useState<RemoveTargetState | null>(null);
  const [resetDialog, setResetDialog] = React.useState<ResetDialogState | null>(
    null,
  );
  const resetReadSeqRef = React.useRef(0);

  const presentProviders = React.useMemo(() => {
    const known = Object.keys(PROVIDERS).filter((provider) =>
      accounts.some((account) => account.provider === provider),
    );
    const extra = Array.from(
      new Set(
        accounts
          .map((account) => account.provider)
          .filter((provider) => !(provider in PROVIDERS)),
      ),
    );
    return [...known, ...extra];
  }, [accounts]);

  const activeFilter =
    providerFilter === "all" || presentProviders.includes(providerFilter)
      ? providerFilter
      : "all";

  const filteredAccounts = React.useMemo(() => {
    if (activeFilter === "all") return accounts;
    return accounts.filter((account) => account.provider === activeFilter);
  }, [accounts, activeFilter]);

  const providerCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const account of accounts) {
      counts.set(account.provider, (counts.get(account.provider) ?? 0) + 1);
    }
    return counts;
  }, [accounts]);

  const accountIndexMap = React.useMemo(() => {
    const map = new Map<string, number>();
    accounts.forEach((account, index) => {
      map.set(account.id, index);
    });
    return map;
  }, [accounts]);

  const totalSuccess = React.useMemo(
    () => accounts.reduce((sum, account) => sum + account.success, 0),
    [accounts],
  );

  async function handleToggleRotation(
    account: Account,
    label: string,
    nextDisabled: boolean,
  ) {
    if (account.id in pendingDisabled) return;
    setPendingDisabled((prev) => ({ ...prev, [account.id]: nextDisabled }));
    try {
      await apiPost<OkResponse>("account/status", {
        id: account.id,
        disabled: nextDisabled,
      });
      toast.success(nextDisabled ? "Account paused" : "Account resumed", {
        description: nextDisabled
          ? `${label} is excluded from rotation.`
          : `${label} is back in rotation.`,
      });
      await onReload();
    } catch (err) {
      toast.error("Couldn't update the account", {
        description:
          err instanceof Error ? err.message : "Request failed. Try again.",
      });
    } finally {
      setPendingDisabled((prev) => {
        if (!(account.id in prev)) return prev;
        const next = { ...prev };
        delete next[account.id];
        return next;
      });
    }
  }

  async function handleResetCooldown(account: Account, label: string) {
    if (resettingCooldownId === account.id) return;
    setResettingCooldownId(account.id);
    try {
      await apiPost<OkResponse>("account/cooldown", { id: account.id });
      toast.success("Cooldown cleared", {
        description: `${label} is back in rotation.`,
      });
      await onReload();
    } catch (err) {
      toast.error("Couldn't reset the cooldown", {
        description:
          err instanceof Error ? err.message : "Request failed. Try again.",
      });
    } finally {
      setResettingCooldownId((prev) => (prev === account.id ? null : prev));
    }
  }

  async function handleConfirmRemove() {
    if (!removeTarget) return;
    const { account, label } = removeTarget;
    try {
      await apiPost<OkResponse>("account/remove", { id: account.id });
      toast.success("Account removed", {
        description: `${label} is no longer in the pool.`,
      });
      await onReload();
    } catch (err) {
      toast.error("Couldn't remove the account", {
        description:
          err instanceof Error ? err.message : "Request failed. Try again.",
      });
    }
  }

  function pickDefaultGrant(resets: AccountResets | null): string {
    const items = resets && resets.available > 0 ? resets.items : [];
    const firstUsable = items.find((item) => !item.reason && item.left > 0);
    return firstUsable?.id ?? "";
  }

  async function openResetDialog(account: Account, label: string) {
    if (!account.resets) return;
    const isClaude = account.provider === "claude";
    const readSeq = ++resetReadSeqRef.current;

    if (isClaude) {
      setResetDialog({
        account,
        label,
        resets: account.resets,
        loading: false,
        submitting: false,
        selectedGrant: pickDefaultGrant(account.resets),
        error: "",
        retrySame: false,
      });
      return;
    }

    setResetDialog({
      account,
      label,
      resets: null,
      loading: true,
      submitting: false,
      selectedGrant: "",
      error: "",
      retrySame: false,
    });

    try {
      const freshResets = await apiPost<AccountResets>(
        "account/reset-options",
        { id: account.id },
      );
      if (readSeq !== resetReadSeqRef.current) return;
      setResetDialog((prev) =>
        prev && prev.account.id === account.id
          ? {
              ...prev,
              resets: freshResets,
              loading: false,
              selectedGrant: pickDefaultGrant(freshResets),
              error: "",
            }
          : prev,
      );
      void onReload();
    } catch (err) {
      if (readSeq !== resetReadSeqRef.current) return;
      setResetDialog((prev) =>
        prev && prev.account.id === account.id
          ? {
              ...prev,
              loading: false,
              error:
                err instanceof Error
                  ? err.message
                  : "Couldn't check reset credits.",
            }
          : prev,
      );
    }
  }

  function closeResetDialog() {
    resetReadSeqRef.current += 1;
    setResetDialog(null);
  }

  async function handleConfirmReset() {
    if (!resetDialog || resetDialog.loading || resetDialog.submitting) return;
    const { account, label, selectedGrant } = resetDialog;
    setResetDialog((prev) =>
      prev ? { ...prev, submitting: true, error: "" } : prev,
    );

    try {
      await apiPost<OkResponse>(
        "account/reset",
        selectedGrant ? { id: account.id, grant: selectedGrant } : { id: account.id },
      );
      resetReadSeqRef.current += 1;
      setResetDialog(null);
      toast.success("Reset used", {
        description: `${label}'s limits are clearing. Quotas update ${
          account.provider === "claude" ? "within a few minutes" : "in a moment"
        }.`,
      });
      await onReload();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't apply the reset.";
      setResetDialog((prev) =>
        prev
          ? {
              ...prev,
              submitting: false,
              error: message,
              retrySame: prev.retrySame || /outcome is unknown/i.test(message),
            }
          : prev,
      );
    }
  }

  if (!loading && snapshot && accounts.length === 0) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardHeader className="flex-col items-center">
          <CardTitle>
            {snapshot.error
              ? "Waiting for the proxy"
              : "Your account pool starts here"}
          </CardTitle>
          <CardDescription>
            {snapshot.error
              ? "The connection will be checked automatically."
              : "Add a login to start pooling accounts and tracking their quotas."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button variant="default" onClick={() => onAddLogin()}>
            <PlusIcon className="size-4" aria-hidden="true" />
            Add login
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading && !snapshot) {
    return (
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-4 px-4 py-3.5"
            >
              <div className="flex items-center gap-2.5">
                <span className="size-4 animate-pulse rounded-full bg-secondary" />
                <span className="h-4 w-44 animate-pulse rounded bg-secondary" />
              </div>
              <span className="h-4 w-24 animate-pulse rounded bg-secondary" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  const resetItems: ResetItem[] =
    resetDialog?.resets && resetDialog.resets.available > 0
      ? resetDialog.resets.items
      : [];
  const resetHasUsable = resetItems.some(
    (item) => !item.reason && item.left > 0,
  );
  const resetTitlesNumbered =
    new Set(resetItems.map((item) => item.label)).size < resetItems.length;
  const resetIsClaude = resetDialog?.account.provider === "claude";

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={activeFilter}
        onValueChange={(value) => {
          if (value) setProviderFilter(value);
        }}
      >
        <TabsList
          aria-label="Filter provider"
          className="max-w-full flex-wrap"
        >
          <TabsTab value="all">
            <LayersIcon className="size-4" aria-hidden="true" />
            <span>All</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {accounts.length}
            </span>
          </TabsTab>
          {presentProviders.map((provider) => (
            <TabsTab key={provider} value={provider}>
              <ProviderIcon provider={provider} className="size-4" />
              <span>{pName(provider)}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {providerCounts.get(provider) ?? 0}
              </span>
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Accounts share one endpoint. Paused accounts are excluded from
          rotation.
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {filteredAccounts.map((account) => {
            const index = accountIndexMap.get(account.id) ?? 0;
            const label = accountLabel(account, index);
            const subtitle = accountSubtitle(account);
            const status = accountStatus(account);
            const reason = accountStatusReason(account, now);
            const primaryWindow =
              account.windows.find((window) => window.period === 5 * 3600) ??
              account.windows[0];
            const remainingPct = primaryWindow
              ? Math.max(0, Math.min(100, primaryWindow.remaining))
              : 0;

            const isPendingToggle = account.id in pendingDisabled;
            const effectiveDisabled = isPendingToggle
              ? pendingDisabled[account.id]
              : account.disabled;
            const inRotation = !effectiveDisabled;

            const cooldownResettable =
              canResetCooldown(account, now) &&
              resettingCooldownId !== account.id;
            const hasResetItems = Boolean(account.resets?.items?.length);
            const resetsAvailable = account.resets?.available ?? 0;

            return (
              <article
                key={account.id}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 text-sm leading-5",
                  "transition-colors hover:bg-white/[0.02]",
                  "sm:grid-cols-[minmax(0,1fr)_minmax(170px,1fr)_auto] sm:gap-x-4 sm:py-2.5",
                  "lg:grid-cols-[minmax(0,1.5fr)_minmax(180px,1fr)_minmax(0,1.5fr)_auto] lg:gap-6",
                )}
              >
                {/* Identity */}
                <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
                  <ProviderIcon
                    provider={account.provider}
                    className="mr-0.5 size-4 shrink-0"
                  />
                  <span
                    className="truncate font-medium text-foreground"
                    title={label}
                  >
                    {label}
                  </span>
                  {subtitle ? (
                    <span className="shrink-0 text-muted-foreground">
                      {subtitle}
                    </span>
                  ) : null}
                </div>

                {/* Quota meter */}
                <div className="col-span-full row-start-2 flex min-w-0 items-center gap-3 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  <div
                    className="h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-white/10"
                    aria-hidden="true"
                  >
                    <span
                      className="block h-full w-full origin-left rounded-full transition-transform duration-200 ease-out motion-reduce:transition-none"
                      style={{
                        backgroundColor: providerColor(account.provider),
                        transform: `scaleX(${remainingPct / 100})`,
                      }}
                    />
                  </div>
                  <span className="w-11 shrink-0 text-right font-mono text-[13px] font-medium tabular-nums text-foreground">
                    {primaryWindow ? fmtPct(primaryWindow.remaining) : "—"}
                  </span>
                  <span
                    className="w-16 shrink-0 whitespace-nowrap text-right font-mono text-xs tabular-nums text-muted-foreground"
                    title={account.quota_error ? "Last known quota" : undefined}
                  >
                    {age(account.quota_at)}
                  </span>
                </div>

                {/* Status */}
                <div className="col-span-full row-start-3 flex min-w-0 flex-wrap items-center gap-2 sm:row-start-2 lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:flex-nowrap">
                  <Badge variant={STATUS_TONE_VARIANT[status.tone]}>
                    {status.label}
                  </Badge>
                  {resetsAvailable > 0 ? (
                    <Badge
                      variant="outline"
                      title="Manual resets available. Use one from the account menu."
                    >
                      {resetsAvailable} reset{resetsAvailable === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                  <span
                    className="min-w-0 truncate text-muted-foreground"
                    title={reason}
                  >
                    {reason}
                  </span>
                  {account.requires_sign_in ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRelogin(account)}
                    >
                      Sign in again
                    </Button>
                  ) : null}
                </div>

                {/* Actions */}
                <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 sm:col-start-3 lg:col-start-4">
                  <Switch
                    checked={inRotation}
                    disabled={isPendingToggle}
                    aria-label={`Include ${label} in rotation`}
                    title={
                      effectiveDisabled
                        ? "Paused: excluded from rotation"
                        : "In rotation"
                    }
                    onCheckedChange={(checked) => {
                      void handleToggleRotation(account, label, !checked);
                    }}
                  />

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`More actions for ${label}`}
                      className={buttonVariants({
                        variant: "ghost",
                        size: "icon-sm",
                        className:
                          "text-muted-foreground hover:text-foreground data-[open]:bg-accent data-[open]:text-foreground",
                      })}
                    >
                      <MoreHorizontalIcon
                        className="size-4"
                        aria-hidden="true"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={6}>
                      <DropdownMenuItem onSelect={() => onRelogin(account)}>
                        <DropdownMenuItemIcon>
                          <LogInIcon
                            className="size-4 text-muted-foreground"
                            aria-hidden="true"
                          />
                        </DropdownMenuItemIcon>
                        <span>Sign in again</span>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        disabled={!cooldownResettable}
                        onSelect={() => {
                          void handleResetCooldown(account, label);
                        }}
                      >
                        <DropdownMenuItemIcon>
                          <RotateCcwIcon
                            className="size-4 text-muted-foreground"
                            aria-hidden="true"
                          />
                        </DropdownMenuItemIcon>
                        <span>Reset cooldown</span>
                      </DropdownMenuItem>

                      {hasResetItems ? (
                        <DropdownMenuItem
                          disabled={resetsAvailable <= 0}
                          onSelect={() => {
                            void openResetDialog(account, label);
                          }}
                        >
                          <DropdownMenuItemIcon>
                            <RefreshCwIcon
                              className="size-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                          </DropdownMenuItemIcon>
                          <span>Use a reset…</span>
                        </DropdownMenuItem>
                      ) : null}

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        destructive
                        onSelect={() => setRemoveTarget({ account, label })}
                      >
                        <DropdownMenuItemIcon>
                          <Trash2Icon className="size-4" aria-hidden="true" />
                        </DropdownMenuItemIcon>
                        <span>Remove account</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </article>
            );
          })}
        </div>
      </Card>

      <footer className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">
          {totalSuccess.toLocaleString()} successful request
          {totalSuccess === 1 ? "" : "s"}
        </span>
      </footer>

      {/* Confirm remove account dialog */}
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={removeTarget ? `Remove ${removeTarget.label}?` : "Remove account?"}
        description="The proxy stops using this login and deletes its credential file. This can't be undone."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={handleConfirmRemove}
      />

      {/* Manual reset picker dialog */}
      <Dialog
        open={resetDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            if (resetDialog?.submitting) return;
            closeResetDialog();
          }
        }}
      >
        <DialogBackdrop />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {resetDialog
                ? `Use a reset on ${resetDialog.label}?`
                : "Use a reset?"}
            </DialogTitle>
            <DialogDescription>
              {resetDialog && !resetDialog.loading && resetItems.length === 0
                ? "This account has no resets available."
                : "Choose a reset. It clears this account's usage limits right away and can't be given back."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {resetDialog?.loading ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-4 text-sm text-muted-foreground">
                <Loader2Icon
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                <span>Checking resets…</span>
              </div>
            ) : resetItems.length > 0 ? (
              <div
                role="radiogroup"
                aria-label="Resets"
                className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border"
              >
                {resetItems.map((item, itemIndex) => {
                  const title = resetTitlesNumbered
                    ? `Reset ${itemIndex + 1}`
                    : item.label;
                  const disabled = Boolean(item.reason) || item.left <= 0;
                  const checked = resetDialog?.selectedGrant === item.id;
                  const claudeMeta = [
                    item.total > 1 ? `${item.left} of ${item.total} left` : "",
                    item.reason ||
                      (item.expires_at
                        ? `Expires ${dateLabel(item.expires_at)} · ${formatExpiryRelative(item.expires_at)}`
                        : ""),
                  ]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <label
                      key={item.id}
                      className={cn(
                        "flex min-h-11 items-center gap-3 px-3 py-2.5 transition-colors",
                        disabled
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer hover:bg-secondary/40",
                        checked && !disabled && "bg-secondary/50",
                      )}
                    >
                      <input
                        type="radio"
                        name="reset-grant"
                        value={item.id}
                        checked={checked}
                        disabled={disabled || resetDialog?.submitting}
                        onChange={() => {
                          setResetDialog((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  selectedGrant: item.id,
                                  error: "",
                                  retrySame: false,
                                }
                              : prev,
                          );
                        }}
                        className="size-4 accent-primary"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium leading-5 text-foreground">
                          {title}
                        </span>
                        {resetIsClaude && claudeMeta ? (
                          <span className="text-xs leading-4.5 tabular-nums text-muted-foreground">
                            {claudeMeta}
                          </span>
                        ) : null}
                      </span>
                      {!resetIsClaude && item.expires_at ? (
                        <span className="shrink-0 text-right text-xs leading-4.5 tabular-nums text-muted-foreground">
                          Expires{" "}
                          <strong className="font-normal text-foreground">
                            {dateLabel(item.expires_at)}
                          </strong>{" "}
                          · {formatExpiryRelative(item.expires_at)}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            ) : null}

            {resetDialog?.error ? (
              <p role="alert" className="text-sm text-destructive">
                {resetDialog.error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <DialogClose
              disabled={Boolean(resetDialog?.submitting)}
              className={buttonVariants({ variant: "outline" })}
            >
              Cancel
            </DialogClose>
            <Button
              variant="default"
              disabled={
                !resetDialog ||
                resetDialog.loading ||
                resetDialog.submitting ||
                !resetHasUsable ||
                !resetDialog.selectedGrant
              }
              onClick={() => void handleConfirmReset()}
            >
              {resetDialog?.loading ? (
                <>
                  <Loader2Icon
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                  Checking resets…
                </>
              ) : resetDialog?.submitting ? (
                <>
                  <Loader2Icon
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                  Using reset…
                </>
              ) : resetDialog?.retrySame ? (
                "Retry same request"
              ) : (
                "Use reset"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
