import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/react/alert-dialog";
import { notify } from "../lib/api";
import type { ConfirmAction } from "../lib/types";

export function ConfirmDialog({
  action,
  onClose,
}: {
  action: ConfirmAction | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<(() => HTMLElement | null) | undefined>(undefined);

  if (action) {
    returnFocusRef.current = action.returnFocus;
  }

  useEffect(() => {
    setBusy(false);
  }, [action]);

  async function onConfirm() {
    if (!action || busy) return;
    setBusy(true);
    let result: unknown;
    try {
      result = await action.run();
    } catch (err) {
      setBusy(false);
      notify(
        action.failure,
        "error",
        err instanceof Error ? err.message : "Request failed.",
      );
      return;
    }
    setBusy(false);
    returnFocusRef.current = undefined;
    onClose();
    await action.done(result);
  }

  return (
    <AlertDialog
      open={Boolean(action)}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogBackdrop />
      <AlertDialogContent
        id="confirm-dialog"
        className="ui-modal"
        initialFocus={() => cancelRef.current}
        finalFocus={() => returnFocusRef.current?.() ?? null}
      >
        <header className="dialog-header">
          <AlertDialogTitle id="confirm-title">
            {action?.title || "Confirm"}
          </AlertDialogTitle>
          <AlertDialogDescription
            id="confirm-description"
            className="dialog-description"
          >
            {action?.description || ""}
          </AlertDialogDescription>
        </header>
        <footer className="dialog-footer">
          <AlertDialogClose
            ref={cancelRef}
            id="confirm-cancel"
            className="outline"
            disabled={busy}
          >
            Cancel
          </AlertDialogClose>
          <button
            type="button"
            className="destructive"
            id="confirm-remove"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {busy ? (
              <>
                <span className="loading-mark" />
                {action?.busy || "Working…"}
              </>
            ) : (
              action?.label || "Remove"
            )}
          </button>
        </footer>
      </AlertDialogContent>
    </AlertDialog>
  );
}
