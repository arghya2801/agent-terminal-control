//! Command-facing error type.
//!
//! Tauri commands must return a serializable error, and the frontend only ever needs a
//! message, so everything collapses to a string rather than leaking Rust types across
//! the IPC boundary.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Pty(#[from] crate::pty::session::PtyError),
    #[error(transparent)]
    Shell(#[from] crate::pty::shell::ShellError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Message(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
