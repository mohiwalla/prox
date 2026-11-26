import * as React from "react";
import { AlertTriangleIcon, CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@/components/ui";
import { modelPattern } from "@/lib/format";
import type { ClientKey, ClientKeyOptions } from "@/lib/types";

export interface KeySecretPayload {
  key: ClientKey;
  secret: string;
  reason: "created" | "rotated";
}

export interface KeySecretDialogProps {
  payload: KeySecretPayload | null;
  baseUrl: string;
  options: ClientKeyOptions | null;
  onClose: () => void;
}

type SetupClient = "curl" | "claude" | "codex" | "openai";

const CLIENT_TABS: readonly { id: SetupClient; label: string }[] = [
  { id: "curl", label: "curl" },
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "openai", label: "OpenAI" },
];

function buildSnippet(
  client: SetupClient,
  base: string,
  secret: string,
  model: string,
): { code: string; help: React.ReactNode } {
  if (client === "claude") {
    return {
      code: `export ANTHROPIC_BASE_URL="${base}"\nexport ANTHROPIC_AUTH_TOKEN="${secret}"\nclaude`,
      help: "Run in your shell before launching Claude Code.",
    };
  }
  if (client === "codex") {
    return {
      code: `# ~/.codex/config.toml\nmodel_provider = "prox"\n\n[model_providers.prox]\nname = "prox"\nbase_url = "${base}/v1"\nenv_key = "PROX_API_KEY"\nwire_api = "responses"\n\n# shell\nexport PROX_API_KEY="${secret}"`,
      help: (
        <>
          Configure the custom provider once, then export{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-[11px] text-foreground">
            PROX_API_KEY
          </code>{" "}
          before running codex.
        </>
      ),
    };
  }
  if (client === "openai") {
    return {
      code: `export OPENAI_BASE_URL="${base}/v1"\nexport OPENAI_API_KEY="${secret}"`,
      help: "Works with OpenAI-compatible SDKs and editors (Cursor, Cline, Roo Code, OpenCode, Aider).",
    };
  }
  return {
    code: `curl ${base}/v1/chat/completions \\\n  -H "Authorization: Bearer ${secret}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`,
    help: (
      <>
        Send the key as{" "}
        <code className="rounded bg-secondary px-1 py-0.5 text-[11px] text-foreground">
          Authorization: Bearer …
        </code>
        . OpenAI-style clients take the base URL with{" "}
        <code className="rounded bg-secondary px-1 py-0.5 text-[11px] text-foreground">
          /v1
        </code>
        .
      </>
    ),
  };
}

export function KeySecretDialog({
  payload,
  baseUrl,
  options,
  onClose,
}: KeySecretDialogProps) {
  const open = payload !== null;
  const [client, setClient] = React.useState<SetupClient>("curl");
  const [copiedField, setCopiedField] = React.useState<string | null>(null);

  const copyKeyRef = React.useRef<HTMLButtonElement | null>(null);
  const copyTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (open) {
      setClient("curl");
      setCopiedField(null);
    }
  }, [open, payload?.key.id]);

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const cleanBase = baseUrl.replace(/\/$/, "");

  const allowedModel = React.useMemo(() => {
    if (!payload) return "MODEL";
    const k = payload.key;
    const allowed = (options?.models ?? []).filter(
      (m) =>
        (!k.models.length ||
          k.models.some((p) => modelPattern(p).test(m.id))) &&
        (!k.providers.length ||
          m.providers.some((p) => k.providers.includes(p))),
    );
    return (
      allowed[0]?.id ||
      k.models.find((p) => !/[*?]/.test(p)) ||
      "MODEL"
    );
  }, [payload, options]);

  async function copyText(field: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedField((prev) => (prev === field ? null : prev));
      }, 2000);
    } catch {
      toast.error("Couldn't copy", {
        description: "Select the text and copy it manually.",
      });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent
        initialFocus={() => copyKeyRef.current}
        className="w-[min(560px,calc(100vw-32px))]"
      >
        <DialogHeader>
          <DialogTitle>
            {payload ? `Copy ${payload.key.name}'s key` : "Copy the new key"}
          </DialogTitle>
          <DialogDescription>
            {payload?.reason === "rotated"
              ? "The key was rotated. Give the client this new secret; the old one no longer works."
              : "The key is ready. Give it to the client it's for."}
          </DialogDescription>
        </DialogHeader>

        {payload ? (
          <div className="flex flex-col gap-4">
            {/* Warning banner */}
            <div
              role="note"
              className="flex items-start gap-2.5 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3.5 py-2.5 text-[13px] leading-5 text-warning"
            >
              <AlertTriangleIcon
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>
                You won&rsquo;t see this key again. If it&rsquo;s lost, rotate
                it.
              </span>
            </div>

            {/* API key */}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
                API key
              </span>
              <div className="flex items-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground select-all">
                  {payload.secret}
                </code>
                <button
                  ref={copyKeyRef}
                  type="button"
                  onClick={() => void copyText("secret", payload.secret)}
                  aria-label={
                    copiedField === "secret" ? "Copied" : "Copy API key"
                  }
                  className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {copiedField === "secret" ? (
                    <CheckIcon
                      className="size-4 text-success"
                      aria-hidden="true"
                    />
                  ) : (
                    <CopyIcon className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {/* Base URL */}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
                Base URL
              </span>
              <div className="flex items-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground select-all">
                  {cleanBase}
                </code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void copyText("base", cleanBase)}
                  aria-label={
                    copiedField === "base" ? "Copied" : "Copy base URL"
                  }
                >
                  {copiedField === "base" ? (
                    <CheckIcon
                      className="size-4 text-success"
                      aria-hidden="true"
                    />
                  ) : (
                    <CopyIcon className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>

            {/* Client setup tabs */}
            <div className="flex flex-col gap-2">
              <Tabs<SetupClient>
                value={client}
                onValueChange={(next) => {
                  if (next) setClient(next);
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    Client setup
                  </span>
                  <TabsList aria-label="Client setup format">
                    {CLIENT_TABS.map((t) => (
                      <TabsTab
                        key={t.id}
                        value={t.id}
                        className="h-7 px-2.5 text-xs"
                      >
                        {t.label}
                      </TabsTab>
                    ))}
                  </TabsList>
                </div>

                {CLIENT_TABS.map((t) => {
                  const snippet = buildSnippet(
                    t.id,
                    cleanBase,
                    payload.secret,
                    allowedModel,
                  );
                  const copyKey = `snippet-${t.id}`;
                  return (
                    <TabsPanel
                      key={t.id}
                      value={t.id}
                      className="flex flex-col gap-2"
                    >
                      <div className="relative rounded-lg border border-border bg-background/70 p-3 pr-11">
                        <pre
                          tabIndex={0}
                          className="m-0 overflow-x-auto font-mono text-xs leading-5 text-foreground/95 focus-visible:outline-none"
                        >
                          {snippet.code}
                        </pre>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void copyText(copyKey, snippet.code)}
                          aria-label={
                            copiedField === copyKey
                              ? "Copied"
                              : "Copy example request"
                          }
                          className="absolute top-2 right-2"
                        >
                          {copiedField === copyKey ? (
                            <CheckIcon
                              className="size-4 text-success"
                              aria-hidden="true"
                            />
                          ) : (
                            <CopyIcon className="size-4" aria-hidden="true" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {snippet.help}
                      </p>
                    </TabsPanel>
                  );
                })}
              </Tabs>
            </div>

            <DialogFooter>
              <Button variant="default" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
