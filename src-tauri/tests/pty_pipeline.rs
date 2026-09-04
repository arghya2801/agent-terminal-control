//! End-to-end test of the real PTY pipeline: registry -> ConPTY -> reader thread ->
//! pump thread -> `tauri::ipc::Channel`.
//!
//! `Channel::new` takes a plain callback, so the production path can be exercised
//! headlessly with no window. Nothing here is mocked except the far side of the IPC.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use atc_lib::pty::registry::PtyRegistry;
use atc_lib::pty::session::{PtyEvent, SpawnOpts};
use tauri::ipc::Channel;

const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default)]
struct Collected {
    text: Mutex<String>,
    exited: AtomicBool,
    exit_code: Mutex<Option<u32>>,
    sends: AtomicU64,
    max_payload: AtomicU64,
}

/// Builds a Channel that decodes what the frontend would actually receive, so the test
/// asserts on the serialized wire format rather than on internal Rust values.
fn collecting_channel() -> (Channel<PtyEvent>, Arc<Collected>) {
    let sink = Arc::new(Collected::default());
    let s = Arc::clone(&sink);
    let ch = Channel::new(move |body: tauri::ipc::InvokeResponseBody| {
        let json = match &body {
            tauri::ipc::InvokeResponseBody::Json(j) => j.clone(),
            tauri::ipc::InvokeResponseBody::Raw(r) => String::from_utf8_lossy(r).into_owned(),
        };
        s.sends.fetch_add(1, Ordering::Relaxed);
        s.max_payload
            .fetch_max(json.len() as u64, Ordering::Relaxed);

        let v: serde_json::Value = serde_json::from_str(&json).expect("channel payload is json");
        match v["t"].as_str() {
            Some("o") => {
                s.text
                    .lock()
                    .unwrap()
                    .push_str(v["d"].as_str().unwrap_or_default());
            }
            Some("x") => {
                *s.exit_code.lock().unwrap() = v["code"].as_u64().map(|c| c as u32);
                s.exited.store(true, Ordering::Relaxed);
            }
            _ => {}
        }
        Ok(())
    });
    (ch, sink)
}

fn wait_until<F: Fn() -> bool>(cond: F, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if cond() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

fn opts(initial: Option<&str>) -> SpawnOpts {
    SpawnOpts {
        cwd: Some(env!("CARGO_MANIFEST_DIR").to_string()),
        cols: 120,
        rows: 30,
        shell: None,
        args: None,
        initial_command: initial.map(str::to_string),
    }
}

#[test]
fn output_reaches_the_channel_as_decoded_text() {
    let reg = PtyRegistry::new();
    let (ch, sink) = collecting_channel();

    let id = reg.spawn(opts(None), ch).expect("spawn");
    reg.write(&id, "Write-Output ('PIPE' + '-OK')\r\n")
        .expect("write");

    let seen = wait_until(|| sink.text.lock().unwrap().contains("PIPE-OK"), TIMEOUT);
    assert!(
        seen,
        "marker never arrived. got:\n{}",
        sink.text.lock().unwrap()
    );

    reg.kill(&id).expect("kill");
}

#[test]
fn an_initial_command_is_typed_into_the_shell() {
    // This is exactly how a session tab runs `claude --resume <uuid>`.
    let reg = PtyRegistry::new();
    let (ch, sink) = collecting_channel();

    let id = reg
        .spawn(opts(Some("Write-Output ('INIT' + '-RAN')")), ch)
        .expect("spawn");

    let seen = wait_until(|| sink.text.lock().unwrap().contains("INIT-RAN"), TIMEOUT);
    assert!(
        seen,
        "initial command never ran. got:\n{}",
        sink.text.lock().unwrap()
    );

    reg.kill(&id).expect("kill");
}

#[test]
fn the_cwd_is_honoured() {
    let reg = PtyRegistry::new();
    let (ch, sink) = collecting_channel();

    let id = reg.spawn(opts(None), ch).expect("spawn");
    reg.write(&id, "(Get-Location).Path\r\n").expect("write");

    // The shell must actually start in src-tauri, not wherever the test runner sits.
    let seen = wait_until(|| sink.text.lock().unwrap().contains("src-tauri"), TIMEOUT);
    assert!(seen, "cwd not applied. got:\n{}", sink.text.lock().unwrap());

    reg.kill(&id).expect("kill");
}

#[test]
fn bulk_output_is_coalesced_rather_than_sent_per_read() {
    // The pump's whole reason for existing. Without tick-coalescing this would be one
    // send per ConPTY read, flooding the Tauri main thread.
    let reg = PtyRegistry::new();
    let (ch, sink) = collecting_channel();

    let id = reg.spawn(opts(None), ch).expect("spawn");
    reg.write(
        &id,
        "1..2000 | ForEach-Object { \"line $_ of bulk output\" }\r\n",
    )
    .expect("write");

    let done = wait_until(
        || {
            sink.text
                .lock()
                .unwrap()
                .contains("line 2000 of bulk output")
        },
        TIMEOUT,
    );
    assert!(done, "bulk output never completed");

    let text_len = sink.text.lock().unwrap().len();
    let sends = sink.sends.load(Ordering::Relaxed);
    assert!(text_len > 40_000, "expected bulky output, got {text_len}");

    // The pump emits at most once per 8ms tick, so send count is bounded by how long
    // the output took to produce -- not by how many reads ConPTY served. ConPTY flushes
    // per screen update, so a send-per-read implementation would approach one send per
    // line. Far fewer sends than lines is the property that matters.
    assert!(
        sends < 500,
        "{sends} sends for 2000 lines / {text_len} bytes suggests no coalescing"
    );
    let avg = text_len as u64 / sends.max(1);
    assert!(
        avg > 200,
        "average payload {avg} bytes is too small to be coalesced"
    );

    reg.kill(&id).expect("kill");
}

#[test]
fn no_payload_is_wildly_over_the_single_eval_threshold() {
    // Chunking must keep individual payloads near Tauri's 8192-byte fast path. A large
    // burst may exceed it, but never by orders of magnitude.
    let reg = PtyRegistry::new();
    let (ch, sink) = collecting_channel();

    let id = reg.spawn(opts(None), ch).expect("spawn");
    reg.write(&id, "1..3000 | ForEach-Object { \"chunk test $_\" }\r\n")
        .expect("write");

    let done = wait_until(
        || sink.text.lock().unwrap().contains("chunk test 3000"),
        TIMEOUT,
    );
    assert!(done, "output never completed");

    let max = sink.max_payload.load(Ordering::Relaxed);
    assert!(
        max <= 9000,
        "largest channel payload was {max} bytes; chunking is not holding the budget"
    );

    reg.kill(&id).expect("kill");
}

#[test]
fn exit_is_reported_after_the_output_that_preceded_it() {
    let reg = PtyRegistry::new();
    let (ch, sink) = collecting_channel();

    let id = reg.spawn(opts(None), ch).expect("spawn");
    reg.write(&id, "Write-Output ('BYE' + '-NOW'); exit 7\r\n")
        .expect("write");

    let exited = wait_until(|| sink.exited.load(Ordering::Relaxed), TIMEOUT);
    assert!(exited, "never saw an Exit event");

    // Ordering guarantee: the text that preceded exit must already be present.
    assert!(
        sink.text.lock().unwrap().contains("BYE-NOW"),
        "Exit arrived before the output that preceded it"
    );
    assert_eq!(*sink.exit_code.lock().unwrap(), Some(7));
}

#[test]
fn killing_a_session_removes_it_and_stops_the_stream() {
    let reg = PtyRegistry::new();
    let (ch, _sink) = collecting_channel();

    let id = reg.spawn(opts(None), ch).expect("spawn");
    assert_eq!(reg.ids(), vec![id.clone()]);

    reg.kill(&id).expect("kill");
    assert!(reg.ids().is_empty());
    // Writing to a killed pty is an error, not a panic.
    assert!(reg.write(&id, "x").is_err());
}

#[test]
fn resize_reaches_a_live_session() {
    let reg = PtyRegistry::new();
    let (ch, _sink) = collecting_channel();
    let id = reg.spawn(opts(None), ch).expect("spawn");

    reg.resize(&id, 200, 50).expect("resize");

    reg.kill(&id).expect("kill");
}

#[test]
fn kill_all_tears_down_every_session() {
    // Runs on app exit; leaving a session behind means an orphaned claude process.
    let reg = PtyRegistry::new();
    for _ in 0..3 {
        let (ch, _s) = collecting_channel();
        reg.spawn(opts(None), ch).expect("spawn");
    }
    assert_eq!(reg.ids().len(), 3);

    let started = Instant::now();
    reg.kill_all();
    assert!(reg.ids().is_empty());
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "kill_all must not block shutdown"
    );
}

#[test]
fn stats_track_what_the_debug_overlay_reports() {
    let reg = PtyRegistry::new();
    let (ch, sink) = collecting_channel();
    let id = reg.spawn(opts(None), ch).expect("spawn");

    reg.write(&id, "Write-Output ('STAT' + '-OK')\r\n").unwrap();
    assert!(wait_until(
        || sink.text.lock().unwrap().contains("STAT-OK"),
        TIMEOUT
    ));

    let stats = reg.stats(&id).expect("stats");
    assert!(stats.sends > 0, "sends not counted");
    assert!(stats.bytes_out > 0, "bytes not counted");

    // Acking more than is outstanding must saturate at zero, not underflow.
    reg.ack(&id, u64::MAX).expect("ack");
    assert_eq!(reg.stats(&id).unwrap().inflight, 0);

    reg.kill(&id).expect("kill");
}
