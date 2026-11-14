// Package clientkeys manages per-client API keys for the proxy: who may call it, which
// providers, accounts and models each key may use, a weekly token budget, and usage per key.
// Keys live in client-keys.json next to the config file; only a SHA-256 of each secret is stored.
package clientkeys

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ProviderID identifies requests authenticated with a client key.
const ProviderID = "client-keys"

const (
	keysFileName  = "client-keys.json"
	usageFileName = "client-key-usage.json"
	secretPrefix  = "cpk_"
)

// ErrNotFound is returned when a key ID does not exist.
var ErrNotFound = errors.New("client key not found")

// Key is one client key. Empty Providers, Accounts or Models mean "any".
type Key struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	Hash             string    `json:"hash"`
	Hint             string    `json:"hint"`
	Enabled          bool      `json:"enabled"`
	Providers        []string  `json:"providers,omitempty"`
	Accounts         []string  `json:"accounts,omitempty"`
	Models           []string  `json:"models,omitempty"`
	WeeklyTokenLimit int64     `json:"weekly_token_limit,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// Input carries the editable fields of a key. Nil fields are left unchanged on update.
type Input struct {
	Name             *string   `json:"name"`
	Enabled          *bool     `json:"enabled"`
	Providers        *[]string `json:"providers"`
	Accounts         *[]string `json:"accounts"`
	Models           *[]string `json:"models"`
	WeeklyTokenLimit *int64    `json:"weekly_token_limit"`
}

type keysFile struct {
	Keys []Key `json:"keys"`
}

// Store holds the keys and their usage. It is safe for concurrent use.
type Store struct {
	mu     sync.RWMutex
	path   string
	keys   []Key
	byHash map[string]int
	usage  *Usage
	now    func() time.Time
}

var defaultStore atomic.Pointer[Store]

// Default returns the process-wide store, or nil before SetDefault.
func Default() *Store { return defaultStore.Load() }

// SetDefault replaces the process-wide store.
func SetDefault(s *Store) { defaultStore.Store(s) }

// Open loads keys and usage from dir, creating nothing until the first write.
func Open(dir string) (*Store, error) {
	s := &Store{
		path:   filepath.Join(dir, keysFileName),
		byHash: map[string]int{},
		now:    time.Now,
	}
	data, errRead := os.ReadFile(s.path)
	switch {
	case errRead == nil:
		var file keysFile
		if errDecode := json.Unmarshal(data, &file); errDecode != nil {
			return nil, fmt.Errorf("read %s: %w", s.path, errDecode)
		}
		s.keys = file.Keys
	case !errors.Is(errRead, os.ErrNotExist):
		return nil, fmt.Errorf("read %s: %w", s.path, errRead)
	}
	s.reindex()
	usage, errUsage := openUsage(filepath.Join(dir, usageFileName))
	if errUsage != nil {
		return nil, errUsage
	}
	s.usage = usage
	return s, nil
}

// Usage returns the store's usage counters.
func (s *Store) Usage() *Usage { return s.usage }

// Close flushes pending usage to disk.
func (s *Store) Close() error { return s.usage.Flush() }

func (s *Store) reindex() {
	s.byHash = make(map[string]int, len(s.keys))
	for i, key := range s.keys {
		s.byHash[key.Hash] = i
	}
}

// List returns all keys sorted by creation time.
func (s *Store) List() []Key {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Key, len(s.keys))
	for i, key := range s.keys {
		out[i] = cloneKey(key)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

// Get returns one key by ID.
func (s *Store) Get(id string) (Key, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, key := range s.keys {
		if key.ID == id {
			return cloneKey(key), true
		}
	}
	return Key{}, false
}

// Len reports how many keys exist.
func (s *Store) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.keys)
}

// Lookup finds the enabled key matching a presented secret.
func (s *Store) Lookup(secret string) (Key, bool) {
	if secret == "" {
		return Key{}, false
	}
	hash := hashSecret(secret)
	s.mu.RLock()
	defer s.mu.RUnlock()
	idx, ok := s.byHash[hash]
	if !ok {
		return Key{}, false
	}
	return cloneKey(s.keys[idx]), true
}

// Create adds a key and returns it with its secret, which is never stored or shown again.
func (s *Store) Create(in Input) (Key, string, error) {
	name := ""
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
	}
	if name == "" {
		return Key{}, "", errors.New("name is required")
	}
	secret, errSecret := newSecret()
	if errSecret != nil {
		return Key{}, "", errSecret
	}
	id, errID := randomHex(6)
	if errID != nil {
		return Key{}, "", errID
	}
	now := s.now().UTC()
	key := Key{
		ID:        "ck_" + id,
		Name:      name,
		Hash:      hashSecret(secret),
		Hint:      secret[len(secret)-4:],
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
	}
	applyInput(&key, in)
	if errValidate := validate(key); errValidate != nil {
		return Key{}, "", errValidate
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	next := append(append([]Key(nil), s.keys...), key)
	if errSave := s.save(next); errSave != nil {
		return Key{}, "", errSave
	}
	s.keys = next
	s.reindex()
	return cloneKey(key), secret, nil
}

// Update changes the given fields of a key.
func (s *Store) Update(id string, in Input) (Key, error) {
	return s.modify(id, func(key *Key) error {
		applyInput(key, in)
		return validate(*key)
	})
}

// Rotate replaces a key's secret and returns the new one.
func (s *Store) Rotate(id string) (Key, string, error) {
	secret, errSecret := newSecret()
	if errSecret != nil {
		return Key{}, "", errSecret
	}
	key, errModify := s.modify(id, func(key *Key) error {
		key.Hash = hashSecret(secret)
		key.Hint = secret[len(secret)-4:]
		return nil
	})
	if errModify != nil {
		return Key{}, "", errModify
	}
	return key, secret, nil
}

// Delete removes a key and its usage history.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := make([]Key, 0, len(s.keys))
	for _, key := range s.keys {
		if key.ID != id {
			next = append(next, key)
		}
	}
	if len(next) == len(s.keys) {
		return ErrNotFound
	}
	if errSave := s.save(next); errSave != nil {
		return errSave
	}
	s.keys = next
	s.reindex()
	s.usage.forget(id)
	return nil
}

func (s *Store) modify(id string, change func(*Key) error) (Key, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := make([]Key, len(s.keys))
	for i, key := range s.keys {
		next[i] = cloneKey(key)
	}
	for i := range next {
		if next[i].ID != id {
			continue
		}
		if errChange := change(&next[i]); errChange != nil {
			return Key{}, errChange
		}
		next[i].UpdatedAt = s.now().UTC()
		if errSave := s.save(next); errSave != nil {
			return Key{}, errSave
		}
		s.keys = next
		s.reindex()
		return cloneKey(next[i]), nil
	}
	return Key{}, ErrNotFound
}

func (s *Store) save(keys []Key) error {
	data, errEncode := json.MarshalIndent(keysFile{Keys: keys}, "", "  ")
	if errEncode != nil {
		return errEncode
	}
	return writeFileAtomic(s.path, data)
}

func applyInput(key *Key, in Input) {
	if in.Name != nil {
		key.Name = strings.TrimSpace(*in.Name)
	}
	if in.Enabled != nil {
		key.Enabled = *in.Enabled
	}
	if in.Providers != nil {
		key.Providers = cleanList(*in.Providers, true)
	}
	if in.Accounts != nil {
		key.Accounts = cleanList(*in.Accounts, false)
	}
	if in.Models != nil {
		key.Models = cleanList(*in.Models, true)
	}
	if in.WeeklyTokenLimit != nil {
		key.WeeklyTokenLimit = *in.WeeklyTokenLimit
	}
}

func validate(key Key) error {
	if key.Name == "" {
		return errors.New("name is required")
	}
	if key.WeeklyTokenLimit < 0 {
		return errors.New("weekly_token_limit must be 0 (no limit) or positive")
	}
	for _, pattern := range key.Models {
		if !validPattern(pattern) {
			return fmt.Errorf("invalid model pattern %q", pattern)
		}
	}
	return nil
}

func cleanList(values []string, lower bool) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if lower {
			value = strings.ToLower(value)
		}
		if value == "" {
			continue
		}
		if _, dup := seen[value]; dup {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func cloneKey(key Key) Key {
	key.Providers = append([]string(nil), key.Providers...)
	key.Accounts = append([]string(nil), key.Accounts...)
	key.Models = append([]string(nil), key.Models...)
	return key
}

func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func newSecret() (string, error) {
	value, errRandom := randomHex(24)
	if errRandom != nil {
		return "", errRandom
	}
	return secretPrefix + value, nil
}

func randomHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, errRead := rand.Read(buf); errRead != nil {
		return "", fmt.Errorf("generate random value: %w", errRead)
	}
	return hex.EncodeToString(buf), nil
}

func writeFileAtomic(path string, data []byte) error {
	if errMkdir := os.MkdirAll(filepath.Dir(path), 0o700); errMkdir != nil {
		return errMkdir
	}
	tmp, errCreate := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if errCreate != nil {
		return errCreate
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if errChmod := tmp.Chmod(0o600); errChmod != nil {
		_ = tmp.Close()
		return errChmod
	}
	if _, errWrite := tmp.Write(data); errWrite != nil {
		_ = tmp.Close()
		return errWrite
	}
	if errClose := tmp.Close(); errClose != nil {
		return errClose
	}
	return os.Rename(tmpName, path)
}
