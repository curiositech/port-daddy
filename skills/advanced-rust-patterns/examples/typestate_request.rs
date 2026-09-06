//! Type-state request builder: the compiler enforces call ORDER.
//!
//! A request must set a URL, then a method, then may add headers, then `send`.
//! Calling `send()` before the method is set is a *compile error*, not a runtime
//! check. The state lives entirely in `PhantomData<S>` — zero runtime cost.
//!
//! Pattern source: https://cliffle.com/blog/rust-typestate/
//! Run as a test:  `rustc --test typestate_request.rs && ./typestate_request`
//! Or drop into a crate and `cargo test`.

use std::marker::PhantomData;

// --- Uninhabited state markers: no value of these can ever be constructed. ---
pub enum NeedsUrl {}
pub enum NeedsMethod {}
pub enum Ready {}

pub struct Request<S> {
    url: Option<String>,
    method: Option<String>,
    headers: Vec<(String, String)>,
    _state: PhantomData<S>,
}

impl Request<NeedsUrl> {
    pub fn new() -> Request<NeedsUrl> {
        Request {
            url: None,
            method: None,
            headers: Vec::new(),
            _state: PhantomData,
        }
    }

    // Consumes self, returns the next state. The old NeedsUrl handle is gone.
    pub fn url(self, url: &str) -> Request<NeedsMethod> {
        Request {
            url: Some(url.to_string()),
            method: self.method,
            headers: self.headers,
            _state: PhantomData,
        }
    }
}

impl Request<NeedsMethod> {
    pub fn method(self, method: &str) -> Request<Ready> {
        Request {
            url: self.url,
            method: Some(method.to_string()),
            headers: self.headers,
            _state: PhantomData,
        }
    }
}

impl Request<Ready> {
    // header() is available in Ready and keeps you in Ready (so it's chainable & optional).
    pub fn header(mut self, k: &str, v: &str) -> Request<Ready> {
        self.headers.push((k.to_string(), v.to_string()));
        self
    }

    // send() exists ONLY in the Ready state. url/method are guaranteed Some by construction.
    pub fn send(self) -> String {
        format!(
            "{} {} ({} headers)",
            self.method.unwrap(),
            self.url.unwrap(),
            self.headers.len()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_compiles_and_runs() {
        let out = Request::new()
            .url("https://example.com")
            .method("GET")
            .header("accept", "application/json")
            .send();
        assert_eq!(out, "GET https://example.com (1 headers)");
    }

    // The following would NOT compile (uncomment to see the type error):
    //
    //   Request::new().send();
    //   // error: no method named `send` found for `Request<NeedsUrl>`
    //
    //   Request::new().url("x").send();
    //   // error: no method named `send` found for `Request<NeedsMethod>`
    #[test]
    fn state_size_is_unchanged() {
        // PhantomData is zero-sized: every state has the same layout.
        assert_eq!(
            std::mem::size_of::<Request<NeedsUrl>>(),
            std::mem::size_of::<Request<Ready>>()
        );
    }
}

fn main() {
    let out = Request::new().url("https://example.com").method("POST").send();
    println!("{out}");
}
