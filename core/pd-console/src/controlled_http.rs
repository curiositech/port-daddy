//! All console daemon and relay requests share this pre-send control boundary.
//! Kept intentionally narrower than reqwest: callers cannot extract the raw
//! client or builder and accidentally bypass local Off.
use std::time::Duration;

#[derive(Clone)]
pub struct ControlledHttp(reqwest::Client);

pub struct ControlledRequest(reqwest::RequestBuilder);

impl ControlledHttp {
    pub fn new() -> Self {
        Self(
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(15))
                .build()
                .expect("static HTTP client configuration"),
        )
    }
    pub fn get(&self, url: impl reqwest::IntoUrl) -> ControlledRequest {
        ControlledRequest(self.0.get(url))
    }
    pub fn post(&self, url: impl reqwest::IntoUrl) -> ControlledRequest {
        ControlledRequest(self.0.post(url))
    }
    pub fn delete(&self, url: impl reqwest::IntoUrl) -> ControlledRequest {
        ControlledRequest(self.0.delete(url))
    }
}

impl ControlledRequest {
    pub fn json<T: serde::Serialize + ?Sized>(self, value: &T) -> Self {
        Self(self.0.json(value))
    }
    pub fn query<T: serde::Serialize + ?Sized>(self, value: &T) -> Self {
        Self(self.0.query(value))
    }
    pub fn header(self, key: &str, value: impl AsRef<str>) -> Self {
        Self(self.0.header(key, value.as_ref()))
    }
    pub fn bearer_auth(self, token: impl std::fmt::Display) -> Self {
        Self(self.0.bearer_auth(token))
    }
    pub fn body(self, body: impl Into<reqwest::Body>) -> Self {
        Self(self.0.body(body))
    }
    pub fn timeout(self, timeout: Duration) -> Self {
        Self(self.0.timeout(timeout))
    }
    pub async fn send(self) -> anyhow::Result<reqwest::Response> {
        with_admission(crate::local_control::ensure_allowed, || async move {
        // Drop an in-flight request after Off is observed. This cannot recall
        // bytes/effects already accepted by the peer; the UI says so explicitly.
            tokio::select! {
                result = self.0.send() => Ok(result?),
                _ = wait_until_off() => Err(anyhow::anyhow!("Local Off cancelled this request; any prior remote outcome is unverified.")),
            }
        }).await
    }
}

// The effect future is not even constructed until the current control read
// permits it. Tests use an inert closure here, never a listening test server.
async fn with_admission<T, F: std::future::Future<Output = anyhow::Result<T>>>(
    admission: impl FnOnce() -> std::io::Result<()>,
    effect: impl FnOnce() -> F,
) -> anyhow::Result<T> {
    admission()?;
    effect().await
}

pub async fn wait_until_off() {
    loop {
        if crate::local_control::ensure_allowed().is_err() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

pub fn is_timeout(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<reqwest::Error>()
        .is_some_and(reqwest::Error::is_timeout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[tokio::test]
    async fn disabled_or_unknown_control_never_constructs_the_effect() {
        for reason in ["off", "cannot read control"] {
            let effects = Cell::new(0);
            let result = with_admission(
                || Err(std::io::Error::other(reason)),
                || {
                    effects.set(effects.get() + 1);
                    async { Ok(()) }
                },
            )
            .await;
            assert!(result.is_err());
            assert_eq!(effects.get(), 0);
        }
    }

    #[tokio::test]
    async fn allowed_control_constructs_exactly_one_fake_effect() {
        let effects = Cell::new(0);
        let result = with_admission(
            || Ok(()),
            || {
                effects.set(effects.get() + 1);
                async { Ok("fake receipt") }
            },
        )
        .await
        .unwrap();
        assert_eq!(result, "fake receipt");
        assert_eq!(effects.get(), 1);
    }

    #[tokio::test]
    async fn a_prepared_request_rechecks_admission_when_polled() {
        let enabled = Cell::new(true);
        let effects = Cell::new(0);
        let prepared = with_admission(
            || {
                if enabled.get() {
                    Ok(())
                } else {
                    Err(std::io::Error::other("off after preparation"))
                }
            },
            || {
                effects.set(effects.get() + 1);
                async { Ok(()) }
            },
        );
        enabled.set(false);
        assert!(prepared.await.is_err());
        assert_eq!(effects.get(), 0);
    }
}
