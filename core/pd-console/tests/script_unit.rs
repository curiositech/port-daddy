//! Headless contract target for the semantic control socket.
//!
//! `src/main.rs` exercises the GPUI integration, but parser and transport
//! safety must remain testable even when the host compiler cannot load GPUI's
//! proc-macro dylib.

#[allow(dead_code)]
mod pane {
    pub struct AlertLevel;

    impl AlertLevel {
        pub fn label(&self) -> &'static str {
            "info"
        }
    }

    pub struct Alert {
        pub level: AlertLevel,
        pub title: String,
        pub detail: String,
        pub ts: String,
    }
}

#[path = "../src/script.rs"]
mod script;
