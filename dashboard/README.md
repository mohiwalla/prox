# prox dashboard

A quota dashboard for a pooled CLIProxyAPI install: provider tabs, pooled quota charts
with forecasts, per-account status, and the everyday account actions, styled after
shadcn/ui. Layout inspired by Theo Browne's ([@t3dotgg](https://github.com/t3dotgg))
CLIProxyAPI setup; this is an independent implementation.

## Features

- Pooled quota charts for Codex and Antigravity with recorded history, burn rate,
  reset markers and a projection; scrub or arrow-key through samples.
- Accounts: rotation switch, sign in again, reset cooldown, remove (with confirmation).
- **Add login** for every sign-in CLIProxyAPI offers: Claude, Codex, Antigravity, xAI,
  Kimi (kimi.com and kimi.ai), Devin and Meta. Quota charts cover Codex and Antigravity.
- Logs: failed-request logs with a viewer, and a live activity tail (opt-in: it turns on
  the proxy's file logging only when you click Enable).
- Sonner toasts, Torph text morphing, keyboard navigation, reduced-motion support.

## Design

- shadcn/ui (v4, neutral, dark) tokens and component metrics: base `#0a0a0a`, cards `#171717`, borders white/10%, muted text `#a1a1a1`, 4px grid.
- Codex blue `#82aafa`, Antigravity apricot `#e59a75`; status also uses text labels.
- Self-hosted Geist and Geist Mono; no remote requests. Sonner, React and Torph are
  bundled into `assets/vendor.js` (rebuild with `npm install && npm run build` in `vendor/`).
- Large figures always describe measured account percentages. Plans are not assumed
  to have equal token budgets. Restrictions and missing/stale readings remain visible.

## How it works

A small Python service (`server.py`, standard library only) serves the page on
`127.0.0.1:8318` and talks to CLIProxyAPI's v8 management API on `127.0.0.1:8317`.
Put it behind Tailscale Serve and/or a Cloudflare Tunnel under `/dashboard/`, and list
the public host names in `DASHBOARD_HOSTS` (other Host headers are refused):

```ini
# ~/.config/systemd/user/cliproxy-dashboard.service.d/hosts.conf
[Service]
Environment=DASHBOARD_HOSTS=proxy.example.com,box.tailnet.ts.net:8317
# Optional: these Tailscale logins skip the management key (tailnet-only setups).
Environment=DASHBOARD_TAILNET_USERS=you@github
```

`DASHBOARD_TAILNET_USERS` trusts the `Tailscale-User-Login` header, so only set it when
every route to the dashboard goes through a tailnet proxy that sets that header (Caddy's
`tailscale_auth`, or `tailscale serve`), never through a public tunnel.

A Cloudflare Tunnel should allowlist routes so the management API never becomes public
(requests arrive from loopback, so CLIProxyAPI treats them as local):

```yaml
ingress:
  - hostname: proxy.example.com
    path: ^/($|dashboard(/|$))
    service: http://127.0.0.1:8318
  - hostname: proxy.example.com
    path: ^/v1/tunnel
    service: http_status:404
  - hostname: proxy.example.com
    path: ^/(v1|v1beta)(/|$)
    service: http://127.0.0.1:8317
  - service: http_status:404
```

Sign in with the CLIProxyAPI management key. The browser receives an HttpOnly,
SameSite=Strict, 12-hour session cookie (Secure on public hosts). The key and account
tokens never reach the page or browser storage. Write requests also check origin and a
custom header. Sign-in attempts are rate-limited per visitor address (the
`CF-Connecting-IP` / `X-Forwarded-For` address when behind a tunnel).

Quotas are read with quota-only requests through CLIProxyAPI (Codex
`/backend-api/wham/usage`, Antigravity `v1internal:fetchAvailableModels`); it never runs
model inference to check quotas, and tokens are substituted by CLIProxyAPI.

History is recorded every 30 seconds into `data/quota.sqlite` (private permissions),
sent to the browser downsampled to about 720 points per series (gzip-compressed),
and retained for 30 days. No history is invented. Forecasts need ten minutes of recent,
contiguous samples for every measured account; consumption excludes reset increases.
The dashboard never changes routing.

## Operate

The deploy script assumes CLIProxyAPI lives in `~/cliproxyapi` (binary, `config.yaml`,
`credentials.json` with `management_key`) and installs the dashboard to
`~/cliproxyapi/dashboard`. It backs up its own files and verifies the proxy binary,
config and stock panel are byte-identical afterwards.

```sh
python3 -m unittest discover -s dashboard -v     # server tests
python3 dashboard/deploy.py                      # install + restart the service
python3 dashboard/deploy.py --frontend-only      # UI only; sessions survive
systemctl --user status cliproxy-dashboard
```

Browser tests (Playwright + Chrome): `DASHBOARD_SOURCE=1 node dashboard/test_ui.cjs`
(set `DASHBOARD_URL` to test through a public host).

The design audit, direction and attributions are in `DESIGN.md`.
