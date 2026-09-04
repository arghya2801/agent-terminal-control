//! Canonical identity for project directories.
//!
//! Every project is keyed by its path, and those paths arrive from two places that spell
//! them differently: the `cwd` field inside session JSONL, and the settings file the user
//! hand-edits. On Windows the same directory can be written with either separator, either
//! case, a trailing slash, or an 8.3 short name. Without one canonical key the same
//! project shows up two or three times in the sidebar.

use std::path::{Path, PathBuf};

/// A path resolved to canonical form, plus whether it still exists on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedPath {
    /// Lowercased canonical form. Compare with this, never display it.
    pub key: String,
    /// Canonical path in its real casing. Display and use as a shell cwd.
    pub path: PathBuf,
    /// False for a directory recorded by an old session and since deleted.
    pub exists: bool,
}

/// Resolve a path to its canonical key.
///
/// Uses `dunce::canonicalize`, never `std::fs::canonicalize`: the latter returns
/// `\\?\D:\...`, which ConPTY and PowerShell handle poorly and which would never
/// string-match the `cwd` values read out of session JSONL.
pub fn resolve(path: impl AsRef<Path>) -> ResolvedPath {
    let raw = path.as_ref();
    match dunce::canonicalize(raw) {
        Ok(p) => ResolvedPath {
            key: key_of(&p),
            path: p,
            exists: true,
        },
        // A deleted directory cannot be canonicalized; fall back to lexical
        // normalization so the session still groups under the right project.
        Err(_) => {
            let p = lexical_normalize(raw);
            ResolvedPath {
                key: key_of(&p),
                path: p,
                exists: false,
            }
        }
    }
}

/// Just the comparison key. Cheaper when the `ResolvedPath` is not needed.
pub fn project_key(path: impl AsRef<Path>) -> String {
    resolve(path).key
}

fn key_of(p: &Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    let trimmed = s.trim_end_matches('\\');
    // NTFS is case-insensitive but case-preserving: key on lowercase, display the
    // original casing.
    if trimmed.is_empty() {
        s.to_lowercase()
    } else {
        trimmed.to_lowercase()
    }
}

/// Normalize without touching the filesystem: unify separators, strip `.` components,
/// resolve `..` textually, and drop any verbatim prefix.
fn lexical_normalize(p: &Path) -> PathBuf {
    let s = p.to_string_lossy().replace('/', "\\");
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();

    let mut out: Vec<&str> = Vec::new();
    for part in s.split('\\') {
        match part {
            "" | "." => {}
            ".." => {
                // Never pop the drive component.
                if out.len() > 1 {
                    out.pop();
                }
            }
            other => out.push(other),
        }
    }
    PathBuf::from(out.join("\\"))
}

/// Where Claude Code keeps its session transcripts.
pub fn claude_projects_dir(override_dir: Option<&str>) -> PathBuf {
    if let Some(d) = override_dir.map(str::trim).filter(|d| !d.is_empty()) {
        return PathBuf::from(d);
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join(".claude").join("projects")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_real_directory_resolves_and_exists() {
        let here = env!("CARGO_MANIFEST_DIR");
        let r = resolve(here);
        assert!(r.exists);
        assert!(r.path.is_dir());
    }

    #[test]
    fn resolved_paths_never_carry_a_verbatim_prefix() {
        // `\\?\D:\...` breaks ConPTY and would never match a cwd from session JSONL.
        let r = resolve(env!("CARGO_MANIFEST_DIR"));
        assert!(
            !r.path.to_string_lossy().starts_with(r"\\?\"),
            "got {:?}",
            r.path
        );
        assert!(!r.key.starts_with(r"\\?\"), "got {}", r.key);
    }

    #[test]
    fn casing_does_not_create_a_second_project() {
        let here = env!("CARGO_MANIFEST_DIR");
        assert_eq!(project_key(here), project_key(here.to_uppercase()));
    }

    #[test]
    fn separator_style_does_not_create_a_second_project() {
        let here = env!("CARGO_MANIFEST_DIR");
        assert_eq!(project_key(here), project_key(here.replace('\\', "/")));
    }

    #[test]
    fn a_trailing_separator_does_not_create_a_second_project() {
        let here = env!("CARGO_MANIFEST_DIR");
        assert_eq!(project_key(here), project_key(format!("{here}\\")));
    }

    #[test]
    fn a_deleted_directory_still_gets_a_stable_key() {
        // Old sessions routinely reference directories that no longer exist. They must
        // still group under one project rather than vanishing or erroring.
        let gone = r"D:\Coding\deleted_project_xyz";
        let r = resolve(gone);
        assert!(!r.exists);
        assert_eq!(r.key, r"d:\coding\deleted_project_xyz");
        assert_eq!(resolve(format!("{gone}\\")).key, r.key);
    }

    #[test]
    fn lexical_fallback_normalizes_dot_segments() {
        let r = resolve(r"D:\Coding\foo\.\bar\..\baz_missing");
        assert!(!r.exists);
        assert_eq!(r.key, r"d:\coding\foo\baz_missing");
    }

    #[test]
    fn underscores_are_preserved() {
        // The mangled ~/.claude/projects directory name cannot represent an underscore,
        // which is exactly why we key on cwd instead. The key must not mangle it too.
        assert_eq!(
            resolve(r"D:\Coding\game_tracker_app").key,
            r"d:\coding\game_tracker_app"
        );
    }

    #[test]
    fn claude_projects_dir_honours_an_override() {
        assert_eq!(
            claude_projects_dir(Some(r"D:\fixtures\projects")),
            PathBuf::from(r"D:\fixtures\projects")
        );
        // Blank means "unset", not "a directory named ''".
        assert!(claude_projects_dir(Some("  "))
            .to_string_lossy()
            .contains(".claude"));
    }

    #[test]
    fn claude_projects_dir_defaults_under_the_user_profile() {
        let d = claude_projects_dir(None);
        assert!(d.ends_with("projects"));
        assert!(d.to_string_lossy().contains(".claude"));
    }
}
