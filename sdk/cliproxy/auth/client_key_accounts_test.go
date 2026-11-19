package auth

import (
	"context"
	"testing"

	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
)

func TestManager_PickNextMixed_AllowedAuthIDsLimitSelection(t *testing.T) {
	t.Parallel()

	model := "gpt-5.4-mini-client-key"
	registerSchedulerModels(t, "codex", model, "codex-a", "codex-b", "codex-c")

	manager := NewManager(nil, &RoundRobinSelector{}, nil)
	manager.executors["codex"] = schedulerTestExecutor{}
	for _, id := range []string{"codex-a", "codex-b", "codex-c"} {
		if _, errRegister := manager.Register(context.Background(), &Auth{ID: id, Provider: "codex"}); errRegister != nil {
			t.Fatalf("Register(%s) error = %v", id, errRegister)
		}
	}

	opts := cliproxyexecutor.Options{
		Metadata: map[string]any{cliproxyexecutor.AllowedAuthIDsMetadataKey: []string{"codex-b"}},
	}
	for i := 0; i < 4; i++ {
		got, _, _, errPick := manager.pickNextMixed(context.Background(), []string{"codex"}, model, opts, map[string]struct{}{})
		if errPick != nil {
			t.Fatalf("pickNextMixed() #%d error = %v", i, errPick)
		}
		if got == nil || got.ID != "codex-b" {
			t.Fatalf("pickNextMixed() #%d auth = %+v, want codex-b", i, got)
		}
	}

	none := cliproxyexecutor.Options{
		Metadata: map[string]any{cliproxyexecutor.AllowedAuthIDsMetadataKey: []string{"not-registered"}},
	}
	if got, _, _, errPick := manager.pickNextMixed(context.Background(), []string{"codex"}, model, none, map[string]struct{}{}); errPick == nil {
		t.Fatalf("pickNextMixed() with no allowed auth = %+v, want error", got)
	}
}
