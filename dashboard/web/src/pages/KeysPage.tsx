import { useCallback, useEffect, useState } from "react";
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
import { api, notify } from "../lib/api";
import { fmtTokens, pName, PROVIDERS } from "../lib/format";
import type {
  ClientKey,
  ConfirmAction,
  KeyOptions,
  KeysListResponse,
} from "../lib/types";
import { KeyFormDialog } from "./keys/KeyFormDialog";
import { KeySecretDialog, type SecretModalState } from "./keys/KeySecretDialog";
import { KeyUsageDialog } from "./keys/KeyUsageDialog";

export function KeysPage({
  refreshTick,
  onMetaChange,
  onConfirm,
}: {
  refreshTick: number;
  onMetaChange: (meta: string) => void;
  onConfirm: (action: ConfirmAction) => void;
}) {
  const [list, setList] = useState<ClientKey[] | null>(null);
  const [options, setOptions] = useState<KeyOptions | null>(null);
  const [baseUrl, setBaseUrl] = useState(
    () => (typeof location !== "undefined" ? location.origin : ""),
  );
  const [error, setError] = useState("");
  const [usageKeyId, setUsageKeyId] = useState<string | null>(null);
  const [usageRefreshSeq, setUsageRefreshSeq] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<ClientKey | null>(null);
  const [secretModal, setSecretModal] = useState<SecretModalState | null>(null);
  const [pendingToggle, setPendingToggle] = useState<Record<string, boolean>>(
    {},
  );
  const [optimisticEnabled, setOptimisticEnabled] = useState<
    Record<string, boolean>
  >({});

  const loadKeys = useCallback(async () => {
    try {
      const [keysRes, optsRes] = await Promise.all([
        api<KeysListResponse>("keys"),
        api<KeyOptions>("keys/options"),
      ]);
      const keys = keysRes.keys || [];
      setList(keys);
      setBaseUrl(keysRes.base_url || location.origin);
      setOptions(optsRes);
      setError("");
      setUsageKeyId((prev) =>
        prev && !keys.some((k) => k.id === prev) ? null : prev,
      );
      setUsageRefreshSeq((s) => s + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load keys.");
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys, refreshTick]);

  useEffect(() => {
    if (!list) {
      onMetaChange("Loading keys…");
    } else {
      const on = list.filter((k) => k.enabled).length;
      onMetaChange(
        `${list.length} key${list.length === 1 ? "" : "s"} · ${on} enabled`,
      );
    }
  }, [list, onMetaChange]);

  const accountLabelFor = (id: string) => {
    if (!id) return "Unknown account";
    return options?.accounts.find((a) => a.id === id)?.label || id;
  };

  async function toggleEnabled(k: ClientKey, nextEnabled: boolean) {
    if (pendingToggle[k.id]) return;
    setPendingToggle((prev) => ({ ...prev, [k.id]: true }));
    setOptimisticEnabled((prev) => ({ ...prev, [k.id]: nextEnabled }));
    try {
      const r = await api<{ key: ClientKey }>("keys/update", {
        id: k.id,
        enabled: nextEnabled,
      });
      setList((prev) =>
        prev ? prev.map((item) => (item.id === k.id ? { ...item, ...r.key } : item)) : prev,
      );
      notify(
        nextEnabled ? "Key enabled" : "Key disabled",
        "success",
        nextEnabled
          ? `${k.name} can make requests again.`
          : `Requests with ${k.name} are refused.`,
      );
    } catch (err) {
      notify(
        "Couldn't update the key",
        "error",
        err instanceof Error ? err.message : "Request failed.",
      );
    } finally {
      setOptimisticEnabled((prev) => {
        const next = { ...prev };
        delete next[k.id];
        return next;
      });
      setPendingToggle((prev) => {
        const next = { ...prev };
        delete next[k.id];
        return next;
      });
    }
  }

  function confirmRotate(k: ClientKey) {
    onConfirm({
      title: `Rotate ${k.name}?`,
      description:
        "A new secret replaces this key's secret right away. Clients using the current one stop working until they get the new one.",
      label: "Rotate key",
      busy: "Rotating…",
      failure: "Couldn't rotate the key",
      run: () => api<{ key: ClientKey; secret: string }>("keys/rotate", { id: k.id }),
      done(res) {
        const r = res as { key: ClientKey; secret: string };
        setList((prev) =>
          prev
            ? prev.map((item) => (item.id === k.id ? { ...item, ...r.key } : item))
            : prev,
        );
        setSecretModal({ key: r.key, secret: r.secret, how: "rotated" });
      },
    });
  }

  function confirmDelete(k: ClientKey) {
    onConfirm({
      title: `Delete ${k.name}?`,
      description:
        "Clients using this key stop working right away and its usage history is deleted. This can’t be undone.",
      label: "Delete key",
      busy: "Deleting…",
      failure: "Couldn't delete the key",
      run: () => api("keys/delete", { id: k.id }),
      async done() {
        notify("Key deleted", "success", `${k.name} no longer works.`);
        if (usageKeyId === k.id) setUsageKeyId(null);
        await loadKeys();
      },
    });
  }

  const activeUsageKey =
    (usageKeyId && list?.find((k) => k.id === usageKeyId)) || null;

  return (
    <div className="keys" id="keys-live">
      <div className="page-toolbar">
        <p>
          Each client uses its own key. The proxy enforces each key's
          restrictions and weekly limit.
        </p>
        {Boolean(list?.length) && (
          <button
            type="button"
            className="primary sm"
            data-key-new=""
            onClick={() => {
              setEditingKey(null);
              setFormOpen(true);
            }}
          >
            <Icon name="plus" />
            New key
          </button>
        )}
      </div>

      {error && list && (
        <div className="notice error">
          <Icon name="warning" />
          <span>{error}</span>
        </div>
      )}

      {error && !list ? (
        <div className="notice error">
          <Icon name="warning" />
          <span>{error}</span>
        </div>
      ) : !list ? (
        <div className="logs-loading">
          <span className="loading-mark" />
          Loading keys…
        </div>
      ) : !list.length ? (
        <div className="state-card">
          <h2>No client keys yet</h2>
          <p>
            Give each client its own key to limit which providers, accounts and
            models it uses, cap its weekly tokens and see its usage.
          </p>
          <button
            type="button"
            className="primary"
            data-key-new=""
            onClick={() => {
              setEditingKey(null);
              setFormOpen(true);
            }}
          >
            <Icon name="plus" />
            New key
          </button>
        </div>
      ) : (
        <div className="key-list">
          {list.map((k) => {
            const enabled =
              k.id in optimisticEnabled ? optimisticEnabled[k.id] : k.enabled;
            const chips: React.ReactNode[] = [
              ...k.providers.map((p) => (
                <span
                  className="tag outline"
                  key={`p-${p}`}
                  title={`Provider: ${pName(p)}`}
                >
                  {PROVIDERS[p] && <ProviderIcon provider={p} />}
                  <span>{pName(p)}</span>
                </span>
              )),
              ...k.accounts.map((a) => (
                <span
                  className="tag outline"
                  key={`a-${a}`}
                  title={`Account: ${accountLabelFor(a)}`}
                >
                  <Icon name="accounts" />
                  <span>{accountLabelFor(a)}</span>
                </span>
              )),
              ...k.models.map((m) => (
                <span
                  className="tag outline model"
                  key={`m-${m}`}
                  title={`Model: ${m}`}
                >
                  <span>{m}</span>
                </span>
              )),
            ];

            const share = k.weekly_token_limit
              ? Math.min(1, k.weekly_tokens / k.weekly_token_limit)
              : 0;

            return (
              <article
                key={k.id}
                className="key-row"
                data-key={k.id}
                data-enabled={String(enabled)}
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest("button, [role='switch'], [role='menu']"))
                    return;
                  if (window.getSelection()?.toString()) return;
                  setUsageKeyId(k.id);
                }}
              >
                <div className="key-identity">
                  <button
                    type="button"
                    className="key-name"
                    data-key-open={k.id}
                    title={k.name}
                    onClick={() => setUsageKeyId(k.id)}
                  >
                    {k.name}
                  </button>
                  <code className="key-hint">cpk_…{k.hint}</code>
                </div>

                <div className="key-scope">
                  {chips.length ? (
                    <>
                      {chips.slice(0, 4)}
                      {chips.length > 4 && (
                        <span className="tag outline any">
                          +{chips.length - 4}
                        </span>
                      )}
                    </>
                  ) : (
                    <span
                      className="tag outline any"
                      title="Any provider, account and model"
                    >
                      Any
                    </span>
                  )}
                </div>

                {k.weekly_token_limit ? (
                  <div
                    className="key-usage"
                    title={`${k.weekly_tokens.toLocaleString()} of ${k.weekly_token_limit.toLocaleString()} tokens in the last 7 days`}
                  >
                    <div
                      className={`meter ${share >= 1 ? "full" : share >= 0.8 ? "warning" : ""}`}
                    >
                      <span style={{ transform: `scaleX(${share})` }} />
                    </div>
                    <span className="key-usage-value">
                      <strong>
                        <MorphText text={fmtTokens(k.weekly_tokens)} />
                      </strong>{" "}
                      / {fmtTokens(k.weekly_token_limit)}
                    </span>
                  </div>
                ) : (
                  <div className="key-usage">
                    <span className="key-usage-value">
                      <strong>
                        <MorphText text={fmtTokens(k.weekly_tokens)} />
                      </strong>{" "}
                      this week · no limit
                    </span>
                  </div>
                )}

                <div className="account-actions">
                  <Switch
                    className="switch"
                    checked={enabled}
                    disabled={Boolean(pendingToggle[k.id])}
                    aria-label={`Enable ${k.name}`}
                    title={
                      enabled
                        ? "Enabled"
                        : "Disabled: requests with this key are refused"
                    }
                    data-key-enabled={k.id}
                    onCheckedChange={(checked) => toggleEnabled(k, checked)}
                  >
                    <SwitchThumb className="switch-thumb" />
                  </Switch>

                  <Menu>
                    <MenuTrigger
                      className="ghost icon-btn sm row-menu"
                      data-key-menu={k.id}
                      aria-label={`More actions for ${k.name}`}
                    >
                      <Icon name="more" />
                    </MenuTrigger>
                    <MenuContent
                      className="menu"
                      aria-label="Key actions"
                      side="bottom"
                      align="end"
                      sideOffset={4}
                    >
                      <MenuItem
                        className="menu-item"
                        data-key-action="usage"
                        onSelect={() => setUsageKeyId(k.id)}
                      >
                        <Icon name="gauge" />
                        <span>View usage</span>
                      </MenuItem>
                      <MenuItem
                        className="menu-item"
                        data-key-action="edit"
                        onSelect={() => {
                          setEditingKey(k);
                          setFormOpen(true);
                        }}
                      >
                        <Icon name="edit" />
                        <span>Edit</span>
                      </MenuItem>
                      <MenuItem
                        className="menu-item"
                        data-key-action="rotate"
                        onSelect={() => confirmRotate(k)}
                      >
                        <Icon name="refresh" />
                        <span>Rotate</span>
                      </MenuItem>
                      <MenuSeparator className="menu-separator" />
                      <MenuItem
                        className="menu-item danger"
                        data-key-action="delete"
                        destructive
                        onSelect={() => confirmDelete(k)}
                      >
                        <Icon name="trash" />
                        <span>Delete key</span>
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <KeyFormDialog
        open={formOpen}
        editingKey={editingKey}
        options={options}
        onClose={() => setFormOpen(false)}
        onUpdated={loadKeys}
        onCreated={(key, secret) =>
          setSecretModal({ key, secret, how: "created" })
        }
      />

      <KeySecretDialog
        modal={secretModal}
        baseUrl={baseUrl}
        options={options}
        onClose={() => setSecretModal(null)}
      />

      <KeyUsageDialog
        clientKey={activeUsageKey}
        options={options}
        refreshSeq={usageRefreshSeq}
        onClose={() => setUsageKeyId(null)}
      />
    </div>
  );
}
