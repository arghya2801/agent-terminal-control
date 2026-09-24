//! Short-lived app-server connection. No auth files or access tokens enter ATC.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct Client {
    request: Mutex<()>,
    child: Mutex<Option<Child>>,
}

impl Client {
    fn child(&self) -> std::sync::MutexGuard<'_, Option<Child>> {
        self.child.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn stop(&self) {
        if let Some(mut child) = self.child().take() {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                // npm's codex.cmd owns a child executable. Stop the whole owned tree.
                let _ = Command::new("taskkill.exe")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .creation_flags(0x08000000)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// `None` when the Codex CLI is not installed, so the UI can leave Codex out.
    pub fn read(&self, settings: &crate::settings::Settings) -> Result<Option<Value>, String> {
        let _request = self.request.lock().unwrap_or_else(|e| e.into_inner());
        let exe = &settings.codex.command;
        let Ok(resolved) = crate::pty::shell::resolve_shell(Some(exe)) else {
            return Ok(None);
        };
        let mut command = Command::new(resolved.path);
        command
            .arg("app-server")
            .env("CODEX_HOME", settings.codex_home())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut slot = self.child();
        let mut child = command
            .spawn()
            .map_err(|e| format!("Codex `{exe}` app-server unavailable: {e}"))?;
        let Some(stdout) = child.stdout.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Codex stdout unavailable".into());
        };
        let Some(mut stdin) = child.stdin.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Codex stdin unavailable".into());
        };
        *slot = Some(child);
        drop(slot);
        let (tx, rx) = mpsc::sync_channel(64);
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    if tx.send(v).is_err() {
                        break;
                    }
                }
            }
        });
        let result = (|| {
            writeln!(stdin, "{}", json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"atc","title":"ATC","version":env!("CARGO_PKG_VERSION")}}})).map_err(|e| e.to_string())?;
            stdin.flush().map_err(|e| e.to_string())?;
            response(&rx, 1, Duration::from_secs(15))?;
            writeln!(stdin, "{}", json!({"method":"initialized"})).map_err(|e| e.to_string())?;
            writeln!(
                stdin,
                "{}",
                json!({"id":2,"method":"account/rateLimits/read"})
            )
            .map_err(|e| e.to_string())?;
            stdin.flush().map_err(|e| e.to_string())?;
            response(&rx, 2, Duration::from_secs(15))
        })();
        drop(stdin);
        drop(rx);
        self.stop();
        let _ = reader.join();
        result.map(Some)
    }
}

fn response(rx: &mpsc::Receiver<Value>, id: u64, timeout: Duration) -> Result<Value, String> {
    let deadline = Instant::now() + timeout;
    loop {
        let message = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|e| format!("Codex app-server response unavailable: {e}"))?;
        if message["id"].as_u64() != Some(id) {
            continue;
        }
        if let Some(error) = message.get("error") {
            return Err(format!(
                "Codex rate limits unavailable: {}",
                error["message"]
                    .as_str()
                    .unwrap_or("unsupported API or account unavailable")
            ));
        }
        return message
            .get("result")
            .cloned()
            .ok_or_else(|| "Codex app-server returned no result".into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires ATC_TEST_CODEX pointing to the installed CLI"]
    fn installed_codex_handles_an_isolated_signed_out_account_and_cleans_up() {
        let home = tempfile::tempdir().unwrap();
        let mut settings = crate::settings::Settings::default();
        settings.codex.command = std::env::var("ATC_TEST_CODEX").expect("CLI path");
        settings.codex.home_dir = Some(home.path().to_string_lossy().into_owned());
        let client = Client::default();
        let result = client.read(&settings);
        assert!(client.child.lock().unwrap().is_none());
        match result {
            Ok(None) => panic!("ATC_TEST_CODEX was not found"),
            Ok(Some(v)) => assert!(v["rateLimits"].is_null(), "unexpected authenticated data"),
            Err(e) => assert!(e.contains("Codex rate limits unavailable"), "{e}"),
        }
    }
    #[test]
    fn ignores_notifications_and_reports_errors_timeouts_and_empty_accounts() {
        let (tx, rx) = mpsc::channel();
        tx.send(json!({"method":"account/updated"})).unwrap();
        tx.send(json!({"id":2,"result":{"rateLimits":null}}))
            .unwrap();
        assert_eq!(
            response(&rx, 2, Duration::from_millis(10)).unwrap(),
            json!({"rateLimits":null})
        );
        tx.send(json!({"id":3,"error":{"code":-32601,"message":"unsupported API"}}))
            .unwrap();
        assert!(response(&rx, 3, Duration::from_millis(10))
            .unwrap_err()
            .contains("unsupported API"));
        tx.send(json!({"id":4,"error":{"message":"not signed in"}}))
            .unwrap();
        assert!(response(&rx, 4, Duration::from_millis(10))
            .unwrap_err()
            .contains("not signed in"));
        assert!(response(&rx, 5, Duration::from_millis(1)).is_err());
    }
    #[test]
    fn missing_cli_does_not_start_a_process() {
        let mut settings = crate::settings::Settings::default();
        settings.codex.command = "atc-nonexistent-codex-123.exe".into();
        let client = Client::default();
        assert_eq!(client.read(&settings), Ok(None));
        assert!(client.child.lock().unwrap().is_none());
    }
}
