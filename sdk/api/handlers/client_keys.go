package handlers

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/clientkeys"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/interfaces"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	coreexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	"golang.org/x/net/context"
)

// applyClientKeyPolicy keeps the providers a client key may use for this model, or refuses the
// request (403 for a model, provider or account set the key may not use, 429 over its weekly budget).
func (h *BaseAPIHandler) applyClientKeyPolicy(ctx context.Context, requestedModel, normalizedModel string, providers []string) ([]string, *interfaces.ErrorMessage) {
	policy := clientkeys.PolicyFromContext(ctx)
	if policy == nil {
		return providers, nil
	}
	allowed, denial := policy.Check(requestedModel, normalizedModel, providers)
	if denial == nil && len(policy.Accounts) > 0 && h.AuthManager != nil {
		allowed = h.providersWithAccounts(policy.Accounts, allowed)
		if len(allowed) == 0 {
			denial = &clientkeys.Denial{Status: http.StatusForbidden, Message: fmt.Sprintf("none of the accounts this API key may use serve model %q", requestedModel)}
		}
	}
	if denial == nil {
		return allowed, nil
	}
	if denial.RetryAfter > 0 {
		if c, ok := ctx.Value("gin").(*gin.Context); ok && c != nil {
			c.Header("Retry-After", fmt.Sprintf("%d", int64(math.Ceil(denial.RetryAfter.Seconds()))))
		}
	}
	return nil, &interfaces.ErrorMessage{StatusCode: denial.Status, Error: errors.New(denial.Message)}
}

// providersWithAccounts keeps the providers that have at least one of the given accounts.
func (h *BaseAPIHandler) providersWithAccounts(accounts, providers []string) []string {
	owned := make(map[string]struct{}, len(accounts))
	for _, id := range accounts {
		if auth, ok := h.AuthManager.GetByID(id); ok && auth != nil {
			owned[strings.ToLower(strings.TrimSpace(auth.Provider))] = struct{}{}
		}
	}
	out := make([]string, 0, len(providers))
	for _, provider := range providers {
		if _, ok := owned[strings.ToLower(strings.TrimSpace(provider))]; ok {
			out = append(out, provider)
		}
	}
	return out
}

// addClientKeyAccountsMetadata limits auth selection to the accounts a client key may use.
func addClientKeyAccountsMetadata(ctx context.Context, meta map[string]any) {
	policy := clientkeys.PolicyFromContext(ctx)
	if policy == nil || len(policy.Accounts) == 0 {
		return
	}
	meta[coreexecutor.AllowedAuthIDsMetadataKey] = append([]string(nil), policy.Accounts...)
}

// FilterModelsForClientKey drops models the request's client key may not use from a model list.
// Entries are matched by "id", falling back to "name" (with any "models/" prefix removed).
func FilterModelsForClientKey(c *gin.Context, models []map[string]any) []map[string]any {
	if c == nil || c.Request == nil {
		return models
	}
	policy := clientkeys.PolicyFromContext(c.Request.Context())
	if policy == nil {
		return models
	}
	modelRegistry := registry.GetGlobalRegistry()
	out := make([]map[string]any, 0, len(models))
	for _, model := range models {
		id, _ := model["id"].(string)
		if id == "" {
			name, _ := model["name"].(string)
			id = strings.TrimPrefix(name, "models/")
		}
		if id == "" || !policy.AllowsModel(id) {
			continue
		}
		if len(policy.Providers) > 0 && len(policy.FilterProviders(modelRegistry.GetModelProviders(id))) == 0 {
			continue
		}
		out = append(out, model)
	}
	return out
}
