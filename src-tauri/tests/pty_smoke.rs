//! The load-bearing test for the whole project.
//!
//! wezterm issue #6783 reports portable-pty 0.9.0 returning garbage on Windows, tied to
//! ConPTY's startup `ESC[6n` cursor-position request. If that bites us, everything else
//! is built on sand — so this runs a real `pwsh` through a real ConPTY before any
//! terminal UI exists, and answers the CPR the way xterm.js would.
//!
//! It is deliberately an integration test against the real OS, not a mock. A mocked PTY
//! would prove nothing about the thing that is actually risky.

use std::io::{Read, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use atc_lib::pty::shell::resolve_shell;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

/// Generous on purpose: `wait_for` returns the moment its marker lands, so only a real
/// failure waits this long. See #51.
const TIMEOUT: Duration = Duration::from_secs(120);

/// These tests spawn real shells in parallel and none of them is about startup time, so
/// keep the user's PowerShell profile out of it. Same reasoning as `pty_pipeline.rs`.
fn test_shell() -> atc_lib::pty::shell::ShellInfo {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| std::env::set_var(atc_lib::pty::shell::NO_PROFILE_ENV, "1"));
    resolve_shell(None).expect("a shell must be resolvable on this machine")
}

type SharedWriter = Arc<Mutex<Box<dyn Write + Send>>>;

/// Drains the master side on a thread, answering ConPTY's cursor-position request the
/// way a real terminal emulator does. Returns a receiver of decoded output chunks.
fn spawn_reader(mut reader: Box<dyn Read + Send>, writer: SharedWriter) -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    // Device Status Report -> report cursor position. ConPTY deadlocks
                    // if nobody answers; xterm.js answers this automatically.
                    if chunk.contains("\x1b[6n") {
                        if let Ok(mut w) = writer.lock() {
                            let _ = w.write_all(b"\x1b[1;1R");
                            let _ = w.flush();
                        }
                    }
                    if tx.send(chunk).is_err() {
                        break;
                    }
                }
            }
        }
    });
    rx
}

/// Collects output until `needle` appears. On failure returns everything seen, so a
/// failure message shows what the PTY actually produced.
fn wait_for(
    rx: &mpsc::Receiver<String>,
    needle: &str,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    let mut seen = String::new();
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(chunk) => {
                seen.push_str(&chunk);
                if seen.contains(needle) {
                    return Ok(seen);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    Err(seen)
}

#[test]
fn spawns_a_real_shell_and_round_trips_a_command() {
    let shell = test_shell();

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");

    let mut cmd = CommandBuilder::new(shell.path.as_os_str());
    for a in &shell.args {
        cmd.arg(a);
    }
    cmd.cwd(env!("CARGO_MANIFEST_DIR"));
    cmd.env("TERM", "xterm-256color");

    let mut child = pair.slave.spawn_command(cmd).expect("spawn");
    // Drop the slave so the master sees EOF once the child exits.
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().expect("clone reader");
    // `take_writer` is valid exactly once, ever, so the CPR responder and the test body
    // share this one writer.
    let writer: SharedWriter = Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));
    let rx = spawn_reader(reader, Arc::clone(&writer));

    // Build the marker from two halves so a bare echo of our own input cannot satisfy
    // the assertion -- only the shell actually executing the line can.
    writer
        .lock()
        .unwrap()
        .write_all(b"Write-Output ('ATC' + '-OK')\r\n")
        .expect("write command");
    writer.lock().unwrap().flush().expect("flush");

    if let Err(seen) = wait_for(&rx, "ATC-OK", TIMEOUT) {
        panic!("never saw the marker within {TIMEOUT:?}. output so far:\n{seen}");
    }

    child.kill().expect("kill");
    let status = child.wait().expect("wait");
    println!("child reaped with {status:?}");
}

#[test]
fn resize_is_accepted_on_a_live_pty() {
    let shell = test_shell();

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");

    let mut cmd = CommandBuilder::new(shell.path.as_os_str());
    for a in &shell.args {
        cmd.arg(a);
    }
    let mut child = pair.slave.spawn_command(cmd).expect("spawn");
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().expect("clone reader");
    let writer: SharedWriter = Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));
    let _rx = spawn_reader(reader, writer);

    pair.master
        .resize(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("resize should succeed on a live ConPTY");

    let size = pair.master.get_size().expect("get_size");
    assert_eq!((size.rows, size.cols), (40, 120));

    child.kill().expect("kill");
    child.wait().expect("wait");
}

#[test]
fn output_is_clean_text_not_garbage() {
    // Direct check on wezterm #6783: 0.9.0 was reported returning garbage on Windows.
    // The sentence is concatenated by the shell, so the full string can only appear as
    // executed output -- never as an echo of what we typed.
    let shell = test_shell();
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 200,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");

    let mut cmd = CommandBuilder::new(shell.path.as_os_str());
    for a in &shell.args {
        cmd.arg(a);
    }
    cmd.env("TERM", "xterm-256color");
    let mut child = pair.slave.spawn_command(cmd).expect("spawn");
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().expect("clone reader");
    let writer: SharedWriter = Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));
    let rx = spawn_reader(reader, Arc::clone(&writer));

    let head = "the quick brown fox jumps over the lazy dog";
    let tail = "0123456789 xyz";
    let whole = format!("{head} {tail}");
    {
        let mut w = writer.lock().unwrap();
        w.write_all(format!("Write-Output ('{head} ' + '{tail}')\r\n").as_bytes())
            .unwrap();
        w.flush().unwrap();
    }

    let seen = wait_for(&rx, &whole, TIMEOUT)
        .unwrap_or_else(|s| panic!("sentence never round-tripped intact. saw:\n{s}"));

    // Lossy UTF-8 decoding substitutes U+FFFD; any here means bytes were mangled.
    assert!(
        !seen.contains('\u{FFFD}'),
        "output contains replacement characters, i.e. corrupted bytes"
    );

    child.kill().expect("kill");
    child.wait().expect("wait");
}
