//! The model proposes operations; Rust validates them before any database write.
use crate::db::Loop;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum Operation {
    Create {
        title: String,
        state: String,
        owner: String,
        evidence: String,
    },
    Resolve {
        loop_id: i64,
        evidence: String,
    },
    Keep {
        loop_id: i64,
        evidence: String,
    },
    Update {
        loop_id: i64,
        title: String,
        state: String,
        owner: String,
        evidence: String,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Analysis {
    pub operations: Vec<Operation>,
}

impl Analysis {
    pub fn validate(&self, transcript: &str, active: &[Loop]) -> Result<(), String> {
        if self.operations.len() > 50 {
            return Err("Too many proposed operations".into());
        }
        let mut touched = std::collections::HashSet::new();
        for operation in &self.operations {
            let evidence = match operation {
                Operation::Create {
                    title,
                    state,
                    owner,
                    evidence,
                } => {
                    validate_fields(title, state, owner)?;
                    evidence
                }
                Operation::Update {
                    loop_id,
                    title,
                    state,
                    owner,
                    evidence,
                } => {
                    validate_fields(title, state, owner)?;
                    validate_id(*loop_id, active, &mut touched)?;
                    evidence
                }
                Operation::Resolve { loop_id, evidence }
                | Operation::Keep { loop_id, evidence } => {
                    validate_id(*loop_id, active, &mut touched)?;
                    evidence
                }
            };
            // Evidence must be a verbatim excerpt, never an invented justification.
            if evidence.trim().is_empty() || !normalize(transcript).contains(&normalize(evidence)) {
                return Err("Model evidence was not found in the transcript".into());
            }
        }
        Ok(())
    }
}
fn normalize(value: &str) -> String {
    value
        .replace('’', "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn validate_fields(title: &str, state: &str, owner: &str) -> Result<(), String> {
    if title.trim().is_empty()
        || title.chars().count() > 200
        || owner.trim().is_empty()
        || owner.chars().count() > 80
        || !matches!(state, "open" | "waiting")
    {
        return Err("Invalid commitment fields".into());
    }
    Ok(())
}
fn validate_id(
    id: i64,
    active: &[Loop],
    touched: &mut std::collections::HashSet<i64>,
) -> Result<(), String> {
    if !active
        .iter()
        .any(|item| item.id == id && item.state != "resolved")
        || !touched.insert(id)
    {
        return Err("Unknown, resolved, or repeated commitment ID".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invented_evidence_invalid_states_and_unknown_ids() {
        for data in [
            r#"{"operations":[{"operation":"create","title":"Call Jo","state":"open","owner":"Me","evidence":"invented"}]}"#,
            r#"{"operations":[{"operation":"create","title":"Call Jo","state":"done","owner":"Me","evidence":"Call Jo"}]}"#,
            r#"{"operations":[{"operation":"resolve","loop_id":999,"evidence":"Call Jo"}]}"#,
        ] {
            assert!(
                serde_json::from_str::<Analysis>(data)
                    .unwrap()
                    .validate("Call Jo", &[])
                    .is_err()
            );
        }
        assert!(
            serde_json::from_str::<Analysis>(
                r#"{"operations":[{"operation":"delete","loop_id":1}]}"#
            )
            .is_err()
        );
    }
}
