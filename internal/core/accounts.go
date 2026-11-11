package core

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Account is a Claude login ATC passes to the CLI as environment (#252), so ~/.claude
// stays as it is. Kind is "oauth" (a `claude setup-token` token) or "apiKey".
type Account struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Kind   string `json:"kind"`
	Secret string `json:"secret"`
}

// Env is what the CLI needs to run as the account. An empty API key, which the CLI
// ignores, keeps one inherited from Windows from outranking a token.
func (a Account) Env() map[string]string {
	if a.Kind == "apiKey" {
		return map[string]string{"ANTHROPIC_API_KEY": a.Secret}
	}
	return map[string]string{"CLAUDE_CODE_OAUTH_TOKEN": a.Secret, "ANTHROPIC_API_KEY": ""}
}

// Masked shows the start and end of the secret.
func (a Account) Masked() Account {
	if len(a.Secret) > 16 {
		a.Secret = a.Secret[:10] + "…" + a.Secret[len(a.Secret)-4:]
	} else if a.Secret != "" {
		a.Secret = "…"
	}
	return a
}

func accountsPath(config string) string { return filepath.Join(config, "accounts.dat") }

// LoadAccounts reads accounts.dat, which DPAPI encrypts for this Windows user.
func LoadAccounts(config string) ([]Account, error) {
	b, e := os.ReadFile(accountsPath(config))
	if os.IsNotExist(e) {
		return []Account{}, nil
	}
	if e != nil {
		return nil, e
	}
	plain, e := dpapi(b, false)
	if e != nil {
		return nil, fmt.Errorf("accounts.dat unreadable: %w", e)
	}
	out := []Account{}
	return out, json.Unmarshal(plain, &out)
}

func SaveAccounts(config string, accounts []Account) error {
	b, e := json.Marshal(accounts)
	if e != nil {
		return e
	}
	sealed, e := dpapi(b, true)
	if e != nil {
		return e
	}
	return WriteFile(accountsPath(config), sealed)
}

func dpapi(in []byte, protect bool) ([]byte, error) {
	if len(in) == 0 {
		return nil, fmt.Errorf("empty data")
	}
	src := windows.DataBlob{Size: uint32(len(in)), Data: &in[0]}
	var out windows.DataBlob
	var e error
	if protect {
		e = windows.CryptProtectData(&src, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out)
	} else {
		e = windows.CryptUnprotectData(&src, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out)
	}
	if e != nil {
		return nil, e
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...), nil
}
