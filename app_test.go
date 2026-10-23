package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"atc/internal/core"
)

func TestTasksMoveIntoNotesOnceAndStayOnDisk(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("ATC_CONFIG_DIR", dir)
	tasks := `[{"id":1,"title":"keep me","state":"done"}]`
	os.WriteFile(filepath.Join(dir, "tasks.json"), []byte(tasks), 0600)
	a := NewApp(dir)
	a.load()
	if a.notes != "- [x] keep me\n" {
		t.Fatalf("%q", a.notes)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "tasks.json")); string(b) != tasks {
		t.Fatal("tasks.json was changed")
	}
	// Once notes.md exists, it is the only source, even when emptied.
	os.WriteFile(filepath.Join(dir, "notes.md"), nil, 0600)
	a.load()
	if a.notes != "" {
		t.Fatalf("tasks migrated twice: %q", a.notes)
	}
}
func TestInvalidSettingsAreNeverRewrittenOnLoad(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("ATC_CONFIG_DIR", dir)
	path := filepath.Join(dir, "settings.json")
	original := `{"ui":{"zoom":"1.2"},"tasks":[{"id":1,"title":"keep me"}]}`
	os.WriteFile(path, []byte(original), 0600)
	if _, e := core.LoadSettings(path); e == nil {
		t.Fatal("fixture must fail settings validation")
	}
	NewApp(dir).load()
	if b, _ := os.ReadFile(path); string(b) != original {
		t.Fatalf("invalid settings were rewritten: %s", b)
	}
}
func TestAppVersionComesFromWailsJSON(t *testing.T) {
	b, _ := os.ReadFile("package.json")
	var pkg struct{ Version string }
	json.Unmarshal(b, &pkg)
	if appVersion == "" || appVersion != pkg.Version {
		t.Fatalf("wails.json says %q, package.json says %q", appVersion, pkg.Version)
	}
}
func TestNewerComparesVersionsNumerically(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{{"0.10.0", "0.9.3", true}, {"0.6.0", "0.6.0", false}, {"0.6", "0.6.1", false}, {"1.0.0", "0.99.99", true}} {
		if newer(c.a, c.b) != c.want {
			t.Error(c)
		}
	}
}
func TestLinksAndCommands(t *testing.T) {
	for _, url := range []string{"https://github.com/a/b?c=1&d=2", "HTTP://x.y", "https://www.google.com/maps/@51.5,-0.12,14z"} {
		if !validURL(url) {
			t.Fatal(url)
		}
	}
	for _, url := range []string{"file:///C:/Windows/System32/calc.exe", `C:\Windows\notepad.exe`, "javascript:alert(1)", "https://", "https://a b", "https://a\"b", "ms-settings:"} {
		if validURL(url) {
			t.Fatal(url)
		}
	}
	a := NewApp(t.TempDir())
	a.load()
	if e := a.PtyWrite("missing", ""); e == nil {
		t.Fatal("missing terminal accepted")
	}
	if _, e := a.AgentCommand("wrong", "", false); e == nil {
		t.Fatal("invalid provider accepted")
	}
	if e := a.OpenInExplorer(os.Args[0]); e == nil {
		t.Fatal("opened a file, which would run it")
	}
}
func TestLimitResponseNotificationsErrorsCancellation(t *testing.T) {
	messages := make(chan core.Object, 4)
	messages <- core.Object{"method": "account/updated"}
	messages <- core.Object{"id": float64(2), "result": core.Object{"rateLimits": nil}}
	v, e := limitResponse(context.Background(), messages, 2)
	if e != nil || core.Obj(v)["rateLimits"] != nil {
		t.Fatal(v, e)
	}
	messages <- core.Object{"id": float64(3), "error": core.Object{"message": "not signed in"}}
	if _, e = limitResponse(context.Background(), messages, 3); e == nil {
		t.Fatal("error lost")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if _, e = limitResponse(ctx, messages, 4); e == nil {
		t.Fatal("cancel ignored")
	}
}
func TestMissingCustomCLIReportsError(t *testing.T) {
	s := core.Defaults()
	core.Obj(s["codex"])["command"] = "atc-nonexistent-codex-123.exe"
	var client limitsClient
	if _, e := client.read(s); e == nil {
		t.Fatal("missing customized CLI hidden")
	}
}
func TestPersistenceReloadDoesNotLoseLatestSave(t *testing.T) {
	dir := t.TempDir()
	a := NewApp(dir)
	a.load()
	s := a.getSettings()
	core.Obj(s["projects"])["claudeProjectsDir"] = filepath.Join(dir, "claude")
	core.Obj(s["codex"])["homeDir"] = filepath.Join(dir, "codex")
	a.settings = s
	core.Save(filepath.Join(dir, "settings.json"), s)
	a.lastSettings = jsonText(s)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 20; i++ {
			a.refreshFiles()
		}
	}()
	for i := 0; i < 20; i++ {
		if err := a.NotesSet(fmt.Sprintf("note %d", i)); err != nil {
			t.Fatal(err)
		}
	}
	wg.Wait()
	a.refreshFiles()
	if got := a.NotesGet(); got != "note 19" {
		t.Fatal(got)
	}
	// An edit made outside ATC is picked up.
	os.WriteFile(filepath.Join(dir, "notes.md"), []byte("from an editor"), 0600)
	a.refreshFiles()
	if got := a.NotesGet(); got != "from an editor" {
		t.Fatal(got)
	}
}
func TestHeadlessCommandsAndValidation(t *testing.T) {
	dir := t.TempDir()
	a := NewApp(dir)
	a.load()
	if err := a.SettingsSet(nil); err == nil {
		t.Fatal("SettingsSet accepted a missing payload")
	}
	path, err := a.ScratchDir()
	if err != nil || !core.IsDir(path) {
		t.Fatal(path, err)
	}
	file := filepath.Join(dir, "export.csv")
	if err = a.WriteTextFile(file, "name,tokens\n世界,123\n"); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(file)
	if string(b) != "name,tokens\n世界,123\n" {
		t.Fatal(string(b))
	}
	os.MkdirAll(filepath.Join(dir, "themes"), 0700)
	os.WriteFile(filepath.Join(dir, "themes", "valid.json"), []byte(`{"background":"#123456"}`), 0600)
	os.WriteFile(filepath.Join(dir, "themes", "bad.json"), []byte("{bad"), 0600)
	if v := a.ListThemes(); len(v) != 1 {
		t.Fatal(v)
	}
}
func TestBackoffHonoursRetryAfterThenDoublesUpToHalfAnHour(t *testing.T) {
	var b backoff
	now := time.Now()
	if b.blocked(now) != nil {
		t.Fatal("blocked before any 429")
	}
	b.hit("120", now)
	if b.blocked(now.Add(119*time.Second)) == nil || b.blocked(now.Add(121*time.Second)) != nil {
		t.Fatal("Retry-After not honoured", b.until.Sub(now))
	}
	for _, want := range []time.Duration{4, 8, 16, 30, 30} {
		b.hit("", now)
		if b.wait != want*time.Minute {
			t.Fatal(b.wait, want)
		}
	}
	b.reset()
	b.hit("", now)
	if b.wait != 2*time.Minute {
		t.Fatal("a success did not reset the wait", b.wait)
	}
}
func TestClaudeUsageHonorsIsolatedHome(t *testing.T) {
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	if _, err := claudeUsage(); err == nil || !strings.Contains(err.Error(), "not signed in") {
		t.Fatal(err)
	}
}

// The executable doubles as a deterministic Codex app-server for integration tests.
func TestMain(m *testing.M) {
	if mode := os.Getenv("ATC_TEST_APP_SERVER"); mode != "" && len(os.Args) > 1 && os.Args[1] == "app-server" {
		if mode == "hang" {
			time.Sleep(time.Minute)
			os.Exit(0)
		}
		decoder := json.NewDecoder(os.Stdin)
		encoder := json.NewEncoder(os.Stdout)
		var request core.Object
		if decoder.Decode(&request) != nil || request["method"] != "initialize" {
			os.Exit(2)
		}
		encoder.Encode(core.Object{"id": 1, "result": core.Object{}})
		if decoder.Decode(&request) != nil || request["method"] != "initialized" {
			os.Exit(3)
		}
		if decoder.Decode(&request) != nil || request["method"] != "account/rateLimits/read" {
			os.Exit(4)
		}
		encoder.Encode(core.Object{"method": "account/updated"})
		encoder.Encode(core.Object{"id": 2, "result": core.Object{"rateLimits": core.Object{"primary": core.Object{"usedPercent": 42}}}})
		os.Exit(0)
	}
	os.Exit(m.Run())
}
func TestCodexAppServerHandshakeAndCancellation(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	s := core.Defaults()
	core.Obj(s["codex"])["command"] = executable
	core.Obj(s["codex"])["homeDir"] = t.TempDir()
	t.Setenv("ATC_TEST_APP_SERVER", "reply")
	var client limitsClient
	result, err := client.read(s)
	if err != nil || core.Num(core.Obj(core.Obj(core.Obj(result)["rateLimits"])["primary"])["usedPercent"]) != 42 {
		t.Fatal(result, err)
	}
	t.Setenv("ATC_TEST_APP_SERVER", "hang")
	done := make(chan error, 1)
	go func() { _, err := client.read(s); done <- err }()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		client.mu.Lock()
		started := client.child != nil
		client.mu.Unlock()
		if started {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	client.stop()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled app-server reported success")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("app-server did not cancel")
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if client.child != nil || client.cancel != nil {
		t.Fatal("helper lifecycle not cleared")
	}
}

type testTransport func(*http.Request) (*http.Response, error)

func (f testTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestClaudeUsageResponseAndErrors(t *testing.T) {
	home := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", home)
	previous := http.DefaultClient
	t.Cleanup(func() { http.DefaultClient = previous })
	for _, tc := range []struct {
		name, body string
		status     int
		wantError  bool
	}{{"success", `{"five_hour":{"utilization":25}}`, 200, false}, {"unauthorized", `{}`, 401, true}, {"malformed", `{broken`, 200, true}} {
		t.Run(tc.name, func(t *testing.T) {
			core.Save(filepath.Join(home, ".credentials.json"), core.Object{"claudeAiOauth": core.Object{"accessToken": "test-token", "expiresAt": time.Now().Add(time.Hour).UnixMilli(), "subscriptionType": "test"}})
			http.DefaultClient = &http.Client{Transport: testTransport(func(r *http.Request) (*http.Response, error) {
				if r.Method != "GET" || r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("anthropic-beta") == "" {
					t.Error("invalid usage request")
				}
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body)), Header: make(http.Header)}, nil
			})}
			result, err := claudeUsage()
			if (err != nil) != tc.wantError {
				t.Fatal(err)
			}
			if err == nil && (core.Obj(result)["subscriptionType"] != "test" || core.Num(core.Obj(core.Obj(result)["five_hour"])["utilization"]) != 25) {
				t.Fatal(result)
			}
		})
	}
	core.Save(filepath.Join(home, ".credentials.json"), core.Object{"claudeAiOauth": core.Object{"accessToken": "test-token", "expiresAt": 1}})
	if _, err := claudeUsage(); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatal(err)
	}
}
