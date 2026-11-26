import * as React from "react";
import { CheckIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  Badge,
  Button,
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components/ui";
import { apiPost } from "@/lib/api";
import {
  fmtTokens,
  modelPattern,
  parseTokens,
  pName,
  PROVIDERS,
} from "@/lib/format";
import type {
  ClientKey,
  ClientKeyAccountOption,
  ClientKeyOptions,
  ClientKeySecretResponse,
  ClientKeyUpdateResponse,
  ProviderId,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export interface KeyFormDialogProps {
  open: boolean;
  editingKey: ClientKey | null;
  options: ClientKeyOptions | null;
  onClose: () => void;
  onCreated: (key: ClientKey, secret: string) => void | Promise<void>;
  onUpdated: (key: ClientKey) => void | Promise<void>;
}

interface AccountOptionItem extends ClientKeyAccountOption {
  missing?: boolean;
}

export function KeyFormDialog({
  open,
  editingKey,
  options,
  onClose,
  onCreated,
  onUpdated,
}: KeyFormDialogProps) {
  const isEditing = editingKey !== null;

  const [name, setName] = React.useState("");
  const [nameError, setNameError] = React.useState("");
  const [selectedProviders, setSelectedProviders] = React.useState<string[]>(
    [],
  );
  const [selectedAccounts, setSelectedAccounts] = React.useState<string[]>([]);
  const [modelPatterns, setModelPatterns] = React.useState<string[]>([]);
  const [modelInput, setModelInput] = React.useState("");
  const [limitInput, setLimitInput] = React.useState("");
  const [formError, setFormError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const nameInputRef = React.useRef<HTMLInputElement | null>(null);
  const modelInputRef = React.useRef<HTMLInputElement | null>(null);
  const limitInputRef = React.useRef<HTMLInputElement | null>(null);

  // Sync form state whenever dialog opens or target key changes.
  React.useEffect(() => {
    if (!open) return;
    setName(editingKey?.name ?? "");
    setNameError("");
    setSelectedProviders([...(editingKey?.providers ?? [])]);
    setSelectedAccounts([...(editingKey?.accounts ?? [])]);
    setModelPatterns([...(editingKey?.models ?? [])]);
    setModelInput("");
    setLimitInput(
      editingKey?.weekly_token_limit
        ? fmtTokens(editingKey.weekly_token_limit)
        : "",
    );
    setFormError("");
    setSaving(false);
  }, [open, editingKey]);

  // Preserve stored providers/accounts that the proxy no longer lists so editing never drops them silently.
  const allProviders = React.useMemo(() => {
    const base = options?.providers ?? [];
    const existing = editingKey?.providers ?? [];
    return [...new Set([...base, ...existing])];
  }, [options, editingKey]);

  const allAccounts = React.useMemo<AccountOptionItem[]>(() => {
    const listed = options?.accounts ?? [];
    const knownIds = new Set(listed.map((a) => a.id));
    const missing: AccountOptionItem[] = (editingKey?.accounts ?? [])
      .filter((id) => !knownIds.has(id))
      .map((id) => ({
        id,
        provider: "",
        label: id,
        disabled: false,
        missing: true,
      }));
    return [...listed, ...missing];
  }, [options, editingKey]);

  const selectedProviderSet = React.useMemo(
    () => new Set(selectedProviders),
    [selectedProviders],
  );

  // Group visible accounts by provider, filtering by selected providers when any are chosen.
  const visibleAccountGroups = React.useMemo(() => {
    const groups = new Map<string, AccountOptionItem[]>();
    for (const acc of allAccounts) {
      const hidden =
        selectedProviderSet.size > 0 &&
        Boolean(acc.provider) &&
        !selectedProviderSet.has(acc.provider);
      if (hidden) continue;
      const list = groups.get(acc.provider) ?? [];
      list.push(acc);
      groups.set(acc.provider, list);
    }
    return [...groups.entries()];
  }, [allAccounts, selectedProviderSet]);

  // Available models from options, narrowed by selected providers.
  const scopedModels = React.useMemo(() => {
    const all = options?.models ?? [];
    if (selectedProviderSet.size === 0) return all;
    return all.filter((m) =>
      m.providers.some((p) => selectedProviderSet.has(p)),
    );
  }, [options, selectedProviderSet]);

  // Pending tokens from the model input (if user typed something before pressing Enter).
  const activePatterns = React.useMemo(() => {
    const trimmed = modelInput.trim().toLowerCase();
    if (!trimmed) return modelPatterns;
    const extra = trimmed.split(/[\s,]+/).filter(Boolean);
    return [...new Set([...modelPatterns, ...extra])];
  }, [modelPatterns, modelInput]);

  // Live matched model count against scoped available models.
  const matchedModels = React.useMemo(() => {
    if (activePatterns.length === 0) return scopedModels;
    const regexes = activePatterns.map((p) => modelPattern(p));
    return scopedModels.filter((m) => regexes.some((re) => re.test(m.id)));
  }, [scopedModels, activePatterns]);

  // Clickable suggestions matching current input text (or popular unadded models).
  const modelSuggestions = React.useMemo(() => {
    const query = modelInput.trim().toLowerCase();
    const added = new Set(modelPatterns);
    const pool = scopedModels.filter((m) => !added.has(m.id.toLowerCase()));
    if (!query) {
      return pool.slice(0, 8);
    }
    const hasWildcard = /[*?]/.test(query);
    const re = hasWildcard ? modelPattern(query) : null;
    return pool
      .filter((m) => {
        const id = m.id.toLowerCase();
        return re ? re.test(id) : id.includes(query);
      })
      .slice(0, 8);
  }, [scopedModels, modelInput, modelPatterns]);

  const parsedLimit = parseTokens(limitInput);
  const limitInvalid = Number.isNaN(parsedLimit);

  function toggleProvider(provider: string) {
    setSelectedProviders((prev) => {
      const next = prev.includes(provider)
        ? prev.filter((p) => p !== provider)
        : [...prev, provider];
      const nextSet = new Set(next);
      // Uncheck accounts belonging to now-hidden known providers; keep unknown/missing ones.
      if (nextSet.size > 0) {
        setSelectedAccounts((prevAccounts) =>
          prevAccounts.filter((accId) => {
            const found = allAccounts.find((a) => a.id === accId);
            if (!found || !found.provider) return true;
            return nextSet.has(found.provider);
          }),
        );
      }
      return next;
    });
  }

  function toggleAccount(accountId: string) {
    setSelectedAccounts((prev) =>
      prev.includes(accountId)
        ? prev.filter((id) => id !== accountId)
        : [...prev, accountId],
    );
  }

  function commitModelPatterns(raw: string): string[] {
    const tokens = raw
      .toLowerCase()
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!tokens.length) {
      setModelInput("");
      return modelPatterns;
    }
    const next = [...modelPatterns];
    for (const token of tokens) {
      if (!next.includes(token)) next.push(token);
    }
    setModelPatterns(next);
    setModelInput("");
    return next;
  }

  function removeModelPattern(pattern: string) {
    setModelPatterns((prev) => prev.filter((p) => p !== pattern));
    modelInputRef.current?.focus();
  }

  function handleModelKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if ((event.key === "Enter" || event.key === ",") && modelInput.trim()) {
      event.preventDefault();
      commitModelPatterns(modelInput);
    } else if (
      event.key === "Backspace" &&
      !modelInput &&
      modelPatterns.length > 0
    ) {
      setModelPatterns((prev) => prev.slice(0, -1));
    }
  }

  function handleModelInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const val = event.target.value;
    if (/[\s,]/.test(val)) {
      commitModelPatterns(val);
    } else {
      setModelInput(val);
    }
  }

  function handleLimitBlur() {
    const n = parseTokens(limitInput);
    if (!Number.isNaN(n)) {
      setLimitInput(n ? fmtTokens(n) : "");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const finalModels = modelInput.trim()
      ? commitModelPatterns(modelInput)
      : modelPatterns;
    const trimmedName = name.trim();
    const limitValue = parseTokens(limitInput);

    if (!trimmedName) {
      setNameError("Name the key, e.g. after the person or app using it.");
      nameInputRef.current?.focus();
      return;
    }
    if (Number.isNaN(limitValue)) {
      limitInputRef.current?.focus();
      return;
    }

    // Only submit accounts that are either visible under the selected providers or preserved missing accounts.
    const allowedAccountIds = new Set(
      visibleAccountGroups.flatMap(([, items]) => items.map((a) => a.id)),
    );
    const finalAccounts = selectedAccounts.filter((id) =>
      allowedAccountIds.has(id),
    );

    const payload: Record<string, unknown> = {
      name: trimmedName,
      providers: selectedProviders,
      accounts: finalAccounts,
      models: finalModels,
      weekly_token_limit: limitValue,
    };

    setSaving(true);
    setFormError("");
    try {
      if (isEditing && editingKey) {
        const res = await apiPost<ClientKeyUpdateResponse>("keys/update", {
          id: editingKey.id,
          ...payload,
        });
        toast.success("Key updated", {
          description: `${trimmedName}'s settings apply to its next request.`,
        });
        onClose();
        await onUpdated(res.key);
      } else {
        const res = await apiPost<ClientKeySecretResponse>(
          "keys/create",
          payload,
        );
        onClose();
        await onCreated(res.key, res.secret);
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not save the key.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent
        initialFocus={() => nameInputRef.current}
        className="w-[min(540px,calc(100vw-32px))]"
      >
        <DialogHeader>
          <DialogTitle>
            {isEditing ? `Edit ${editingKey.name}` : "New key"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Changes apply to the next request made with this key."
              : "Leave a restriction empty to allow anything. The secret is shown once, after you create the key."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          noValidate
          className="flex flex-col gap-4"
        >
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="key-name-input"
              className="text-sm font-medium text-foreground"
            >
              Name
            </label>
            <Input
              ref={nameInputRef}
              id="key-name-input"
              maxLength={80}
              autoComplete="off"
              placeholder="Who uses this key"
              value={name}
              onValueChange={(val) => {
                setName(val);
                if (nameError) setNameError("");
              }}
              aria-invalid={nameError ? "true" : undefined}
              aria-describedby={nameError ? "key-name-error" : undefined}
            />
            {nameError ? (
              <p
                id="key-name-error"
                role="alert"
                className="text-xs leading-5 text-destructive"
              >
                {nameError}
              </p>
            ) : null}
          </div>

          {/* Providers */}
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="text-sm font-medium text-foreground">
              Providers
            </legend>
            {allProviders.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No providers are signed in.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allProviders.map((provider) => {
                  const active = selectedProviderSet.has(provider);
                  const hasIcon = provider in PROVIDERS;
                  return (
                    <button
                      key={provider}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleProvider(provider)}
                      className={cn(
                        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        active
                          ? "border-foreground/50 bg-secondary text-foreground"
                          : "border-input bg-[var(--input-fill)] text-muted-foreground hover:bg-[var(--input-fill-hover)] hover:text-foreground",
                      )}
                    >
                      {hasIcon ? (
                        <ProviderIcon
                          provider={provider as ProviderId}
                          className="size-3.5 shrink-0"
                        />
                      ) : null}
                      <span>{pName(provider)}</span>
                      {active ? (
                        <CheckIcon
                          className="size-3 text-foreground"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>

          {/* Accounts */}
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <div className="flex items-baseline justify-between gap-2">
              <legend className="text-sm font-medium text-foreground">
                Accounts
              </legend>
              {selectedAccounts.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {selectedAccounts.length} selected
                </span>
              ) : null}
            </div>

            {visibleAccountGroups.length === 0 ? (
              <p className="rounded-md border border-border/70 bg-background/40 px-3 py-2.5 text-xs text-muted-foreground">
                {selectedProviderSet.size > 0
                  ? "No accounts for the selected providers."
                  : "No accounts are signed in."}
              </p>
            ) : (
              <div className="flex max-h-44 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-background/40 p-2.5">
                {visibleAccountGroups.map(([provider, accounts]) => (
                  <div key={provider || "__missing__"} className="flex flex-col gap-1">
                    <div className="px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      {provider ? pName(provider) : "No longer signed in"}
                    </div>
                    <div className="flex flex-col gap-1">
                      {accounts.map((acc) => {
                        const checked = selectedAccounts.includes(acc.id);
                        return (
                          <label
                            key={acc.id}
                            className={cn(
                              "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                              checked
                                ? "bg-secondary/80 text-foreground"
                                : "text-foreground/90 hover:bg-secondary/40",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleAccount(acc.id)}
                              className="size-4 shrink-0 cursor-pointer accent-primary"
                            />
                            <span className="min-w-0 flex-1 truncate text-[13px]">
                              {acc.label || acc.id}
                            </span>
                            {acc.disabled ? (
                              <Badge variant="outline" className="text-[11px] text-muted-foreground">
                                Paused
                              </Badge>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          {/* Model patterns */}
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label
                htmlFor="key-model-input"
                className="text-sm font-medium text-foreground"
              >
                Models
              </label>
              {scopedModels.length > 0 ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {activePatterns.length > 0
                    ? `Matches ${matchedModels.length} of ${scopedModels.length} available`
                    : `${scopedModels.length} available`}
                </span>
              ) : null}
            </div>

            <div
              onClick={() => modelInputRef.current?.focus()}
              className={cn(
                "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-[var(--input-fill)] px-2.5 py-1.5",
                "transition-[border-color,box-shadow,background-color] duration-150",
                "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
              )}
            >
              {modelPatterns.map((pattern) => (
                <span
                  key={pattern}
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-secondary px-2 font-mono text-xs text-foreground"
                >
                  <span>{pattern}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeModelPattern(pattern);
                    }}
                    aria-label={`Remove ${pattern}`}
                    className="inline-flex size-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
                  >
                    <XIcon className="size-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
              <input
                ref={modelInputRef}
                id="key-model-input"
                type="text"
                autoComplete="off"
                value={modelInput}
                onChange={handleModelInputChange}
                onKeyDown={handleModelKeyDown}
                onBlur={() => {
                  if (modelInput.trim()) commitModelPatterns(modelInput);
                }}
                placeholder={
                  modelPatterns.length > 0 ? "Add a pattern" : "Any model"
                }
                aria-describedby="key-model-help"
                className="min-w-[120px] flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground"
              />
            </div>

            {modelSuggestions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                <span className="mr-0.5 text-[11px] text-muted-foreground">
                  Suggestions:
                </span>
                {modelSuggestions.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onMouseDown={(e) => {
                      // Prevent blur from committing partial query text before clicking a suggestion.
                      e.preventDefault();
                      const lower = m.id.toLowerCase();
                      setModelPatterns((prev) =>
                        prev.includes(lower) ? prev : [...prev, lower],
                      );
                      setModelInput("");
                      modelInputRef.current?.focus();
                    }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded border border-border/80 bg-background/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-secondary hover:text-foreground"
                  >
                    <PlusIcon className="size-2.5" aria-hidden="true" />
                    <span>{m.id}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <p
              id="key-model-help"
              className="text-xs leading-5 text-muted-foreground"
            >
              Press Enter to add.{" "}
              <code className="rounded bg-secondary px-1 py-0.5 text-[11px] text-foreground">
                *
              </code>{" "}
              matches anything,{" "}
              <code className="rounded bg-secondary px-1 py-0.5 text-[11px] text-foreground">
                ?
              </code>{" "}
              one character, e.g.{" "}
              <code className="rounded bg-secondary px-1 py-0.5 text-[11px] text-foreground">
                gpt-5*
              </code>
              .
            </p>
          </div>

          {/* Weekly token limit */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="key-limit-input"
              className="text-sm font-medium text-foreground"
            >
              Weekly token limit
            </label>
            <Input
              ref={limitInputRef}
              id="key-limit-input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="No limit"
              value={limitInput}
              onValueChange={setLimitInput}
              onBlur={handleLimitBlur}
              aria-invalid={limitInvalid ? "true" : undefined}
              aria-describedby="key-limit-help"
            />
            <p
              id="key-limit-help"
              className={cn(
                "text-xs leading-5",
                limitInvalid ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {limitInvalid
                ? "Use a number like 5M, 500k or 2,000,000."
                : parsedLimit > 0
                  ? `${parsedLimit.toLocaleString()} tokens over any 7 days. Input and output count; cache reads don't.`
                  : "No limit. Type a number like 5M or 500k to cap tokens over any 7 days."}
            </p>
          </div>

          {formError ? (
            <p role="alert" className="text-[13px] leading-5 text-destructive">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" variant="default" disabled={saving}>
              {saving ? (
                <>
                  <Loader2Icon
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                  {isEditing ? "Saving…" : "Creating…"}
                </>
              ) : isEditing ? (
                "Save changes"
              ) : (
                "Create key"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
