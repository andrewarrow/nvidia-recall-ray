# RecallRay

A local Rust application that remembers unfinished commitments in conversation.
Browser microphone → local Whisper → NVIDIA Nemotron on Nebius Token Factory →
validated changes in SQLite. Later conversations can resolve earlier promises
without a checkbox.

## Download a test build

Download the ZIP for your computer from [GitHub Releases](https://github.com/andrewarrow/nvidia-recall-ray/releases).
Extract it into a writable folder before starting the app. Rust, Cargo, and Node
are not required for these builds.

| Download | Platform | Launcher |
| --- | --- | --- |
| `macos-arm64` | Apple Silicon Mac | `Start RecallRay.command` |
| `macos-x64` | Intel Mac | `Start RecallRay.command` |
| `windows-x64` | 64-bit Windows | `Start RecallRay.cmd` |
| `linux-x64` | 64-bit Linux, Ubuntu 22.04 or newer | `./start-recallray.sh` |

Each download includes `TESTING.txt` with setup, the demo sequence, and optional
microphone setup. The launcher creates a local `.env` from the included template
and helps you configure your Nebius key. Evaluation keys must be supplied through
the private judging instructions; no credentials are included in release files.
A Nebius key is required for live reasoning. Tavily is required for live web
search. Pasted-text conversations work without Python or Whisper; microphone
recording requires the optional transcription setup.

These are unsigned test builds. On macOS, approve the downloaded launcher and
binary in System Settings → Privacy & Security if prompted. If Finder does not
recognize the launcher as executable, follow the terminal instructions in
`TESTING.txt`. On Windows, the unsigned executable may trigger SmartScreen.

## Run

Set `API_KEY` in `.env` to your Nebius Token Factory key. Add `TAVILY_KEY` (or
`TAVILY_API_KEY`) for live search. Credentials remain on the Rust server and
are never sent to the browser. See `.env.example` for overrides.

```sh
cargo run
```

Opens **http://127.0.0.1:7733**. Stop with Ctrl+C. No Node build is required.

Local transcription uses `faster-whisper` in a local `.venv` when available,
then `~/os/VoxCPM/.venv`, then `python3` (`python` on Windows).
`WHISPER_PYTHON` overrides this selection. To use a different environment:

```sh
/path/to/python -m pip install faster-whisper
WHISPER_PYTHON=/path/to/python cargo run
```

`base.en` runs on CPU with int8 quantization; its first use downloads the model.
Override with `WHISPER_MODEL`. Browser recording works on localhost in modern
Chrome/Safari. Recordings are limited to two minutes and 20 MB. Audio is stored
in a temporary file only during transcription, then deleted. Transcripts are
editable before reasoning and remain in the composer if inference fails.

```sh
cargo run -- --no-open
RECALLRAY_PORT=7734 cargo run
RECALLRAY_DB=/tmp/recallray.db cargo run
```

The default database is `recallray.db` in the working directory. The server
binds only to `127.0.0.1`.

## Demo sequence

Click **Listen**, speak, then **Stop listening**. Review the local transcript
and click **Find commitments**. Pasted text also works through the sidebar **+**.

1. “I told Sarah I'd send her the article tonight. And Mike said he'd send me
   the numbers tomorrow.” → Sarah Open, Mike Waiting.
2. “Oh, I sent Sarah that article. Mike still hasn't gotten back to me.” →
   Sarah Resolved, Mike still Waiting.
3. “I told Ben I'd send him the current price of the Jetson Orin Nano.” →
   Ben Open. Click his loop, then **Help me finish**. Nemotron decides whether
   current information is needed, Tavily searches, and Nemotron drafts a reply
   grounded in returned sources. Source links and the draft are saved locally.
4. “Okay, I sent that to Ben.” → Ben Resolved using earlier conversation context.

No seeded commitments or preview rules are used. Every saved conversation
calls `nvidia/nemotron-3-super-120b-a12b` through the Nebius API. Rust validates
operation types, state values, active loop IDs, and verbatim transcript evidence
before an atomic SQLite transaction. A second Nemotron inference independently
audits proposed resolutions and discards unconfirmed completions. Requests that change memory are serialized
to prevent reasoning against stale state. Model reasoning remains probabilistic;
review the visible evidence. A search/draft never marks a promise complete.

## Data and privacy

Conversations, loops, evidence history, and assistance runs persist in local
SQLite. Audio stays local. New transcripts, all active loops, and the five most
recent conversations are sent to Nebius for reasoning. Search queries go to
Tavily when needed, and search results go to Nebius to generate a draft.
No accounts, syncing, vector database, or background recording.

## Structure

```text
src/main.rs          Startup, .env, and browser launch
src/web.rs           Local HTTP API and embedded static UI
src/db.rs            SQLite transactions, migration, and history
src/agent.rs         Structured operations and evidence validation
src/nebius.rs        Live Nemotron inference
src/transcript.rs    Temporary audio and local Python subprocess
src/tools.rs         Nemotron search decision → Tavily → grounded draft
scripts/transcribe.py Local faster-whisper worker (embedded in binary)
scripts/package_release.py Downloadable ZIP and checksum packaging
scripts/smoke_release.py Packaged launcher and HTTP smoke check
release/            Launchers for packaged binaries
TESTING.txt         Bundled evaluation and transcription setup instructions
static/              HTML, CSS, plain JavaScript
```

## Verify

```sh
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
node --check static/app.js
```

## Release builds

GitHub Actions validates and builds macOS Apple Silicon, macOS Intel, Linux
x64, and Windows x64. Each job starts the extracted package in a temporary
directory and checks its local HTTP API and embedded UI without calling Nebius.
Release ZIPs contain only the compiled app, launchers, placeholder
configuration, testing instructions, and license. Each ZIP has a SHA-256 file.

To publish a new version, update `Cargo.toml` and `Cargo.lock`, commit the changes,
then push a matching version tag:

```sh
git tag v0.1.0
git push origin main v0.1.0
```

The workflow checks that the tag matches the package version and publishes only
after all platforms pass. Manual workflow runs build downloadable Actions
artifacts without publishing a release. Use the specific release URL in
Devpost's demo/test-build field and provide evaluation credentials privately.
