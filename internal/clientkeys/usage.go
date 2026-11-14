package clientkeys

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
	log "github.com/sirupsen/logrus"
)

const (
	// Week is the rolling window the weekly token limit counts over.
	Week          = 7 * 24 * time.Hour
	usageRetained = 90 * 24 * time.Hour
	flushInterval = 30 * time.Second
)

// Counter totals one slice of usage. Tokens excludes cache reads; it is what limits count.
type Counter struct {
	Requests        int64 `json:"requests"`
	Failed          int64 `json:"failed"`
	InputTokens     int64 `json:"input_tokens"`
	OutputTokens    int64 `json:"output_tokens"`
	CacheReadTokens int64 `json:"cache_read_tokens"`
	Tokens          int64 `json:"tokens"`
}

func (c *Counter) add(other Counter) {
	c.Requests += other.Requests
	c.Failed += other.Failed
	c.InputTokens += other.InputTokens
	c.OutputTokens += other.OutputTokens
	c.CacheReadTokens += other.CacheReadTokens
	c.Tokens += other.Tokens
}

// Bucket is one hour of usage for one key, provider, account and model.
type Bucket struct {
	KeyID    string    `json:"key_id"`
	Hour     time.Time `json:"hour"`
	Provider string    `json:"provider"`
	Account  string    `json:"account"`
	Model    string    `json:"model"`
	Counter
}

type bucketKey struct {
	keyID    string
	hour     int64
	provider string
	account  string
	model    string
}

type usageFile struct {
	Buckets []Bucket `json:"buckets"`
}

// Usage keeps hourly usage per key in memory and flushes it to disk periodically.
type Usage struct {
	mu      sync.Mutex
	path    string
	buckets map[bucketKey]*Counter
	hourly  map[string]map[int64]int64
	dirty   bool
	now     func() time.Time
	stop    chan struct{}
	done    chan struct{}
}

func openUsage(path string) (*Usage, error) {
	u := &Usage{
		path:    path,
		buckets: map[bucketKey]*Counter{},
		hourly:  map[string]map[int64]int64{},
		now:     time.Now,
	}
	data, errRead := os.ReadFile(path)
	switch {
	case errRead == nil:
		var file usageFile
		if errDecode := json.Unmarshal(data, &file); errDecode != nil {
			return nil, fmt.Errorf("read %s: %w", path, errDecode)
		}
		for _, bucket := range file.Buckets {
			u.addLocked(bucket.KeyID, bucket.Hour.Unix(), bucket.Provider, bucket.Account, bucket.Model, bucket.Counter)
		}
	case !errors.Is(errRead, os.ErrNotExist):
		return nil, fmt.Errorf("read %s: %w", path, errRead)
	}
	return u, nil
}

// Start flushes usage to disk every 30 seconds until Flush stops it.
func (u *Usage) Start() {
	u.mu.Lock()
	if u.stop != nil {
		u.mu.Unlock()
		return
	}
	u.stop = make(chan struct{})
	u.done = make(chan struct{})
	stop, done := u.stop, u.done
	u.mu.Unlock()
	go func() {
		defer close(done)
		ticker := time.NewTicker(flushInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				if errFlush := u.flush(); errFlush != nil {
					log.Warnf("client keys: save usage: %v", errFlush)
				}
			}
		}
	}()
}

// Flush stops the periodic flusher and writes pending usage.
func (u *Usage) Flush() error {
	u.mu.Lock()
	stop, done := u.stop, u.done
	u.stop, u.done = nil, nil
	u.mu.Unlock()
	if stop != nil {
		close(stop)
		<-done
	}
	return u.flush()
}

// Add records one finished upstream request.
func (u *Usage) Add(keyID, provider, account, model string, counter Counter) {
	hour := u.now().UTC().Truncate(time.Hour).Unix()
	u.mu.Lock()
	defer u.mu.Unlock()
	u.addLocked(keyID, hour, provider, account, model, counter)
	u.dirty = true
}

func (u *Usage) addLocked(keyID string, hour int64, provider, account, model string, counter Counter) {
	k := bucketKey{keyID: keyID, hour: hour, provider: provider, account: account, model: model}
	existing, ok := u.buckets[k]
	if !ok {
		existing = &Counter{}
		u.buckets[k] = existing
	}
	existing.add(counter)
	hours, ok := u.hourly[keyID]
	if !ok {
		hours = map[int64]int64{}
		u.hourly[keyID] = hours
	}
	hours[hour] += counter.Tokens
}

// WeeklyTokens sums a key's counted tokens over the rolling week ending now.
func (u *Usage) WeeklyTokens(keyID string) int64 {
	start := u.windowStart()
	u.mu.Lock()
	defer u.mu.Unlock()
	var total int64
	for hour, tokens := range u.hourly[keyID] {
		if hour >= start {
			total += tokens
		}
	}
	return total
}

// RetryAfter returns how long until a key's weekly usage drops below limit, or 0 if it already is.
func (u *Usage) RetryAfter(keyID string, limit int64) time.Duration {
	start := u.windowStart()
	u.mu.Lock()
	type hourTokens struct {
		hour   int64
		tokens int64
	}
	var window []hourTokens
	var total int64
	for hour, tokens := range u.hourly[keyID] {
		if hour >= start {
			window = append(window, hourTokens{hour, tokens})
			total += tokens
		}
	}
	u.mu.Unlock()
	if total < limit {
		return 0
	}
	sort.Slice(window, func(i, j int) bool { return window[i].hour < window[j].hour })
	now := u.now()
	for _, entry := range window {
		total -= entry.tokens
		if total < limit {
			wait := time.Unix(entry.hour, 0).Add(Week).Sub(now)
			if wait < time.Minute {
				wait = time.Minute
			}
			return wait
		}
	}
	return Week
}

// windowStart is the first hour bucket inside the rolling week (the current hour counts as one).
func (u *Usage) windowStart() int64 {
	return u.now().UTC().Truncate(time.Hour).Add(-Week + time.Hour).Unix()
}

// Buckets returns a key's buckets since the given time; an empty keyID returns every key's.
func (u *Usage) Buckets(keyID string, since time.Time) []Bucket {
	sinceUnix := since.Unix()
	u.mu.Lock()
	defer u.mu.Unlock()
	out := make([]Bucket, 0)
	for k, counter := range u.buckets {
		if (keyID != "" && k.keyID != keyID) || k.hour < sinceUnix {
			continue
		}
		out = append(out, Bucket{
			KeyID:    k.keyID,
			Hour:     time.Unix(k.hour, 0).UTC(),
			Provider: k.provider,
			Account:  k.account,
			Model:    k.model,
			Counter:  *counter,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].Hour.Equal(out[j].Hour) {
			return out[i].Hour.Before(out[j].Hour)
		}
		if out[i].KeyID != out[j].KeyID {
			return out[i].KeyID < out[j].KeyID
		}
		if out[i].Account != out[j].Account {
			return out[i].Account < out[j].Account
		}
		return out[i].Model < out[j].Model
	})
	return out
}

func (u *Usage) forget(keyID string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	for k := range u.buckets {
		if k.keyID == keyID {
			delete(u.buckets, k)
		}
	}
	delete(u.hourly, keyID)
	u.dirty = true
}

func (u *Usage) flush() error {
	cutoff := u.now().Add(-usageRetained).Unix()
	u.mu.Lock()
	if !u.dirty {
		u.mu.Unlock()
		return nil
	}
	file := usageFile{Buckets: make([]Bucket, 0, len(u.buckets))}
	for k, counter := range u.buckets {
		if k.hour < cutoff {
			delete(u.buckets, k)
			if hours := u.hourly[k.keyID]; hours != nil {
				delete(hours, k.hour)
			}
			continue
		}
		file.Buckets = append(file.Buckets, Bucket{
			KeyID:    k.keyID,
			Hour:     time.Unix(k.hour, 0).UTC(),
			Provider: k.provider,
			Account:  k.account,
			Model:    k.model,
			Counter:  *counter,
		})
	}
	u.dirty = false
	u.mu.Unlock()

	data, errEncode := json.Marshal(file)
	if errEncode == nil {
		errEncode = writeFileAtomic(u.path, data)
	}
	if errEncode != nil {
		u.mu.Lock()
		u.dirty = true
		u.mu.Unlock()
	}
	return errEncode
}

// usagePlugin counts finished upstream requests made with client keys.
type usagePlugin struct{}

// HandleUsage implements coreusage.Plugin.
func (usagePlugin) HandleUsage(ctx context.Context, record coreusage.Record) {
	store := Default()
	if store == nil {
		return
	}
	keyID := ""
	if policy := PolicyFromContext(ctx); policy != nil {
		keyID = policy.KeyID
	} else if strings.EqualFold(strings.TrimSpace(record.AccessProvider), ProviderID) {
		if key, ok := store.Lookup(record.APIKey); ok {
			keyID = key.ID
		}
	}
	if keyID == "" {
		return
	}
	store.usage.Add(keyID, strings.ToLower(strings.TrimSpace(record.Provider)), record.AuthID, record.Model, counterFromRecord(record))
}

func counterFromRecord(record coreusage.Record) Counter {
	detail := record.Detail
	// CachedTokens can hold cache-creation tokens for Claude, so only CacheReadTokens is subtracted.
	cacheRead := detail.CacheReadTokens
	tokens := detail.TotalTokens - cacheRead
	if tokens < 0 {
		tokens = 0
	}
	counter := Counter{
		Requests:        1,
		InputTokens:     detail.InputTokens,
		OutputTokens:    detail.OutputTokens,
		CacheReadTokens: cacheRead,
		Tokens:          tokens,
	}
	if record.Failed {
		counter.Failed = 1
	}
	return counter
}
