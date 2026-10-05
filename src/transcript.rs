use axum::body::Bytes;
use serde_json::Value;
use std::{env, io::Write, path::PathBuf, time::Duration};

pub fn python() -> PathBuf {
    env::var_os("WHISPER_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let candidate = PathBuf::from(env::var_os("HOME").unwrap_or_default())
                .join("os/VoxCPM/.venv/bin/python");
            if candidate.exists() {
                candidate
            } else {
                PathBuf::from("python3")
            }
        })
}
pub async fn transcribe(audio: Bytes) -> Result<String, String> {
    if audio.len() < 100 {
        return Err("The recording is empty. Record a few seconds and try again.".into());
    }
    let mut file =
        tempfile::NamedTempFile::new().map_err(|_| "Could not store recording locally")?;
    file.write_all(&audio)
        .map_err(|_| "Could not store recording locally")?;
    let mut command = tokio::process::Command::new(python());
    command
        .arg("-c")
        .arg(include_str!("../scripts/transcribe.py"))
        .arg(file.path())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(180), command.output())
        .await
        .map_err(|_| "Local transcription timed out. Try a shorter recording.")?
        .map_err(|_| "Could not start Whisper. Check WHISPER_PYTHON.")?;
    if !output.status.success() {
        eprintln!("Whisper process failed (exit {:?})", output.status.code());
        return Err(
            "Local transcription failed. Check the Whisper environment and model installation."
                .into(),
        );
    }
    let result: Value =
        serde_json::from_slice(&output.stdout).map_err(|_| "Invalid Whisper response")?;
    let text = result["transcript"].as_str().unwrap_or("").trim();
    if text.is_empty() {
        return Err("No speech detected. Try speaking closer to the microphone.".into());
    }
    Ok(text.to_owned())
}
