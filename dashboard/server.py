#!/usr/bin/env python3
"""Private quota dashboard. Account tokens stay inside CLIProxyAPI."""
import concurrent.futures
from contextlib import contextmanager
import copy
import gzip
import hashlib
import hmac
import http.cookies
import json
import math
import os
import re
from pathlib import Path
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("DASHBOARD_DATA", str(ROOT / "data")))
CREDENTIALS = Path.home() / "cliproxyapi/credentials.json"
# Public host[:port] names the dashboard answers on, comma-separated (e.g. a Tailscale
# name and a Cloudflare Tunnel hostname). The first one is advertised as the API endpoint.
PUBLIC_HOSTS = [h.strip() for h in os.environ.get("DASHBOARD_HOSTS", "").split(",") if h.strip()]
LOCAL_HOSTS = {"127.0.0.1:8318", "localhost:8318"}
QUOTA_PROVIDERS = {"codex", "antigravity", "claude"}  # providers with quota readers
# Slower checks for providers whose quota endpoint is rate-limited. Anthropic's
# /api/oauth/usage answers about one call per two minutes per account.
QUOTA_MIN_INTERVAL = {"claude": 180}
QUOTA_INTERVAL = 30
# Codex reset credits change rarely: read them every 10 minutes and right after one is used.
RESET_INTERVAL = 600
# A Claude reset claim with an unknown outcome may be retried with the same request ID for 10 minutes.
RESET_RETRY_WINDOW = 600
CODEX_RESETS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"
CLAUDE_UA = "claude-cli/2.1.280 (external, cli)"  # seconds between live quota checks
HISTORY_POINTS = 720  # most points per series sent to the browser
# Every OAuth flow CLIProxyAPI v8 exposes through /oauth/auth-url.
OAUTH_PROVIDERS = {"claude", "codex", "antigravity", "xai", "kimi", "kimi-ai", "devin", "meta"}
ERROR_LOG_NAME = re.compile(r"^error-[A-Za-z0-9._-]+\.log$")
ERROR_LOG_LIMIT = 256 * 1024  # bytes of a failed-request log sent to the browser


class ProxyError(ValueError):
    """An HTTP error from CLIProxyAPI. The body stays server-side; only the status is public."""

    def __init__(self, status, body=b""):
        super().__init__(f"Proxy returned HTTP {status}. Check the original panel for details.")
        self.status = status
        self.body = body


def timestamp(value):
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError, AttributeError):
        return None


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def window(key, label, used=None, remaining=None, reset=None, period=None):
    fraction = number(remaining)
    used = number(used)
    if fraction is None and used is not None:
        fraction = 1 - used / 100
    if fraction is None:
        return None
    return {"id": key, "label": label, "remaining": round(max(0, min(1, fraction)) * 100, 3),
            "reset_at": timestamp(reset), "period": number(period)}


def parse_codex(data):
    windows = []
    for group, title in [("rate_limit", "Usage"), ("code_review_rate_limit", "Code review")]:
        for slot in ["primary_window", "secondary_window"]:
            value = (data.get(group) or {}).get(slot)
            if not isinstance(value, dict):
                continue
            period = number(value.get("limit_window_seconds"))
            duration = f"{period / 86400:g} days" if period and period >= 86400 else f"{(period or 0) / 3600:g} hours"
            item = window(f"{group}:{slot}", f"{title} · {duration}", used=value.get("used_percent"),
                          reset=value.get("reset_at"), period=period)
            if item:
                windows.append(item)
    return {"plan": str(data.get("plan_type") or "Unknown"), "windows": windows}


ANTIGRAVITY_WINDOWS = {"5h": ("5-hour limit", 5 * 3600), "weekly": ("Weekly limit", 7 * 86400)}


def parse_antigravity(data):
    # retrieveUserQuotaSummary: models in a group share one 5-hour and one weekly limit.
    windows = []
    for n, group in enumerate(data.get("groups") or [], 1):
        name = str(group.get("displayName") or f"Group {n}")
        name = re.sub(r"\s+models$", "", name, flags=re.I).replace(" and ", " & ")
        # Shortest window first, like Claude and Codex (the API lists weekly first).
        buckets = sorted(group.get("buckets") or [], key=lambda b: ANTIGRAVITY_WINDOWS.get(b.get("window"), ("", math.inf))[1])
        for bucket in buckets:
            label, period = ANTIGRAVITY_WINDOWS.get(bucket.get("window"), (
                re.sub(r"\s+remaining$", "", str(bucket.get("displayName") or "Limit"), flags=re.I), None))
            item = window(bucket.get("bucketId") or f"{name}:{bucket.get('window')}", f"{name} · {label}",
                          remaining=bucket.get("remainingFraction"), reset=bucket.get("resetTime"), period=period)
            if item:
                windows.append({**item, "group": name})
    return {"plan": "Antigravity", "windows": windows}


CLAUDE_WINDOWS = {"five_hour": ("5-hour limit", 5 * 3600), "seven_day": ("Weekly limit", 7 * 86400)}
# Per-model weekly windows (seven_day_opus, seven_day_sonnet, ...) are read generically so a new
# model's limit shows up without a code change. OAuth-app usage is not a model limit.
CLAUDE_MODEL_WINDOW = re.compile(r"seven_day_([a-z0-9_]+)")
CLAUDE_SKIPPED_WINDOWS = {"seven_day_oauth_apps"}


def claude_used(value):
    # A present but unreadable value fails the check, so the last good reading is kept.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Claude returned an unreadable quota.")
    return value


def parse_claude(data):
    # Claude Code's /api/oauth/usage: utilization is percent used; null windows don't apply.
    windows = []
    model_keys = sorted(k for k in data if CLAUDE_MODEL_WINDOW.fullmatch(k) and k not in CLAUDE_SKIPPED_WINDOWS)
    for key in [*CLAUDE_WINDOWS, *model_keys]:
        value = data.get(key)
        if not isinstance(value, dict) or value.get("utilization") is None:
            continue
        label, period = CLAUDE_WINDOWS.get(key) or (
            "Weekly · " + CLAUDE_MODEL_WINDOW.fullmatch(key)[1].replace("_", " ").title(), 7 * 86400)
        windows.append(window(key, label, used=claude_used(value["utilization"]), reset=value.get("resets_at"), period=period))
    # Newer models (Fable 5) report their weekly limit in `limits` as a model-scoped entry.
    scoped = {}
    for limit in data.get("limits") or []:
        name = ((((limit or {}).get("scope") or {}).get("model") or {}).get("display_name") or "").strip()
        if limit.get("kind") != "weekly_scoped" or not name or limit.get("percent") is None:
            continue
        if name not in scoped or limit.get("is_active") is True:
            scoped[name] = limit
    for name, limit in scoped.items():
        key = "weekly_scoped:" + re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
        windows.append(window(key, f"Weekly · {name}", used=claude_used(limit["percent"]),
                              reset=limit.get("resets_at"), period=7 * 86400))
    # Older responses carried Fable under its codename; with dollar fields it is cloud credits instead.
    fable = data.get("iguana_necktie")
    if (isinstance(fable, dict) and fable.get("utilization") is not None and not scoped
            and all(fable.get(k) is None for k in ("limit_dollars", "used_dollars", "remaining_dollars"))):
        windows.append(window("iguana_necktie", "Weekly · Fable 5", used=claude_used(fable["utilization"]),
                              reset=fable.get("resets_at"), period=7 * 86400))
    result = {"plan": "Claude", "windows": windows}
    resets = parse_claude_resets(data.get("cedar_ember"))
    if resets is not None:
        result["resets"] = resets
    return result


def parse_codex_resets(data):
    credits = sorted((c for c in data.get("credits") or [] if isinstance(c, dict)
                      and c.get("reset_type") == "codex_rate_limits" and c.get("status") == "available"
                      and timestamp(c.get("expires_at"))), key=lambda c: timestamp(c["expires_at"]))
    items = [{"id": str(c.get("id") or ""), "label": str(c.get("title") or "Full reset")[:80], "left": 1, "total": 1,
              "expires_at": timestamp(c["expires_at"]), "reason": None} for c in credits]
    count = number(data.get("available_count"))
    return {"available": int(count) if count is not None else len(items), "items": items}


CLAUDE_GRANT_ID = re.compile(r"[a-z0-9_-]{1,40}")


def claude_grant_reason(status, grant, now):
    # Mirrors Anthropic's own checks so the dashboard never submits a claim it knows will be refused.
    starts, ends, cooldown = (timestamp(v) for v in (grant.get("starts_at"), grant.get("ends_at"), status.get("cooldown_until")))
    used = [v for v in (grant.get("percent_used") or {}).values() if isinstance(v, (int, float))]
    if not status.get("eligible"):
        return "Not available for this account"
    if grant.get("paused"):
        return "Paused by Anthropic"
    if not grant.get("usable_now"):
        return "Not usable yet"
    if grant["left"] <= 0:
        return "Used up"
    if grant.get("use_requires_limit", True) and not status.get("at_limit"):
        return "Usable once the account hits a limit"
    if grant.get("gives_back_weekly") and used and all(v == 0 for v in used):
        return "No usage to give back yet"
    if starts and starts > now:
        return "Not started yet"
    if ends and ends <= now:
        return "Expired"
    if cooldown and cooldown > now:
        return "Cooling down after the last reset"
    return None


def parse_claude_resets(status, now=None):
    if not isinstance(status, dict) or not isinstance(status.get("eligible"), bool):
        return None
    now = time.time() if now is None else now
    items = []
    for grant in status.get("grants") or []:
        left, total = (grant or {}).get("resets_left"), (grant or {}).get("resets_total")
        if (not CLAUDE_GRANT_ID.fullmatch(str(grant.get("id", ""))) or not isinstance(left, int)
                or not isinstance(total, int) or isinstance(left, bool) or not 0 <= left <= total):
            continue
        label = re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", str(grant.get("label") or ""))).strip()[:120]
        item = {"id": grant["id"], "label": label or "Limit reset", "left": left, "total": total,
                "expires_at": timestamp(grant.get("ends_at"))}
        item["reason"] = claude_grant_reason(status, {**grant, "left": left}, now)
        items.append(item)
    return {"available": sum(i["left"] for i in items), "items": items}


def safe_account(raw, quota=None):
    # Deliberately enumerate fields. Never relay raw credentials, id_token, paths or headers.
    cooldowns = [{k: c.get(k) for k in ["scope", "model_key", "reason", "retry_at", "http_status"]}
                 for c in raw.get("cooldowns", [])]
    plan = (quota or {}).get("plan") or raw.get("id_token", {}).get("plan_type") or "Unknown"
    retry = [t for t in (timestamp(c.get("retry_at")) for c in raw.get("cooldowns", [])) if t]
    return {"id": raw["auth_index"], "provider": raw.get("provider", raw.get("type")),
            "email": raw.get("email") or raw.get("label") or "", "name": raw.get("name", ""),
            "plan": plan, "disabled": bool(raw.get("disabled")), "status": raw.get("status", "unknown"),
            "unavailable": bool(raw.get("unavailable")), "requires_sign_in": bool(raw.get("requires_sign_in")),
            "cooldowns": cooldowns, "success": raw.get("success", 0), "failed": raw.get("failed", 0),
            "windows": (quota or {}).get("windows", []), "quota_at": (quota or {}).get("observed_at"),
            "quota_error": (quota or {}).get("error"), "last_refresh": raw.get("last_refresh"),
            "resets": (quota or {}).get("resets"),
            "cooldown_until": max(retry) if retry else None}


class Store:
    def __init__(self, path):
        self.path = path
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS samples (ts REAL, account TEXT, provider TEXT, metric TEXT, remaining REAL, reset_at REAL, period REAL, PRIMARY KEY(ts,account,metric))")
            db.execute("CREATE INDEX IF NOT EXISTS samples_time ON samples(ts)")
            db.execute("CREATE TABLE IF NOT EXISTS latest (account TEXT PRIMARY KEY, data TEXT)")

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=15)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def load(self):
        with self.connect() as db:
            return {row[0]: json.loads(row[1]) for row in db.execute("SELECT account,data FROM latest")}

    def save(self, account, provider, quota):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO latest VALUES (?,?)", (account, json.dumps(quota)))
            for w in quota.get("windows", []):
                db.execute("INSERT OR REPLACE INTO samples VALUES (?,?,?,?,?,?,?)", (
                    quota["observed_at"], account, provider, w["id"], w["remaining"], w["reset_at"], w["period"]))
            db.execute("DELETE FROM samples WHERE ts < ?", (time.time() - 30 * 86400,))

    def forget(self, account):
        """Drop an account's latest reading; its history samples stay for the charts."""
        with self.connect() as db:
            db.execute("DELETE FROM latest WHERE account=?", (account,))

    @staticmethod
    def bucket(hours):
        return max(120, hours * 3600 / HISTORY_POINTS)

    def history(self, hours=24):
        # Keep every sample on disk, but send one refresh cycle per bucket: all accounts
        # in a cycle share a timestamp, so pooled sums stay exact.
        size = self.bucket(hours)
        with self.connect() as db:
            rows = db.execute(
                "WITH b AS (SELECT MAX(ts) m FROM samples WHERE ts>=? GROUP BY CAST(ts/? AS INTEGER)) "
                "SELECT ts,account,provider,metric,remaining,reset_at,period FROM samples JOIN b ON ts=b.m ORDER BY ts",
                (time.time() - hours * 3600, size)).fetchall()
        return [dict(zip(["ts", "account", "provider", "metric", "remaining", "reset_at", "period"], r)) for r in rows]


class Hub:
    def __init__(self, store):
        self.store = store
        self.lock = threading.RLock()
        self.refresh_lock = threading.Lock()
        self.quotas = store.load()
        self.quota_attempts = {}
        self.reset_reads = {}
        self.reset_claims = {}
        self.resetting = set()
        self.files = []
        self.error = None
        self.updated = None
        self.refreshing = False
        self.wake = threading.Event()
        self.sessions = {}
        self.oauth = {}
        self.login_attempts = {}

    @staticmethod
    def management_key():
        return json.loads(CREDENTIALS.read_text())["management_key"]

    def request(self, path, data=None, method=None, raw=False):
        req = urllib.request.Request("http://127.0.0.1:8317/v8/management/" + path,
            headers={"Authorization": "Bearer " + self.management_key(), "Content-Type": "application/json"},
            data=json.dumps(data).encode() if data is not None else None, method=method)
        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                return response.read() if raw else json.load(response)
        except urllib.error.HTTPError as exc:
            # Do not relay raw upstream bodies, which may contain account details or auth material.
            raise ProxyError(exc.code, exc.read()[:2048]) from None

    def account(self, idx):
        with self.lock:
            return next((f for f in self.files if f["auth_index"] == idx), None)

    def read_files(self):
        result = self.request("credentials")
        # Every signed-in account is listed; only QUOTA_PROVIDERS also get quota checks.
        files = [f for f in result.get("files", []) if f.get("provider")]
        with self.lock:
            self.files, self.updated, self.error = files, time.time(), None
        return files

    @staticmethod
    def headers(raw):
        headers = {"Authorization": "Bearer $TOKEN$", "Content-Type": "application/json"}
        if raw["provider"] == "codex":
            account_id = raw.get("id_token", {}).get("chatgpt_account_id")
            if account_id:
                headers["Chatgpt-Account-Id"] = account_id
            headers["User-Agent"] = "codex-tui/0.149.1"
        elif raw["provider"] == "claude":
            headers["anthropic-beta"] = "oauth-2025-04-20"
            # Anthropic only reports reset grants to a current CLI version.
            headers["User-Agent"] = CLAUDE_UA
        return headers

    def call(self, raw, method, url, headers, data=None):
        payload = {"auth_index": raw["auth_index"], "method": method, "url": url, "header": headers}
        if data is not None:
            payload["data"] = json.dumps(data)
        response = self.request("requests/api-call", payload)
        try:
            body = json.loads(response.get("body") or "null")
        except ValueError:
            body = None
        return response.get("status_code", 0), body

    def fetch_quota(self, raw):
        headers = self.headers(raw)
        if raw["provider"] == "codex":
            payload = {"method": "GET", "url": "https://chatgpt.com/backend-api/wham/usage", "header": headers}
        elif raw["provider"] == "claude":
            # cedar_ember adds the account's banked reset grants to the same response.
            payload = {"method": "GET", "url": "https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1",
                       "header": headers}
        else:
            headers["User-Agent"] = "antigravity/hub/2.23.0 linux/amd64"
            payload = {"method": "POST", "url": "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
                       "header": headers, "data": json.dumps({"project": raw.get("project_id", "")})}
        payload["auth_index"] = raw["auth_index"]
        response = self.request("requests/api-call", payload)
        if not 200 <= response.get("status_code", 0) < 300:
            raise ValueError(f"Quota request returned HTTP {response.get('status_code', 'unknown')}. Try refreshing or signing in again.")
        data = json.loads(response.get("body", "{}"))
        parsed = {"codex": parse_codex, "claude": parse_claude}.get(raw["provider"], parse_antigravity)(data)
        if not parsed["windows"]:
            raise ValueError("The provider returned no quota windows.")
        parsed["observed_at"] = time.time()
        return parsed

    def fetch_codex_resets(self, raw):
        status, body = self.call(raw, "GET", CODEX_RESETS_URL, {**self.headers(raw), "Accept": "application/json",
                                                               "OpenAI-Beta": "codex-1", "Originator": "Codex Desktop"})
        if not 200 <= status < 300 or not isinstance(body, dict):
            raise ValueError("Reset credits could not be read.")
        return parse_codex_resets(body)

    def refresh_one(self, raw, observed_at=None):
        idx = raw["auth_index"]
        if raw.get("disabled") or raw.get("provider") not in QUOTA_PROVIDERS:
            return
        interval = QUOTA_MIN_INTERVAL.get(raw["provider"])
        if interval:
            now = time.time()
            with self.lock:
                if now - self.quota_attempts.get(idx, 0) < interval:
                    return
                self.quota_attempts[idx] = now
        try:
            quota = self.fetch_quota(raw)
            if observed_at is not None:
                quota["observed_at"] = observed_at
            if raw["provider"] == "codex":
                quota["resets"] = self.codex_resets(raw)
            self.store.save(idx, raw["provider"], quota)
        except Exception as exc:
            with self.lock:
                quota = copy.deepcopy(self.quotas.get(idx, {"windows": []}))
            quota["error"] = str(exc) if isinstance(exc, ValueError) else "Quota refresh failed. Check the connection and retry."
        with self.lock:
            self.quotas[idx] = quota

    def codex_resets(self, raw):
        # A failed read keeps the last known credits; quota checks never fail because of it.
        idx, now = raw["auth_index"], time.time()
        with self.lock:
            known = (self.quotas.get(idx) or {}).get("resets")
            due = now - self.reset_reads.get(idx, 0) >= RESET_INTERVAL
            if due:
                self.reset_reads[idx] = now
        if not due:
            return known
        try:
            return self.fetch_codex_resets(raw)
        except Exception:
            return known

    def use_reset(self, raw, grant_id=None):
        idx = raw["auth_index"]
        with self.lock:
            if idx in self.resetting:
                raise ValueError("A reset is already running for this account.")
            self.resetting.add(idx)
            resets = copy.deepcopy((self.quotas.get(idx) or {}).get("resets") or {})
        try:
            if raw["provider"] == "codex":
                self.claim_codex(raw, grant_id)
            elif raw["provider"] == "claude":
                self.claim_claude(raw, resets, grant_id)
            else:
                raise ValueError("This provider has no manual resets.")
            try:
                self.request("routing/cooldown/reset", {"auth_index": idx}, "POST")
            except Exception:
                pass
            with self.lock:
                if raw["provider"] == "codex":
                    self.reset_reads.pop(idx, None)
                else:
                    # Show the spent grant now; Anthropic's usage endpoint answers about once per two minutes.
                    quota = self.quotas.get(idx) or {}
                    for item in (quota.get("resets") or {}).get("items", []):
                        if item["id"] == grant_id and item["left"] > 0:
                            item["left"] -= 1
                            quota["resets"]["available"] = max(0, quota["resets"]["available"] - 1)
            if raw["provider"] == "codex":
                self.refresh_one(raw)
        finally:
            with self.lock:
                self.resetting.discard(idx)

    def pending_claim(self, idx, key):
        # A claim whose outcome was unknown is retried with the same request ID for a while,
        # so the provider treats the retry as the same request and can't spend twice.
        with self.lock:
            pending = self.reset_claims.get((idx, key))
            if pending and time.time() - pending["created"] >= RESET_RETRY_WINDOW:
                self.reset_claims.pop((idx, key), None)
                pending = None
            return pending

    def claim_codex(self, raw, credit_id):
        idx = raw["auth_index"]
        pending = self.pending_claim(idx, credit_id) if credit_id else None
        if not pending:
            # Read the credits fresh: the chosen one must still be on the account.
            try:
                fresh = self.fetch_codex_resets(raw)
            except ValueError:
                raise ValueError("Reset credits could not be read, so none was used.") from None
            with self.lock:
                if idx in self.quotas:
                    self.quotas[idx]["resets"] = fresh
            ids = [i["id"] for i in fresh["items"]]
            credit_id = credit_id or next(iter(ids), None)
            if not credit_id:
                raise ValueError("This account has no resets left.")
            if credit_id not in ids:
                raise ValueError("That reset is no longer on the account, so none was used.")
            pending = {"request_id": str(uuid.uuid4()), "created": time.time()}
            with self.lock:
                self.reset_claims[(idx, credit_id)] = pending
        try:
            status, body = self.call(raw, "POST", CODEX_RESETS_URL + "/consume", self.headers(raw),
                                     {"credit_id": credit_id, "redeem_request_id": pending["request_id"]})
        except Exception:
            status, body = 0, None
        code = (body or {}).get("code") if 200 <= status < 300 else None
        declined = {"nothing_to_reset": "OpenAI says no limit has been used yet, so the reset was kept.",
                    "no_credit": "OpenAI says this account has no resets left. None was used."}
        if code in {"reset", "already_redeemed"} or code in declined or status in (401, 403, 429):
            with self.lock:
                self.reset_claims.pop((idx, credit_id), None)
        if status == 429:
            raise ValueError("OpenAI is rate limiting this account. Try again in a minute.")
        if status in (401, 403):
            raise ValueError("OpenAI rejected the login. Sign in again, then retry.")
        if code in declined:
            raise ValueError(declined[code])
        if code not in {"reset", "already_redeemed"}:
            raise ValueError("The outcome is unknown and a reset may have been spent. Retrying within 10 minutes "
                             "reuses the same request, so it can't spend a second one.")

    def claim_claude(self, raw, resets, grant_id):
        idx = raw["auth_index"]
        grant = next((g for g in resets.get("items", []) if g["id"] == grant_id), None)
        if grant is None:
            raise ValueError("That reset is no longer listed. Refresh and try again.")
        pending = self.pending_claim(idx, grant_id)
        # A pending claim already passed these checks; only its retry may skip them.
        if not pending and grant["reason"]:
            raise ValueError(f"This reset can't be used now: {grant['reason'].lower()}.")
        status, profile = self.call(raw, "GET", "https://api.anthropic.com/api/oauth/profile", self.headers(raw))
        org = str(((profile or {}).get("organization") or {}).get("uuid") or "").lower()
        if not 200 <= status < 300 or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", org):
            raise ValueError("Anthropic's account lookup failed. Nothing was submitted.")
        if pending and pending["org"] != org:
            raise ValueError("This login now belongs to a different organization. Nothing was submitted.")
        if not pending:
            pending = {"request_id": uuid.uuid4().hex, "org": org, "created": time.time()}
            with self.lock:
                self.reset_claims[(idx, grant_id)] = pending
        try:
            status, body = self.call(raw, "POST", f"https://api.anthropic.com/api/organizations/{org}/reset_rate_limits",
                                     self.headers(raw), {"program": "cedar_ember", "grant_id": grant_id,
                                                         "request_id": pending["request_id"]})
        except Exception:
            status, body = 0, None
        result = (body or {}).get("result") if 200 <= status < 300 else None
        if status == 429:
            raise ValueError("Anthropic is rate limiting this account. Try again in a minute.")
        if status in (401, 403):
            raise ValueError("Anthropic rejected the login. Sign in again, then retry.")
        declined = {"not_limited": "Anthropic says the account isn't at a limit, so no reset was used.",
                    "cooldown": "Anthropic says the account is cooling down after a recent reset. None was used.",
                    "ineligible": "Anthropic declined the reset. None was used.",
                    "unavailable": "Anthropic declined the reset. None was used."}
        if result in {"reset", "already_used"} or result in declined:
            with self.lock:
                self.reset_claims.pop((idx, grant_id), None)
            if result in declined:
                raise ValueError(declined[result])
            return
        raise ValueError("The outcome is unknown and a reset may have been spent. Retrying within 10 minutes "
                         "reuses the same request, so it can't spend a second one.")

    def refresh(self):
        if not self.refresh_lock.acquire(blocking=False):
            return
        with self.lock:
            self.refreshing = True
        try:
            files = self.read_files()
            observed_at = time.time()
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(lambda raw: self.refresh_one(raw, observed_at), files))
        except Exception:
            with self.lock:
                self.error = "Cannot reach CLIProxyAPI. Check that the proxy service is running."
        finally:
            with self.lock:
                self.refreshing = False
            self.refresh_lock.release()

    def collect(self):
        last_quota = 0
        while True:
            requested = self.wake.is_set()
            self.wake.clear()
            if requested or time.monotonic() - last_quota >= QUOTA_INTERVAL - 1:
                self.refresh()
                last_quota = time.monotonic()
            else:
                try:
                    self.read_files()
                except Exception:
                    with self.lock:
                        self.error = "Cannot reach CLIProxyAPI. Showing the last recorded state."
            self.wake.wait(30)

    def snapshot(self, hours):
        with self.lock:
            accounts = [safe_account(f, self.quotas.get(f["auth_index"])) for f in self.files]
            result = {"accounts": accounts, "updated_at": self.updated, "refreshing": self.refreshing,
                      "error": self.error, "now": time.time(), "endpoint": f"https://{(PUBLIC_HOSTS or ['localhost:8317'])[0]}/v1"}
        result["history"] = self.store.history(hours)
        result["history_bucket"] = self.store.bucket(hours)
        return result


class Handler(BaseHTTPRequestHandler):
    server_version = "prox"

    def log_message(self, *args):
        pass  # Never log keys, OAuth URLs, email addresses, or cookies.

    @property
    def hub(self):
        return self.server.hub

    def send(self, status, body, content_type="application/json", cookie=None):
        payload = json.dumps(body).encode() if content_type == "application/json" else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if len(payload) > 1024 and "gzip" in self.headers.get("Accept-Encoding", ""):
            payload = gzip.compress(payload, 6)
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)

    def client_ip(self):
        # Tailscale Serve and Cloudflare Tunnel both connect from loopback; rate-limit
        # sign-in by the visitor's address they forward instead of by the tunnel.
        if self.client_address[0] in {"127.0.0.1", "::1"}:
            forwarded = self.headers.get("CF-Connecting-IP") or self.headers.get("X-Forwarded-For", "").split(",")[0]
            if forwarded.strip():
                return forwarded.strip()
        return self.client_address[0]

    def session(self):
        try:
            cookies = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
            token = cookies["prox_session"].value
        except (KeyError, http.cookies.CookieError):
            return None
        with self.hub.lock:
            expiry = self.hub.sessions.get(token, 0)
            return token if expiry > time.time() else None

    def route(self):
        host = self.headers.get("Host", "")
        if host not in LOCAL_HOSTS and host not in PUBLIC_HOSTS:
            self.send(403, {"error": "Unrecognized host."})
            return
        url = urllib.parse.urlsplit(self.path)
        path = url.path.removeprefix("/dashboard").rstrip("/") or "/"
        if self.command == "GET" and path == "/":
            self.send(200, (ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")
            return
        if self.command == "GET" and path in {"/assets/geist-sans.woff2", "/assets/geist-mono.woff2"}:
            self.send(200, (ROOT / path.lstrip("/")).read_bytes(), "font/woff2")
            return
        if self.command == "GET" and path == "/assets/vendor.js":
            self.send(200, (ROOT / "assets/vendor.js").read_bytes(), "text/javascript; charset=utf-8")
            return
        if self.command == "POST":
            origin = self.headers.get("Origin")
            if (origin and origin not in {f"https://{host}", f"http://{host}"}) or self.headers.get("X-Dashboard-Request") != "1":
                self.send(403, {"error": "Reload the dashboard and try again."})
                return
        if path == "/api/session" and self.command == "GET":
            self.send(200, {"authenticated": bool(self.session())})
            return
        body = {}
        if self.command == "POST":
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 16384:
                self.send(413, {"error": "Request is too large."})
                return
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError("Expected a JSON object.")
        secure = "" if host in LOCAL_HOSTS else "; Secure"
        if path == "/api/login" and self.command == "POST":
            now = time.time()
            with self.hub.lock:
                attempts = [t for t in self.hub.login_attempts.get(self.client_ip(), []) if t > now - 300]
                if len(attempts) >= 10:
                    self.send(429, {"error": "Too many attempts. Try again in five minutes."})
                    return
                self.hub.login_attempts[self.client_ip()] = attempts + [now]
            supplied = str(body.get("key", ""))
            if not hmac.compare_digest(hashlib.sha256(supplied.encode()).digest(), hashlib.sha256(self.hub.management_key().encode()).digest()):
                self.send(401, {"error": "Management key not recognized."})
                return
            token = secrets.token_urlsafe(32)
            with self.hub.lock:
                self.hub.sessions = {k: v for k, v in self.hub.sessions.items() if v > now}
                self.hub.sessions[token] = now + 12 * 3600
                self.hub.login_attempts.pop(self.client_ip(), None)
            self.send(200, {"ok": True}, cookie=f"prox_session={token}; Path=/dashboard; HttpOnly; SameSite=Strict; Max-Age=43200{secure}")
            return
        session = self.session()
        if not session:
            self.send(401, {"error": "Sign in with your management key."})
            return
        if path == "/api/logout" and self.command == "POST":
            with self.hub.lock:
                self.hub.sessions.pop(session, None)
            self.send(200, {"ok": True}, cookie=f"prox_session=; Path=/dashboard; Max-Age=0; HttpOnly; SameSite=Strict{secure}")
        elif path == "/api/snapshot" and self.command == "GET":
            hours = int(urllib.parse.parse_qs(url.query).get("hours", ["24"])[0])
            self.send(200, self.hub.snapshot(min(max(hours, 1), 24 * 30)))
        elif path == "/api/refresh" and self.command == "POST":
            self.hub.wake.set()
            self.send(202, {"ok": True})
        elif path == "/api/account/status" and self.command == "POST":
            idx = str(body.get("id", ""))
            if not isinstance(body.get("disabled"), bool):
                raise ValueError("Choose whether the account should be paused.")
            with self.hub.lock:
                raw = next((f for f in self.hub.files if f["auth_index"] == idx), None)
            if raw is None:
                raise ValueError("Account no longer exists. Refresh the dashboard.")
            self.hub.request("credentials/status", {"name": raw["name"], "auth_index": idx, "disabled": body["disabled"]}, "PATCH")
            self.hub.read_files()
            self.hub.wake.set()
            self.send(200, {"ok": True})
        elif path == "/api/oauth/start" and self.command == "POST":
            provider = body.get("provider")
            if provider not in OAUTH_PROVIDERS:
                raise ValueError("Choose Codex or Antigravity.")
            result = self.hub.request("oauth/auth-url", {"provider": provider, "is_webui": True})
            with self.hub.lock:
                self.hub.oauth[result["state"]] = {"provider": provider, "session": session, "created": time.time()}
            self.send(200, {k: result[k] for k in ["url", "state"]})
        elif path in {"/api/oauth/status", "/api/oauth/callback", "/api/oauth/cancel"} and self.command == "POST":
            state = str(body.get("state", ""))
            with self.hub.lock:
                pending = self.hub.oauth.get(state)
            if not pending or pending["session"] != session or time.time() - pending["created"] > 600:
                raise ValueError("This sign-in has expired. Start again.")
            if path.endswith("callback"):
                callback = str(body.get("redirect_url", ""))
                parsed = urllib.parse.urlsplit(callback)
                query = urllib.parse.parse_qs(parsed.query)
                if parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or query.get("state", [None])[0] != state or not query.get("code"):
                    raise ValueError("The callback does not match this sign-in.")
                result = self.hub.request("oauth/callback", {"provider": pending["provider"], "state": state, "redirect_url": callback})
            elif path.endswith("cancel"):
                result = self.hub.request("oauth/session?" + urllib.parse.urlencode({"state": state}), method="DELETE")
                with self.hub.lock:
                    self.hub.oauth.pop(state, None)
            else:
                result = self.hub.request("oauth/status?" + urllib.parse.urlencode({"state": state}))
                if result.get("status") == "ok":
                    self.hub.wake.set()
            # OAuth status can include credential records. Return only status and a generic error.
            self.send(200, {"status": result.get("status", "ok"), "error": "Sign-in failed or expired. Start again." if result.get("error") else None})
        elif path == "/api/account/reset" and self.command == "POST":
            raw = self.hub.account(str(body.get("id", "")))
            if raw is None:
                self.send(404, {"error": "Account no longer exists. Refresh the dashboard."})
                return
            grant = body.get("grant")
            try:
                self.hub.use_reset(raw, str(grant) if grant is not None else None)
            except ValueError as exc:
                # These messages are written here and say whether a reset may have been spent.
                self.send(409, {"error": str(exc)})
                return
            self.send(200, {"status": "ok"})
        elif path in {"/api/account/relogin", "/api/account/cooldown", "/api/account/remove"} and self.command == "POST":
            idx = str(body.get("id", ""))
            raw = self.hub.account(idx)
            if raw is None:
                self.send(404, {"error": "Account no longer exists. Refresh the dashboard."})
                return
            if path.endswith("relogin"):
                # Re-authorizes the same credential file; the proxy keeps its settings.
                result = self.hub.request("oauth/auth-url", {"provider": raw["provider"], "auth_index": idx, "is_webui": True}, "POST")
                with self.hub.lock:
                    self.hub.oauth[result["state"]] = {"provider": raw["provider"], "session": session,
                                                       "created": time.time(), "account": idx}
                self.send(200, {k: result[k] for k in ["url", "state"]})
            elif path.endswith("cooldown"):
                self.hub.request("routing/cooldown/reset", {"auth_index": idx}, "POST")
                self.hub.wake.set()
                self.send(200, {"status": "ok"})
            else:
                name = str(raw.get("name") or "")
                if not name or "/" in name or "\\" in name or ".." in name:
                    raise ValueError("This account's credential file cannot be removed here.")
                # One named file only; the proxy's all=true mode is never used.
                self.hub.request("credentials?" + urllib.parse.urlencode({"name": name}), method="DELETE")
                self.hub.read_files()
                with self.hub.lock:
                    self.hub.quotas.pop(idx, None)
                self.hub.store.forget(idx)
                self.send(200, {"status": "ok"})
        elif path == "/api/logs/errors" and self.command == "GET":
            result = self.hub.request("observability/logs/errors")
            files = [{k: f.get(k) for k in ["name", "size", "modified"]} for f in result.get("files", [])
                     if ERROR_LOG_NAME.match(str(f.get("name", "")))]
            self.send(200, {"files": files})
        elif path == "/api/logs/errors/file" and self.command == "GET":
            name = urllib.parse.parse_qs(url.query).get("name", [""])[0]
            if not ERROR_LOG_NAME.match(name):
                raise ValueError("Unknown log file.")
            try:
                data = self.hub.request("observability/logs/errors/" + urllib.parse.quote(name), raw=True)
            except ProxyError as exc:
                if exc.status == 404:
                    self.send(404, {"error": "This log file no longer exists."})
                    return
                raise
            self.send(200, {"name": name, "text": data[:ERROR_LOG_LIMIT].decode("utf-8", "replace"),
                            "truncated": len(data) > ERROR_LOG_LIMIT})
        elif path == "/api/logs/activity" and self.command == "GET":
            query = urllib.parse.parse_qs(url.query)
            params = {"limit": min(max(int(query.get("limit", ["300"])[0]), 1), 500)}
            if query.get("after", [""])[0]:
                params["after"] = int(float(query["after"][0]))
            if query.get("cursor", [""])[0]:
                params["cursor"] = query["cursor"][0]
            try:
                result = self.hub.request("observability/logs?" + urllib.parse.urlencode(params))
            except ProxyError as exc:
                if exc.status == 400 and b"logging to file disabled" in exc.body:
                    self.send(200, {"enabled": False, "lines": []})
                    return
                raise
            self.send(200, {"enabled": True, "lines": result.get("lines") or [],
                            "latest": result.get("latest-timestamp"), "next_cursor": result.get("next-cursor")})
        elif path == "/api/logs/activity/enable" and self.command == "POST":
            # The only proxy setting this dashboard changes, and only on an explicit click.
            self.hub.request("config/observability/logs/logging-to-file", True, "PUT")
            self.send(200, {"enabled": True})
        else:
            self.send(404, {"error": "Page not found."})

    def do_GET(self):
        self.handle_route()

    def do_POST(self):
        self.handle_route()

    def handle_route(self):
        try:
            self.route()
        except (ValueError, KeyError, json.JSONDecodeError):
            self.send(400, {"error": "The request could not be completed. Refresh and try again, or check the original panel."})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.send(502, {"error": "Cannot reach the proxy. Check the connection and try again."})


def main():
    os.umask(0o077)
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    hub = Hub(Store(DATA / "quota.sqlite"))
    server = ThreadingHTTPServer(("127.0.0.1", 8318), Handler)
    server.daemon_threads = True
    server.hub = hub
    threading.Thread(target=hub.collect, daemon=True).start()
    print("Dashboard listening on 127.0.0.1:8318", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
