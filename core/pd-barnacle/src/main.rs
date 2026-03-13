use axum::{routing::get, Json, Router, extract::State};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tokio::time::{sleep, Duration};
use tokio::sync::Mutex;
use rusqlite::Connection;
use std::sync::Arc;
use reqwest::Client;
use std::process::Command;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DaemonStatus {
    pub status: String,
    pub pid: Option<u32>,
    pub uptime_seconds: u64,
    pub last_seen: i64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct HealthResponse {
    pub system_status: String,
    pub daemon: DaemonStatus,
    pub barnacle_pid: u32,
}

struct AppState {
    db: Arc<Mutex<Connection>>,
    daemon_status: Arc<Mutex<DaemonStatus>>,
}

#[tokio::main]
async fn main() {
    // Initialize Telemetry DB
    let conn = Connection::open("telemetry.db").expect("Failed to open telemetry DB");
    conn.execute(
        "CREATE TABLE IF NOT EXISTS daemon_lifecycle (
            id INTEGER PRIMARY KEY,
            event_type TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            details TEXT
        )",
        [],
    ).expect("Failed to create telemetry schema");
    
    let db = Arc::new(Mutex::new(conn));
    let daemon_status = Arc::new(Mutex::new(DaemonStatus {
        status: "starting".to_string(),
        pid: None,
        uptime_seconds: 0,
        last_seen: 0,
    }));

    let state = Arc::new(AppState {
        db: db.clone(),
        daemon_status: daemon_status.clone(),
    });

    // Spawn the Monitor Loop
    let monitor_state = state.clone();
    tokio::spawn(async move {
        monitor_loop(monitor_state).await;
    });

    // Health API Server
    let app = Router::new()
        .route("/health", get(health_handler))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 9875));
    println!("🐕 pd-barnacle health api listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health_handler(
    State(state): State<Arc<AppState>>,
) -> Json<HealthResponse> {
    let daemon = state.daemon_status.lock().await.clone();
    Json(HealthResponse {
        system_status: if daemon.status == "ok" { "healthy" } else { "degraded" }.to_string(),
        daemon,
        barnacle_pid: std::process::id(),
    })
}

async fn monitor_loop(state: Arc<AppState>) {
    let client = Client::new();
    let daemon_url = "http://localhost:9876/status";

    loop {
        let res = client.get(daemon_url).timeout(Duration::from_secs(2)).send().await;

        {
            let mut status = state.daemon_status.lock().await;
            match res {
                Ok(response) => {
                    if response.status().is_success() {
                        status.status = "ok".to_string();
                        status.last_seen = chrono::Utc::now().timestamp();
                    } else {
                        status.status = "unresponsive".to_string();
                    }
                }
                Err(_) => {
                    println!("⚠️ Daemon not responding. Initiating resurrection...");
                    status.status = "dead".to_string();
                    resurrect_daemon();
                }
            }
        }
        sleep(Duration::from_secs(5)).await;
    }
}

fn resurrect_daemon() {
    let _ = Command::new("npm")
        .args(["run", "daemon"])
        .spawn();
}
