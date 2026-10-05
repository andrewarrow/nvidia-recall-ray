use crate::{
    db::{self, Snapshot},
    nebius::Nebius,
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{StatusCode, header},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};

#[derive(Clone)]
struct App {
    database: PathBuf,
    nebius: Nebius,
    memory_lock: Arc<tokio::sync::Mutex<()>>,
    audio_lock: Arc<tokio::sync::Mutex<()>>,
}
pub fn router(database: PathBuf, nebius: Nebius) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/static/app.css", get(styles))
        .route("/static/app.js", get(script))
        .route("/api/state", get(state))
        .route("/api/conversations", post(add_conversation))
        .route("/api/recordings", post(recording))
        .route("/api/loops/{id}/help", post(help).get(history))
        .layer(DefaultBodyLimit::max(20 * 1024 * 1024))
        .with_state(App {
            database,
            nebius,
            memory_lock: Arc::new(tokio::sync::Mutex::new(())),
            audio_lock: Arc::new(tokio::sync::Mutex::new(())),
        })
}
async fn index() -> Html<&'static str> {
    Html(include_str!("../static/index.html"))
}
async fn styles() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
        include_str!("../static/app.css"),
    )
}
async fn script() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("../static/app.js"),
    )
}
async fn state(State(app): State<App>) -> Result<Json<Snapshot>, ApiError> {
    Ok(Json(read(app.database).await?))
}
async fn read(path: PathBuf) -> Result<Snapshot, ApiError> {
    tokio::task::spawn_blocking(move || db::snapshot(&path))
        .await
        .map_err(ApiError::internal)?
        .map_err(ApiError::internal)
}
#[derive(Deserialize)]
struct ConversationInput {
    transcript: String,
}
async fn add_conversation(
    State(app): State<App>,
    Json(input): Json<ConversationInput>,
) -> Result<(StatusCode, Json<Snapshot>), ApiError> {
    let transcript = input.transcript.trim().to_owned();
    if transcript.is_empty() || transcript.chars().count() > 10_000 {
        return Err(ApiError::bad(
            "Add conversation text under 10,000 characters.",
        ));
    }
    // Serialize read → inference → commit so concurrent conversations cannot reason against stale memory.
    let _guard = app.memory_lock.lock().await;
    let snapshot = read(app.database.clone()).await?;
    let active = snapshot
        .loops
        .into_iter()
        .filter(|item| item.state != "resolved")
        .collect::<Vec<_>>();
    let recent = serde_json::to_value(snapshot.conversations.iter().take(5).collect::<Vec<_>>())
        .map_err(ApiError::internal)?;
    let analysis = app
        .nebius
        .analyze(&transcript, &active, recent)
        .await
        .map_err(ApiError::service)?;
    let result = tokio::task::spawn_blocking(move || {
        db::add_conversation(&app.database, &transcript, analysis.operations)
    })
    .await
    .map_err(ApiError::internal)?
    .map_err(ApiError::internal)?;
    Ok((StatusCode::CREATED, Json(result)))
}
async fn recording(State(app): State<App>, audio: Bytes) -> Result<Json<Value>, ApiError> {
    let _guard = app
        .audio_lock
        .try_lock()
        .map_err(|_| ApiError::bad("Another recording is being transcribed. Try again shortly."))?;
    let transcript = crate::transcript::transcribe(audio)
        .await
        .map_err(ApiError::service)?;
    Ok(Json(json!({"transcript":transcript})))
}
async fn help(State(app): State<App>, Path(id): Path<i64>) -> Result<Json<Value>, ApiError> {
    let snapshot = read(app.database.clone()).await?;
    let item = snapshot
        .loops
        .iter()
        .find(|item| item.id == id)
        .ok_or_else(|| ApiError::bad("Commitment not found."))?;
    if item.state != "open" {
        return Err(ApiError::bad(
            "Assistance is available for open commitments.",
        ));
    }
    let output = crate::tools::help(&app.nebius, item)
        .await
        .map_err(ApiError::service)?;
    let saved = output.clone();
    tokio::task::spawn_blocking(move || db::save_tool_run(&app.database, id, &saved))
        .await
        .map_err(ApiError::internal)?
        .map_err(ApiError::internal)?;
    Ok(Json(output))
}
async fn history(
    State(app): State<App>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<Value>>, ApiError> {
    Ok(Json(
        tokio::task::spawn_blocking(move || db::tool_runs(&app.database, id))
            .await
            .map_err(ApiError::internal)?
            .map_err(ApiError::internal)?,
    ))
}
struct ApiError {
    status: StatusCode,
    message: String,
}
impl ApiError {
    fn bad(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }
    fn service(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            message: message.into(),
        }
    }
    fn internal(error: impl std::fmt::Display) -> Self {
        eprintln!("Local memory error: {error}");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "Your local memory could not be accessed. Try again.".into(),
        }
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({"error": self.message}))).into_response()
    }
}
