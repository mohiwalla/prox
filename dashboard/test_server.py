import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from server import Handler, Hub, Store, ThreadingHTTPServer, parse_antigravity, parse_codex, safe_account


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

    def test_antigravity_handles_zero_and_omits_unknown(self):
        result = parse_antigravity({"models": {
            "flash": {"displayName": "Gemini Flash", "quotaInfo": {"remainingFraction": 0}},
            "unknown": {"displayName": "Unknown", "quotaInfo": {}},
            "autocomplete": {"quotaInfo": {"remainingFraction": 1}}}})
        self.assertEqual([w["id"] for w in result["windows"]], ["flash"])
        self.assertEqual(result["windows"][0]["remaining"], 0)
        self.assertIsNone(result["windows"][0]["period"])

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

    def request(self, path, body=None, cookie=None, origin=None, host="localhost:8318"):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        headers = {"Host": host, "X-Dashboard-Request": "1", "Content-Type": "application/json"}
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
        code, _, cookie = self.request("login", {"key": "test-only-key"}, host="batman.tailc343ff.ts.net:8317")
        self.assertEqual(code, 200)
        for flag in ["HttpOnly", "Secure", "SameSite=Strict", "Path=/dashboard"]:
            self.assertIn(flag, cookie)

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


if __name__ == "__main__":
    unittest.main()
