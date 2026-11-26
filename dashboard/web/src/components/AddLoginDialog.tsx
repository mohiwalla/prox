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
import { PROVIDERS } from "../lib/format";
import type { OAuthSession } from "../lib/types";
import { Icon, ProviderIcon } from "./BrandSprite";
import { CopyButton } from "./CopyButton";

export interface OAuthRequest {
  mode: "add" | "relogin";
  provider?: string;
  accountId?: string;
  accountLabel?: string;
}

const DESCRIPTIONS = {
  choose: "Sign in once. The proxy adds the account to its pool automatically.",
  flow: "Open the sign-in page and choose the account to add.",
};

export function AddLoginDialog({
  request,
  onClose,
  onConnected,
}: {
  request: OAuthRequest | null;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [provider, setProvider] = useState("codex");
  const [step, setStep] = useState<"choose" | "flow">("choose");
  const [description, setDescription] = useState(DESCRIPTIONS.choose);
  const [session, setSession] = useState<OAuthSession | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [callbackError, setCallbackError] = useState("");
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("Waiting for sign-in");
  const [statusLoading, setStatusLoading] = useState(true);

  const pollTimerRef = useRef<number | null>(null);
  const sessionRef = useRef<OAuthSession | null>(null);
  const ticketRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  function clearPoll() {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function startPolling(stateToken: string, mode: "add" | "relogin", ticket: number) {
    clearPoll();
    const tick = async () => {
      if (ticket !== ticketRef.current || !sessionRef.current) return;
      try {
        const r = await api<{ status: string; error?: string }>("oauth/status", {
          state: stateToken,
        });
        if (ticket !== ticketRef.current) return;
        if (r.status === "ok") {
          clearPoll();
          sessionRef.current = null;
          setSession(null);
          onClose();
          notify(
            mode === "relogin" ? "Signed in again" : "Account connected",
            "success",
            "Refreshing quotas.",
          );
          onConnected();
          return;
        }
        if (r.status === "error") {
          setSubmitting(false);
          setCallbackError(
            r.error || "Sign-in failed. Close this dialog and try again.",
          );
          setStatusLoading(false);
          setStatusText("Sign-in did not complete");
          return;
        }
      } catch (err) {
        if (ticket !== ticketRef.current) return;
        setSubmitting(false);
        setError(err instanceof Error ? err.message : "OAuth check failed.");
        return;
      }
      pollTimerRef.current = window.setTimeout(tick, 2000);
    };
    tick();
  }

  function enterFlow(r: OAuthSession, desc: string, mode: "add" | "relogin", ticket: number) {
    const url = new URL(r.url);
    if (url.protocol !== "https:") {
      throw new Error("Unexpected sign-in address. Use the original panel.");
    }
    const clean = { state: r.state, url: url.href };
    sessionRef.current = clean;
    setSession(clean);
    setPreparing(false);
    setStep("flow");
    setDescription(desc);
    setStatusLoading(true);
    setStatusText("Waiting for sign-in");
    startPolling(clean.state, mode, ticket);
  }

  useEffect(() => {
    clearPoll();
    const ticket = ++ticketRef.current;
    sessionRef.current = null;
    setSession(null);
    setCallbackUrl("");
    setCallbackError("");
    setError("");
    setStarting(false);
    setSubmitting(false);

    if (!request) return;

    if (request.mode === "relogin" && request.accountId) {
      const desc = `Sign in as ${request.accountLabel || "this account"} to restore this login.`;
      setStep("flow");
      setDescription(desc);
      setPreparing(true);
      setStatusLoading(true);
      setStatusText("Preparing sign-in");
      api<OAuthSession>("account/relogin", { id: request.accountId })
        .then((r) => {
          if (ticket !== ticketRef.current) {
            api("oauth/cancel", { state: r.state }).catch(() => {});
            return;
          }
          enterFlow(r, desc, "relogin", ticket);
        })
        .catch((err) => {
          if (ticket !== ticketRef.current) return;
          setPreparing(false);
          setError(err instanceof Error ? err.message : "Couldn't start sign-in.");
          setStatusLoading(false);
          setStatusText("Couldn't start sign-in");
        });
    } else {
      setProvider(request.provider && PROVIDERS[request.provider] ? request.provider : "codex");
      setStep("choose");
      setDescription(DESCRIPTIONS.choose);
      setPreparing(false);
    }

    return () => {
      clearPoll();
    };
  }, [request]);

  async function handleDismiss() {
    clearPoll();
    ticketRef.current++;
    const active = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    onClose();
    if (active) {
      try {
        await api("oauth/cancel", { state: active.state });
      } catch {
        // ignore cancel failures
      }
    }
  }

  async function onStart() {
    if (starting) return;
    setStarting(true);
    setError("");
    const ticket = ticketRef.current;
    try {
      const r = await api<OAuthSession>("oauth/start", { provider });
      if (ticket !== ticketRef.current) {
        api("oauth/cancel", { state: r.state }).catch(() => {});
        return;
      }
      enterFlow(r, DESCRIPTIONS.flow, "add", ticket);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start sign-in.");
    } finally {
      setStarting(false);
    }
  }

  async function onSubmitCallback() {
    if (!session || submitting) return;
    setError("");
    const raw = callbackUrl.trim();
    let parsed: URL | null = null;
    try {
      parsed = new URL(raw);
    } catch {
      parsed = null;
    }
    if (!raw) {
      setCallbackError("Paste the callback address first.");
      return;
    }
    if (
      !parsed ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      !parsed.searchParams.has("code")
    ) {
      setCallbackError(
        "Paste the full address from your browser, starting with http://localhost and including ?code=.",
      );
      return;
    }
    setSubmitting(true);
    try {
      await api("oauth/callback", {
        state: session.state,
        redirect_url: raw,
      });
      setStatusLoading(true);
      setStatusText("Verifying sign-in…");
    } catch (err) {
      setSubmitting(false);
      setCallbackError(
        err instanceof Error ? err.message : "Failed to submit callback.",
      );
    }
  }

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open) handleDismiss();
      }}
    >
      <DialogBackdrop />
      <DialogContent
        id="oauth-dialog"
        className="ui-modal"
        initialFocus={() => closeRef.current}
      >
        <DialogClose
          ref={closeRef}
          className="dialog-close ghost icon-btn sm"
          id="oauth-close"
          aria-label="Close"
        >
          <Icon name="close" />
        </DialogClose>
        <header className="dialog-header">
          <DialogTitle id="oauth-title">
            {request?.mode === "relogin" ? "Sign in again" : "Add login"}
          </DialogTitle>
          <DialogDescription
            id="oauth-description"
            className="dialog-description"
          >
            {description}
          </DialogDescription>
        </header>

        {step === "choose" ? (
          <div id="oauth-choose" className="dialog-body">
            <div
              className="provider-picker"
              role="radiogroup"
              aria-label="Provider"
              id="oauth-providers"
            >
              {Object.entries(PROVIDERS).map(([id, p]) => (
                <label
                  className="provider-option"
                  key={id}
                  onDoubleClick={() => {
                    setProvider(id);
                    onStart();
                  }}
                >
                  <input
                    type="radio"
                    name="oauth-provider"
                    value={id}
                    checked={provider === id}
                    onChange={() => setProvider(id)}
                  />
                  <ProviderIcon provider={id} />
                  <span className="provider-option-text">
                    <strong>{p.name}</strong>
                    <span>{p.note}</span>
                  </span>
                </label>
              ))}
            </div>
            <footer className="dialog-footer">
              <DialogClose className="outline" data-dialog-cancel="">
                Cancel
              </DialogClose>
              <button
                type="button"
                id="oauth-start"
                className="primary"
                disabled={starting}
                aria-busy={starting || undefined}
                onClick={onStart}
              >
                {starting ? (
                  <>
                    <span className="loading-mark" />
                    Starting…
                  </>
                ) : (
                  "Continue"
                )}
              </button>
            </footer>
          </div>
        ) : (
          <div id="oauth-flow" className="dialog-body">
            <a
              id="oauth-url"
              className="button outline"
              href={session?.url}
              aria-disabled={!session ? "true" : undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open sign-in page
              <Icon name="out" />
            </a>
            <div className="field">
              <label id="oauth-link-label">Or copy the sign-in link</label>
              <div className="codebox" aria-labelledby="oauth-link-label">
                <code id="oauth-link">
                  {session
                    ? session.url
                    : preparing
                      ? "Preparing sign-in link…"
                      : "Sign-in link unavailable"}
                </code>
                <CopyButton
                  id="oauth-copy"
                  text={session?.url || ""}
                  label="Copy sign-in link"
                  disabled={!session}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="oauth-callback">Callback address</label>
              <input
                id="oauth-callback"
                type="url"
                placeholder="http://localhost:…/callback?code=…"
                autoComplete="off"
                aria-describedby="oauth-callback-help oauth-callback-error"
                aria-invalid={callbackError ? "true" : undefined}
                value={callbackUrl}
                onChange={(e) => {
                  setCallbackUrl(e.target.value);
                  setCallbackError("");
                }}
              />
              <p className="field-description" id="oauth-callback-help">
                If the final page can’t reach localhost, paste its full address
                here.
              </p>
              <p
                className="field-error"
                id="oauth-callback-error"
                hidden={!callbackError}
              >
                {callbackError}
              </p>
            </div>
            <div id="oauth-status" className="oauth-pending" role="status">
              {statusLoading && <span className="loading-mark" />}
              {statusText}
            </div>
            <footer className="dialog-footer">
              <DialogClose className="outline" data-dialog-cancel="">
                Cancel
              </DialogClose>
              <button
                type="button"
                id="oauth-submit"
                className="primary"
                disabled={submitting || !session}
                aria-busy={submitting || undefined}
                onClick={onSubmitCallback}
              >
                {submitting ? (
                  <>
                    <span className="loading-mark" />
                    Completing sign-in…
                  </>
                ) : (
                  "Complete sign-in"
                )}
              </button>
            </footer>
          </div>
        )}
        <p id="oauth-error" className="form-error" role="alert" hidden={!error}>
          {error}
        </p>
      </DialogContent>
    </Dialog>
  );
}
