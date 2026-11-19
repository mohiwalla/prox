package clientkeys

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	sdkaccess "github.com/router-for-me/CLIProxyAPI/v8/sdk/access"
	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

func ptr[T any](v T) *T { return &v }

func openTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	dir := t.TempDir()
	store, errOpen := Open(dir)
	if errOpen != nil {
		t.Fatalf("Open() error = %v", errOpen)
	}
	SetDefault(store)
	t.Cleanup(func() { SetDefault(nil) })
	return store, dir
}

func TestStoreCreateLookupPersistAndRotate(t *testing.T) {
	store, dir := openTestStore(t)
	key, secret, errCreate := store.Create(Input{
		Name:      ptr("alice"),
		Providers: ptr([]string{" Codex ", "codex"}),
		Models:    ptr([]string{"GPT-5*"}),
	})
	if errCreate != nil {
		t.Fatalf("Create() error = %v", errCreate)
	}
	if !strings.HasPrefix(secret, secretPrefix) || key.Hint != secret[len(secret)-4:] {
		t.Fatalf("secret %q / hint %q not as expected", secret, key.Hint)
	}
	if got := strings.Join(key.Providers, ","); got != "codex" {
		t.Fatalf("providers = %q, want codex", got)
	}
	if got := strings.Join(key.Models, ","); got != "gpt-5*" {
		t.Fatalf("models = %q, want gpt-5*", got)
	}

	data, errRead := os.ReadFile(filepath.Join(dir, keysFileName))
	if errRead != nil {
		t.Fatalf("read keys file: %v", errRead)
	}
	if strings.Contains(string(data), secret) {
		t.Fatal("keys file contains the plain secret")
	}
	info, _ := os.Stat(filepath.Join(dir, keysFileName))
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("keys file mode = %v, want 0600", info.Mode().Perm())
	}

	reopened, errOpen := Open(dir)
	if errOpen != nil {
		t.Fatalf("reopen: %v", errOpen)
	}
	if found, ok := reopened.Lookup(secret); !ok || found.ID != key.ID {
		t.Fatalf("Lookup after reopen = %+v, %v", found, ok)
	}

	_, rotated, errRotate := store.Rotate(key.ID)
	if errRotate != nil {
		t.Fatalf("Rotate() error = %v", errRotate)
	}
	if _, ok := store.Lookup(secret); ok {
		t.Fatal("old secret still works after rotate")
	}
	if _, ok := store.Lookup(rotated); !ok {
		t.Fatal("new secret does not work after rotate")
	}
}

func TestStoreUpdateValidatesAndDeleteForgetsUsage(t *testing.T) {
	store, _ := openTestStore(t)
	key, _, _ := store.Create(Input{Name: ptr("bob")})
	if _, errUpdate := store.Update(key.ID, Input{WeeklyTokenLimit: ptr(int64(-1))}); errUpdate == nil {
		t.Fatal("negative limit accepted")
	}
	if _, errUpdate := store.Update(key.ID, Input{Name: ptr("  ")}); errUpdate == nil {
		t.Fatal("empty name accepted")
	}
	updated, errUpdate := store.Update(key.ID, Input{Enabled: ptr(false), WeeklyTokenLimit: ptr(int64(100))})
	if errUpdate != nil || updated.Enabled || updated.WeeklyTokenLimit != 100 || updated.Name != "bob" {
		t.Fatalf("Update() = %+v, %v", updated, errUpdate)
	}
	store.usage.Add(key.ID, "codex", "a.json", "gpt-5", Counter{Requests: 1, Tokens: 10})
	if errDelete := store.Delete(key.ID); errDelete != nil {
		t.Fatalf("Delete() error = %v", errDelete)
	}
	if store.usage.WeeklyTokens(key.ID) != 0 {
		t.Fatal("usage kept after delete")
	}
	if errDelete := store.Delete(key.ID); errDelete != ErrNotFound {
		t.Fatalf("second Delete() error = %v, want ErrNotFound", errDelete)
	}
}

func TestWildcardMatch(t *testing.T) {
	cases := []struct {
		pattern, name string
		want          bool
	}{
		{"gpt-5*", "gpt-5-codex", true},
		{"gpt-5*", "gpt-4o", false},
		{"*", "anything/with/slashes", true},
		{"claude-*-4?", "claude-opus-45", true},
		{"claude-*-4?", "claude-opus-4", false},
		{"*sonnet*", "claude-sonnet-5-5", true},
		{"exact", "exact", true},
		{"exact", "exactly", false},
	}
	for _, tc := range cases {
		if got := wildcardMatch(tc.pattern, tc.name); got != tc.want {
			t.Errorf("wildcardMatch(%q, %q) = %v, want %v", tc.pattern, tc.name, got, tc.want)
		}
	}
}

func TestPolicyCheck(t *testing.T) {
	store, _ := openTestStore(t)
	policy := &Policy{KeyID: "ck_1", Providers: []string{"codex"}, Models: []string{"gpt-5*"}, WeeklyTokenLimit: 1000}

	if _, denial := policy.Check("claude-sonnet", "claude-sonnet", []string{"claude"}); denial == nil || denial.Status != http.StatusForbidden {
		t.Fatalf("model outside patterns: denial = %+v, want 403", denial)
	}
	if _, denial := policy.Check("gpt-5", "gpt-5", []string{"openai-compat"}); denial == nil || denial.Status != http.StatusForbidden {
		t.Fatalf("provider outside list: denial = %+v, want 403", denial)
	}
	providers, denial := policy.Check("gpt-5", "gpt-5", []string{"openai-compat", "codex"})
	if denial != nil || strings.Join(providers, ",") != "codex" {
		t.Fatalf("allowed request: providers = %v, denial = %+v", providers, denial)
	}

	store.usage.Add("ck_1", "codex", "a.json", "gpt-5", Counter{Requests: 1, Tokens: 1000})
	_, denial = policy.Check("gpt-5", "gpt-5", []string{"codex"})
	if denial == nil || denial.Status != http.StatusTooManyRequests || denial.RetryAfter <= 0 {
		t.Fatalf("over limit: denial = %+v, want 429 with Retry-After", denial)
	}

	var nilPolicy *Policy
	if got, denial := nilPolicy.Check("x", "x", []string{"a"}); denial != nil || len(got) != 1 {
		t.Fatal("nil policy must allow everything")
	}
}

func TestWeeklyWindowRollsOff(t *testing.T) {
	store, _ := openTestStore(t)
	now := time.Date(2026, 11, 15, 12, 30, 0, 0, time.UTC)
	store.usage.now = func() time.Time { return now }

	store.usage.Add("k", "codex", "a", "m", Counter{Tokens: 600}) // 2026-11-15 12:00
	now = now.Add(2 * time.Hour)
	store.usage.Add("k", "codex", "a", "m", Counter{Tokens: 500}) // 2026-11-15 14:00

	if got := store.usage.WeeklyTokens("k"); got != 1100 {
		t.Fatalf("WeeklyTokens = %d, want 1100", got)
	}
	// Under 1000 once the 12:00 bucket leaves the window, at 2026-11-22 12:00 (21h30m from 14:30).
	if got, want := store.usage.RetryAfter("k", 1000), 6*24*time.Hour+21*time.Hour+30*time.Minute; got != want {
		t.Fatalf("RetryAfter = %v, want %v", got, want)
	}
	if got := store.usage.RetryAfter("k", 2000); got != 0 {
		t.Fatalf("RetryAfter under limit = %v, want 0", got)
	}

	now = time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	if got := store.usage.WeeklyTokens("k"); got != 500 {
		t.Fatalf("WeeklyTokens after a week = %d, want 500", got)
	}
}

func TestUsagePersistsAcrossReopen(t *testing.T) {
	store, dir := openTestStore(t)
	store.usage.Add("k", "claude", "acct.json", "claude-sonnet", Counter{Requests: 2, Tokens: 42, CacheReadTokens: 7})
	if errClose := store.Close(); errClose != nil {
		t.Fatalf("Close() error = %v", errClose)
	}
	reopened, errOpen := Open(dir)
	if errOpen != nil {
		t.Fatalf("reopen: %v", errOpen)
	}
	buckets := reopened.usage.Buckets("k", time.Now().Add(-time.Hour))
	if len(buckets) != 1 || buckets[0].Tokens != 42 || buckets[0].Requests != 2 || buckets[0].CacheReadTokens != 7 || buckets[0].Account != "acct.json" {
		t.Fatalf("buckets after reopen = %+v", buckets)
	}
	if reopened.usage.WeeklyTokens("k") != 42 {
		t.Fatal("weekly total not rebuilt after reopen")
	}
}

func TestUsagePluginCountsClientKeyRequests(t *testing.T) {
	store, _ := openTestStore(t)
	key, secret, _ := store.Create(Input{Name: ptr("carol")})

	usagePlugin{}.HandleUsage(context.Background(), coreusage.Record{
		Provider:       "Claude",
		Model:          "claude-sonnet",
		AuthID:         "claude-a.json",
		APIKey:         secret,
		AccessProvider: ProviderID,
		Detail: coreusage.Detail{
			InputTokens:         100,
			OutputTokens:        50,
			CacheReadTokens:     1000,
			CacheCreationTokens: 20,
			CachedTokens:        20,
			TotalTokens:         1170,
		},
	})
	usagePlugin{}.HandleUsage(context.Background(), coreusage.Record{APIKey: "other", AccessProvider: "config-inline", Detail: coreusage.Detail{TotalTokens: 999}})

	buckets := store.usage.Buckets("", time.Now().Add(-time.Hour))
	if len(buckets) != 1 {
		t.Fatalf("buckets = %+v, want one for the client key", buckets)
	}
	got := buckets[0]
	if got.KeyID != key.ID || got.Provider != "claude" || got.Account != "claude-a.json" || got.Tokens != 170 || got.CacheReadTokens != 1000 {
		t.Fatalf("bucket = %+v, want 170 counted tokens excluding cache reads", got)
	}
}

func TestAccessProviderAuthenticate(t *testing.T) {
	store, _ := openTestStore(t)
	provider := accessProvider{}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer whatever")
	if _, authErr := provider.Authenticate(context.Background(), req); !sdkaccess.IsAuthErrorCode(authErr, sdkaccess.AuthErrorCodeNotHandled) {
		t.Fatalf("no keys: err = %v, want not handled", authErr)
	}

	key, secret, _ := store.Create(Input{Name: ptr("dave")})
	for _, set := range []func(*http.Request){
		func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+secret) },
		func(r *http.Request) { r.Header.Set("X-Api-Key", secret) },
		func(r *http.Request) { r.Header.Set("X-Goog-Api-Key", secret) },
		func(r *http.Request) { r.URL.RawQuery = "key=" + secret },
	} {
		r := httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
		set(r)
		result, authErr := provider.Authenticate(context.Background(), r)
		if authErr != nil || result.Principal != secret || result.Metadata["client_key_id"] != key.ID {
			t.Fatalf("Authenticate = %+v, %v", result, authErr)
		}
	}

	if _, authErr := provider.Authenticate(context.Background(), req); !sdkaccess.IsAuthErrorCode(authErr, sdkaccess.AuthErrorCodeInvalidCredential) {
		t.Fatalf("unknown key: err = %v, want invalid", authErr)
	}
	empty := httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	if _, authErr := provider.Authenticate(context.Background(), empty); !sdkaccess.IsAuthErrorCode(authErr, sdkaccess.AuthErrorCodeNoCredentials) {
		t.Fatalf("no credentials: err = %v, want no credentials", authErr)
	}

	_, _ = store.Update(key.ID, Input{Enabled: ptr(false)})
	disabled := httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	disabled.Header.Set("X-Api-Key", secret)
	if _, authErr := provider.Authenticate(context.Background(), disabled); !sdkaccess.IsAuthErrorCode(authErr, sdkaccess.AuthErrorCodeInvalidCredential) {
		t.Fatalf("disabled key: err = %v, want invalid", authErr)
	}
}

func TestLookupPolicyOnlyForClientKeyProvider(t *testing.T) {
	store, _ := openTestStore(t)
	_, secret, _ := store.Create(Input{Name: ptr("erin"), Accounts: ptr([]string{"Codex-A.json"})})
	if LookupPolicy("config-inline", secret) != nil {
		t.Fatal("policy attached for a config key")
	}
	policy := LookupPolicy(ProviderID, secret)
	if policy == nil || strings.Join(policy.Accounts, ",") != "Codex-A.json" {
		t.Fatalf("policy = %+v, want accounts kept case-sensitive", policy)
	}
	ctx := WithPolicy(context.Background(), policy)
	if PolicyFromContext(ctx) != policy {
		t.Fatal("PolicyFromContext did not return the attached policy")
	}
}
