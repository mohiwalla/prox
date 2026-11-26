import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { api, notify } from "../lib/api";
import { dateLabel, relative } from "../lib/format";
import type { Account, AccountResets, ResetGrant } from "../lib/types";

function untilLabel(ts: number): string {
  const days = Math.round((ts - Date.now() / 1000) / 86400);
  return days >= 1 ? `in ${days} day${days === 1 ? "" : "s"}` : relative(ts);
}

export function ResetDialog({
  account,
  label,
  onClose,
  onSuccess,
}: {
  account: Account | null;
  label: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [resets, setResets] = useState<AccountResets | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [error, setError] = useState("");
  const [retrySame, setRetrySame] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!account) {
      setResets(null);
      setError("");
      setRetrySame(false);
      setSubmitting(false);
      return;
    }
    let active = true;
    setError("");
    setRetrySame(false);
    setSubmitting(false);
    const claude = account.provider === "claude";
    if (claude) {
      const next = account.resets || null;
      setResets(next);
      const firstUsable = next?.available
        ? next.items.find((g) => !g.reason && g.left > 0)
        : undefined;
      setSelected(firstUsable?.id || "");
      setLoading(false);
      return;
    }
    setLoading(true);
    setResets(null);
    api<AccountResets>("account/reset-options", { id: account.id })
      .then((next) => {
        if (!active) return;
        setResets(next);
        const firstUsable = next?.available
          ? next.items.find((g) => !g.reason && g.left > 0)
          : undefined;
        setSelected(firstUsable?.id || "");
        setLoading(false);
        onSuccess();
      })
      .catch((err) => {
        if (!active) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load resets.");
      });
    return () => {
      active = false;
    };
  }, [account?.id]);

  const items: ResetGrant[] = resets?.available ? resets.items : [];
  const firstUsable = items.find((g) => !g.reason && g.left > 0);
  const numbered = new Set(items.map((g) => g.label)).size < items.length;
  const claude = account?.provider === "claude";

  async function onConfirm() {
    if (!account || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      await api("account/reset", selected ? { id: account.id, grant: selected } : { id: account.id });
      onClose();
      notify(
        "Reset used",
        "success",
        `${label}'s limits are clearing. Quotas update ${claude ? "within a few minutes" : "in a moment"}.`,
      );
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to use reset.";
      if (/outcome is unknown/i.test(msg)) setRetrySame(true);
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={Boolean(account)}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent
        id="reset-dialog"
        className="ui-modal"
        initialFocus={() => cancelRef.current}
      >
        <header className="dialog-header">
          <DialogTitle id="reset-title">
            {account ? `Use a reset on ${label}?` : "Use a reset?"}
          </DialogTitle>
          <DialogDescription
            id="reset-description"
            className="dialog-description"
          >
            {!loading && resets && !items.length
              ? "This account has no resets available."
              : "Choose a reset. It clears this account's usage limits right away and can't be given back."}
          </DialogDescription>
        </header>
        <div className="dialog-body">
          <div
            className="reset-list"
            id="reset-list"
            role="radiogroup"
            aria-label="Resets"
          >
            {items.map((g, i) => {
              const title = numbered ? `Reset ${i + 1}` : g.label;
              const disabled = Boolean(g.reason || g.left <= 0);
              const meta = [
                g.total > 1 ? `${g.left} of ${g.total} left` : "",
                g.reason ||
                  (g.expires_at
                    ? `Expires ${dateLabel(g.expires_at)} · ${untilLabel(g.expires_at)}`
                    : ""),
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <label className="reset-row" key={g.id}>
                  <input
                    type="radio"
                    name="reset-grant"
                    value={g.id}
                    checked={selected === g.id}
                    disabled={disabled}
                    onChange={() => setSelected(g.id)}
                  />
                  <span className="reset-row-text">
                    <span className="reset-row-title">{title}</span>
                    {claude && meta && (
                      <span className="reset-row-meta">{meta}</span>
                    )}
                  </span>
                  {!claude && g.expires_at && (
                    <span className="reset-row-when">
                      Expires <strong>{dateLabel(g.expires_at)}</strong> ·{" "}
                      {untilLabel(g.expires_at)}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <p className="field-error" id="reset-error" role="alert" hidden={!error}>
            {error}
          </p>
          <footer className="dialog-footer">
            <DialogClose
              ref={cancelRef}
              id="reset-cancel"
              className="outline"
              disabled={submitting}
            >
              Cancel
            </DialogClose>
            <button
              type="button"
              className="primary"
              id="reset-confirm"
              disabled={loading || submitting || !firstUsable}
              aria-busy={loading || submitting || undefined}
              onClick={onConfirm}
            >
              {loading ? (
                <>
                  <span className="loading-mark" />
                  Checking resets…
                </>
              ) : submitting ? (
                <>
                  <span className="loading-mark" />
                  Using reset…
                </>
              ) : retrySame ? (
                "Retry same request"
              ) : (
                "Use reset"
              )}
            </button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
