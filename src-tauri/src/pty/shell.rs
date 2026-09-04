//! Resolving which shell a PTY should launch.
//!
//! `CommandBuilder::new("pwsh.exe")` would lean on `PATH` at spawn time, which fails
//! opaquely inside a ConPTY. Resolving to an absolute path up front means a missing
//! shell is a clear error in the UI instead of a terminal that opens and immediately
//! dies.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ShellInfo {
    pub path: PathBuf,
    pub args: Vec<String>,
    /// Human-readable name for the settings UI, e.g. "PowerShell 7".
    pub label: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ShellError {
    #[error("configured shell `{0}` was not found")]
    ConfiguredNotFound(String),
    #[error("no usable shell found; tried: {0}")]
    NoneFound(String),
}

/// Resolve the shell to launch.
///
/// `preferred` comes from settings. When it is set but unusable we fail loudly rather
/// than silently falling back — otherwise a typo in settings looks like a working app
/// running the wrong shell.
pub fn resolve_shell(preferred: Option<&str>) -> Result<ShellInfo, ShellError> {
    if let Some(raw) = preferred.map(str::trim).filter(|s| !s.is_empty()) {
        return locate(raw)
            .map(|path| {
                let label = friendly_label(&path);
                let args = default_args(&path);
                ShellInfo { path, args, label }
            })
            .ok_or_else(|| ShellError::ConfiguredNotFound(raw.to_string()));
    }

    let candidates = default_candidates();
    for cand in &candidates {
        if let Some(path) = locate(cand) {
            let label = friendly_label(&path);
            let args = default_args(&path);
            return Ok(ShellInfo { path, args, label });
        }
    }
    Err(ShellError::NoneFound(candidates.join(", ")))
}

/// Preference order. PowerShell 7 first (it is what the user runs day to day), then
/// Windows PowerShell as a floor that exists on every Windows install.
fn default_candidates() -> Vec<String> {
    #[cfg(windows)]
    {
        let mut v = Vec::new();
        if let Ok(pf) = std::env::var("ProgramFiles") {
            v.push(format!("{pf}\\PowerShell\\7\\pwsh.exe"));
        }
        v.push("pwsh.exe".into());
        if let Ok(root) = std::env::var("SystemRoot") {
            v.push(format!(
                "{root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
            ));
        }
        v.push("powershell.exe".into());
        v
    }
    #[cfg(not(windows))]
    {
        vec!["/bin/bash".into(), "/bin/sh".into()]
    }
}

/// Turn a candidate into an absolute, existing path — accepting either a full path or
/// a bare executable name to look up on `PATH`.
fn locate(candidate: &str) -> Option<PathBuf> {
    let direct = Path::new(candidate);
    if direct.is_absolute() {
        return direct.is_file().then(|| normalize(direct));
    }
    if candidate.contains(['\\', '/']) {
        // A relative path: resolve against cwd rather than searching PATH.
        return direct.is_file().then(|| normalize(direct));
    }
    search_path(candidate)
}

fn search_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    let exts: Vec<String> = if cfg!(windows) && !name.contains('.') {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT".into())
            .split(';')
            .filter(|e| !e.is_empty())
            .map(|e| e.to_ascii_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };

    std::env::split_paths(&path_var).find_map(|dir| {
        exts.iter().find_map(|ext| {
            let cand = dir.join(format!("{name}{ext}"));
            cand.is_file().then(|| normalize(&cand))
        })
    })
}

/// Canonicalize via `dunce` so we never hand ConPTY or PowerShell a `\\?\`-prefixed
/// path, which they handle poorly. Falls back to the path as given.
fn normalize(p: &Path) -> PathBuf {
    dunce::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

fn file_stem_lower(p: &Path) -> String {
    p.file_stem()
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

fn default_args(p: &Path) -> Vec<String> {
    match file_stem_lower(p).as_str() {
        // Skip the startup banner; it is noise above every prompt.
        "pwsh" | "powershell" => vec!["-NoLogo".into()],
        _ => Vec::new(),
    }
}

fn friendly_label(p: &Path) -> String {
    match file_stem_lower(p).as_str() {
        "pwsh" => "PowerShell 7".into(),
        "powershell" => "Windows PowerShell".into(),
        "cmd" => "Command Prompt".into(),
        "" => p.display().to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_a_default_shell_to_an_absolute_existing_path() {
        let shell = resolve_shell(None).expect("every machine has some shell");
        assert!(shell.path.is_absolute(), "got {:?}", shell.path);
        assert!(shell.path.is_file(), "got {:?}", shell.path);
    }

    #[test]
    fn resolved_path_has_no_verbatim_prefix() {
        // `\\?\D:\...` breaks ConPTY and will not string-match cwd values read from
        // session JSONL. See SESSION.md > Gotchas.
        let shell = resolve_shell(None).unwrap();
        assert!(
            !shell.path.to_string_lossy().starts_with(r"\\?\"),
            "resolved path must not be verbatim: {:?}",
            shell.path
        );
    }

    #[test]
    fn prefers_powershell_and_suppresses_its_banner() {
        let shell = resolve_shell(None).unwrap();
        if cfg!(windows) {
            let stem = file_stem_lower(&shell.path);
            assert!(
                stem == "pwsh" || stem == "powershell",
                "expected a PowerShell, got {stem}"
            );
            assert_eq!(shell.args, vec!["-NoLogo".to_string()]);
        }
    }

    #[test]
    fn an_explicit_absolute_path_is_honoured() {
        let discovered = resolve_shell(None).unwrap();
        let explicit = resolve_shell(Some(&discovered.path.to_string_lossy())).unwrap();
        assert_eq!(explicit.path, discovered.path);
    }

    #[test]
    fn a_bare_name_is_looked_up_on_path() {
        let name = if cfg!(windows) { "cmd.exe" } else { "sh" };
        let shell = resolve_shell(Some(name)).expect("should be found on PATH");
        assert!(shell.path.is_absolute());
    }

    #[test]
    fn a_misconfigured_shell_errors_rather_than_falling_back() {
        // Silently falling back would present a working terminal running the wrong
        // shell, which is worse than a visible error.
        let err = resolve_shell(Some("definitely-not-a-real-shell-xyz.exe")).unwrap_err();
        assert!(matches!(err, ShellError::ConfiguredNotFound(_)), "{err:?}");
    }

    #[test]
    fn blank_configured_shell_falls_back_to_defaults() {
        // An empty string in settings.json means "unset", not "a shell named ''".
        assert!(resolve_shell(Some("   ")).is_ok());
    }
}
