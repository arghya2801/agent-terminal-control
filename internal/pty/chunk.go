package pty

import (
	"encoding/json"
	"unicode/utf8"
)

// chunkBudget bounds each output event by its serialized JSON length, not its raw size:
// events reach the WebView as script, and escape-dense TUI redraws expand up to 6x
// (ESC becomes \u001b).
const chunkBudget = 7900

var asciiEscaped = func() (n [utf8.RuneSelf]int) {
	for i := range n {
		b, _ := json.Marshal(string(rune(i)))
		n[i] = len(b) - 2
	}
	return
}()

// escapedLen is how many bytes json.Marshal spends on r inside a string.
func escapedLen(r rune) int {
	switch {
	case r < utf8.RuneSelf:
		return asciiEscaped[r]
	case r == ' ' || r == ' ':
		return 6
	}
	return utf8.RuneLen(r)
}

// splitForIPC cuts text into chunks that each serialize within budget, never inside a
// character. A single character over budget still makes progress as its own chunk.
func splitForIPC(text string, budget int) []string {
	var out []string
	start, size := 0, 0
	for i, r := range text {
		n := escapedLen(r)
		if size+n > budget && i > start {
			out = append(out, text[start:i])
			start, size = i, 0
		}
		size += n
	}
	if start < len(text) {
		out = append(out, text[start:])
	}
	return out
}
