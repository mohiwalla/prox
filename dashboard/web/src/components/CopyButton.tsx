import { useEffect, useRef, useState } from "react";
import { notify } from "../lib/api";
import { Icon } from "./BrandSprite";

export function CopyButton({
  id,
  text,
  label,
  disabled,
  className = "ghost icon-btn sm copy-button",
  extraProps,
}: {
  id?: string;
  text: string;
  label: string;
  disabled?: boolean;
  className?: string;
  extraProps?: Record<string, unknown>;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      notify("Couldn't copy", "error", "Select the text and copy it.");
    }
  }

  return (
    <button
      id={id}
      type="button"
      className={className}
      disabled={disabled}
      aria-label={copied ? "Copied" : label}
      data-motion-copied={copied ? "" : undefined}
      onClick={onCopy}
      {...extraProps}
    >
      <span className="copy-icons">
        <Icon name="copy" className="copy-idle" />
        <Icon name="check" className="copy-done" />
      </span>
    </button>
  );
}
