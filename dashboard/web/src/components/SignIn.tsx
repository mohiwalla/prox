import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { ProxBrandIcon } from "@/components/ProviderIcon";
import { Button, Input } from "@/components/ui";
import { apiPost } from "@/lib/api";

export interface SignInProps {
  initialError?: string;
  onAuthenticated: () => void;
}

export function SignIn({ initialError = "", onAuthenticated }: SignInProps) {
  const [key, setKey] = React.useState("");
  const [error, setError] = React.useState(initialError);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (initialError) {
      setError(initialError);
    }
  }, [initialError]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await apiPost("login", { key });
      setKey("");
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-h-dvh items-center justify-center bg-background p-6">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex w-full max-w-[380px] flex-col gap-5 rounded-xl border border-border bg-card p-6 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          <ProxBrandIcon />
          <span className="text-[15px] font-semibold tracking-tight text-foreground">
            prox
          </span>
        </div>

        <header className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Your accounts. One place.
          </h1>
          <p className="text-sm leading-5 text-muted-foreground">
            Pool your AI coding accounts behind one endpoint and keep an eye on
            every quota.
          </p>
        </header>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="management-key"
            className="text-sm font-medium leading-5 text-foreground"
          >
            Management key
          </label>
          <Input
            id="management-key"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={key}
            onValueChange={(value) => {
              setKey(value);
              if (error) setError("");
            }}
            aria-invalid={error ? "true" : undefined}
            aria-describedby="management-key-help management-key-error"
          />
          <p
            id="management-key-help"
            className="text-[13px] leading-5 text-muted-foreground"
          >
            Your CLIProxyAPI management key. Sessions stay active until signed
            out or rotated.
          </p>
        </div>

        {error ? (
          <p
            id="management-key-error"
            role="alert"
            className="text-[13px] leading-5 text-destructive"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="default"
          disabled={busy || !key}
          className="w-full"
        >
          {busy ? (
            <>
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              Signing in…
            </>
          ) : (
            "Open dashboard"
          )}
        </Button>
      </form>
    </section>
  );
}
