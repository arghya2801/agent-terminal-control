//! The whole IPC surface, as thin delegation. Keeping it in one file makes what the
//! frontend can reach auditable at a glance.

use tauri::ipc::Channel;
use tauri::State;

use crate::error::AppResult;
use crate::index::cost::CostRow;
use crate::index::IndexSnapshot;
use crate::pty::session::{PtyEvent, SpawnOpts, StatsSnapshot};
use crate::settings::Settings;
use crate::state::AppState;

// --- pty -------------------------------------------------------------------

#[tauri::command]
pub fn pty_spawn(
    opts: SpawnOpts,
    on_event: Channel<PtyEvent>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    Ok(state.ptys.spawn(opts, on_event)?)
}

#[tauri::command]
pub fn pty_write(id: String, data: String, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.ptys.write(&id, &data)?)
}

#[tauri::command]
pub fn pty_resize(id: String, cols: u16, rows: u16, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.ptys.resize(&id, cols, rows)?)
}

#[tauri::command]
pub fn pty_ack(id: String, bytes: u64, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.ptys.ack(&id, bytes)?)
}

#[tauri::command]
pub fn pty_kill(id: String, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.ptys.kill(&id)?)
}

#[tauri::command]
pub fn pty_stats(id: String, state: State<'_, AppState>) -> AppResult<StatsSnapshot> {
    Ok(state.ptys.stats(&id)?)
}

// --- index -----------------------------------------------------------------

#[tauri::command]
pub fn index_snapshot(state: State<'_, AppState>) -> AppResult<IndexSnapshot> {
    Ok(state.index.scan(&state.settings.get(), false))
}

#[tauri::command]
pub fn index_refresh(force: bool, state: State<'_, AppState>) -> AppResult<IndexSnapshot> {
    // An explicit refresh should always report, even if nothing changed.
    state.index.invalidate();
    Ok(state.index.scan(&state.settings.get(), force))
}

// --- settings --------------------------------------------------------------

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> AppResult<Settings> {
    Ok(state.settings.get())
}

#[tauri::command]
pub fn settings_set(settings: Settings, app: tauri::AppHandle) -> AppResult<()> {
    crate::settings::save(&settings).map_err(crate::error::AppError::Io)?;
    crate::apply_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn tasks_get(state: State<'_, AppState>) -> AppResult<Vec<crate::settings::Task>> {
    Ok(state.tasks.get())
}

#[tauri::command]
pub fn tasks_set(tasks: Vec<crate::settings::Task>, state: State<'_, AppState>) -> AppResult<()> {
    crate::settings::save_to(&crate::settings::tasks::tasks_path(), &tasks)
        .map_err(crate::error::AppError::Io)?;
    state.tasks.set(tasks);
    Ok(())
}

// --- usage ---------------------------------------------------------------

/// Token use and list-price cost across every transcript. Slow on first call (reads
/// every file), cached per file after that, so it runs off the main thread.
#[tauri::command]
pub async fn usage_costs(app: tauri::AppHandle) -> AppResult<Vec<CostRow>> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        let settings = state.settings.get();
        let mut rows = state.costs.rows(&settings.claude_projects_dir());
        rows.extend(state.codex_costs.rows(&settings.codex_home()));
        rows
    })
    .await
    .map_err(|e| crate::error::AppError::Message(e.to_string()))
}

/// Plan limits, as Claude Code's `/usage` shows them. Uses the OAuth token Claude Code
/// stores; the token never crosses to the frontend.
#[tauri::command]
pub async fn claude_usage() -> AppResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(fetch_claude_usage)
        .await
        .map_err(|e| crate::error::AppError::Message(e.to_string()))?
}

fn fetch_claude_usage() -> AppResult<serde_json::Value> {
    use crate::error::AppError::Message;
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| Message("no home directory".into()))?;
    let creds_path = std::path::Path::new(&home)
        .join(".claude")
        .join(".credentials.json");
    let text = std::fs::read_to_string(&creds_path)
        .map_err(|_| Message("not signed in: run `claude` and log in first".into()))?;
    let creds: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| Message(format!("credentials unreadable: {e}")))?;
    let oauth = &creds["claudeAiOauth"];
    let token = oauth["accessToken"]
        .as_str()
        .ok_or_else(|| Message("no Claude subscription login found".into()))?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if oauth["expiresAt"].as_u64().is_some_and(|exp| exp <= now_ms) {
        return Err(Message(
            "login token expired: run `claude` once to refresh it".into(),
        ));
    }

    let tls = ureq::tls::TlsConfig::builder()
        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
        .build();
    let agent = ureq::Agent::new_with_config(ureq::Agent::config_builder().tls_config(tls).build());
    let mut resp = agent
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", &format!("Bearer {token}"))
        .header("anthropic-beta", "oauth-2025-04-20")
        .call()
        .map_err(|e| Message(format!("usage request failed: {e}")))?;
    let mut body: serde_json::Value = resp
        .body_mut()
        .read_json()
        .map_err(|e| Message(format!("usage response unreadable: {e}")))?;
    if let Some(obj) = body.as_object_mut() {
        obj.insert("subscriptionType".into(), oauth["subscriptionType"].clone());
    }
    Ok(body)
}

// --- misc ------------------------------------------------------------------

/// Devtools, re-added under our own chord after WebView2's F12 was turned off.
/// Debug builds only: release has no path to it at all.
#[tauri::command]
pub fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = window;
}

/// Open `settings.json` with the default handler, writing defaults first if it is
/// missing so the button is never a dead end.
#[tauri::command]
pub fn open_settings_file(state: State<'_, AppState>) -> AppResult<()> {
    let path = crate::settings::settings_path();
    if !path.exists() {
        crate::settings::save(&state.settings.get()).map_err(crate::error::AppError::Io)?;
    }
    // `explorer <file>` opens with the default handler and involves no shell; `cmd /C
    // start` would interpret metacharacters in the path.
    open_with_shell_handler(&path)
}

/// ShellExecuteW rather than `explorer <path>`: explorer splits its command line on
/// commas, so a link like `https://maps/@51.5,-0.12,14z` opened the wrong thing (#92).
#[cfg(windows)]
fn open_with_shell_handler(path: &std::path::Path) -> AppResult<()> {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let target = HSTRING::from(path.as_os_str());
    let code = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            &target,
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // Documented: anything above 32 is success.
    if code.0 as isize > 32 {
        Ok(())
    } else {
        Err(crate::error::AppError::Message(format!(
            "could not open {} (shell error {})",
            path.display(),
            code.0 as isize
        )))
    }
}

#[cfg(not(windows))]
fn open_with_shell_handler(path: &std::path::Path) -> AppResult<()> {
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(crate::error::AppError::Io)?;
    Ok(())
}

/// The directory "Ask Claude" runs in, created on first use so the shell can start there.
#[tauri::command]
pub fn scratch_dir(state: State<'_, AppState>) -> AppResult<String> {
    let dir = state.settings.get().scratch_dir();
    std::fs::create_dir_all(&dir).map_err(crate::error::AppError::Io)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// A theme file found in the config directory's `themes/` folder.
#[derive(serde::Serialize)]
pub struct UserTheme {
    /// File name without the extension, used as the theme's name when the file omits one.
    pub stem: String,
    /// The file's contents, parsed only as far as "it is JSON". The frontend owns the
    /// palette shape, and a file this does not understand must not break the list.
    pub palette: serde_json::Value,
}

/// Themes the user dropped in `<config dir>/themes`. A missing folder is not an error:
/// it is the normal case, and the app ships presets of its own.
#[tauri::command]
pub fn list_themes() -> AppResult<Vec<UserTheme>> {
    Ok(read_theme_dir(
        &crate::settings::config_dir().join("themes"),
    ))
}

fn read_theme_dir(dir: &std::path::Path) -> Vec<UserTheme> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("json"))
        {
            continue;
        }
        // One unreadable or malformed file skips itself rather than hiding the rest.
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(palette) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        out.push(UserTheme {
            stem: path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
            palette,
        });
    }
    // Sorted so the settings list does not reshuffle between launches: directory order is
    // not guaranteed.
    out.sort_by(|a, b| a.stem.cmp(&b.stem));
    out
}

#[cfg(test)]
mod tests {
    use super::read_theme_dir;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().expect("temp dir")
    }

    #[test]
    fn a_missing_themes_folder_is_empty_not_an_error() {
        let d = tmp();
        assert!(read_theme_dir(&d.path().join("themes")).is_empty());
    }

    #[test]
    fn reads_json_files_and_skips_everything_else() {
        let d = tmp();
        // Note the extra hashes: the hex colour contains `"#`, which would end a
        // single-hash raw string.
        std::fs::write(d.path().join("nord.json"), r##"{"background":"#2e3440"}"##).unwrap();
        std::fs::write(d.path().join("notes.txt"), "not a theme").unwrap();
        std::fs::create_dir(d.path().join("sub")).unwrap();

        let themes = read_theme_dir(d.path());

        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].stem, "nord");
        assert_eq!(themes[0].palette["background"], "#2e3440");
    }

    #[test]
    fn one_malformed_file_does_not_hide_the_others() {
        // A typo in a hand-written theme must cost that theme, not the whole list.
        let d = tmp();
        std::fs::write(d.path().join("broken.json"), "{ not json").unwrap();
        std::fs::write(d.path().join("good.json"), r#"{"name":"Good"}"#).unwrap();

        let themes = read_theme_dir(d.path());

        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].stem, "good");
    }

    #[test]
    fn the_extension_match_ignores_case() {
        let d = tmp();
        std::fs::write(d.path().join("Shout.JSON"), "{}").unwrap();
        assert_eq!(read_theme_dir(d.path()).len(), 1);
    }

    #[test]
    fn the_order_is_stable_rather_than_whatever_the_directory_says() {
        let d = tmp();
        for name in ["c.json", "a.json", "b.json"] {
            std::fs::write(d.path().join(name), "{}").unwrap();
        }
        let stems: Vec<_> = read_theme_dir(d.path())
            .into_iter()
            .map(|t| t.stem)
            .collect();
        assert_eq!(stems, ["a", "b", "c"]);
    }
}

/// Write text to a path the user chose in the save dialog. Only used by the Usage
/// page's CSV export; the fs plugin is deliberately not enabled.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> AppResult<()> {
    std::fs::write(&path, contents).map_err(crate::error::AppError::Io)
}

#[tauri::command]
pub fn open_in_explorer(path: String) -> AppResult<()> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(crate::error::AppError::Message(format!(
            "path no longer exists: {path}"
        )));
    }
    open_with_shell_handler(p)
}

/// Open a link from task notes in the default browser. Only http(s): anything else could
/// name a local program or file for the shell handler to run.
#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    if !is_web_url(&url) {
        return Err(crate::error::AppError::Message(format!(
            "not a web link: {url}"
        )));
    }
    open_with_shell_handler(std::path::Path::new(&url))
}

fn is_web_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://"))
        && url.len() > "https://".len()
        && !url
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '"')
}

#[tauri::command]
pub fn agent_command(
    provider: crate::agent::AgentProvider,
    session_id: Option<String>,
    state: State<'_, AppState>,
) -> String {
    crate::agent::command(&state.settings.get(), provider, session_id.as_deref())
}

#[tauri::command]
pub async fn codex_usage(app: tauri::AppHandle) -> AppResult<Option<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        state
            .codex_limits
            .read(&state.settings.get())
            .map_err(crate::error::AppError::Message)
    })
    .await
    .map_err(|e| crate::error::AppError::Message(e.to_string()))?
}

#[tauri::command]
pub fn codex_usage_stop(state: State<'_, AppState>) {
    state.codex_limits.stop();
}

/// Local branch names in `path`, for a task's branch picker. Empty when `path` is not a
/// git repo or git is missing: this is a picker, not a git client.
#[tauri::command]
pub async fn git_branches(path: String) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || local_branches(std::path::Path::new(&path)))
        .await
        .unwrap_or_default()
}

fn local_branches(dir: &std::path::Path) -> Vec<String> {
    if !dir.is_dir() {
        return Vec::new();
    }
    let mut cmd = std::process::Command::new("git");
    cmd.args(["branch", "--format=%(refname:short)"])
        .current_dir(dir)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    match cmd.output() {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod git_tests {
    use super::{is_web_url, local_branches};

    #[test]
    fn only_plain_web_links_are_opened() {
        assert!(is_web_url("https://github.com/a/b?c=1&d=2"));
        assert!(is_web_url("HTTP://x.y"));
        assert!(is_web_url("https://www.google.com/maps/@51.5,-0.12,14z"));
        for bad in [
            "file:///C:/Windows/System32/calc.exe",
            r"C:\Windows\notepad.exe",
            "javascript:alert(1)",
            "https://",
            "https://a b",
            "https://a\"b",
            "ms-settings:",
        ] {
            assert!(!is_web_url(bad), "{bad}");
        }
    }

    fn git(dir: &std::path::Path, args: &[&str]) {
        let ok = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git is installed")
            .status
            .success();
        assert!(ok, "git {args:?}");
    }

    #[test]
    fn lists_local_branches_and_is_empty_outside_a_repo() {
        let d = tempfile::tempdir().unwrap();
        assert!(local_branches(d.path()).is_empty());
        assert!(local_branches(&d.path().join("missing")).is_empty());
        git(d.path(), &["init", "-q", "-b", "main"]);
        git(d.path(), &["commit", "-q", "--allow-empty", "-m", "x"]);
        git(d.path(), &["branch", "feat/tasks"]);
        let mut branches = local_branches(d.path());
        branches.sort();
        assert_eq!(branches, ["feat/tasks", "main"]);
    }
}
