use axum::{Json, Router, routing::get};
use serde::Serialize;
use tokio::net::TcpListener;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = Router::new().route("/api/health", get(health));
    let listener = TcpListener::bind("0.0.0.0:3000").await?;

    println!("Jira TV API listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}
