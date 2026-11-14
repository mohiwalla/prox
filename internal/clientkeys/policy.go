package clientkeys

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	sdkaccess "github.com/router-for-me/CLIProxyAPI/v8/sdk/access"
	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
	log "github.com/sirupsen/logrus"
)

// Install makes s the process-wide store, accepts its keys as client credentials, and counts their usage.
func Install(s *Store) {
	SetDefault(s)
	sdkaccess.RegisterProvider(ProviderID, accessProvider{})
	coreusage.RegisterNamedPlugin(ProviderID, usagePlugin{})
	s.usage.Start()
}

// Policy is what a request authenticated with a client key may do.
type Policy struct {
	KeyID            string
	Name             string
	Providers        []string
	Accounts         []string
	Models           []string
	WeeklyTokenLimit int64
}

// Denial explains why a request was refused.
type Denial struct {
	Status     int
	Message    string
	RetryAfter time.Duration
}

type policyContextKey struct{}

// GinPolicyKey stores the request's *Policy in the gin context, for handlers whose
// execution context is derived from context.Background plus the gin context.
const GinPolicyKey = "clientKeyPolicy"

// WithPolicy returns ctx carrying p.
func WithPolicy(ctx context.Context, p *Policy) context.Context {
	if p == nil {
		return ctx
	}
	return context.WithValue(ctx, policyContextKey{}, p)
}

// PolicyFromContext returns the client key policy of the request, or nil for other credentials.
func PolicyFromContext(ctx context.Context) *Policy {
	if ctx == nil {
		return nil
	}
	if p, ok := ctx.Value(policyContextKey{}).(*Policy); ok {
		return p
	}
	if c, ok := ctx.Value("gin").(*gin.Context); ok && c != nil {
		if value, exists := c.Get(GinPolicyKey); exists {
			p, _ := value.(*Policy)
			return p
		}
	}
	return nil
}

// Attach records the policy of the client key that authenticated a request on the gin
// context and returns the request context carrying it. Other credentials leave both unchanged.
func Attach(c *gin.Context, ctx context.Context, accessProvider, principal string) context.Context {
	p := LookupPolicy(accessProvider, principal)
	if p == nil {
		return ctx
	}
	if c != nil {
		c.Set(GinPolicyKey, p)
	}
	return WithPolicy(ctx, p)
}

// LookupPolicy returns the policy for a principal authenticated by the client key provider.
func LookupPolicy(accessProvider, principal string) *Policy {
	if !strings.EqualFold(strings.TrimSpace(accessProvider), ProviderID) {
		return nil
	}
	store := Default()
	if store == nil {
		return nil
	}
	key, ok := store.Lookup(principal)
	if !ok {
		return nil
	}
	return &Policy{
		KeyID:            key.ID,
		Name:             key.Name,
		Providers:        key.Providers,
		Accounts:         key.Accounts,
		Models:           key.Models,
		WeeklyTokenLimit: key.WeeklyTokenLimit,
	}
}

// AllowsModel reports whether any of the given names for one model matches the key's model patterns.
func (p *Policy) AllowsModel(names ...string) bool {
	if p == nil || len(p.Models) == 0 {
		return true
	}
	for _, name := range names {
		name = strings.ToLower(strings.TrimSpace(name))
		if name == "" {
			continue
		}
		for _, pattern := range p.Models {
			if wildcardMatch(pattern, name) {
				return true
			}
		}
	}
	return false
}

// FilterProviders keeps the providers the key may use.
func (p *Policy) FilterProviders(providers []string) []string {
	if p == nil || len(p.Providers) == 0 {
		return providers
	}
	out := make([]string, 0, len(providers))
	for _, provider := range providers {
		for _, allowed := range p.Providers {
			if strings.EqualFold(strings.TrimSpace(provider), allowed) {
				out = append(out, provider)
				break
			}
		}
	}
	return out
}

// Check validates a request for a model served by providers. It returns the providers
// the key may use, or a denial when the model, every provider, or the weekly budget rules it out.
func (p *Policy) Check(requestedModel, model string, providers []string) ([]string, *Denial) {
	if p == nil {
		return providers, nil
	}
	if !p.AllowsModel(requestedModel, model) {
		return nil, &Denial{Status: http.StatusForbidden, Message: fmt.Sprintf("model %q is not allowed for this API key", requestedModel)}
	}
	allowed := p.FilterProviders(providers)
	if len(allowed) == 0 {
		return nil, &Denial{Status: http.StatusForbidden, Message: fmt.Sprintf("model %q is served by %s, which this API key may not use", requestedModel, strings.Join(providers, ", "))}
	}
	if p.WeeklyTokenLimit > 0 {
		if store := Default(); store != nil {
			if used := store.usage.WeeklyTokens(p.KeyID); used >= p.WeeklyTokenLimit {
				return nil, &Denial{
					Status:     http.StatusTooManyRequests,
					Message:    fmt.Sprintf("this API key used %d of its %d weekly tokens", used, p.WeeklyTokenLimit),
					RetryAfter: store.usage.RetryAfter(p.KeyID, p.WeeklyTokenLimit),
				}
			}
		}
	}
	return allowed, nil
}

// accessProvider authenticates requests that present a client key.
type accessProvider struct{}

func (accessProvider) Identifier() string { return ProviderID }

func (accessProvider) Authenticate(_ context.Context, r *http.Request) (*sdkaccess.Result, *sdkaccess.AuthError) {
	store := Default()
	if store == nil || store.Len() == 0 || r == nil {
		return nil, sdkaccess.NewNotHandledError()
	}
	candidates := []struct {
		value  string
		source string
	}{
		{bearerToken(r.Header.Get("Authorization")), "authorization"},
		{r.Header.Get("X-Goog-Api-Key"), "x-goog-api-key"},
		{r.Header.Get("X-Api-Key"), "x-api-key"},
	}
	if r.URL != nil {
		query := r.URL.Query()
		candidates = append(candidates,
			struct{ value, source string }{query.Get("key"), "query-key"},
			struct{ value, source string }{query.Get("auth_token"), "query-auth-token"},
		)
	}
	presented := false
	for _, candidate := range candidates {
		value := strings.TrimSpace(candidate.value)
		if value == "" {
			continue
		}
		presented = true
		key, ok := store.Lookup(value)
		if !ok {
			continue
		}
		if !key.Enabled {
			log.Debugf("client keys: rejected disabled key %s", key.ID)
			return nil, sdkaccess.NewInvalidCredentialError()
		}
		return &sdkaccess.Result{
			Provider:  ProviderID,
			Principal: value,
			Metadata: map[string]string{
				"source":        candidate.source,
				"client_key_id": key.ID,
			},
		}, nil
	}
	if !presented {
		return nil, sdkaccess.NewNoCredentialsError()
	}
	return nil, sdkaccess.NewInvalidCredentialError()
}

func bearerToken(header string) string {
	parts := strings.SplitN(header, " ", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
		return strings.TrimSpace(parts[1])
	}
	return header
}

func validPattern(pattern string) bool {
	return pattern != "" && !strings.ContainsAny(pattern, " \t\n")
}

// wildcardMatch matches name against pattern, where * matches any run of characters
// (including "/") and ? matches one character.
func wildcardMatch(pattern, name string) bool {
	p, n := 0, 0
	star, mark := -1, 0
	for n < len(name) {
		switch {
		case p < len(pattern) && (pattern[p] == '?' || pattern[p] == name[n]):
			p++
			n++
		case p < len(pattern) && pattern[p] == '*':
			star, mark = p, n
			p++
		case star >= 0:
			p = star + 1
			mark++
			n = mark
		default:
			return false
		}
	}
	for p < len(pattern) && pattern[p] == '*' {
		p++
	}
	return p == len(pattern)
}
