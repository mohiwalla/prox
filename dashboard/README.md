# Batman quota dashboard

Private dashboard: https://batman.tailc343ff.ts.net:8317/dashboard/

Built from the saved Theo screenshot: black shell, quiet sidebar, provider tabs,
pooled quota charts, account breakdowns, and reset/burn summaries. This is a local
implementation, not Theo's unpublished fork.

## Design

- shadcn/ui (v4, neutral, dark) tokens and component metrics: base `#0a0a0a`, cards `#171717`, borders white/10%, muted text `#a1a1a1`, 4px grid.
- Codex blue `#82aafa`, Antigravity apricot `#e59a75`; status also uses text labels.
- Self-hosted Geist for the interface and Geist Mono for chart labels; no remote font requests.
- Left-aligned sidebar and wide charts; compact navigation and stacked details on phones.
- Large figures always describe measured account percentages. Plans are not assumed
  to have equal token budgets. Restrictions and missing/stale readings remain visible.

## Operation

Installed at `~/cliproxyapi/dashboard`. A separate user service serves localhost:8318.
Tailscale routes only `/dashboard/` to it. The existing API and original management
panel on port 8317 keep their original handlers.

Sign in with the existing CLIProxyAPI management key. The browser receives an
HttpOnly, SameSite=Strict, 12-hour session cookie, marked Secure over Tailscale.
The key and account tokens are never embedded in the page or saved in browser storage.
API access requires a session; write requests also check origin and a custom header.

The service reads credentials and makes quota-only requests using CLIProxyAPI's v8
management API. Codex reads `/backend-api/wham/usage`; Antigravity reads
`v1internal:fetchAvailableModels`. It never runs model inference to check quotas.
Tokens are substituted by CLIProxyAPI, not read by this service.

History is recorded every five minutes into `data/quota.sqlite` (private permissions),
retained for 30 days, and survives service restarts. No history is invented before
installation. Failed checks preserve their previous observation timestamp and show
an error. Credential status updates every 30 seconds. Manual refresh triggers a new check.

Forecasts require at least ten minutes of recent, contiguous samples for every
measured account. Consumption excludes increases caused by resets; gaps over fifteen
minutes are excluded. The dashed line assumes that recent usage continues and applies
only a provider-reported upcoming reset. Antigravity reset periods are not guessed.
No routing changes are made by this dashboard.

API endpoint for clients: `https://batman.tailc343ff.ts.net:8317/v1` (use the API key).

**Add login** (top right) lists every sign-in CLIProxyAPI offers: Claude, Codex,
Antigravity, xAI, Kimi (kimi.com and kimi.ai), Devin and Meta. Quota charts cover
Codex and Antigravity. Adding an account uses the proxy's OAuth flow. On another machine, the final localhost
callback may need to be pasted into the dialog. The callback is bound to the browser
session and matching OAuth state. Closing the dialog cancels the pending flow.
Pause/resume uses the existing credential status API; deleting credentials is left
to the original panel.

```sh
systemctl --user status cliproxy-dashboard
systemctl --user restart cliproxy-dashboard
python3 -m unittest discover -s dashboard -v
python3 dashboard/deploy.py
```

For UI-only updates, run from `~/cliproxyapi/source`:

```sh
python3 dashboard/deploy.py --frontend-only
```

The live URL serves deployed files, not a development server. Refresh the browser
after publishing; HTML updates are atomic and this command preserves active sessions.

Rollback only the dashboard route, preserving the proxy:

```sh
tailscale serve --bg --https=8317 --set-path=/dashboard off
systemctl --user disable --now cliproxy-dashboard
```

The original Tailscale handler map is saved as `data/tailscale-before-dashboard.json`.

Versioned source is in `~/cliproxyapi/source`. The tag `baseline-supplied-zip` points
to the original supplied source archive, before any dashboard code was added.
The production proxy is still the installed v8.0.67 release binary; the archive
baseline is a supplied source snapshot, not a claim that the binary was rebuilt.
Dashboard deployment backs up its own files and verifies that the proxy binary,
configuration, and original panel have identical SHA-256 fingerprints afterward.
It does not modify inference routes or restart the core proxy.

The design audit, direction, and skill attribution are recorded in `DESIGN.md`.
