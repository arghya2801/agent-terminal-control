//! One live PTY: spawn, stream, resize, tear down.
//!
//! ```text
//! [reader] blocking read() --mpsc--> [pump] --Channel::send--> webview
//!                                      ^ 8ms tick
//! ```
//!
//! The split matters: `Channel::send` bottoms out in `webview.eval()` on the Tauri main
//! thread, so sending straight from the reader would let a TUI redraw storm stall window
//! input. The pump coalesces a tick's worth of reads into one send.
//!
//! `Channel::send` is fire-and-forget, so the frontend acks bytes once xterm has parsed
//! them. Above `INFLIGHT_HIGH` the reader stops draining ConPTY, pushing back on the
//! child through the OS pipe. Bytes are never dropped: half an ANSI sequence corrupts
//! the screen permanently.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use super::pump::{split_for_ipc, Utf8Decoder, CHUNK_BUDGET};
use super::shell::{resolve_shell, ShellError};

/// How long the pump waits to gather more output before sending. ~120fps.
const TICK: Duration = Duration::from_millis(8);
/// Stop draining ConPTY above this many unacked bytes.
const INFLIGHT_HIGH: usize = 2 * 1024 * 1024;
/// Resume draining once the backlog falls back under this.
const INFLIGHT_LOW: usize = 256 * 1024;
/// Give the shell a moment to finish starting before typing into it. PSReadLine can
/// swallow input that arrives before it has taken over the console.
const INITIAL_COMMAND_DELAY: Duration = Duration::from_millis(400);
/// How long to let the terminal answer ConPTY's cursor-position request before
/// answering it ourselves. See `arm_cpr_watchdog`.
const CPR_GRACE: Duration = Duration::from_millis(1200);
/// After the child exits, keep draining briefly so output already in the OS pipe is
/// delivered before the Exit event.
const EXIT_DRAIN_GRACE: Duration = Duration::from_millis(200);

/// ConPTY's startup Device Status Report: "where is the cursor?".
const CPR_REQUEST: &str = "\x1b[6n";
/// The reply a terminal sends: cursor at row 1, column 1.
const CPR_REPLY: &[u8] = b"\x1b[1;1R";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnOpts {
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Typed into the shell after it starts, e.g. `claude --resume <uuid>`. Sent as
    /// input rather than argv so the user is left in an interactive shell afterwards.
    pub initial_command: Option<String>,
}

/// Output and lifecycle share one ordered stream, so "exited" can never be rendered
/// before the last line of output that preceded it.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t")]
pub enum PtyEvent {
    #[serde(rename = "o")]
    Output { d: String },
    #[serde(rename = "x")]
    Exit { code: Option<u32> },
    #[serde(rename = "e")]
    Error { msg: String },
}

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error(transparent)]
    Shell(#[from] ShellError),
    #[error("pty error: {0}")]
    Pty(String),
    #[error("no such pty: {0}")]
    NotFound(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Counters behind the Ctrl+Shift+D overlay, so the claims above can be measured.
#[derive(Debug, Default)]
pub struct PtyStats {
    pub bytes_out: AtomicU64,
    pub sends: AtomicU64,
    /// Sends that cleared Tauri's single-eval threshold.
    pub sends_over_threshold: AtomicU64,
    pub inflight: AtomicUsize,
    pub paused_count: AtomicU64,
}

impl PtyStats {
    pub fn snapshot(&self) -> StatsSnapshot {
        StatsSnapshot {
            bytes_out: self.bytes_out.load(Ordering::Relaxed),
            sends: self.sends.load(Ordering::Relaxed),
            sends_over_threshold: self.sends_over_threshold.load(Ordering::Relaxed),
            inflight: self.inflight.load(Ordering::Relaxed),
            paused_count: self.paused_count.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSnapshot {
    pub bytes_out: u64,
    pub sends: u64,
    pub sends_over_threshold: u64,
    pub inflight: usize,
    pub paused_count: u64,
}

/// Reader-thread pause switch. `true` means "stop draining ConPTY".
type Gate = Arc<(Mutex<bool>, Condvar)>;

/// What the pump consumes. Child exit travels the same queue as output so it cannot
/// overtake bytes that were read before it.
enum PumpMsg {
    Data(Vec<u8>),
    Exited(Option<u32>),
}

pub struct PtySession {
    pub id: String,
    // `dyn MasterPty` is Send but not Sync, and Tauri's managed State demands Sync.
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    gate: Gate,
    pub stats: Arc<PtyStats>,
}

impl PtySession {
    pub fn spawn(id: String, opts: SpawnOpts, ch: Channel<PtyEvent>) -> Result<Self, PtyError> {
        let shell = resolve_shell(None)?;

        let pty = native_pty_system()
            .openpty(PtySize {
                rows: opts.rows.max(1),
                cols: opts.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::Pty(e.to_string()))?;

        let mut cmd = CommandBuilder::new(shell.path.as_os_str());
        for a in &shell.args {
            cmd.arg(a);
        }
        if let Some(cwd) = opts.cwd.as_deref().filter(|c| !c.is_empty()) {
            // Only set a cwd that exists; ConPTY fails opaquely otherwise, and a stale
            // path from an old session is a normal thing to encounter.
            let p = std::path::Path::new(cwd);
            if p.is_dir() {
                cmd.cwd(dunce::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()));
            }
        }
        cmd.env("TERM", "xterm-256color");

        let child = pty
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::Pty(e.to_string()))?;
        // Drop the slave so the master reader sees EOF when the child exits.
        drop(pty.slave);

        let killer = child.clone_killer();
        let reader = pty
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::Pty(e.to_string()))?;
        // Valid exactly once, ever.
        let writer = pty
            .master
            .take_writer()
            .map_err(|e| PtyError::Pty(e.to_string()))?;

        let stats = Arc::new(PtyStats::default());
        let gate: Gate = Arc::new((Mutex::new(false), Condvar::new()));
        let writer = Arc::new(Mutex::new(writer));
        let (tx, rx) = mpsc::channel::<PumpMsg>();

        spawn_reader_thread(reader, tx.clone(), Arc::clone(&gate), Arc::clone(&stats));
        spawn_waiter_thread(child, tx);
        spawn_pump_thread(rx, ch, Arc::clone(&stats), Arc::clone(&writer));

        let session = PtySession {
            id,
            master: Mutex::new(pty.master),
            writer,
            killer: Mutex::new(killer),
            gate,
            stats,
        };

        if let Some(cmd) = opts.initial_command.filter(|c| !c.trim().is_empty()) {
            session.write_delayed(format!("{cmd}\r"), INITIAL_COMMAND_DELAY);
        }

        Ok(session)
    }

    pub fn write(&self, data: &str) -> Result<(), PtyError> {
        let mut w = self.writer.lock().expect("writer mutex");
        w.write_all(data.as_bytes())?;
        w.flush()?;
        Ok(())
    }

    /// Type into the shell after a delay, without blocking the caller.
    fn write_delayed(&self, data: String, delay: Duration) {
        let w = Arc::clone(&self.writer);
        thread::spawn(move || {
            thread::sleep(delay);
            if let Ok(mut w) = w.lock() {
                let _ = w.write_all(data.as_bytes());
                let _ = w.flush();
            }
        });
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
        self.master
            .lock()
            .expect("master mutex")
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::Pty(e.to_string()))
    }

    /// The frontend confirming xterm.js has parsed `bytes`, releasing backpressure.
    pub fn ack(&self, bytes: u64) {
        let before = self.stats.inflight.load(Ordering::Relaxed);
        let after = before.saturating_sub(bytes as usize);
        self.stats.inflight.store(after, Ordering::Relaxed);
        if after <= INFLIGHT_LOW {
            let (lock, cv) = &*self.gate;
            if let Ok(mut paused) = lock.lock() {
                if *paused {
                    *paused = false;
                    cv.notify_all();
                }
            }
        }
    }

    pub fn kill(&self) {
        if let Ok(mut k) = self.killer.lock() {
            let _ = k.kill();
        }
        // Release any paused reader so its thread can observe EOF and exit.
        let (lock, cv) = &*self.gate;
        if let Ok(mut paused) = lock.lock() {
            *paused = false;
            cv.notify_all();
        }
    }
}

/// Blocks on the child and reports its exit through the pump queue.
///
/// We cannot rely on the reader hitting EOF: we hold the master handle open for the
/// life of the session, so on Windows `read()` keeps blocking after the child is gone.
/// Waiting on the child directly is the only reliable exit signal.
fn spawn_waiter_thread(
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    tx: mpsc::Sender<PumpMsg>,
) {
    thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        let _ = tx.send(PumpMsg::Exited(code));
    });
}

fn spawn_reader_thread(
    mut reader: Box<dyn Read + Send>,
    tx: mpsc::Sender<PumpMsg>,
    gate: Gate,
    stats: Arc<PtyStats>,
) {
    thread::spawn(move || {
        let mut buf = [0u8; 64 * 1024];
        loop {
            {
                let (lock, cv) = &*gate;
                let mut paused = lock.lock().expect("gate mutex");
                while *paused {
                    paused = cv.wait(paused).expect("gate condvar");
                }
            }

            match reader.read(&mut buf) {
                // EOF: ConPTY closed because the child exited.
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let inflight = stats.inflight.fetch_add(n, Ordering::Relaxed) + n;
                    if tx.send(PumpMsg::Data(buf[..n].to_vec())).is_err() {
                        break;
                    }
                    if inflight >= INFLIGHT_HIGH {
                        let (lock, cv) = &*gate;
                        if let Ok(mut paused) = lock.lock() {
                            if !*paused {
                                *paused = true;
                                stats.paused_count.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                        let _ = cv;
                    }
                }
            }
        }
    });
}

fn spawn_pump_thread(
    rx: mpsc::Receiver<PumpMsg>,
    ch: Channel<PtyEvent>,
    stats: Arc<PtyStats>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
) {
    thread::spawn(move || {
        let mut decoder = Utf8Decoder::new();
        let mut acc: Vec<u8> = Vec::with_capacity(64 * 1024);
        let mut cpr_armed = false;
        let mut exit_code = None;
        let mut exiting = false;

        loop {
            // Block for the first message, then gather whatever else lands within a
            // tick. Once the child has exited we only wait out a short drain window, so
            // a reader still blocked on the master handle cannot stall the Exit event.
            let first = if exiting {
                match rx.recv_timeout(EXIT_DRAIN_GRACE) {
                    Ok(m) => m,
                    Err(_) => break,
                }
            } else {
                match rx.recv() {
                    Ok(m) => m,
                    Err(_) => break,
                }
            };

            let mut batch = vec![first];
            thread::sleep(TICK);
            while let Ok(m) = rx.try_recv() {
                batch.push(m);
            }
            for m in batch {
                match m {
                    PumpMsg::Data(b) => acc.extend_from_slice(&b),
                    PumpMsg::Exited(code) => {
                        exit_code = code;
                        exiting = true;
                    }
                }
            }

            let text = decoder.push(&acc);
            acc.clear();
            if text.is_empty() {
                continue;
            }
            if !cpr_armed && text.contains(CPR_REQUEST) {
                cpr_armed = true;
                arm_cpr_watchdog(Arc::clone(&writer), Arc::clone(&stats));
            }
            send_text(&ch, &text, &stats);
        }

        let tail = decoder.finish();
        if !tail.is_empty() {
            send_text(&ch, &tail, &stats);
        }
        let _ = ch.send(PtyEvent::Exit { code: exit_code });
    });
}

/// ConPTY asks for the cursor position at startup and deadlocks until something answers,
/// emitting nothing further. xterm.js normally answers, which is why `term.onData` must
/// be wired before `pty_spawn`; this is the safety net when it does not.
///
/// Gates on "no new output" rather than "no input written": a session that types an
/// initial command would otherwise look like it had answered and stay wedged.
fn arm_cpr_watchdog(writer: Arc<Mutex<Box<dyn Write + Send>>>, stats: Arc<PtyStats>) {
    thread::spawn(move || {
        let before = stats.bytes_out.load(Ordering::Relaxed);
        thread::sleep(CPR_GRACE);
        if stats.bytes_out.load(Ordering::Relaxed) != before {
            return; // the terminal answered; the shell is producing output again
        }
        if let Ok(mut w) = writer.lock() {
            let _ = w.write_all(CPR_REPLY);
            let _ = w.flush();
        }
    });
}

fn send_text(ch: &Channel<PtyEvent>, text: &str, stats: &PtyStats) {
    for slice in split_for_ipc(text, CHUNK_BUDGET) {
        stats
            .bytes_out
            .fetch_add(slice.len() as u64, Ordering::Relaxed);
        stats.sends.fetch_add(1, Ordering::Relaxed);
        if slice.len() >= super::pump::MAX_JSON_DIRECT_EXECUTE {
            stats.sends_over_threshold.fetch_add(1, Ordering::Relaxed);
        }
        if ch
            .send(PtyEvent::Output {
                d: slice.to_string(),
            })
            .is_err()
        {
            break;
        }
    }
}
