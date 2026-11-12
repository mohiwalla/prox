# Batman quota dashboard

Private dashboard: https://batman.tailc343ff.ts.net:8317/dashboard/

Built from the saved Theo screenshot: black shell, quiet sidebar, provider tabs,
pooled quota charts, account breakdowns, and reset/burn summaries. This is a local
implementation, not Theo's unpublished fork.

## Design

- Base `#000000`, panels `#101010`, borders `#292929`, text `#ededed`, secondary text `#a2a2a2`.
- Codex blue `#82aafa`, Antigravity apricot `#e59a75`; status also uses text labels.
- System sans serif to match the reference and work without remote font requests.
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

Adding an account uses the proxy's OAuth flow. On another machine, the final localhost
callback may need to be pasted into the dialog. The callback is bound to the browser
session and matching OAuth state. Closing the dialog cancels the pending flow.
Pause/resume uses the existing credential status API; deleting credentials is left
to the original panel.

```sh
systemctl --user status cliproxy-dashboard
systemctl --user restart cliproxy-dashboard
python3 -m unittest discover -s dashboard -v
```

Rollback only the dashboard route, preserving the proxy:

```sh
tailscale serve --bg --https=8317 --set-path=/dashboard off
systemctl --user disable --now cliproxy-dashboard
```

The original Tailscale handler map is saved as `data/tailscale-before-dashboard.json`.
