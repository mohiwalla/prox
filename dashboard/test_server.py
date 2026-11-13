import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import server as dashboard_server
from server import ERROR_LOG_LIMIT, Handler, Hub, ProxyError, Store, ThreadingHTTPServer, parse_antigravity, parse_claude, parse_codex, safe_account


class QuotaTests(unittest.TestCase):
    def test_codex_preserves_real_window_and_zero_quota(self):
        result = parse_codex({"plan_type": "go", "rate_limit": {
            "primary_window": {"used_percent": 100, "limit_window_seconds": 2592000, "reset_at": 1797106147},
            "secondary_window": None}})
        self.assertEqual(result["plan"], "go")
        self.assertEqual(len(result["windows"]), 1)
        self.assertEqual(result["windows"][0]["remaining"], 0)
        self.assertEqual(result["windows"][0]["period"], 2592000)

    def test_missing_codex_percent_is_unknown(self):
        self.assertEqual(parse_codex({"rate_limit": {"primary_window": {"reset_at": 123}}})["windows"], [])

    def test_antigravity_reads_shared_group_limits(self):
        result = parse_antigravity({"groups": [
            {"displayName": "Gemini Models", "buckets": [
                {"bucketId": "gemini-weekly", "window": "weekly", "remainingFraction": 1},
                {"bucketId": "gemini-5h", "window": "5h", "remainingFraction": 0, "resetTime": "2026-11-13T23:17:58Z"},
                {"bucketId": "gemini-unknown", "window": "weekly"}]},
            {"displayName": "Claude and GPT models", "buckets": [
                {"bucketId": "3p-daily", "window": "daily", "displayName": "Daily Limit Remaining", "remainingFraction": 0.5}]}]})
        self.assertEqual([(w["id"], w["group"], w["label"], w["remaining"], w["period"]) for w in result["windows"]], [
            ("gemini-5h", "Gemini", "Gemini · 5-hour limit", 0, 5 * 3600),
            ("gemini-weekly", "Gemini", "Gemini · Weekly limit", 100, 7 * 86400),
            ("3p-daily", "Claude & GPT", "Claude & GPT · Daily Limit", 50, None)])
        self.assertIsNotNone(result["windows"][0]["reset_at"])

    def test_claude_reads_utilization_and_skips_null_windows(self):
        result = parse_claude({
            "five_hour": {"utilization": 68.0, "resets_at": "2026-11-13T18:00:00+00:00"},
            "seven_day": {"utilization": 100, "resets_at": "2026-11-18T00:00:00Z"},
            "seven_day_opus": None, "seven_day_sonnet": {"utilization": None}})
        self.assertEqual([(w["id"], w["remaining"]) for w in result["windows"]], [("five_hour", 32.0), ("seven_day", 0.0)])
        self.assertEqual(result["windows"][0]["period"], 5 * 3600)
        self.assertIsNotNone(result["windows"][1]["reset_at"])

    def test_claude_reads_new_model_windows_without_a_code_change(self):
        result = parse_claude({
            "five_hour": {"utilization": 10}, "seven_day": {"utilization": 20},
            "seven_day_opus": {"utilization": 40}, "seven_day_oauth_apps": {"utilization": 50},
            "extra_usage": {"utilization": 60}, "iguana_necktie": {"utilization": 70},
            "limits": [
                {"kind": "weekly_scoped", "scope": {"model": {"display_name": "Fable 5"}}, "percent": 90, "is_active": False},
                {"kind": "weekly_scoped", "scope": {"model": {"display_name": "Fable 5"}}, "percent": 30, "is_active": True},
                {"kind": "session", "percent": 5}]})
        self.assertEqual([(w["id"], w["label"], w["remaining"]) for w in result["windows"]], [
            ("five_hour", "5-hour limit", 90), ("seven_day", "Weekly limit", 80),
            ("seven_day_opus", "Weekly · Opus", 60), ("weekly_scoped:fable_5", "Weekly · Fable 5", 70)])
        self.assertEqual(result["windows"][3]["period"], 7 * 86400)

    def test_claude_codename_window_is_fable_unless_it_is_cloud_credits(self):
        fable = parse_claude({"iguana_necktie": {"utilization": 25}})["windows"]
        self.assertEqual([(w["label"], w["remaining"]) for w in fable], [("Weekly · Fable 5", 75)])
        self.assertEqual(parse_claude({"iguana_necktie": {"utilization": 25, "limit_dollars": 50}})["windows"], [])

    def test_claude_rejects_malformed_present_windows(self):
        for bad in ("invalid", True, [1]):
            with self.assertRaises(ValueError):
                parse_claude({"five_hour": {"utilization": 10}, "seven_day": {"utilization": bad}})

    def test_every_provider_is_listed_but_only_quota_providers_are_checked(self):
        with tempfile.TemporaryDirectory() as folder:
            hub = Hub(Store(Path(folder) / "history.sqlite"))
            files = [{"auth_index": "c", "provider": "claude"}, {"auth_index": "x", "provider": "xai"}]
            with patch.object(hub, "request", return_value={"files": files}):
                self.assertEqual([f["auth_index"] for f in hub.read_files()], ["c", "x"])
            with patch.object(hub, "fetch_quota", return_value={"windows": [], "observed_at": 1}) as fetch:
                hub.refresh_one(files[1])
                fetch.assert_not_called()
                hub.refresh_one(files[0])
                fetch.assert_called_once()

    def test_claude_quota_checks_respect_its_slower_interval(self):
        with tempfile.TemporaryDirectory() as folder:
            hub = Hub(Store(Path(folder) / "history.sqlite"))
            claude, codex = {"auth_index": "c", "provider": "claude"}, {"auth_index": "x", "provider": "codex"}
            with patch.object(hub, "fetch_quota", return_value={"windows": [], "observed_at": 1}) as fetch:
                for _ in range(3):
                    hub.refresh_one(claude)
                    hub.refresh_one(codex)
            self.assertEqual([c.args[0]["provider"] for c in fetch.call_args_list].count("claude"), 1)
            self.assertEqual([c.args[0]["provider"] for c in fetch.call_args_list].count("codex"), 3)
            hub.quota_attempts["c"] -= 181
            with patch.object(hub, "fetch_quota", return_value={"windows": [], "observed_at": 2}) as fetch:
                hub.refresh_one(claude)
                fetch.assert_called_once()

    def test_raw_credentials_are_not_relayed(self):
        raw = {"auth_index": "a", "provider": "codex", "access_token": "secret-token",
               "id_token": {"chatgpt_account_id": "private-id", "plan_type": "go"},
               "path": "/secret-path", "status_message": "secret-token", "refresh_token": "secret-refresh"}
        result = json.dumps(safe_account(raw))
        for value in ["secret-token", "private-id", "secret-path", "secret-refresh", "id_token"]:
            self.assertNotIn(value, result)

    def test_failed_refresh_preserves_last_observation_without_new_sample(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder) / "history.sqlite")
            hub = Hub(store)
            before = {"observed_at": time.time() - 600, "plan": "go", "windows": [
                {"id": "primary", "label": "Monthly", "remaining": 50, "reset_at": None, "period": 2592000}]}
            hub.quotas["a"] = before
            store.save("a", "codex", before)
            with patch.object(hub, "fetch_quota", side_effect=ValueError("Quota unavailable")):
                hub.refresh_one({"auth_index": "a", "provider": "codex"})
            self.assertEqual(hub.quotas["a"]["observed_at"], before["observed_at"])
            self.assertEqual(hub.quotas["a"]["windows"][0]["remaining"], 50)
            self.assertEqual(len(store.history()), 1)
            self.assertIn("error", hub.quotas["a"])

    def test_history_sends_latest_cycle_per_bucket(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder) / "history.sqlite")
            base = (time.time() // 600) * 600 - 3600  # start of an old bucket
            for offset in (0, 30, 60):
                for account in ("a", "b"):
                    store.save(account, "codex", {"observed_at": base + offset, "windows": [
                        {"id": "primary", "label": "Weekly", "remaining": 90 - offset / 30, "reset_at": None, "period": 604800}]})
            rows = [r for r in store.history(24) if r["ts"] < base + 120]
            self.assertEqual({r["ts"] for r in rows}, {base + 60})
            self.assertEqual({r["account"] for r in rows}, {"a", "b"})

    def test_history_survives_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "history.sqlite"
            data = {"observed_at": time.time(), "windows": [{"id": "weekly", "remaining": 62, "reset_at": None, "period": 604800}]}
            Store(path).save("a", "codex", data)
            restarted = Hub(Store(path))
            self.assertEqual(restarted.quotas["a"]["windows"][0]["remaining"], 62)
            self.assertEqual(len(restarted.store.history()), 1)


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.hub = Hub(Store(Path(cls.folder.name) / "test.sqlite"))
        cls.hub.management_key = lambda: "test-only-key"
        cls.hub.files = [{"auth_index": "a", "name": "a.json", "provider": "codex", "disabled": False}]
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.server.hub = cls.hub
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.folder.cleanup()

    def request(self, path, body=None, cookie=None, origin=None, host="localhost:8318", extra=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        headers = {"Host": host, "X-Dashboard-Request": "1", "Content-Type": "application/json", **(extra or {})}
        if cookie:
            headers["Cookie"] = cookie
        if origin:
            headers["Origin"] = origin
        conn.request("GET" if body is None else "POST", "/dashboard/api/" + path,
                     body=json.dumps(body) if body is not None else None, headers=headers)
        res = conn.getresponse()
        result = res.status, json.loads(res.read()), res.getheader("Set-Cookie")
        conn.close()
        return result

    def login(self):
        status, data, cookie = self.request("login", {"key": "test-only-key"})
        self.assertEqual(status, 200)
        return cookie.split(";")[0]

    def test_auth_and_csrf_boundaries(self):
        self.assertEqual(self.request("snapshot")[0], 401)
        self.assertEqual(self.request("login", {"key": "wrong"})[0], 401)
        self.assertEqual(self.request("login", {"key": "test-only-key"}, origin="https://evil.example")[0], 403)
        self.assertEqual(self.request("session", host="evil.example")[0], 403)
        cookie = self.login()
        self.assertEqual(self.request("snapshot", cookie=cookie)[0], 200)
        self.assertEqual(self.request("logout", {}, cookie=cookie)[0], 200)
        self.assertEqual(self.request("snapshot", cookie=cookie)[0], 401)

    def test_public_cookie_is_secure_and_not_script_readable(self):
        with patch.object(dashboard_server, "PUBLIC_HOSTS", ["proxy.example.test"]):
            code, _, cookie = self.request("login", {"key": "test-only-key"}, host="proxy.example.test")
        self.assertEqual(code, 200)
        for flag in ["HttpOnly", "Secure", "SameSite=Strict", "Path=/dashboard"]:
            self.assertIn(flag, cookie)

    def test_only_configured_public_hosts_are_served(self):
        with patch.object(dashboard_server, "PUBLIC_HOSTS", ["proxy.example.test", "box.tail.ts.net:8317"]):
            self.assertEqual(self.request("session", host="proxy.example.test")[0], 200)
            self.assertEqual(self.request("session", host="box.tail.ts.net:8317")[0], 200)
            self.assertEqual(self.request("session", host="evil.example")[0], 403)

    def test_sign_in_rate_limit_uses_forwarded_visitor_address(self):
        self.hub.login_attempts.clear()
        attacker = {"CF-Connecting-IP": "203.0.113.9"}
        for _ in range(10):
            self.request("login", {"key": "wrong"}, extra=attacker)
        self.assertEqual(self.request("login", {"key": "test-only-key"}, extra=attacker)[0], 429)
        # The tunnel's loopback address isn't locked out for everyone else.
        self.assertEqual(self.request("login", {"key": "test-only-key"}, extra={"CF-Connecting-IP": "198.51.100.4"})[0], 200)
        self.hub.login_attempts.clear()

    def test_pause_calls_only_selected_account(self):
        cookie = self.login()
        with patch.object(self.hub, "request", return_value={"ok": True}) as request, patch.object(self.hub, "read_files"):
            result = self.request("account/status", {"id": "a", "disabled": True}, cookie=cookie)
        self.assertEqual(result[0], 200)
        request.assert_called_once_with("credentials/status", {"name": "a.json", "auth_index": "a", "disabled": True}, "PATCH")

    def test_oauth_callback_is_bound_to_session_and_state(self):
        cookie = self.login()
        token = cookie.split("=", 1)[1]
        self.hub.oauth["state-a"] = {"provider": "codex", "session": token, "created": time.time()}
        other = self.login()
        self.assertEqual(self.request("oauth/status", {"state": "state-a"}, cookie=other)[0], 400)
        with patch.object(self.hub, "request", return_value={"status": "ok"}) as request:
            self.assertEqual(self.request("oauth/callback", {"state": "state-a", "redirect_url": "http://localhost/callback?state=wrong&code=abc"}, cookie=cookie)[0], 400)
            request.assert_not_called()
            self.assertEqual(self.request("oauth/callback", {"state": "state-a", "redirect_url": "http://localhost/callback?state=state-a&code=abc"}, cookie=cookie)[0], 200)


    # --- Account actions and logs ---------------------------------------------------

    def test_relogin_targets_existing_credential_and_binds_state(self):
        cookie = self.login()
        token = cookie.split("=", 1)[1]
        with patch.object(self.hub, "request", return_value={"url": "https://auth.example/x", "state": "re-1", "status": "ok"}) as request:
            status, data, _ = self.request("account/relogin", {"id": "a"}, cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(data, {"url": "https://auth.example/x", "state": "re-1"})
        request.assert_called_once_with("oauth/auth-url", {"provider": "codex", "auth_index": "a", "is_webui": True}, "POST")
        self.assertEqual(self.hub.oauth["re-1"]["account"], "a")
        self.assertEqual(self.hub.oauth["re-1"]["session"], token)

    def test_account_actions_reject_unknown_accounts(self):
        cookie = self.login()
        with patch.object(self.hub, "request") as request:
            for action in ["relogin", "cooldown", "remove"]:
                self.assertEqual(self.request(f"account/{action}", {"id": "missing"}, cookie=cookie)[0], 404)
        request.assert_not_called()

    def test_cooldown_reset_uses_auth_index_and_refreshes(self):
        cookie = self.login()
        self.hub.wake.clear()
        with patch.object(self.hub, "request", return_value={"status": "ok"}) as request:
            status, data, _ = self.request("account/cooldown", {"id": "a"}, cookie=cookie)
        self.assertEqual((status, data), (200, {"status": "ok"}))
        request.assert_called_once_with("routing/cooldown/reset", {"auth_index": "a"}, "POST")
        self.assertTrue(self.hub.wake.is_set())

    def test_remove_deletes_one_named_file_and_forgets_latest(self):
        cookie = self.login()
        self.hub.quotas["a"] = {"observed_at": time.time(), "windows": []}
        self.hub.store.save("a", "codex", self.hub.quotas["a"])
        with patch.object(self.hub, "request", return_value={"status": "ok"}) as request, patch.object(self.hub, "read_files"):
            status, data, _ = self.request("account/remove", {"id": "a"}, cookie=cookie)
        self.assertEqual((status, data), (200, {"status": "ok"}))
        request.assert_called_once_with("credentials?name=a.json", method="DELETE")
        self.assertNotIn("all", request.call_args.args[0])
        self.assertNotIn("a", self.hub.quotas)
        self.assertNotIn("a", self.hub.store.load())

    def test_remove_refuses_unsafe_file_names(self):
        cookie = self.login()
        original = self.hub.files
        self.hub.files = [{"auth_index": "a", "name": "../a.json", "provider": "codex"}]
        try:
            with patch.object(self.hub, "request") as request:
                self.assertEqual(self.request("account/remove", {"id": "a"}, cookie=cookie)[0], 400)
            request.assert_not_called()
        finally:
            self.hub.files = original

    def test_error_log_list_and_file(self):
        cookie = self.login()
        listing = {"files": [{"name": "error-1.log", "size": 10, "modified": 5, "path": "/secret"},
                             {"name": "../etc/passwd", "size": 1, "modified": 1}]}
        with patch.object(self.hub, "request", return_value=listing):
            status, data, _ = self.request("logs/errors", cookie=cookie)
        self.assertEqual((status, data), (200, {"files": [{"name": "error-1.log", "size": 10, "modified": 5}]}))
        with patch.object(self.hub, "request") as request:
            self.assertEqual(self.request("logs/errors/file?name=../x.log", cookie=cookie)[0], 400)
        request.assert_not_called()
        big = b"POST /v1/responses\n" + b"x" * ERROR_LOG_LIMIT
        with patch.object(self.hub, "request", return_value=big) as request:
            status, data, _ = self.request("logs/errors/file?name=error-1.log", cookie=cookie)
        request.assert_called_once_with("observability/logs/errors/error-1.log", raw=True)
        self.assertEqual(status, 200)
        self.assertTrue(data["truncated"])
        self.assertTrue(data["text"].startswith("POST /v1/responses"))
        self.assertEqual(len(data["text"]), ERROR_LOG_LIMIT)
        with patch.object(self.hub, "request", side_effect=ProxyError(404, b"{}")):
            self.assertEqual(self.request("logs/errors/file?name=error-1.log", cookie=cookie)[0], 404)

    def test_activity_log_reports_disabled_and_passes_paging(self):
        cookie = self.login()
        with patch.object(self.hub, "request", side_effect=ProxyError(400, b'{"error":"logging to file disabled"}')):
            status, data, _ = self.request("logs/activity", cookie=cookie)
        self.assertEqual((status, data), (200, {"enabled": False, "lines": []}))
        result = {"lines": ["[2026-11-13 03:00:00] ok"], "line-count": 1, "latest-timestamp": 1794500000, "next-cursor": "c2"}
        with patch.object(self.hub, "request", return_value=result) as request:
            status, data, _ = self.request("logs/activity?after=1794499999&limit=9999", cookie=cookie)
        request.assert_called_once_with("observability/logs?limit=500&after=1794499999")
        self.assertEqual(data, {"enabled": True, "lines": result["lines"], "latest": 1794500000, "next_cursor": "c2"})
        with patch.object(self.hub, "request", side_effect=ProxyError(500, b"boom")):
            self.assertEqual(self.request("logs/activity", cookie=cookie)[0], 400)

    def test_enable_activity_log_sets_only_logging_to_file(self):
        cookie = self.login()
        with patch.object(self.hub, "request", return_value=None) as request:
            status, data, _ = self.request("logs/activity/enable", {}, cookie=cookie)
        self.assertEqual((status, data), (200, {"enabled": True}))
        request.assert_called_once_with("config/observability/logs/logging-to-file", True, "PUT")

    def test_mutations_require_csrf_header(self):
        cookie = self.login()
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        with patch.object(self.hub, "request") as request:
            conn.request("POST", "/dashboard/api/account/remove", body=json.dumps({"id": "a"}),
                         headers={"Host": "localhost:8318", "Cookie": cookie, "Content-Type": "application/json"})
            self.assertEqual(conn.getresponse().status, 403)
        conn.close()
        request.assert_not_called()


class CooldownTests(unittest.TestCase):
    def test_cooldown_until_is_latest_retry(self):
        raw = {"auth_index": "a", "provider": "codex", "cooldowns": [
            {"reason": "quota", "retry_at": "2026-11-13T03:00:00Z"},
            {"reason": "quota", "retry_at": "2026-11-13T04:00:00Z"}]}
        self.assertEqual(safe_account(raw)["cooldown_until"], 1794542400.0)
        self.assertIsNone(safe_account({"auth_index": "b", "provider": "codex"})["cooldown_until"])


if __name__ == "__main__":
    unittest.main()
