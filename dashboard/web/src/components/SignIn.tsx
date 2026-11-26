import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export function SignIn({
  initialError = "",
  onSuccess,
}: {
  initialError?: string;
  onSuccess: () => void;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setError(initialError);
  }, [initialError]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("login", { key });
      setKey("");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="login" className="login-screen">
      <form id="login-form" className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <span className="brand-mark">
            <svg aria-hidden="true">
              <use href="#prox-brand" />
            </svg>
          </span>
          <span className="brand-text">
            <strong>prox</strong>
          </span>
        </div>
        <header className="login-header">
          <h1>Your accounts. One place.</h1>
          <p>
            Pool your AI coding accounts behind one endpoint and keep an eye on
            every quota.
          </p>
        </header>
        <div className="field">
          <label htmlFor="management-key">Management key</label>
          <input
            ref={inputRef}
            id="management-key"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-describedby="management-key-help login-error"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <p className="field-description" id="management-key-help">
            Your CLIProxyAPI management key. Sign-in lasts 12 hours.
          </p>
        </div>
        <p id="login-error" className="form-error" role="alert" hidden={!error}>
          {error}
        </p>
        <button className="primary" type="submit" disabled={busy}>
          Open dashboard
        </button>
      </form>
    </section>
  );
}
