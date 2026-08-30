//! Durable operator-controlled presentation scale for the native console.
//!
//! GPUI's rem size does not cover pd-console's existing explicit-pixel layout,
//! so `app.rs` reads this one process-global scale at every authored `px()`
//! boundary. Keeping the policy and persistence here makes the controls,
//! keyboard actions, and tests agree on the same bounds and increments.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU16, Ordering};

const PREFERENCES_VERSION: u8 = 1;
pub const DEFAULT_ZOOM_PERCENT: u16 = 100;
pub const MIN_ZOOM_PERCENT: u16 = 80;
pub const MAX_ZOOM_PERCENT: u16 = 200;
pub const ZOOM_STEP_PERCENT: u16 = 10;

static ZOOM_PERCENT: AtomicU16 = AtomicU16::new(DEFAULT_ZOOM_PERCENT);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZoomAction {
    Out,
    Reset,
    In,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PresentationPreferences {
    version: u8,
    zoom_percent: u16,
}

pub fn zoom_percent() -> u16 {
    ZOOM_PERCENT.load(Ordering::Relaxed)
}

pub fn zoom_factor() -> f32 {
    f32::from(zoom_percent()) / 100.0
}

pub fn can_apply(action: ZoomAction) -> bool {
    match action {
        ZoomAction::Out => zoom_percent() > MIN_ZOOM_PERCENT,
        ZoomAction::Reset => zoom_percent() != DEFAULT_ZOOM_PERCENT,
        ZoomAction::In => zoom_percent() < MAX_ZOOM_PERCENT,
    }
}

pub fn apply(action: ZoomAction) -> io::Result<u16> {
    let next = next_zoom_percent(zoom_percent(), action);
    ZOOM_PERCENT.store(next, Ordering::Relaxed);
    persist(preferences_path(), next)?;
    Ok(next)
}

/// Load the durable preference, then let an explicit launch override win for
/// this process. The override is intentionally not persisted.
pub fn init() -> Option<String> {
    let path = preferences_path();
    let mut warning = None;
    if path.exists() {
        match load(&path) {
            Ok(value) => ZOOM_PERCENT.store(value, Ordering::Relaxed),
            Err(error) => {
                warning = Some(format!(
                    "pd-console: ignored invalid presentation preferences at {}: {error}",
                    path.display()
                ));
            }
        }
    }

    if let Ok(value) = std::env::var("PD_CONSOLE_ZOOM") {
        match value.parse::<u16>() {
            Ok(percent) => ZOOM_PERCENT.store(clamp_zoom_percent(percent), Ordering::Relaxed),
            Err(error) => {
                warning = Some(format!(
                    "pd-console: ignored invalid PD_CONSOLE_ZOOM={value:?}: {error}"
                ));
            }
        }
    }
    warning
}

fn preferences_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".port-daddy")
        .join("pd-console-presentation.json")
}

fn clamp_zoom_percent(percent: u16) -> u16 {
    percent.clamp(MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT)
}

fn next_zoom_percent(current: u16, action: ZoomAction) -> u16 {
    let current = clamp_zoom_percent(current);
    match action {
        ZoomAction::Out => current
            .saturating_sub(ZOOM_STEP_PERCENT)
            .max(MIN_ZOOM_PERCENT),
        ZoomAction::Reset => DEFAULT_ZOOM_PERCENT,
        ZoomAction::In => current
            .saturating_add(ZOOM_STEP_PERCENT)
            .min(MAX_ZOOM_PERCENT),
    }
}

fn load(path: &Path) -> io::Result<u16> {
    let bytes = fs::read(path)?;
    let preferences: PresentationPreferences = serde_json::from_slice(&bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if preferences.version != PREFERENCES_VERSION {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "unsupported preferences version {} (expected {PREFERENCES_VERSION})",
                preferences.version
            ),
        ));
    }
    Ok(clamp_zoom_percent(preferences.zoom_percent))
}

fn persist(path: PathBuf, zoom_percent: u16) -> io::Result<()> {
    let Some(parent) = path.parent() else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "presentation preferences path has no parent",
        ));
    };
    fs::create_dir_all(parent)?;

    let preferences = PresentationPreferences {
        version: PREFERENCES_VERSION,
        zoom_percent: clamp_zoom_percent(zoom_percent),
    };
    let bytes = serde_json::to_vec_pretty(&preferences)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let temporary = path.with_extension(format!("json.tmp-{}", std::process::id()));
    fs::write(&temporary, bytes)?;
    if let Err(error) = fs::rename(&temporary, &path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!(
                "pd-console-presentation-{name}-{}.json",
                std::process::id()
            ))
    }

    #[test]
    fn zoom_actions_are_bounded_and_reset_is_exact() {
        assert_eq!(next_zoom_percent(80, ZoomAction::Out), 80);
        assert_eq!(next_zoom_percent(90, ZoomAction::Out), 80);
        assert_eq!(next_zoom_percent(110, ZoomAction::Reset), 100);
        assert_eq!(next_zoom_percent(190, ZoomAction::In), 200);
        assert_eq!(next_zoom_percent(200, ZoomAction::In), 200);
    }

    #[test]
    fn persisted_preferences_round_trip_and_clamp() {
        let path = fixture_path("round-trip");
        let _ = fs::remove_file(&path);
        persist(path.clone(), 240).expect("persist preferences");
        assert_eq!(load(&path).expect("load preferences"), MAX_ZOOM_PERCENT);
        fs::remove_file(path).expect("remove preferences fixture");
    }

    #[test]
    fn malformed_or_future_preferences_fail_closed() {
        let malformed = br#"{"version":1,"zoomPercent":"huge"}"#;
        let path = fixture_path("invalid");
        fs::create_dir_all(path.parent().expect("fixture parent"))
            .expect("create fixture directory");
        fs::write(&path, malformed).expect("write malformed fixture");
        assert_eq!(load(&path).unwrap_err().kind(), io::ErrorKind::InvalidData);

        fs::write(&path, br#"{"version":2,"zoomPercent":100}"#).expect("write future fixture");
        assert_eq!(load(&path).unwrap_err().kind(), io::ErrorKind::InvalidData);
        fs::remove_file(path).expect("remove invalid fixture");
    }
}
