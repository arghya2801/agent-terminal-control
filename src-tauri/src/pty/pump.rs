//! Turning raw ConPTY bytes into IPC-sized UTF-8 chunks.
//!
//! Two problems live here, both pure and both easy to get subtly wrong:
//!
//! 1. **UTF-8 never aligns with reads.** ConPTY hands us arbitrary byte counts, so a
//!    multi-byte character routinely straddles two reads. Decoding each read
//!    independently would corrupt it.
//! 2. **Tauri's IPC has a size cliff.** A `Channel` JSON payload under 8192 bytes is
//!    delivered by a single `webview.eval()`; above it, delivery takes a second IPC
//!    round trip. The budget applies to the *serialized* string, where JSON expands
//!    the ESC byte (0x1B) into a six-character escape. Claude Code's TUI is dense
//!    enough in escapes that budgeting on raw byte length overshoots badly: 6000 ESC
//!    bytes serialize to 36000 characters.

/// Tauri's threshold for delivering a JSON channel payload in one `webview.eval()`.
pub const MAX_JSON_DIRECT_EXECUTE: usize = 8192;

/// Serialized-length budget per chunk, leaving room for the surrounding quotes and a
/// little slack against Tauri's exact threshold.
pub const CHUNK_BUDGET: usize = 7900;

/// Incremental UTF-8 decoder that retains a partial trailing sequence between reads.
#[derive(Debug, Default)]
pub struct Utf8Decoder {
    carry: Vec<u8>,
}

impl Utf8Decoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Decode `bytes`, holding back any incomplete trailing sequence for the next call.
    /// Genuinely invalid bytes become U+FFFD — output is never silently dropped.
    pub fn push(&mut self, bytes: &[u8]) -> String {
        let mut data = std::mem::take(&mut self.carry);
        data.extend_from_slice(bytes);

        let mut out = String::with_capacity(data.len());
        let mut idx = 0usize;
        loop {
            match std::str::from_utf8(&data[idx..]) {
                Ok(valid) => {
                    out.push_str(valid);
                    idx = data.len();
                    break;
                }
                Err(e) => {
                    let upto = e.valid_up_to();
                    // Safe: `valid_up_to` is by definition a valid UTF-8 boundary.
                    out.push_str(std::str::from_utf8(&data[idx..idx + upto]).unwrap_or(""));
                    idx += upto;
                    match e.error_len() {
                        // Truncated but still plausible: wait for the rest.
                        None => break,
                        // Genuinely invalid: emit U+FFFD and step over it, so one bad
                        // byte cannot desync everything that follows it.
                        Some(bad) => {
                            out.push(char::REPLACEMENT_CHARACTER);
                            idx += bad;
                        }
                    }
                }
            }
        }

        self.carry = data[idx..].to_vec();
        out
    }

    /// Bytes currently held back awaiting the rest of their sequence.
    pub fn pending(&self) -> usize {
        self.carry.len()
    }

    /// Flush any held-back bytes as replacement characters. For stream end, where the
    /// rest of the sequence is never going to arrive.
    pub fn finish(&mut self) -> String {
        let had_partial = !self.carry.is_empty();
        self.carry.clear();
        if had_partial {
            char::REPLACEMENT_CHARACTER.to_string()
        } else {
            String::new()
        }
    }
}

/// The number of characters `serde_json` will emit for `c` inside a JSON string,
/// excluding the surrounding quotes.
pub fn json_escaped_len(c: char) -> usize {
    match c {
        // serde_json emits these as two-character escapes.
        '"' | '\\' | '\n' | '\r' | '\t' | '\u{8}' | '\u{c}' => 2,
        // Every other C0 control becomes `\u00XX`.
        c if (c as u32) < 0x20 => 6,
        // Everything else, DEL included, is emitted literally.
        c => c.len_utf8(),
    }
}

/// Split `text` so each piece serializes to at most `budget` characters, never breaking
/// a character. Concatenating the result reproduces `text` exactly.
pub fn split_for_ipc(text: &str, budget: usize) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;
    let mut cost = 0usize;

    for (i, c) in text.char_indices() {
        let c_cost = json_escaped_len(c);
        // Close the current chunk before this character pushes it over budget. The
        // `i > start` guard lets a single oversized character still make progress
        // instead of emitting an empty chunk and spinning.
        if cost + c_cost > budget && i > start {
            chunks.push(&text[start..i]);
            start = i;
            cost = 0;
        }
        cost += c_cost;
    }
    if start < text.len() {
        chunks.push(&text[start..]);
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn serialized_len(s: &str) -> usize {
        // Minus the two surrounding quotes serde_json adds.
        serde_json::to_string(s).unwrap().len() - 2
    }

    // --- Utf8Decoder ------------------------------------------------------------

    #[test]
    fn ascii_passes_through_unchanged() {
        let mut d = Utf8Decoder::new();
        assert_eq!(d.push(b"hello world"), "hello world");
        assert_eq!(d.pending(), 0);
    }

    #[test]
    fn a_two_byte_char_split_across_reads_is_reassembled() {
        let mut d = Utf8Decoder::new();
        let bytes = "é".as_bytes(); // 0xC3 0xA9
        assert_eq!(
            d.push(&bytes[..1]),
            "",
            "must hold back the incomplete lead byte"
        );
        assert_eq!(d.pending(), 1);
        assert_eq!(d.push(&bytes[1..]), "é");
        assert_eq!(d.pending(), 0);
    }

    #[test]
    fn a_four_byte_char_split_three_ways_is_reassembled() {
        let mut d = Utf8Decoder::new();
        let bytes = "🚀".as_bytes(); // 4 bytes
        assert_eq!(d.push(&bytes[..1]), "");
        assert_eq!(d.push(&bytes[1..3]), "");
        assert_eq!(d.push(&bytes[3..]), "🚀");
        assert_eq!(d.pending(), 0);
    }

    #[test]
    fn text_around_a_split_char_is_not_delayed() {
        let mut d = Utf8Decoder::new();
        let mut input = b"abc".to_vec();
        input.push("é".as_bytes()[0]);
        // The complete prefix must be emitted immediately; only the partial tail waits.
        assert_eq!(d.push(&input), "abc");
        assert_eq!(d.push(&["é".as_bytes()[1], b'd'][..]), "éd");
    }

    #[test]
    fn invalid_bytes_become_replacement_chars_and_do_not_desync_the_stream() {
        let mut d = Utf8Decoder::new();
        let out = d.push(&[b'a', 0xFF, b'b']);
        assert_eq!(out, "a\u{FFFD}b");
        assert_eq!(d.pending(), 0);
    }

    #[test]
    fn carry_never_exceeds_three_bytes() {
        // A held-back sequence is by definition a valid prefix, so at most 3 bytes.
        let mut d = Utf8Decoder::new();
        for chunk in ["🚀".as_bytes(), "é".as_bytes(), b"plain"] {
            for b in chunk {
                d.push(&[*b]);
                assert!(d.pending() <= 3, "carry grew to {}", d.pending());
            }
        }
    }

    #[test]
    fn finish_flushes_a_dangling_partial_sequence() {
        let mut d = Utf8Decoder::new();
        assert_eq!(d.push(&"🚀".as_bytes()[..2]), "");
        assert_eq!(d.finish(), "\u{FFFD}");
        assert_eq!(d.pending(), 0);
    }

    #[test]
    fn a_stream_split_at_every_byte_boundary_reassembles_exactly() {
        let original = "héllo 🚀 wörld — box: ┌─┐ done";
        let mut d = Utf8Decoder::new();
        let mut out = String::new();
        for b in original.as_bytes() {
            out.push_str(&d.push(&[*b]));
        }
        out.push_str(&d.finish());
        assert_eq!(out, original);
    }

    // --- json_escaped_len -------------------------------------------------------

    #[test]
    fn escaped_length_matches_serde_json_exactly() {
        // The chunker's budget is only correct if this agrees with the real serializer.
        let samples: Vec<char> = ('\u{0}'..='\u{80}')
            .chain(['é', '🚀', '─', '\u{FFFD}'])
            .collect();
        for c in samples {
            let expected = serialized_len(&c.to_string());
            assert_eq!(
                json_escaped_len(c),
                expected,
                "mismatch for {c:?} (U+{:04X})",
                c as u32
            );
        }
    }

    #[test]
    fn escape_is_six_characters() {
        // The whole reason the budget cannot be measured in raw bytes.
        assert_eq!(json_escaped_len('\u{1b}'), 6);
        assert_eq!(json_escaped_len('a'), 1);
    }

    // --- split_for_ipc ----------------------------------------------------------

    #[test]
    fn short_text_is_a_single_chunk() {
        let chunks = split_for_ipc("hello", CHUNK_BUDGET);
        assert_eq!(chunks, vec!["hello"]);
    }

    #[test]
    fn empty_text_yields_no_chunks() {
        assert!(split_for_ipc("", CHUNK_BUDGET).is_empty());
    }

    #[test]
    fn chunks_reassemble_to_the_original() {
        let text = "x".repeat(20_000);
        let chunks = split_for_ipc(&text, CHUNK_BUDGET);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.concat(), text);
    }

    #[test]
    fn every_chunk_stays_within_the_serialized_budget() {
        // Escape-dense input modelled on a TUI redraw: cursor moves and colour codes.
        let unit = "\x1b[2J\x1b[H\x1b[38;5;42mstatus\x1b[0m\r\n";
        let text = unit.repeat(400);
        let chunks = split_for_ipc(&text, CHUNK_BUDGET);
        for c in &chunks {
            assert!(
                serialized_len(c) <= CHUNK_BUDGET,
                "chunk serializes to {} > {CHUNK_BUDGET}",
                serialized_len(c)
            );
        }
        assert_eq!(chunks.concat(), text);
    }

    #[test]
    fn escape_dense_input_is_split_more_finely_than_plain_text() {
        // If this fails, the budget is being measured on raw bytes and the escape
        // expansion would silently push payloads over Tauri's eval threshold.
        let plain = "a".repeat(6000);
        let dense = "\x1b".repeat(6000);
        let plain_chunks = split_for_ipc(&plain, CHUNK_BUDGET).len();
        let dense_chunks = split_for_ipc(&dense, CHUNK_BUDGET).len();
        assert_eq!(plain_chunks, 1, "6000 plain chars fit in one chunk");
        assert!(
            dense_chunks > plain_chunks,
            "6000 ESC bytes serialize to 36000 chars and must split; got {dense_chunks}"
        );
    }

    #[test]
    fn never_splits_a_multibyte_character() {
        // Chunk boundaries land between characters or the &str type would not hold.
        // This asserts the stronger property: reassembly is byte-identical.
        let text = "🚀é─".repeat(3000);
        let chunks = split_for_ipc(&text, 64);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.concat(), text);
        for c in &chunks {
            assert!(!c.is_empty(), "empty chunks waste an IPC round trip");
            assert!(serialized_len(c) <= 64);
        }
    }

    #[test]
    fn a_single_char_over_budget_still_makes_progress() {
        // Degenerate budget: must not loop forever or emit empty chunks.
        let chunks = split_for_ipc("\x1b\x1b", 2);
        assert_eq!(chunks.concat(), "\x1b\x1b");
        assert!(chunks.iter().all(|c| !c.is_empty()));
    }
}
