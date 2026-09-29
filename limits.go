package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"atc/internal/core"
	"atc/internal/pty"
)

func claudeUsage() (any, error) {
	home := os.Getenv("CLAUDE_CONFIG_DIR")
	if home == "" {
		home = filepath.Join(core.Home(), ".claude")
	}
	b, e := os.ReadFile(filepath.Join(home, ".credentials.json"))
	if e != nil {
		return nil, fmt.Errorf("not signed in: run `claude` and log in first")
	}
	var creds core.Object
	if e = json.Unmarshal(b, &creds); e != nil {
		return nil, fmt.Errorf("credentials unreadable: %w", e)
	}
	oauth := core.Obj(creds["claudeAiOauth"])
	token := core.Str(oauth["accessToken"])
	if token == "" {
		return nil, fmt.Errorf("no Claude subscription login found")
	}
	if exp := core.Num(oauth["expiresAt"]); exp > 0 && exp <= float64(time.Now().UnixMilli()) {
		return nil, fmt.Errorf("login token expired: run `claude` once to refresh it")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.anthropic.com/api/oauth/usage", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		return nil, fmt.Errorf("usage request failed: %w", e)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("usage request failed: HTTP %d", res.StatusCode)
	}
	var body core.Object
	if e = json.NewDecoder(res.Body).Decode(&body); e != nil {
		return nil, fmt.Errorf("usage response unreadable: %w", e)
	}
	body["subscriptionType"] = oauth["subscriptionType"]
	return body, nil
}

type limitsClient struct {
	request sync.Mutex
	mu      sync.Mutex
	child   *exec.Cmd
	cancel  context.CancelFunc
}

func (c *limitsClient) stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		c.cancel()
	}
	if c.child != nil && c.child.Process != nil {
		pty.KillTree(uint32(c.child.Process.Pid))
	}
}
func (c *limitsClient) read(s core.Object) (any, error) {
	c.request.Lock()
	defer c.request.Unlock()
	exe := core.Str(core.Obj(s["codex"])["command"])
	path, e := exec.LookPath(exe)
	if e != nil {
		if exe == "codex" {
			return nil, nil
		}
		return nil, fmt.Errorf("Codex `%s` not found", exe)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "app-server")
	if strings.EqualFold(filepath.Ext(path), ".cmd") || strings.EqualFold(filepath.Ext(path), ".bat") {
		shell, e := pty.Shell()
		if e != nil {
			return nil, e
		}
		cmd = exec.CommandContext(ctx, shell, "-NoLogo", "-NoProfile", "-Command", "& "+core.Quote(path)+" app-server")
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_, home := core.Roots(s)
	cmd.Env = append(os.Environ(), "CODEX_HOME="+home)
	stdout, e := cmd.StdoutPipe()
	if e != nil {
		return nil, e
	}
	stdin, e := cmd.StdinPipe()
	if e != nil {
		return nil, e
	}
	if e = cmd.Start(); e != nil {
		return nil, e
	}
	c.mu.Lock()
	c.child = cmd
	c.cancel = cancel
	c.mu.Unlock()
	defer func() {
		stdin.Close()
		c.stop()
		cmd.Wait()
		c.mu.Lock()
		c.child = nil
		c.cancel = nil
		c.mu.Unlock()
	}()
	messages := make(chan core.Object, 64)
	go func() {
		defer close(messages)
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
		for scanner.Scan() {
			var v core.Object
			if json.Unmarshal(scanner.Bytes(), &v) == nil {
				select {
				case messages <- v:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	write := func(v any) error { return json.NewEncoder(stdin).Encode(v) }
	if e = write(core.Object{"id": 1, "method": "initialize", "params": core.Object{"clientInfo": core.Object{"name": "atc", "title": "ATC", "version": "0.3.1"}}}); e != nil {
		return nil, e
	}
	if _, e = limitResponse(ctx, messages, 1); e != nil {
		return nil, e
	}
	if e = write(core.Object{"method": "initialized"}); e != nil {
		return nil, e
	}
	if e = write(core.Object{"id": 2, "method": "account/rateLimits/read"}); e != nil {
		return nil, e
	}
	return limitResponse(ctx, messages, 2)
}
func limitResponse(ctx context.Context, messages <-chan core.Object, id float64) (any, error) {
	timer := time.NewTimer(15 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("Codex app-server response unavailable: %w", ctx.Err())
		case <-timer.C:
			return nil, fmt.Errorf("Codex app-server response unavailable: timeout")
		case v, ok := <-messages:
			if !ok {
				return nil, fmt.Errorf("Codex app-server response unavailable: closed")
			}
			if core.Num(v["id"]) != id {
				continue
			}
			if problem, ok := v["error"]; ok {
				return nil, fmt.Errorf("Codex rate limits unavailable: %s", core.Str(core.Obj(problem)["message"]))
			}
			result, ok := v["result"]
			if !ok {
				return nil, fmt.Errorf("Codex app-server returned no result")
			}
			return result, nil
		}
	}
}
