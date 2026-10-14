use std::{env, fs, net::SocketAddr, path::PathBuf, str::FromStr};

use chrono_tz::Tz;
use jira_tv_server::api::{AppState, router};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let database_path = env::var_os("DATABASE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("data/planner.db"));
    if let Some(directory) = database_path.parent() {
        fs::create_dir_all(directory)?;
    }

    let timezone_name = env::var("HOUSEHOLD_TIMEZONE").unwrap_or_else(|_| "UTC".to_owned());
    let household_timezone = Tz::from_str(&timezone_name)
        .map_err(|_| format!("Invalid HOUSEHOLD_TIMEZONE: {timezone_name}"))?;
    let options = SqliteConnectOptions::new()
        .filename(&database_path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;
    sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES ('household_timezone', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(household_timezone.name())
    .execute(&pool)
    .await?;

    let address = env::var("BIND_ADDRESS").unwrap_or_else(|_| "0.0.0.0:3000".to_owned());
    let address = SocketAddr::from_str(&address)?;
    let listener = TcpListener::bind(address).await?;
    println!("Home planner API listening on {}", listener.local_addr()?);

    axum::serve(
        listener,
        router(AppState {
            pool,
            household_timezone,
        }),
    )
    .await?;

    Ok(())
}
