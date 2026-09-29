package pty

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// Ported from src-tauri/src/pty/pump.rs, shell.rs, procs.rs and tests/pty_{pipeline,smoke}.rs.

func serializedLen(s string) int { b, _ := json.Marshal(s); return len(b) - 2 }

// --- UTF-8 decoding across pipe reads

func TestASCIIPassesThroughUnchanged(t *testing.T) {
	if out, carry := Decode(nil, []byte("hello world"), false); out != "hello world" || len(carry) != 0 {
		t.Fatal(out, carry)
	}
}
func TestATwoByteCharSplitAcrossReadsIsReassembled(t *testing.T) {
	b := []byte("é")
	out, carry := Decode(nil, b[:1], false)
	if out != "" || len(carry) != 1 {
		t.Fatal("must hold back the incomplete lead byte", out, carry)
	}
	if out, carry = Decode(carry, b[1:], false); out != "é" || len(carry) != 0 {
		t.Fatal(out, carry)
	}
}
func TestAFourByteCharSplitThreeWaysIsReassembled(t *testing.T) {
	b := []byte("🚀")
	out1, c := Decode(nil, b[:1], false)
	out2, c := Decode(c, b[1:3], false)
	out3, c := Decode(c, b[3:], false)
	if out1+out2 != "" || out3 != "🚀" || len(c) != 0 {
		t.Fatal(out1, out2, out3, c)
	}
}
func TestTextAroundASplitCharIsNotDelayed(t *testing.T) {
	e := []byte("é")
	out, c := Decode(nil, append([]byte("abc"), e[0]), false)
	if out != "abc" {
		t.Fatal("the complete prefix must be emitted immediately", out)
	}
	if out, _ = Decode(c, []byte{e[1], 'd'}, false); out != "éd" {
		t.Fatal(out)
	}
}
func TestInvalidBytesBecomeReplacementCharsAndDoNotDesyncTheStream(t *testing.T) {
	if out, c := Decode(nil, []byte{'a', 0xFF, 'b'}, false); out != "a�b" || len(c) != 0 {
		t.Fatal(out, c)
	}
}
func TestCarryNeverExceedsThreeBytes(t *testing.T) {
	var c []byte
	for _, chunk := range [][]byte{[]byte("🚀"), []byte("é"), []byte("plain")} {
		for _, b := range chunk {
			_, c = Decode(c, []byte{b}, false)
			if len(c) > 3 {
				t.Fatal("carry grew to", len(c))
			}
		}
	}
}
func TestFinishFlushesADanglingPartialSequence(t *testing.T) {
	out, c := Decode(nil, []byte("🚀")[:2], false)
	if out != "" {
		t.Fatal(out)
	}
	if out, c = Decode(c, nil, true); out != "�" || len(c) != 0 {
		t.Fatal(out, c)
	}
}
func TestAStreamSplitAtEveryByteBoundaryReassemblesExactly(t *testing.T) {
	original := "héllo 🚀 wörld — box: ┌─┐ done"
	var out strings.Builder
	var c []byte
	for _, b := range []byte(original) {
		var s string
		s, c = Decode(c, []byte{b}, false)
		out.WriteString(s)
	}
	last, _ := Decode(c, nil, true)
	if out.String()+last != original {
		t.Fatal(out.String() + last)
	}
}

// --- serialized-length budget

func TestEscapedLengthMatchesJSONMarshalExactly(t *testing.T) {
	// The chunk budget is only correct if this agrees with the real serializer.
	samples := []rune{'é', '🚀', '─', '�', ' ', ' '}
	for r := rune(0); r <= 0x80; r++ {
		samples = append(samples, r)
	}
	for _, r := range samples {
		if escapedLen(r) != serializedLen(string(r)) {
			t.Errorf("U+%04X: %d, json.Marshal says %d", r, escapedLen(r), serializedLen(string(r)))
		}
	}
}
func TestEscapeIsSixCharacters(t *testing.T) {
	// The whole reason the budget cannot be measured in raw bytes.
	if escapedLen('\x1b') != 6 || escapedLen('a') != 1 {
		t.Fatal(escapedLen('\x1b'), escapedLen('a'))
	}
}
func TestShortTextIsASingleChunkAndEmptyTextYieldsNone(t *testing.T) {
	if c := splitForIPC("hello", chunkBudget); !slices.Equal(c, []string{"hello"}) {
		t.Fatal(c)
	}
	if c := splitForIPC("", chunkBudget); len(c) != 0 {
		t.Fatal(c)
	}
}
func TestChunksReassembleToTheOriginal(t *testing.T) {
	text := strings.Repeat("x", 20000)
	if c := splitForIPC(text, chunkBudget); len(c) < 2 || strings.Join(c, "") != text {
		t.Fatal(len(c))
	}
}
func TestEveryChunkStaysWithinTheSerializedBudget(t *testing.T) {
	// Escape-dense input modelled on a TUI redraw: cursor moves and colour codes.
	text := strings.Repeat("\x1b[2J\x1b[H\x1b[38;5;42mstatus\x1b[0m\r\n", 400)
	chunks := splitForIPC(text, chunkBudget)
	for _, c := range chunks {
		if serializedLen(c) > chunkBudget {
			t.Fatalf("chunk serializes to %d > %d", serializedLen(c), chunkBudget)
		}
	}
	if strings.Join(chunks, "") != text {
		t.Fatal("chunks do not reassemble")
	}
}
func TestEscapeDenseInputIsSplitMoreFinelyThanPlainText(t *testing.T) {
	plain := len(splitForIPC(strings.Repeat("a", 6000), chunkBudget))
	dense := len(splitForIPC(strings.Repeat("\x1b", 6000), chunkBudget))
	if plain != 1 || dense <= plain {
		t.Fatal("6000 ESC bytes serialize to 36000 chars and must split", plain, dense)
	}
}
func TestNeverSplitsAMultibyteCharacter(t *testing.T) {
	text := strings.Repeat("🚀é─", 3000)
	chunks := splitForIPC(text, 64)
	if len(chunks) < 2 || strings.Join(chunks, "") != text {
		t.Fatal(len(chunks))
	}
	for _, c := range chunks {
		if c == "" || serializedLen(c) > 64 {
			t.Fatal("empty or oversized chunk", c)
		}
	}
}
func TestASingleCharOverBudgetStillMakesProgress(t *testing.T) {
	chunks := splitForIPC("\x1b\x1b", 2)
	if strings.Join(chunks, "") != "\x1b\x1b" || slices.Contains(chunks, "") {
		t.Fatal(chunks)
	}
}

// --- shell.rs

func TestResolvesAPowerShellToAnAbsoluteExistingPathWithoutAVerbatimPrefix(t *testing.T) {
	shell, e := Shell()
	if e != nil {
		t.Fatal(e)
	}
	st, e := os.Stat(shell)
	if !filepath.IsAbs(shell) || e != nil || st.IsDir() || strings.HasPrefix(shell, `\\?\`) {
		t.Fatal(shell, e)
	}
	stem := strings.ToLower(strings.TrimSuffix(filepath.Base(shell), filepath.Ext(shell)))
	if stem != "pwsh" && stem != "powershell" {
		t.Fatal("expected a PowerShell, got", stem)
	}
}
func TestTheNoProfileEnvVarAddsTheFlagOnlyWhenSetToOne(t *testing.T) {
	for value, want := range map[string]bool{"": false, "0": false, "1": true} {
		t.Setenv("ATC_SHELL_NO_PROFILE", value)
		args, e := shellArgs()
		if e != nil {
			t.Fatal(e)
		}
		if !slices.Contains(args, "-NoLogo") || slices.Contains(args, "-NoProfile") != want {
			t.Errorf("%q: %v", value, args)
		}
	}
}

// --- pipeline and smoke

// collect runs a profile-free shell until its output contains want, acknowledging as the
// frontend does, and returns every output payload.
func collect(t *testing.T, opts Options, want string) []string {
	t.Helper()
	t.Setenv("ATC_SHELL_NO_PROFILE", "1")
	events := make(chan Event, 4096)
	s, e := Spawn(opts, func(ev Event) { events <- ev })
	if e != nil {
		t.Fatal(e)
	}
	defer s.Kill()
	var payloads []string
	var out strings.Builder
	deadline := time.After(20 * time.Second)
	for !strings.Contains(out.String(), want) {
		select {
		case ev := <-events:
			if ev.T == "o" {
				payloads = append(payloads, ev.D)
				out.WriteString(ev.D)
				s.Ack(uint64(len(ev.D)))
				if strings.Contains(ev.D, "\x1b[6n") {
					s.Write("\x1b[1;1R")
				}
			}
		case <-deadline:
			t.Fatalf("missing %q in %q", want, out.String())
		}
	}
	return payloads
}
func TestTheCwdIsHonoured(t *testing.T) {
	dir := t.TempDir()
	collect(t, Options{Cols: 120, Rows: 30, Cwd: dir, InitialCommand: "Write-Output ('CWD_' + (Split-Path -Leaf $PWD.Path))"}, "CWD_"+filepath.Base(dir))
}
func TestNoPayloadIsOverTheSerializedBudgetAndOutputIsCleanText(t *testing.T) {
	// Coloured bulk output: the escape-dense case that raw-byte chunking gets wrong.
	payloads := collect(t, Options{Cols: 120, Rows: 30, InitialCommand: "1..2000 | ForEach-Object { Write-Host ('ROW_' + $_) -ForegroundColor Green }; Write-Output ('DONE_' + 'OK')"}, "DONE_OK")
	for _, p := range payloads {
		if serializedLen(p) > chunkBudget {
			t.Fatalf("payload serializes to %d > %d", serializedLen(p), chunkBudget)
		}
		if strings.ContainsAny(p, "\x00�") {
			t.Fatalf("output is not clean text: %q", p)
		}
	}
}
func TestStatsTrackWhatTheDebugOverlayReports(t *testing.T) {
	runPTY(t, "Write-Output ('STATS_' + 'OK')", func(s *Session, text func() string) {
		waitText(t, text, "STATS_OK")
		deadline := time.Now().Add(5 * time.Second)
		for s.Stats().Inflight != 0 && time.Now().Before(deadline) {
			time.Sleep(25 * time.Millisecond)
		}
		if st := s.Stats(); st.Sends == 0 || st.BytesOut == 0 || st.Inflight != 0 {
			t.Fatalf("%+v", st)
		}
	})
}
func TestAnIdleShellHasNoBusyChild(t *testing.T) {
	runPTY(t, "Write-Output ('IDLE_' + 'OK')", func(s *Session, text func() string) {
		waitText(t, text, "IDLE_OK")
		time.Sleep(300 * time.Millisecond)
		if b := s.Busy(); b != nil {
			t.Fatal("a leaf shell reported a child", b)
		}
	})
}
