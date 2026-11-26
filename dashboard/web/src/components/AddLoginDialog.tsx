import * as React from "react";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  buttonVariants,
} from "@/components/ui";
import { apiPost } from "@/lib/api";
import { PROVIDERS, accountLabel } from "@/lib/format";
import type {
  Account,
  OAuthStartResponse,
  OAuthStatusResponse,
  ProviderId,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export type OAuthDialogRequest =
  | { mode: "add"; provider?: ProviderId }
  | { mode: "relogin"; account: Account };

export interface AddLoginDialogProps {
  request: OAuthDialogRequest | null;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}

const PROVIDER_ENTRIES = Object.entries(PROVIDERS) as [
  ProviderId,
  (typeof PROVIDERS)[ProviderId],
][];

const DESCRIPTIONS = {
  choose: "Sign in once. The proxy adds the account to its pool automatically.",
  flow: "Open the sign-in page and choose the account to add.",
};

export function AddLoginDialog({
  request,
  onClose,
  onSuccess,
}: AddLoginDialogProps) {
  const open = request !== null;
  const mode = request?.mode ?? "add";

  const [provider, setProvider] = React.useState<ProviderId>("codex");
  const [step, setStep] = React.useState<"choose" | "flow">("choose");
  const [session, setSession] = React.useState<OAuthStartResponse | null>(null);
  const [statusText, setStatusText] = React.useState("Waiting for sign-in");
  const [statusDone, setStatusDone] = React.useState(false);
  const [callbackUrl, setCallbackUrl] = React.useState("");
  const [callbackError, setCallbackError] = React.useState("");
  const [formError, setFormError] = React.useState("");
  const [starting, setStarting] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const sessionRef = React.useRef<OAuthStartResponse | null>(null);
  const ticketRef = React.useRef(0);
  const pollTimerRef = React.useRef<number | null>(null);
  const copyTimerRef = React.useRef<number | null>(null);

  const clearPoll = React.useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const cancelPendingSession = React.useCallback(() => {
    const active = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    if (active) {
      void apiPost("oauth/cancel", { state: active.state }).catch(() => {});
    }
  }, []);

  const startPolling = React.useCallback(
    (oauthState: string, ticket: number, activeMode: "add" | "relogin") => {
      clearPoll();

      const poll = async () => {
        if (ticket !== ticketRef.current || !sessionRef.current) return;
        try {
          const result = await apiPost<OAuthStatusResponse>("oauth/status", {
            state: oauthState,
          });
          if (ticket !== ticketRef.current) return;

          if (result.status === "ok") {
            clearPoll();
            sessionRef.current = null;
            setSession(null);
            setSubmitting(false);
            toast.success(
              activeMode === "relogin" ? "Signed in again" : "Account connected",
              { description: "Refreshing quotas." },
            );
            onClose();
            await onSuccess();
            return;
          }

          if (result.status === "error") {
            clearPoll();
            setSubmitting(false);
            setStatusDone(true);
            setStatusText("Sign-in did not complete");
            setCallbackError(
              result.error || "Sign-in failed. Close this dialog and try again.",
            );
            return;
          }
        } catch (err) {
          if (ticket !== ticketRef.current) return;
          clearPoll();
          setSubmitting(false);
          setFormError(
            err instanceof Error ? err.message : "Could not check sign-in status.",
          );
          return;
        }

        if (ticket === ticketRef.current && sessionRef.current) {
          pollTimerRef.current = window.setTimeout(() => void poll(), 2000);
        }
      };

      pollTimerRef.current = window.setTimeout(() => void poll(), 2000);
    },
    [clearPoll, onClose, onSuccess],
  );

  const activateFlow = React.useCallback(
    (
      started: OAuthStartResponse,
      ticket: number,
      activeMode: "add" | "relogin",
    ) => {
      let parsed: URL;
      try {
        parsed = new URL(started.url);
      } catch {
        throw new Error("Unexpected sign-in address. Use the original panel.");
      }
      if (parsed.protocol !== "https:") {
        throw new Error("Unexpected sign-in address. Use the original panel.");
      }

      const normalized: OAuthStartResponse = {
        url: parsed.href,
        state: started.state,
      };
      sessionRef.current = normalized;
      setSession(normalized);
      setStep("flow");
      setStatusDone(false);
      setStatusText("Waiting for sign-in");
      startPolling(normalized.state, ticket, activeMode);
    },
    [startPolling],
  );

  React.useEffect(() => {
    clearPoll();
    ticketRef.current += 1;
    const ticket = ticketRef.current;

    if (!request) {
      cancelPendingSession();
      return;
    }

    setCallbackUrl("");
    setCallbackError("");
    setFormError("");
    setStarting(false);
    setSubmitting(false);
    setCopied(false);
    setStatusDone(false);

    if (request.mode === "add") {
      setProvider(request.provider ?? "codex");
      setStep("choose");
      sessionRef.current = null;
      setSession(null);
      return;
    }

    // Re-login mode immediately prepares the OAuth URL for the existing account.
    setStep("flow");
    sessionRef.current = null;
    setSession(null);
    setStatusText("Preparing sign-in");

    void (async () => {
      try {
        const started = await apiPost<OAuthStartResponse>("account/relogin", {
          id: request.account.id,
        });
        if (ticket !== ticketRef.current) {
          void apiPost("oauth/cancel", { state: started.state }).catch(() => {});
          return;
        }
        activateFlow(started, ticket, "relogin");
      } catch (err) {
        if (ticket !== ticketRef.current) return;
        setStatusDone(true);
        setStatusText("Couldn't start sign-in");
        setFormError(
          err instanceof Error ? err.message : "Could not start sign-in.",
        );
      }
    })();

    return () => {
      clearPoll();
    };
  }, [request, activateFlow, cancelPendingSession, clearPoll]);

  React.useEffect(() => {
    return () => {
      clearPoll();
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, [clearPoll]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      clearPoll();
      ticketRef.current += 1;
      cancelPendingSession();
      onClose();
    }
  }

  async function handleStartProvider(chosenProvider: ProviderId = provider) {
    if (starting) return;
    setStarting(true);
    setFormError("");
    setCallbackError("");
    const ticket = ticketRef.current;
    try {
      const started = await apiPost<OAuthStartResponse>("oauth/start", {
        provider: chosenProvider,
      });
      if (ticket !== ticketRef.current) {
        void apiPost("oauth/cancel", { state: started.state }).catch(() => {});
        return;
      }
      activateFlow(started, ticket, "add");
    } catch (err) {
      if (ticket !== ticketRef.current) return;
      setFormError(
        err instanceof Error ? err.message : "Could not start sign-in.",
      );
    } finally {
      if (ticket === ticketRef.current) {
        setStarting(false);
      }
    }
  }

  async function handleCopyLink() {
    if (!session?.url) return;
    try {
      await navigator.clipboard.writeText(session.url);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy", {
        description: "Select the text and copy it.",
      });
    }
  }

  async function handleSubmitCallback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || submitting) return;
    setFormError("");
    const raw = callbackUrl.trim();
    if (!raw) {
      setCallbackError("Paste the callback address first.");
      return;
    }

    let parsed: URL | null = null;
    try {
      parsed = new URL(raw);
    } catch {
      parsed = null;
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
    setCallbackError("");
    try {
      await apiPost("oauth/callback", {
        state: session.state,
        redirect_url: raw,
      });
      setStatusDone(false);
      setStatusText("Verifying sign-in…");
    } catch (err) {
      setSubmitting(false);
      setCallbackError(
        err instanceof Error ? err.message : "Callback could not be submitted.",
      );
    }
  }

  const title = mode === "relogin" ? "Sign in again" : "Add login";
  const description =
    request?.mode === "relogin"
      ? `Sign in as ${accountLabel(request.account)} to restore this login.`
      : step === "flow"
        ? DESCRIPTIONS.flow
        : DESCRIPTIONS.choose;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogBackdrop />
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {step === "choose" ? (
          <div className="flex flex-col gap-4">
            <div
              role="radiogroup"
              aria-label="Provider"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {PROVIDER_ENTRIES.map(([id, meta]) => {
                const selected = provider === id;
                return (
                  <label
                    key={id}
                    onDoubleClick={() => void handleStartProvider(id)}
                    className={cn(
                      "relative flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                      selected
                        ? "border-foreground bg-white/[0.07]"
                        : "border-input bg-[var(--input-fill)] hover:bg-white/[0.07]",
                      starting && "pointer-events-none opacity-60",
                    )}
                  >
                    <input
                      type="radio"
                      name="oauth-provider"
                      value={id}
                      checked={selected}
                      disabled={starting}
                      onChange={() => setProvider(id)}
                      className="sr-only"
                    />
                    <ProviderIcon provider={id} className="size-5 shrink-0" />
                    <span className="grid min-w-0 leading-5">
                      <strong className="text-sm font-medium text-foreground">
                        {meta.name}
                      </strong>
                      <span className="truncate text-xs leading-4 text-muted-foreground">
                        {meta.note}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            {formError ? (
              <p role="alert" className="text-[13px] leading-5 text-destructive">
                {formError}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={starting}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={() => void handleStartProvider(provider)}
                disabled={starting}
              >
                {starting ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                    Starting…
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(e) => void handleSubmitCallback(e)}
            className="flex flex-col gap-4"
          >
            {session ? (
              <a
                href={session.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({
                  variant: "outline",
                  className: "w-full justify-center",
                })}
              >
                Open sign-in page
                <ExternalLinkIcon className="size-4" aria-hidden="true" />
              </a>
            ) : (
              <Button variant="outline" disabled className="w-full">
                Open sign-in page
                <ExternalLinkIcon className="size-4" aria-hidden="true" />
              </Button>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
                Or copy the sign-in link
              </span>
              <div className="flex items-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2">
                <code className="min-w-0 flex-1 truncate bg-transparent p-0 font-mono text-xs text-muted-foreground">
                  {session?.url ??
                    (formError
                      ? "Sign-in link unavailable"
                      : "Preparing sign-in link…")}
                </code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!session?.url}
                  onClick={() => void handleCopyLink()}
                  aria-label={copied ? "Copied" : "Copy sign-in link"}
                >
                  {copied ? (
                    <CheckIcon className="size-4 text-success" aria-hidden="true" />
                  ) : (
                    <CopyIcon className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="oauth-callback"
                className="text-sm font-medium text-foreground"
              >
                Callback address
              </label>
              <Input
                id="oauth-callback"
                type="url"
                autoComplete="off"
                placeholder="http://localhost:…/callback?code=…"
                value={callbackUrl}
                onValueChange={(val) => {
                  setCallbackUrl(val);
                  if (callbackError) setCallbackError("");
                }}
                aria-invalid={callbackError ? "true" : undefined}
                aria-describedby="oauth-callback-help oauth-callback-error"
              />
              <p
                id="oauth-callback-help"
                className="text-[13px] leading-5 text-muted-foreground"
              >
                If the final page can&rsquo;t reach localhost, paste its full
                address here.
              </p>
              {callbackError ? (
                <p
                  id="oauth-callback-error"
                  role="alert"
                  className="text-[13px] leading-5 text-destructive"
                >
                  {callbackError}
                </p>
              ) : null}
            </div>

            <div
              role="status"
              className="flex items-center gap-2 text-[13px] text-muted-foreground"
            >
              {!statusDone ? (
                <Loader2Icon
                  className="size-3.5 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
              <span>{statusText}</span>
            </div>

            {formError ? (
              <p role="alert" className="text-[13px] leading-5 text-destructive">
                {formError}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                disabled={!session || submitting}
              >
                {submitting ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                    Completing sign-in…
                  </>
                ) : (
                  "Complete sign-in"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
