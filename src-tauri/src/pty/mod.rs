//! PTY layer: resolving a shell, spawning it under a real ConPTY, and pumping its
//! output to the webview.

pub mod procs;
pub mod pump;
pub mod registry;
pub mod session;
pub mod shell;
