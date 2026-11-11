package main

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"atc/internal/core"
)

// AccountList is every Claude account (#252), secrets masked.
func (a *App) AccountList() ([]core.Account, error) {
	list, e := core.LoadAccounts(a.config)
	for i := range list {
		list[i] = list[i].Masked()
	}
	return list, e
}

// AccountSecret is one account's secret, for Show and Copy in Settings.
func (a *App) AccountSecret(id string) (string, error) {
	acc, ok := a.account(id)
	if !ok {
		return "", fmt.Errorf("no such account")
	}
	return acc.Secret, nil
}

// AccountSave adds an account (no id) or edits one. An empty secret keeps the old one.
func (a *App) AccountSave(acc core.Account) (core.Account, error) {
	acc.Label, acc.Secret = strings.TrimSpace(acc.Label), strings.TrimSpace(acc.Secret)
	if acc.Label == "" {
		return acc, fmt.Errorf("give the account a name")
	}
	if acc.Kind != "oauth" && acc.Kind != "apiKey" {
		return acc, fmt.Errorf("unknown account kind: %s", acc.Kind)
	}
	a.diskMu.Lock()
	defer a.diskMu.Unlock()
	list, e := core.LoadAccounts(a.config)
	if e != nil {
		return acc, e
	}
	i := slices.IndexFunc(list, func(x core.Account) bool { return x.ID == acc.ID })
	if acc.ID != "" && i < 0 {
		return acc, fmt.Errorf("no such account")
	}
	if acc.Secret == "" && i < 0 {
		return acc, fmt.Errorf("paste the token or API key")
	}
	if acc.Secret == "" {
		acc.Secret = list[i].Secret
	} else if e := checkSecret(acc); e != nil {
		return acc, e
	}
	if i < 0 {
		acc.ID = fmt.Sprintf("a%d", time.Now().UnixNano())
		list = append(list, acc)
	} else {
		list[i] = acc
	}
	return acc.Masked(), core.SaveAccounts(a.config, list)
}

func (a *App) AccountRemove(id string) error {
	a.diskMu.Lock()
	defer a.diskMu.Unlock()
	list, e := core.LoadAccounts(a.config)
	if e != nil {
		return e
	}
	return core.SaveAccounts(a.config, slices.DeleteFunc(list, func(x core.Account) bool { return x.ID == id }))
}

func (a *App) account(id string) (core.Account, bool) {
	list, _ := core.LoadAccounts(a.config)
	i := slices.IndexFunc(list, func(x core.Account) bool { return x.ID == id })
	if id == "" || i < 0 {
		return core.Account{}, false
	}
	return list[i], true
}

// accountEnv is what a Claude process needs to run as account id. None for "" or a
// removed account: the CLI then uses the ~/.claude login.
func (a *App) accountEnv(id string) map[string]string {
	if acc, ok := a.account(id); ok {
		return acc.Env()
	}
	return nil
}

func (a *App) defaultAccount() string {
	return core.Str(core.Obj(a.getSettings()["claude"])["account"])
}

func envList(m map[string]string) []string {
	out := []string{}
	for k, v := range m {
		out = append(out, k+"="+v)
	}
	return out
}

// checkSecret catches a key pasted into the wrong kind, and an API key Anthropic rejects.
// A network failure is not the key's fault, so it does not stop the save.
func checkSecret(acc core.Account) error {
	if acc.Kind == "oauth" {
		if strings.HasPrefix(acc.Secret, "sk-ant-api") {
			return fmt.Errorf("that is an API key; add it as an API key")
		}
		return nil
	}
	if strings.HasPrefix(acc.Secret, "sk-ant-oat") {
		return fmt.Errorf("that is a subscription token; add it as a subscription")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.anthropic.com/v1/models", nil)
	req.Header.Set("x-api-key", acc.Secret)
	req.Header.Set("anthropic-version", "2023-06-01")
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		return nil
	}
	res.Body.Close()
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return fmt.Errorf("Anthropic rejected this API key (HTTP %d)", res.StatusCode)
	}
	return nil
}
