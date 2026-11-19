package management

import (
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/clientkeys"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
)

// clientKeyView is a client key as the management API shows it: never the secret or its hash.
type clientKeyView struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	Hint             string    `json:"hint"`
	Enabled          bool      `json:"enabled"`
	Providers        []string  `json:"providers"`
	Accounts         []string  `json:"accounts"`
	Models           []string  `json:"models"`
	WeeklyTokenLimit int64     `json:"weekly_token_limit"`
	WeeklyTokens     int64     `json:"weekly_tokens"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func newClientKeyView(store *clientkeys.Store, key clientkeys.Key) clientKeyView {
	nonNil := func(values []string) []string {
		if values == nil {
			return []string{}
		}
		return values
	}
	return clientKeyView{
		ID:               key.ID,
		Name:             key.Name,
		Hint:             key.Hint,
		Enabled:          key.Enabled,
		Providers:        nonNil(key.Providers),
		Accounts:         nonNil(key.Accounts),
		Models:           nonNil(key.Models),
		WeeklyTokenLimit: key.WeeklyTokenLimit,
		WeeklyTokens:     store.Usage().WeeklyTokens(key.ID),
		CreatedAt:        key.CreatedAt,
		UpdatedAt:        key.UpdatedAt,
	}
}

func clientKeyStore(c *gin.Context) *clientkeys.Store {
	store := clientkeys.Default()
	if store == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "client keys are not available"})
	}
	return store
}

func writeClientKeyError(c *gin.Context, err error) {
	if errors.Is(err, clientkeys.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
}

type clientKeyAccountOption struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	Label    string `json:"label"`
	Disabled bool   `json:"disabled"`
}

type clientKeyModelOption struct {
	ID        string   `json:"id"`
	Providers []string `json:"providers"`
}

// GetClientKeyOptions lists the providers, accounts and models a client key can be limited to,
// using the same identifiers the proxy matches against.
func (h *Handler) GetClientKeyOptions(c *gin.Context) {
	providerSet := map[string]struct{}{}
	accounts := make([]clientKeyAccountOption, 0)
	if h.authManager != nil {
		for _, auth := range h.authManager.List() {
			if auth == nil {
				continue
			}
			provider := strings.ToLower(strings.TrimSpace(auth.Provider))
			providerSet[provider] = struct{}{}
			label := strings.TrimSpace(auth.Label)
			if email, _ := auth.Metadata["email"].(string); strings.TrimSpace(email) != "" {
				label = strings.TrimSpace(email)
			} else if email := strings.TrimSpace(auth.Attributes["email"]); email != "" {
				label = email
			}
			accounts = append(accounts, clientKeyAccountOption{ID: auth.ID, Provider: provider, Label: label, Disabled: auth.Disabled})
		}
	}
	sort.Slice(accounts, func(i, j int) bool {
		if accounts[i].Provider != accounts[j].Provider {
			return accounts[i].Provider < accounts[j].Provider
		}
		return accounts[i].Label+accounts[i].ID < accounts[j].Label+accounts[j].ID
	})
	modelRegistry := registry.GetGlobalRegistry()
	models := make([]clientKeyModelOption, 0)
	for _, model := range modelRegistry.GetAvailableModels("openai") {
		id, _ := model["id"].(string)
		if id == "" {
			continue
		}
		models = append(models, clientKeyModelOption{ID: id, Providers: modelRegistry.GetModelProviders(id)})
	}
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
	providers := make([]string, 0, len(providerSet))
	for provider := range providerSet {
		if provider != "" {
			providers = append(providers, provider)
		}
	}
	sort.Strings(providers)
	c.JSON(http.StatusOK, gin.H{"providers": providers, "accounts": accounts, "models": models})
}

// ListClientKeys returns every client key with its usage over the rolling week.
func (h *Handler) ListClientKeys(c *gin.Context) {
	store := clientKeyStore(c)
	if store == nil {
		return
	}
	keys := store.List()
	views := make([]clientKeyView, 0, len(keys))
	for _, key := range keys {
		views = append(views, newClientKeyView(store, key))
	}
	c.JSON(http.StatusOK, gin.H{"keys": views})
}

// CreateClientKey adds a client key and returns its secret once.
func (h *Handler) CreateClientKey(c *gin.Context) {
	store := clientKeyStore(c)
	if store == nil {
		return
	}
	var in clientkeys.Input
	if errBind := c.ShouldBindJSON(&in); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	key, secret, errCreate := store.Create(in)
	if errCreate != nil {
		writeClientKeyError(c, errCreate)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"key": newClientKeyView(store, key), "secret": secret})
}

// UpdateClientKey changes the fields present in the body.
func (h *Handler) UpdateClientKey(c *gin.Context) {
	store := clientKeyStore(c)
	if store == nil {
		return
	}
	var in clientkeys.Input
	if errBind := c.ShouldBindJSON(&in); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	key, errUpdate := store.Update(c.Param("id"), in)
	if errUpdate != nil {
		writeClientKeyError(c, errUpdate)
		return
	}
	c.JSON(http.StatusOK, gin.H{"key": newClientKeyView(store, key)})
}

// RotateClientKey replaces a key's secret and returns the new one once.
func (h *Handler) RotateClientKey(c *gin.Context) {
	store := clientKeyStore(c)
	if store == nil {
		return
	}
	key, secret, errRotate := store.Rotate(c.Param("id"))
	if errRotate != nil {
		writeClientKeyError(c, errRotate)
		return
	}
	c.JSON(http.StatusOK, gin.H{"key": newClientKeyView(store, key), "secret": secret})
}

// DeleteClientKey removes a key and its usage history.
func (h *Handler) DeleteClientKey(c *gin.Context) {
	store := clientKeyStore(c)
	if store == nil {
		return
	}
	if errDelete := store.Delete(c.Param("id")); errDelete != nil {
		writeClientKeyError(c, errDelete)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// GetClientKeyUsage returns hourly usage buckets per key, provider, account and model.
// Query: hours (default 168, at most 2160) and an optional key ID.
func (h *Handler) GetClientKeyUsage(c *gin.Context) {
	store := clientKeyStore(c)
	if store == nil {
		return
	}
	hours := 168
	if raw := strings.TrimSpace(c.Query("hours")); raw != "" {
		parsed, errParse := strconv.Atoi(raw)
		if errParse != nil || parsed <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "hours must be a positive integer"})
			return
		}
		hours = min(parsed, 2160)
	}
	since := time.Now().UTC().Truncate(time.Hour).Add(-time.Duration(hours-1) * time.Hour)
	c.JSON(http.StatusOK, gin.H{
		"since":   since,
		"buckets": store.Usage().Buckets(strings.TrimSpace(c.Query("key")), since),
	})
}
