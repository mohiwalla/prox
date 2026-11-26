# Client Setup Guide

Use a client API key (`cpk_...`) issued from the **Keys** page in the prox dashboard to connect any OpenAI-, Anthropic-, or Gemini-compatible client.

## What you need

- **API key:** `cpk_...` (shown once when created or rotated)
- **Base URL:** your proxy URL, e.g. `https://prox.example.com`

## Check which models your key can access

Each key may be restricted to specific providers, accounts, model patterns, and a weekly token limit. List the models available to your key:

```bash
curl https://prox.example.com/v1/models \
  -H "Authorization: Bearer cpk_YOUR_KEY"
```

## Supported clients

### Claude Code

```bash
export ANTHROPIC_BASE_URL="https://prox.example.com"
export ANTHROPIC_AUTH_TOKEN="cpk_YOUR_KEY"
claude
```

### Codex CLI

Add a custom provider to `~/.codex/config.toml` and export your key:

```toml
model_provider = "prox"

[model_providers.prox]
name = "prox"
base_url = "https://prox.example.com/v1"
env_key = "PROX_API_KEY"
wire_api = "responses"
```

```bash
export PROX_API_KEY="cpk_YOUR_KEY"
codex
```

### OpenAI-compatible tools & SDKs

Works with Cursor, Cline, Roo Code, OpenCode, Continue, Aider, Open WebUI, LibreChat, and the official OpenAI Python/Node SDKs:

- **Base URL:** `https://prox.example.com/v1`
- **API key:** `cpk_YOUR_KEY`

```bash
export OPENAI_BASE_URL="https://prox.example.com/v1"
export OPENAI_API_KEY="cpk_YOUR_KEY"
```

### Gemini CLI & Google GenAI SDKs

Point the Gemini base URL to `https://prox.example.com` (routes under `/v1beta/models/...`) and pass `cpk_YOUR_KEY` as the API key.

### Direct `curl` test

```bash
curl https://prox.example.com/v1/chat/completions \
  -H "Authorization: Bearer cpk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"MODEL_ID","messages":[{"role":"user","content":"Hello"}]}'
```

## Authentication headers

The proxy accepts the client key in any of these places:

- `Authorization: Bearer cpk_...` (OpenAI / Codex / general)
- `x-api-key: cpk_...` (Anthropic)
- `x-goog-api-key: cpk_...` or `?key=cpk_...` (Gemini)

## Notes for admins

- **Provider vs. model restrictions:** Some providers serve multiple model families—for example, Antigravity accounts can serve both Gemini models and Claude models (via Vertex AI). If you want a key limited to Gemini models only, add a model pattern such as `gemini-*` when creating or editing the key.
- **Rotating a key:** Rotating invalidates the old secret immediately and shows the new secret once.
