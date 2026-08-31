//! The error seam: a LIBRARY exposes a matchable `thiserror` enum; the BINARY
//! collapses it into `anyhow::Error` with `.context()` at the `?` boundary.
//!
//! This file is written WITHOUT external crates so it compiles standalone with
//! plain `rustc` — it hand-rolls the *exact* `Display`/`Error`/`From` impls that
//! `thiserror` would generate, so you can see the machinery `?` relies on. The
//! commented blocks show the real `thiserror`/`anyhow` form you'd use in a crate.
//!
//! Run:  `rustc --test error_architecture.rs && ./error_architecture`
//!
//! Sources:
//!   thiserror: https://docs.rs/thiserror/latest/thiserror/
//!   anyhow:    https://github.com/dtolnay/anyhow

use std::fmt;

// ===== LIBRARY side: a typed, matchable error =====================================
//
// With thiserror this whole block is just:
//
//   #[derive(thiserror::Error, Debug)]
//   pub enum StoreError {
//       #[error("data store disconnected")]
//       Disconnect(#[from] std::io::Error),
//       #[error("key `{0}` not available")]
//       Missing(String),
//   }
//
// Below is the hand-written equivalent so the From/Display wiring is visible.

#[derive(Debug)]
pub enum StoreError {
    Disconnect(std::io::Error),
    Missing(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Disconnect(_) => write!(f, "data store disconnected"),
            StoreError::Missing(k) => write!(f, "key `{k}` not available"),
        }
    }
}

impl std::error::Error for StoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StoreError::Disconnect(e) => Some(e), // #[from] also wires source()
            StoreError::Missing(_) => None,
        }
    }
}

// This is what `#[from]` generates — and it's what makes `?` compile below.
impl From<std::io::Error> for StoreError {
    fn from(e: std::io::Error) -> Self {
        StoreError::Disconnect(e)
    }
}

/// A library function returns its OWN error type so callers can match on it.
pub fn read_key(key: &str) -> Result<String, StoreError> {
    if key.is_empty() {
        return Err(StoreError::Missing(key.to_string()));
    }
    // `?` here converts std::io::Error -> StoreError via the From impl above.
    let _bytes = std::fs::read("/nonexistent/path/for/demo")?;
    Ok("value".to_string())
}

// ===== APPLICATION side: erase to one error type + add context ====================
//
// With anyhow this is `anyhow::Result<T>` and `.context(...)`. We model the two
// critical properties — (1) any std::error::Error converts in, (2) context
// wraps with a source chain — using a tiny stand-in so the file is dependency-free.

#[derive(Debug)]
pub struct AppError {
    context: String,
    // named `cause` (not `source`) so the field doesn't shadow Error::source()
    cause: Box<dyn std::error::Error + Send + Sync + 'static>,
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.context, self.cause)
    }
}
impl std::error::Error for AppError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&*self.cause)
    }
}

/// The `.context()` extension trait — anyhow's `Context` in miniature.
trait Context<T> {
    fn context(self, msg: &str) -> Result<T, AppError>;
}
impl<T, E> Context<T> for Result<T, E>
where
    E: std::error::Error + Send + Sync + 'static,
{
    fn context(self, msg: &str) -> Result<T, AppError> {
        self.map_err(|e| AppError {
            context: msg.to_string(),
            cause: Box::new(e),
        })
    }
}

/// Application code: bubble up everything, attach human-readable context.
fn run() -> Result<(), AppError> {
    let _ = read_key("config").context("loading config key")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::error::Error as _; // brings Error::source() into scope for the chain check

    #[test]
    fn library_error_is_matchable() {
        // The whole point of thiserror: callers can MATCH on the variant.
        match read_key("") {
            Err(StoreError::Missing(k)) => assert_eq!(k, ""),
            other => panic!("expected Missing, got {other:?}"),
        }
    }

    #[test]
    fn from_impl_lets_question_mark_convert_io_error() {
        // read_key on a present key still fails (file missing) -> Disconnect via `?`.
        match read_key("present") {
            Err(StoreError::Disconnect(_)) => {} // converted from io::Error
            other => panic!("expected Disconnect, got {other:?}"),
        }
    }

    #[test]
    fn application_layer_adds_context_and_keeps_source() {
        let err = run().unwrap_err();
        assert!(err.to_string().starts_with("loading config key:"));
        // The source chain is preserved (anyhow's {:?} would print the full chain).
        assert!(err.source().is_some());
    }
}

fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        // anyhow's `{e:?}` would print context + the full source chain here.
    }
}
