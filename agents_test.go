package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"atc/internal/core"
)

// A stand-in sidecar that answers close with the session's exit a little later, as a CLI
// taking a moment to quit would.
const fakeSidecar = `require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
  const op = JSON.parse(l);
  if (op.op === 'close') setTimeout(() => process.stdout.write(JSON.stringify({ id: op.id, ev: { t: 'exit' } }) + '\n'), 300);
});`

func TestSidecarSessions(t *testing.T) {
	script := filepath.Join(t.TempDir(), "sidecar.cjs")
	if err := os.WriteFile(script, []byte(fakeSidecar), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ATC_SIDECAR", script)
	a := NewApp(t.TempDir())
	defer a.agents.stop()
	open := func() string {
		t.Helper()
		id, err := a.agents.send(a, core.Object{"op": "open"}, "channel")
		if err != nil {
			t.Fatal(err)
		}
		return id
	}

	// #228: an op for a session Go doesn't know is an error, not silence.
	id := open()
	if err := a.AgentSend(id, core.Object{"op": "send"}); err != nil {
		t.Fatal(err)
	}
	if err := a.AgentSend("agent-none", core.Object{"op": "send"}); err == nil {
		t.Fatal("an op for an unknown session was accepted")
	}

	// #227: AgentClose returns once the session has exited, not when the op is written.
	start := time.Now()
	if err := a.AgentClose(id); err != nil {
		t.Fatal(err)
	}
	if waited := time.Since(start); waited < 250*time.Millisecond || waited > 4*time.Second {
		t.Fatalf("AgentClose returned after %v", waited)
	}

	// #226: a session opened right after stop starts a new sidecar, and the old one's late
	// exit leaves the new session's channel alone.
	a.agents.stop()
	id = open()
	time.Sleep(500 * time.Millisecond)
	a.agents.mu.Lock()
	_, kept := a.agents.channels[id]
	a.agents.mu.Unlock()
	if !kept {
		t.Fatal("the old sidecar's exit wiped the new session")
	}
}
