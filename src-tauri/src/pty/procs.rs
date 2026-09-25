//! What is running under a tab's shell. A tab whose agent has exited is back at a bare
//! prompt and should close without asking; one running Codex, Claude or a dev server
//! should not (#106).

/// Executable name of one child process of `pid`, or `None` when it has none.
#[cfg(windows)]
pub fn first_child(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut found = None;
        let mut more = Process32FirstW(snap, &mut entry).is_ok();
        while more {
            if entry.th32ParentProcessID == pid && entry.th32ProcessID != pid {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(0);
                found = Some(String::from_utf16_lossy(&entry.szExeFile[..len]));
                break;
            }
            more = Process32NextW(snap, &mut entry).is_ok();
        }
        let _ = CloseHandle(snap);
        found
    }
}

/// Whether ATC runs inside a Job Object that forbids breakaway, which its shells inherit.
/// Codex's background server must detach from the job to outlive the terminal, and
/// refuses to start there ("host Job Object prevents daemon detachment", #118).
#[cfg(windows)]
pub fn job_blocks_breakaway() -> bool {
    use windows::Win32::System::JobObjects::{
        IsProcessInJob, JobObjectExtendedLimitInformation, QueryInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
        JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
    };
    use windows::Win32::System::Threading::GetCurrentProcess;

    static BLOCKS: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *BLOCKS.get_or_init(|| unsafe {
        let mut in_job = windows::core::BOOL(0);
        if IsProcessInJob(GetCurrentProcess(), None, &mut in_job).is_err() || !in_job.as_bool() {
            return false;
        }
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        // No handle: the job this process is in.
        if QueryInformationJobObject(
            None,
            JobObjectExtendedLimitInformation,
            &mut info as *mut _ as *mut _,
            std::mem::size_of_val(&info) as u32,
            None,
        )
        .is_err()
        {
            return false;
        }
        let flags = info.BasicLimitInformation.LimitFlags;
        (flags & (JOB_OBJECT_LIMIT_BREAKAWAY_OK | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK)).0 == 0
    })
}

#[cfg(not(windows))]
pub fn job_blocks_breakaway() -> bool {
    false
}

#[cfg(not(windows))]
pub fn first_child(_pid: u32) -> Option<String> {
    None
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn finds_a_running_child_and_none_under_a_leaf() {
        let mut child = std::process::Command::new("ping")
            .args(["-n", "5", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let mine = first_child(std::process::id());
        let under_ping = first_child(child.id());
        let _ = child.kill();
        let _ = child.wait();
        assert!(mine.is_some(), "the test process has ping running under it");
        assert_eq!(under_ping, None);
    }
}
