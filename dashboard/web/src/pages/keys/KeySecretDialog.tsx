import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { Icon } from "../../components/BrandSprite";
import { CopyButton } from "../../components/CopyButton";
import {
  modelPattern,
  secretSnippet,
  type SecretClient,
  type SecretPayload,
} from "../../lib/format";
import type { ClientKey, KeyOptions } from "../../lib/types";

export interface SecretModalState {
  key: ClientKey;
  secret: string;
  how: "created" | "rotated";
}

export function KeySecretDialog({
  modal,
  baseUrl,
  options,
  onClose,
}: {
  modal: SecretModalState | null;
  baseUrl: string;
  options: KeyOptions | null;
  onClose: () => void;
}) {
  const [client, setClient] = useState<SecretClient>("curl");
  const copyRef = useRef<HTMLDivElement | null>(null);
  const lastKeyIdRef = useRef<string | null>(null);

  if (modal) {
    lastKeyIdRef.current = modal.key.id;
  }

  useEffect(() => {
    if (modal) setClient("curl");
  }, [modal]);

  const payload: SecretPayload | null = useMemo(() => {
    if (!modal) return null;
    const k = modal.key;
    const base = baseUrl.replace(/\/$/, "");
    const allowed = (options?.models || []).filter(
      (m) =>
        (!k.models.length ||
          k.models.some((p) => modelPattern(p).test(m.id))) &&
        (!k.providers.length ||
          m.providers.some((p) => k.providers.includes(p))),
    );
    const model =
      allowed[0]?.id || k.models.find((p) => !/[*?]/.test(p)) || "MODEL";
    return { base, secret: modal.secret, model };
  }, [modal, baseUrl, options]);

  const snippet = useMemo(
    () => secretSnippet(client, payload),
    [client, payload],
  );

  return (
    <Dialog
      open={Boolean(modal)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent
        id="secret-dialog"
        className="ui-modal"
        initialFocus={() =>
          copyRef.current?.querySelector<HTMLButtonElement>("#secret-copy") ||
          null
        }
        finalFocus={() => {
          const id = lastKeyIdRef.current;
          return (
            (id
              ? document.querySelector<HTMLElement>(
                  `[data-key-open="${CSS.escape(id)}"]`,
                )
              : null) || document.querySelector<HTMLElement>("[data-key-new]")
          );
        }}
      >
        <header className="dialog-header">
          <DialogTitle id="secret-title">
            {modal ? `Copy ${modal.key.name}'s key` : "Copy the new key"}
          </DialogTitle>
          <DialogDescription
            id="secret-description"
            className="dialog-description"
          >
            {modal?.how === "rotated"
              ? "The key was rotated. Give the client this new secret; the old one no longer works."
              : "The key is ready. Give it to the client it's for."}
          </DialogDescription>
        </header>

        <div className="dialog-body" ref={copyRef}>
          <p className="secret-warning">
            <Icon name="warning" />
            <span>
              You won’t see this key again. If it’s lost, rotate it.
            </span>
          </p>

          <div className="field">
            <label id="secret-key-label">API key</label>
            <div className="codebox" aria-labelledby="secret-key-label">
              <code id="secret-key">{payload?.secret || ""}</code>
              <CopyButton
                id="secret-copy"
                text={payload?.secret || ""}
                label="Copy API key"
              />
            </div>
          </div>

          <div className="field">
            <label id="secret-base-label">Base URL</label>
            <div className="codebox" aria-labelledby="secret-base-label">
              <code id="secret-base">{payload?.base || ""}</code>
              <CopyButton
                id="secret-base-copy"
                text={payload?.base || ""}
                label="Copy base URL"
              />
            </div>
          </div>

          <div className="field">
            <div className="secret-field-head">
              <label id="secret-example-label">Client setup</label>
              <SegmentedControl
                className="segmented sm"
                id="secret-client-tabs"
                aria-label="Client setup format"
                value={client}
                onValueChange={(next) => {
                  if (
                    next === "curl" ||
                    next === "claude" ||
                    next === "codex" ||
                    next === "openai"
                  ) {
                    setClient(next);
                  }
                }}
              >
                <SegmentedControlIndicator />
                <SegmentedControlItem value="curl" data-value="curl">curl</SegmentedControlItem>
                <SegmentedControlItem value="claude" data-value="claude">
                  Claude Code
                </SegmentedControlItem>
                <SegmentedControlItem value="codex" data-value="codex">Codex</SegmentedControlItem>
                <SegmentedControlItem value="openai" data-value="openai">
                  OpenAI
                </SegmentedControlItem>
              </SegmentedControl>
            </div>

            <div className="code-sample" aria-labelledby="secret-example-label">
              <pre id="secret-example" tabIndex={0}>
                {snippet.code}
              </pre>
              <CopyButton
                id="secret-example-copy"
                text={snippet.code}
                label="Copy example request"
              />
            </div>
            <p className="field-description" id="secret-example-help">
              {snippet.help}
            </p>
          </div>

          <footer className="dialog-footer">
            <DialogClose className="primary" id="secret-done">
              Done
            </DialogClose>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
