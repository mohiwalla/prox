import { useState } from "react";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@ui-sdk/react/menu";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { Icon, ProviderIcon } from "../components/BrandSprite";
import { MorphText } from "../components/MorphText";
import { ProviderTabs, type ProviderTabOption } from "../components/ProviderTabs";
import { api, notify } from "../lib/api";
import {
  accountLabel,
  age,
  canResetCooldown,
  fmtPct,
  pName,
  planLabel,
  status,
  statusReason,
} from "../lib/format";
import type { Account, ConfirmAction, SnapshotData } from "../lib/types";

export function AccountsPage({
  data,
  provider,
  providerOptions,
  onProviderChange,
  onReload,
  onRelogin,
  onReset,
  onConfirm,
}: {
  data: SnapshotData;
  provider: string;
  providerOptions: ProviderTabOption[];
  onProviderChange: (p: string) => void;
  onReload: () => Promise<void>;
  onRelogin: (account: Account, label: string) => void;
  onReset: (account: Account, label: string) => void;
  onConfirm: (action: ConfirmAction) => void;
}) {
  const [pendingPause, setPendingPause] = useState<Record<string, boolean>>({});
  const [optimisticDisabled, setOptimisticDisabled] = useState<
    Record<string, boolean>
  >({});

  const visibleAccounts = data.accounts.filter(
    (a) => provider === "all" || a.provider === provider,
  );

  async function toggleRotation(a: Account, label: string, nextChecked: boolean) {
    if (pendingPause[a.id]) return;
    const pause = !nextChecked;
    setPendingPause((prev) => ({ ...prev, [a.id]: true }));
    setOptimisticDisabled((prev) => ({ ...prev, [a.id]: pause }));
    try {
      await api("account/status", { id: a.id, disabled: pause });
      notify(
        pause ? "Account paused" : "Account resumed",
        "success",
        pause
          ? `${label} is excluded from rotation.`
          : `${label} is back in rotation.`,
      );
      await onReload();
    } catch (err) {
      notify(
        "Couldn't update the account",
        "error",
        err instanceof Error ? err.message : "Request failed.",
      );
    } finally {
      setOptimisticDisabled((prev) => {
        const next = { ...prev };
        delete next[a.id];
        return next;
      });
      setPendingPause((prev) => {
        const next = { ...prev };
        delete next[a.id];
        return next;
      });
    }
  }

  async function resetCooldown(a: Account, label: string) {
    try {
      await api("account/cooldown", { id: a.id });
      notify("Cooldown cleared", "success", `${label} is back in rotation.`);
      await onReload();
    } catch (err) {
      notify(
        "Couldn't reset the cooldown",
        "error",
        err instanceof Error ? err.message : "Request failed.",
      );
    }
  }

  function confirmRemove(a: Account, label: string) {
    onConfirm({
      title: `Remove ${label}?`,
      description:
        "The proxy stops using this login and deletes its credential file. This can’t be undone.",
      label: "Remove",
      busy: "Removing…",
      failure: "Couldn't remove the account",
      returnFocus: () =>
        document.querySelector<HTMLElement>(
          `[data-menu="${CSS.escape(a.id)}"]`,
        ),
      run: () => api("account/remove", { id: a.id }),
      async done() {
        notify("Account removed", "success", `${label} is no longer in the pool.`);
        await onReload();
      },
    });
  }

  const totalSuccess = data.accounts.reduce((s, a) => s + a.success, 0);

  return (
    <>
      <ProviderTabs
        value={provider}
        options={providerOptions}
        onChange={onProviderChange}
      />

      <div className="page-toolbar">
        <p className="muted">
          Accounts share one endpoint. Paused accounts are excluded from
          rotation.
        </p>
      </div>

      <div className="account-list">
        {visibleAccounts.map((a, i) => {
          const effectiveDisabled =
            a.id in optimisticDisabled ? optimisticDisabled[a.id] : a.disabled;
          const displayAccount =
            effectiveDisabled === a.disabled
              ? a
              : { ...a, disabled: effectiveDisabled };
          const [tagLabel, tagTone] = status(displayAccount);
          const w =
            a.windows.find((win) => win.period === 5 * 3600) || a.windows[0];
          const label = accountLabel(a, i);
          const sub = [planLabel(a.plan), pName(a.provider)]
            .filter((v, n, all) => Boolean(v) && all.indexOf(v) === n)
            .join(" · ");
          const reason = statusReason(displayAccount, data.now);
          const scale =
            Math.max(0, Math.min(100, w?.remaining || 0)) / 100;

          return (
            <article
              key={a.id}
              className={`account-row provider-${a.provider}`}
              data-account={a.id}
            >
              <div className="account-identity">
                <ProviderIcon provider={a.provider} />
                <span className="account-label" title={label}>
                  {label}
                </span>
                <span className="account-sub">{sub}</span>
              </div>

              <div className="account-quota">
                <div className="meter">
                  <span style={{ transform: `scaleX(${scale})` }} />
                </div>
                <span className="quota-value">
                  <MorphText text={w ? fmtPct(w.remaining) : "—"} />
                </span>
                <span
                  className="account-meta"
                  title={a.quota_error ? "Last known quota" : undefined}
                >
                  <MorphText text={age(a.quota_at)} />
                </span>
              </div>

              <div className="account-status">
                <span className={`tag ${tagTone}`}>
                  <MorphText text={tagLabel} />
                </span>
                {Boolean(a.resets?.available) && (
                  <span
                    className="tag reset-count"
                    title="Manual resets available. Use one from the account menu."
                  >
                    <MorphText
                      text={`${a.resets!.available} reset${a.resets!.available === 1 ? "" : "s"}`}
                    />
                  </span>
                )}
                <span className="account-reason" title={reason}>
                  <MorphText text={reason} />
                </span>
                {a.requires_sign_in && (
                  <button
                    type="button"
                    className="outline sm"
                    data-relogin={a.id}
                    onClick={() => onRelogin(a, label)}
                  >
                    Sign in again
                  </button>
                )}
              </div>

              <div className="account-actions">
                <Switch
                  className="switch"
                  checked={!effectiveDisabled}
                  disabled={Boolean(pendingPause[a.id])}
                  aria-label={`Include ${label} in rotation`}
                  title={
                    effectiveDisabled
                      ? "Paused: excluded from rotation"
                      : "In rotation"
                  }
                  data-pause={a.id}
                  data-disabled={String(!effectiveDisabled)}
                  onCheckedChange={(checked) => toggleRotation(a, label, checked)}
                >
                  <SwitchThumb className="switch-thumb" />
                </Switch>

                <Menu>
                  <MenuTrigger
                    className="ghost icon-btn sm row-menu"
                    data-menu={a.id}
                    aria-label={`More actions for ${label}`}
                  >
                    <Icon name="more" />
                  </MenuTrigger>
                  <MenuContent
                    className="menu"
                    aria-label="Account actions"
                    side="bottom"
                    align="end"
                    sideOffset={4}
                  >
                    <MenuItem
                      className="menu-item"
                      data-action="relogin"
                      onSelect={() => onRelogin(a, label)}
                    >
                      <Icon name="login" />
                      <span>Sign in again</span>
                    </MenuItem>
                    <MenuItem
                      className="menu-item"
                      data-action="cooldown"
                      disabled={!canResetCooldown(a)}
                      onSelect={() => resetCooldown(a, label)}
                    >
                      <Icon name="reset" />
                      <span>Reset cooldown</span>
                    </MenuItem>
                    {Boolean(a.resets?.items?.length) && (
                      <MenuItem
                        className="menu-item"
                        data-action="use-reset"
                        disabled={!a.resets?.available}
                        onSelect={() => onReset(a, label)}
                      >
                        <Icon name="refresh" />
                        <span>Use a reset…</span>
                      </MenuItem>
                    )}
                    <MenuSeparator className="menu-separator" />
                    <MenuItem
                      className="menu-item danger"
                      data-action="remove"
                      destructive
                      onSelect={() => confirmRemove(a, label)}
                    >
                      <Icon name="trash" />
                      <span>Remove account</span>
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </div>
            </article>
          );
        })}
      </div>

      <footer className="footnote">
        <span>{totalSuccess.toLocaleString()} successful requests</span>
      </footer>
    </>
  );
}
