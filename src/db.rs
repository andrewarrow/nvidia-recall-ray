use std::{path::Path, time::Duration};

use rusqlite::{Connection, Result, params};
use serde::Serialize;

use crate::agent::Operation;

#[derive(Debug, Serialize)]
pub struct Conversation {
    pub id: i64,
    pub transcript: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct Loop {
    pub id: i64,
    pub title: String,
    pub state: String,
    pub owner: String,
    pub evidence: String,
    pub created_at: i64,
    pub resolved_at: Option<i64>,
    pub conversation_id: i64,
}

#[derive(Debug, Serialize)]
pub struct Event {
    pub id: i64,
    pub loop_id: i64,
    pub conversation_id: i64,
    pub kind: String,
    pub evidence: String,
    pub created_at: i64,
}

#[derive(Serialize)]
pub struct Snapshot {
    pub version: &'static str,
    pub mode: &'static str,
    pub conversations: Vec<Conversation>,
    pub loops: Vec<Loop>,
    pub events: Vec<Event>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<i64>,
}

fn connect(path: &Path) -> Result<Connection> {
    let connection = Connection::open(path)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    Ok(connection)
}

pub fn initialize(path: &Path) -> Result<()> {
    let connection = connect(path)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY,
            transcript TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS loops (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('open', 'waiting', 'resolved')),
            owner TEXT NOT NULL,
            evidence TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            resolved_at INTEGER,
            conversation_id INTEGER NOT NULL REFERENCES conversations(id)
        );
        CREATE TABLE IF NOT EXISTS loop_events (
            id INTEGER PRIMARY KEY,
            loop_id INTEGER NOT NULL REFERENCES loops(id),
            conversation_id INTEGER NOT NULL REFERENCES conversations(id),
            kind TEXT NOT NULL CHECK(kind IN ('created', 'resolved', 'kept', 'updated')),
            evidence TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(loop_id, conversation_id, kind)
        );
        CREATE TABLE IF NOT EXISTS tool_runs (
            id INTEGER PRIMARY KEY,
            loop_id INTEGER NOT NULL REFERENCES loops(id),
            output TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );",
    )?;
    let schema: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE name = 'loop_events'",
        [],
        |row| row.get(0),
    )?;
    if !schema.contains("'updated'") {
        connection.execute_batch(
            "BEGIN IMMEDIATE;
            ALTER TABLE loop_events RENAME TO old_loop_events;
            CREATE TABLE loop_events (
                id INTEGER PRIMARY KEY, loop_id INTEGER NOT NULL REFERENCES loops(id),
                conversation_id INTEGER NOT NULL REFERENCES conversations(id),
                kind TEXT NOT NULL CHECK(kind IN ('created','resolved','kept','updated')),
                evidence TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                UNIQUE(loop_id, conversation_id, kind));
            INSERT INTO loop_events SELECT * FROM old_loop_events;
            DROP TABLE old_loop_events;
            COMMIT;",
        )?;
    }
    Ok(())
}

pub fn snapshot(path: &Path) -> Result<Snapshot> {
    let mut connection = connect(path)?;
    let transaction = connection.transaction()?;
    let state = read_snapshot(&transaction)?;
    transaction.commit()?;
    Ok(state)
}

pub fn add_conversation(
    path: &Path,
    transcript: &str,
    operations: Vec<Operation>,
) -> Result<Snapshot> {
    let mut connection = connect(path)?;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    transaction.execute(
        "INSERT INTO conversations (transcript) VALUES (?1)",
        [transcript],
    )?;
    let conversation_id = transaction.last_insert_rowid();

    for operation in operations {
        match operation {
            Operation::Create {
                title,
                state,
                owner,
                evidence,
            } => {
                let exists: bool = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM loops
                     WHERE title = ?1 COLLATE NOCASE AND owner = ?2 COLLATE NOCASE
                     AND state != 'resolved')",
                    params![title, owner],
                    |row| row.get(0),
                )?;
                if exists {
                    continue;
                }
                transaction.execute(
                    "INSERT INTO loops (title, state, owner, evidence, conversation_id)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![title, state, owner, evidence, conversation_id],
                )?;
                let loop_id = transaction.last_insert_rowid();
                insert_event(&transaction, loop_id, conversation_id, "created", &evidence)?;
            }
            Operation::Resolve { loop_id, evidence } => {
                let changed = transaction.execute(
                    "UPDATE loops SET state = 'resolved', resolved_at = unixepoch()
                     WHERE id = ?1 AND state != 'resolved'",
                    [loop_id],
                )?;
                if changed > 0 {
                    insert_event(
                        &transaction,
                        loop_id,
                        conversation_id,
                        "resolved",
                        &evidence,
                    )?;
                }
            }
            Operation::Update {
                loop_id,
                title,
                state,
                owner,
                evidence,
            } => {
                let changed = transaction.execute(
                    "UPDATE loops SET title = ?2, state = ?3, owner = ?4, evidence = ?5 WHERE id = ?1 AND state != 'resolved'",
                    params![loop_id, title, state, owner, evidence],
                )?;
                if changed > 0 {
                    insert_event(&transaction, loop_id, conversation_id, "updated", &evidence)?;
                }
            }
            Operation::Keep { loop_id, evidence } => {
                insert_event(&transaction, loop_id, conversation_id, "kept", &evidence)?;
            }
        }
    }

    let mut state = read_snapshot(&transaction)?;
    state.conversation_id = Some(conversation_id);
    transaction.commit()?;
    Ok(state)
}

fn insert_event(
    connection: &Connection,
    loop_id: i64,
    conversation_id: i64,
    kind: &str,
    evidence: &str,
) -> Result<()> {
    connection.execute(
        "INSERT OR IGNORE INTO loop_events (loop_id, conversation_id, kind, evidence)
         VALUES (?1, ?2, ?3, ?4)",
        params![loop_id, conversation_id, kind, evidence],
    )?;
    Ok(())
}

fn read_snapshot(connection: &Connection) -> Result<Snapshot> {
    let conversations = connection
        .prepare("SELECT id, transcript, created_at FROM conversations ORDER BY id DESC")?
        .query_map([], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                transcript: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?
        .collect::<Result<_>>()?;
    let events = connection
        .prepare(
            "SELECT id, loop_id, conversation_id, kind, evidence, created_at
             FROM loop_events ORDER BY id",
        )?
        .query_map([], |row| {
            Ok(Event {
                id: row.get(0)?,
                loop_id: row.get(1)?,
                conversation_id: row.get(2)?,
                kind: row.get(3)?,
                evidence: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<Result<_>>()?;
    Ok(Snapshot {
        version: env!("CARGO_PKG_VERSION"),
        mode: "nemotron",
        conversations,
        loops: read_loops(connection)?,
        events,
        conversation_id: None,
    })
}

fn read_loops(connection: &Connection) -> Result<Vec<Loop>> {
    connection
        .prepare(
            "SELECT id, title, state, owner, evidence, created_at, resolved_at, conversation_id
             FROM loops ORDER BY id DESC",
        )?
        .query_map([], |row| {
            Ok(Loop {
                id: row.get(0)?,
                title: row.get(1)?,
                state: row.get(2)?,
                owner: row.get(3)?,
                evidence: row.get(4)?,
                created_at: row.get(5)?,
                resolved_at: row.get(6)?,
                conversation_id: row.get(7)?,
            })
        })?
        .collect()
}

pub fn save_tool_run(path: &Path, loop_id: i64, output: &serde_json::Value) -> Result<()> {
    connect(path)?.execute(
        "INSERT INTO tool_runs (loop_id, output) VALUES (?1, ?2)",
        params![loop_id, output.to_string()],
    )?;
    Ok(())
}

pub fn tool_runs(path: &Path, loop_id: i64) -> Result<Vec<serde_json::Value>> {
    connect(path)?
        .prepare("SELECT output FROM tool_runs WHERE loop_id = ?1 ORDER BY id DESC")?
        .query_map([loop_id], |row| row.get::<_, String>(0))?
        .map(|row| row.map(|text| serde_json::from_str(&text).unwrap_or_default()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validated_operations_persist_and_resolve_waiting_with_history() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        initialize(&path).unwrap();
        let first = add_conversation(
            &path,
            "Mike will send numbers.",
            vec![Operation::Create {
                title: "Mike sends numbers".into(),
                state: "waiting".into(),
                owner: "Mike".into(),
                evidence: "Mike will send numbers.".into(),
            }],
        )
        .unwrap();
        let id = first.loops[0].id;
        add_conversation(
            &path,
            "Mike sent the numbers.",
            vec![Operation::Resolve {
                loop_id: id,
                evidence: "Mike sent the numbers.".into(),
            }],
        )
        .unwrap();
        let persisted = snapshot(&path).unwrap();
        assert_eq!(persisted.conversations.len(), 2);
        assert_eq!(persisted.loops[0].state, "resolved");
        assert_eq!(persisted.events.len(), 2);
        assert!(persisted.loops[0].resolved_at.is_some());
        save_tool_run(&path, id, &serde_json::json!({"draft":"Thank you"})).unwrap();
        assert_eq!(tool_runs(&path, id).unwrap()[0]["draft"], "Thank you");
    }
    #[test]
    fn migrates_existing_preview_database_without_losing_history() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.db");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE loop_events (
            id INTEGER PRIMARY KEY, loop_id INTEGER NOT NULL REFERENCES loops(id),
            conversation_id INTEGER NOT NULL REFERENCES conversations(id),
            kind TEXT NOT NULL CHECK(kind IN ('created','resolved','kept')),
            evidence TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(loop_id, conversation_id, kind));",
            )
            .unwrap();
        drop(connection);
        initialize(&path).unwrap();
        let created = add_conversation(
            &path,
            "I'll call Jo.",
            vec![Operation::Create {
                title: "Call Jo".into(),
                state: "open".into(),
                owner: "Me".into(),
                evidence: "I'll call Jo.".into(),
            }],
        )
        .unwrap();
        add_conversation(
            &path,
            "Jo will call me instead.",
            vec![Operation::Update {
                loop_id: created.loops[0].id,
                title: "Jo calls me".into(),
                state: "waiting".into(),
                owner: "Jo".into(),
                evidence: "Jo will call me instead.".into(),
            }],
        )
        .unwrap();
        initialize(&path).unwrap();
        let saved = snapshot(&path).unwrap();
        assert_eq!(saved.loops[0].state, "waiting");
        assert_eq!(saved.events.len(), 2);
        assert_eq!(saved.events[1].kind, "updated");
    }
}
