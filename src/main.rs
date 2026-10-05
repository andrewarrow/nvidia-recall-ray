mod agent;
mod db;
mod nebius;
mod tools;
mod transcript;
mod web;

use std::{env, error::Error, path::PathBuf};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    dotenvy::dotenv().ok();
    let nebius = nebius::Nebius::new()?;
    let database =
        PathBuf::from(env::var_os("RECALLRAY_DB").unwrap_or_else(|| "recallray.db".into()));
    db::initialize(&database)?;

    let port: u16 = env::var("RECALLRAY_PORT")
        .unwrap_or_else(|_| "7733".into())
        .parse()?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    let url = format!("http://127.0.0.1:{}", listener.local_addr()?.port());

    println!("\n  RecallRay v{}", env!("CARGO_PKG_VERSION"));
    println!("  {url}");
    println!("  Memory: {}", database.display());
    println!("  Reasoning: {} · Nebius Token Factory", nebius::MODEL);
    println!("  Local Whisper: {}\n", transcript::python().display());

    if !env::args().any(|argument| argument == "--no-open") {
        open_browser(&url);
    }

    axum::serve(listener, web::router(database, nebius))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

fn open_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let command = "open";
    #[cfg(target_os = "windows")]
    let command = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let command = "xdg-open";

    if let Err(error) = std::process::Command::new(command).arg(url).spawn() {
        eprintln!("  Browser could not open ({error}). Open {url} manually.");
    }
}
