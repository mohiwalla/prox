package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/clientkeys"
	coreexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
	"golang.org/x/net/context"
)

func installClientKeyStore(t *testing.T) *clientkeys.Store {
	t.Helper()
	store, errOpen := clientkeys.Open(t.TempDir())
	if errOpen != nil {
		t.Fatalf("Open() error = %v", errOpen)
	}
	clientkeys.SetDefault(store)
	t.Cleanup(func() { clientkeys.SetDefault(nil) })
	return store
}

func TestProvidersForExecutionAppliesClientKeyPolicy(t *testing.T) {
	installClientKeyStore(t)
	handler := NewBaseAPIHandlers(&sdkconfig.SDKConfig{}, nil)
	policy := &clientkeys.Policy{KeyID: "ck_test", Providers: []string{"codex"}, Models: []string{"gpt-*"}}
	ctx := clientkeys.WithPolicy(context.Background(), policy)

	_, _, errMsg := handler.providersForExecution(ctx, "ignored", "claude-sonnet", false, modelRouteDecision{Provider: "claude"}, modelExecutionOptions{})
	if errMsg == nil || errMsg.StatusCode != http.StatusForbidden {
		t.Fatalf("disallowed model: errMsg = %+v, want 403", errMsg)
	}
	_, _, errMsg = handler.providersForExecution(ctx, "ignored", "gpt-5", false, modelRouteDecision{Provider: "claude"}, modelExecutionOptions{})
	if errMsg == nil || errMsg.StatusCode != http.StatusForbidden {
		t.Fatalf("disallowed provider: errMsg = %+v, want 403", errMsg)
	}
	providers, _, errMsg := handler.providersForExecution(ctx, "ignored", "gpt-5", false, modelRouteDecision{Provider: "codex"}, modelExecutionOptions{})
	if errMsg != nil || strings.Join(providers, ",") != "codex" {
		t.Fatalf("allowed request: providers = %v, errMsg = %+v", providers, errMsg)
	}

	// Without a client key nothing changes.
	providers, _, errMsg = handler.providersForExecution(context.Background(), "ignored", "claude-sonnet", false, modelRouteDecision{Provider: "claude"}, modelExecutionOptions{})
	if errMsg != nil || strings.Join(providers, ",") != "claude" {
		t.Fatalf("no client key: providers = %v, errMsg = %+v", providers, errMsg)
	}
}

func TestProvidersForExecutionRefusesClientKeyOverWeeklyLimit(t *testing.T) {
	store := installClientKeyStore(t)
	store.Usage().Add("ck_limited", "codex", "a.json", "gpt-5", clientkeys.Counter{Requests: 1, Tokens: 500})

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ginCtx, _ := gin.CreateTestContext(recorder)
	ginCtx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	ginCtx.Set(clientkeys.GinPolicyKey, &clientkeys.Policy{KeyID: "ck_limited", WeeklyTokenLimit: 500})
	ctx := context.WithValue(context.Background(), "gin", ginCtx)

	handler := NewBaseAPIHandlers(&sdkconfig.SDKConfig{}, nil)
	_, _, errMsg := handler.providersForExecution(ctx, "ignored", "gpt-5", false, modelRouteDecision{Provider: "codex"}, modelExecutionOptions{})
	if errMsg == nil || errMsg.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("errMsg = %+v, want 429", errMsg)
	}
	if ginCtx.Writer.Header().Get("Retry-After") == "" {
		t.Fatal("Retry-After header not set")
	}
}

func TestRequestExecutionMetadataCarriesClientKeyAccounts(t *testing.T) {
	ctx := clientkeys.WithPolicy(context.Background(), &clientkeys.Policy{KeyID: "ck", Accounts: []string{"codex-a.json"}})
	meta := requestExecutionMetadata(ctx)
	ids, _ := meta[coreexecutor.AllowedAuthIDsMetadataKey].([]string)
	if strings.Join(ids, ",") != "codex-a.json" {
		t.Fatalf("allowed auth IDs = %v", meta[coreexecutor.AllowedAuthIDsMetadataKey])
	}
	if _, ok := requestExecutionMetadata(context.Background())[coreexecutor.AllowedAuthIDsMetadataKey]; ok {
		t.Fatal("allowed auth IDs set without a client key")
	}
}

func TestFilterModelsForClientKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ginCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
	request := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	ginCtx.Request = request.WithContext(clientkeys.WithPolicy(request.Context(), &clientkeys.Policy{Models: []string{"gpt-*"}}))

	models := []map[string]any{{"id": "gpt-5"}, {"id": "claude-sonnet"}, {"name": "models/gpt-4o"}}
	got := FilterModelsForClientKey(ginCtx, models)
	if len(got) != 2 || got[0]["id"] != "gpt-5" || got[1]["name"] != "models/gpt-4o" {
		t.Fatalf("filtered = %v", got)
	}

	plain, _ := gin.CreateTestContext(httptest.NewRecorder())
	plain.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	if len(FilterModelsForClientKey(plain, models)) != 3 {
		t.Fatal("models filtered without a client key")
	}
}
