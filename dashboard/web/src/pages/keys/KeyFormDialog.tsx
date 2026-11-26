import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Icon, ProviderIcon } from "../../components/BrandSprite";
import { api, notify } from "../../lib/api";
import { fmtTokens, parseTokens, pName, PROVIDERS } from "../../lib/format";
import type { ClientKey, KeyOptionAccount, KeyOptions } from "../../lib/types";

export function KeyFormDialog({
  open,
  editingKey,
  options,
  onClose,
  onCreated,
  onUpdated,
}: {
  open: boolean;
  editingKey: ClientKey | null;
  options: KeyOptions | null;
  onClose: () => void;
  onCreated: (key: ClientKey, secret: string) => void;
  onUpdated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [modelInput, setModelInput] = useState("");
  const [limitText, setLimitText] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const nameRef = useRef<HTMLInputElement | null>(null);
  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const limitRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editingKey?.name || "");
    setNameError("");
    setSelectedProviders([...(editingKey?.providers || [])]);
    setSelectedAccounts([...(editingKey?.accounts || [])]);
    setModels([...(editingKey?.models || [])]);
    setModelInput("");
    setLimitText(
      editingKey?.weekly_token_limit
        ? fmtTokens(editingKey.weekly_token_limit)
        : "",
    );
    setFormError("");
    setBusy(false);
  }, [open, editingKey]);

  const opts = options || { providers: [], accounts: [], models: [] };

  const allProviders = useMemo(
    () => [...new Set([...opts.providers, ...(editingKey?.providers || [])])],
    [opts.providers, editingKey?.providers],
  );

  const allAccounts: KeyOptionAccount[] = useMemo(() => {
    const known = new Set(opts.accounts.map((a) => a.id));
    return [
      ...opts.accounts,
      ...(editingKey?.accounts || [])
        .filter((id) => !known.has(id))
        .map((id) => ({ id, provider: "", label: id, missing: true })),
    ];
  }, [opts.accounts, editingKey?.accounts]);

  const accountGroups = useMemo(
    () => [...new Set(allAccounts.map((a) => a.provider))],
    [allAccounts],
  );

  const visibleAccountGroups = useMemo(
    () =>
      accountGroups.filter(
        (g) => selectedProviders.length === 0 || selectedProviders.includes(g),
      ),
    [accountGroups, selectedProviders],
  );

  function toggleProvider(p: string) {
    setSelectedProviders((prev) => {
      const next = prev.includes(p)
        ? prev.filter((item) => item !== p)
        : [...prev, p];
      if (next.length > 0) {
        const nextSet = new Set(next);
        setSelectedAccounts((prevAccs) =>
          prevAccs.filter((accId) => {
            const acc = allAccounts.find((a) => a.id === accId);
            if (!acc || !acc.provider) return true;
            return nextSet.has(acc.provider);
          }),
        );
      }
      return next;
    });
  }

  function toggleAccount(id: string) {
    setSelectedAccounts((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function addModelChips(raw: string) {
    const tokens = raw.toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (tokens.length) {
      setModels((prev) => {
        const next = [...prev];
        for (const t of tokens) {
          if (!next.includes(t)) next.push(t);
        }
        return next;
      });
    }
    setModelInput("");
  }

  const parsedLimit = parseTokens(limitText);
  const limitInvalid = Number.isNaN(parsedLimit);
  const limitHelp = limitInvalid
    ? "Use a number like 5M, 500k or 2,000,000."
    : parsedLimit
      ? `${parsedLimit.toLocaleString()} tokens over any 7 days. Input and output count; cache reads don't.`
      : "No limit. Type a number like 5M or 500k to cap tokens over any 7 days.";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    let finalModels = models;
    if (modelInput.trim()) {
      const extra = modelInput.toLowerCase().split(/[\s,]+/).filter(Boolean);
      finalModels = [...models];
      for (const t of extra) {
        if (!finalModels.includes(t)) finalModels.push(t);
      }
      setModels(finalModels);
      setModelInput("");
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Name the key, e.g. after the person or app using it.");
      nameRef.current?.focus();
      return;
    }
    const limit = parseTokens(limitText);
    if (Number.isNaN(limit)) {
      limitRef.current?.focus();
      return;
    }

    const body = {
      name: trimmedName,
      providers: selectedProviders,
      accounts: selectedAccounts,
      models: finalModels,
      weekly_token_limit: limit,
    };

    setFormError("");
    setBusy(true);
    try {
      if (editingKey) {
        await api("keys/update", { id: editingKey.id, ...body });
        notify(
          "Key updated",
          "success",
          `${trimmedName}'s settings apply to its next request.`,
        );
        onClose();
        await onUpdated();
      } else {
        const r = await api<{ key: ClientKey; secret: string }>(
          "keys/create",
          body,
        );
        onClose();
        await onUpdated();
        onCreated(r.key, r.secret);
      }
    } catch (err) {
      setBusy(false);
      setFormError(
        err instanceof Error ? err.message : "Couldn't save the key.",
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent
        id="key-dialog"
        className="ui-modal"
        initialFocus={() => nameRef.current}
      >
        <DialogClose
          className="dialog-close ghost icon-btn sm"
          id="key-close"
          aria-label="Close"
        >
          <Icon name="close" />
        </DialogClose>
        <header className="dialog-header">
          <DialogTitle id="key-title">
            {editingKey ? `Edit ${editingKey.name}` : "New key"}
          </DialogTitle>
          <DialogDescription id="key-description" className="dialog-description">
            {editingKey
              ? "Changes apply to the next request made with this key."
              : "Leave a restriction empty to allow anything. The secret is shown once, after you create the key."}
          </DialogDescription>
        </header>

        <form id="key-form" className="dialog-body" noValidate onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="key-name">Name</label>
            <input
              ref={nameRef}
              id="key-name"
              maxLength={80}
              autoComplete="off"
              placeholder="Who uses this key"
              aria-describedby="key-name-error"
              aria-invalid={nameError ? "true" : undefined}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError("");
              }}
            />
            <p className="field-error" id="key-name-error" hidden={!nameError}>
              {nameError}
            </p>
          </div>

          <fieldset className="field">
            <legend>Providers</legend>
            <div className="chip-picker" id="key-providers">
              {allProviders.length ? (
                allProviders.map((p) => (
                  <label className="chip-option" key={p}>
                    <input
                      type="checkbox"
                      name="key-provider"
                      value={p}
                      checked={selectedProviders.includes(p)}
                      onChange={() => toggleProvider(p)}
                    />
                    {PROVIDERS[p] && <ProviderIcon provider={p} />}
                    {pName(p)}
                  </label>
                ))
              ) : (
                <p className="key-empty">No providers are signed in.</p>
              )}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>Accounts</legend>
            <div className="account-picker" id="key-accounts">
              {accountGroups.map((g) => {
                const hidden =
                  selectedProviders.length > 0 && !selectedProviders.includes(g);
                const groupAccs = allAccounts.filter((a) => a.provider === g);
                return (
                  <div
                    key={g || "__missing"}
                    data-account-provider={g}
                    hidden={hidden}
                  >
                    <div className="account-group-title">
                      {g ? pName(g) : "No longer signed in"}
                    </div>
                    <div className="reset-list">
                      {groupAccs.map((a) => (
                        <label className="reset-row" key={a.id}>
                          <input
                            type="checkbox"
                            name="key-account"
                            value={a.id}
                            checked={selectedAccounts.includes(a.id)}
                            onChange={() => toggleAccount(a.id)}
                          />
                          <span className="reset-row-text">
                            <span className="reset-row-title">
                              {a.label || a.id}
                            </span>
                            {a.disabled && (
                              <span className="reset-row-meta">Paused</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
              <p className="key-empty" hidden={visibleAccountGroups.length > 0}>
                {selectedProviders.length > 0
                  ? "No accounts for the selected providers."
                  : "No accounts are signed in."}
              </p>
            </div>
          </fieldset>

          <div className="field">
            <label htmlFor="key-model-input">Models</label>
            <div
              className="chip-input"
              id="key-models"
              onClick={() => modelInputRef.current?.focus()}
            >
              {models.map((m, i) => (
                <span className="tag outline" key={m}>
                  {m}
                  <button
                    type="button"
                    className="chip-remove"
                    data-chip={i}
                    aria-label={`Remove ${m}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setModels((prev) => prev.filter((_, idx) => idx !== i));
                      modelInputRef.current?.focus();
                    }}
                  >
                    <Icon name="close" />
                  </button>
                </span>
              ))}
              <input
                ref={modelInputRef}
                id="key-model-input"
                list="key-model-options"
                autoComplete="off"
                placeholder={models.length ? "Add a pattern" : "Any model"}
                aria-describedby="key-model-help"
                value={modelInput}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/[\s,]/.test(val)) addModelChips(val);
                  else setModelInput(val);
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === ",") && modelInput.trim()) {
                    e.preventDefault();
                    addModelChips(modelInput);
                  } else if (
                    e.key === "Backspace" &&
                    !modelInput &&
                    models.length
                  ) {
                    setModels((prev) => prev.slice(0, -1));
                  }
                }}
                onBlur={() => {
                  if (modelInput.trim()) addModelChips(modelInput);
                }}
              />
            </div>
            <datalist id="key-model-options">
              {opts.models.map((m) => (
                <option key={m.id} value={m.id} />
              ))}
            </datalist>
            <p className="field-description" id="key-model-help">
              Press Enter to add. <code>*</code> matches anything,{" "}
              <code>?</code> one character, e.g. <code>gpt-5*</code>.
            </p>
          </div>

          <div className="field">
            <label htmlFor="key-limit">Weekly token limit</label>
            <input
              ref={limitRef}
              id="key-limit"
              inputMode="decimal"
              autoComplete="off"
              placeholder="No limit"
              aria-describedby="key-limit-help"
              aria-invalid={limitInvalid ? "true" : undefined}
              value={limitText}
              onChange={(e) => setLimitText(e.target.value)}
              onBlur={() => {
                const n = parseTokens(limitText);
                if (!Number.isNaN(n)) setLimitText(n ? fmtTokens(n) : "");
              }}
            />
            <p className="field-description" id="key-limit-help">
              {limitHelp}
            </p>
          </div>

          <p
            id="key-error"
            className="form-error"
            role="alert"
            hidden={!formError}
          >
            {formError}
          </p>

          <footer className="dialog-footer">
            <DialogClose id="key-cancel" className="outline" disabled={busy}>
              Cancel
            </DialogClose>
            <button
              type="submit"
              className="primary"
              id="key-save"
              disabled={busy}
              aria-busy={busy || undefined}
            >
              {busy ? (
                <>
                  <span className="loading-mark" />
                  {editingKey ? "Saving…" : "Creating…"}
                </>
              ) : editingKey ? (
                "Save changes"
              ) : (
                "Create key"
              )}
            </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
