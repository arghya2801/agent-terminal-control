package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"atc/internal/core"
)

func TestAccounts(t *testing.T) {
	a := NewApp(t.TempDir())
	tok := "sk-ant-oat01-" + strings.Repeat("x", 40) + "tail"
	acc, err := a.AccountSave(core.Account{Label: "Work", Kind: "oauth", Secret: tok})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(acc.Secret, "xxxxxxxxxx") || !strings.HasSuffix(acc.Secret, "tail") {
		t.Fatalf("not masked: %q", acc.Secret)
	}
	raw, _ := os.ReadFile(filepath.Join(a.config, "accounts.dat"))
	if strings.Contains(string(raw), "Work") || strings.Contains(string(raw), tok) {
		t.Fatal("accounts.dat is not encrypted")
	}
	if got, _ := a.AccountSecret(acc.ID); got != tok {
		t.Fatalf("secret = %q", got)
	}
	if _, err := a.AccountSave(core.Account{ID: acc.ID, Label: "Work 2", Kind: "oauth"}); err != nil {
		t.Fatal(err)
	}
	if env := a.accountEnv(acc.ID); env["CLAUDE_CODE_OAUTH_TOKEN"] != tok || env["ANTHROPIC_API_KEY"] != "" {
		t.Fatalf("an edit without a secret lost it: %v", env)
	}
	if _, err := a.AccountSave(core.Account{Label: "Key", Kind: "oauth", Secret: "sk-ant-api03-abc"}); err == nil {
		t.Fatal("an API key saved as a subscription")
	}
	if err := a.AccountRemove(acc.ID); err != nil {
		t.Fatal(err)
	}
	if a.accountEnv(acc.ID) != nil || a.accountEnv("") != nil {
		t.Fatal("a removed or empty account still gives env")
	}
}
