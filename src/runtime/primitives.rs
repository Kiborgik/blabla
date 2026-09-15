use crate::ir::ActionKind;
use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Fact {
    pub key: &'static str,
    pub holds: bool,
    pub statement: &'static str,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Primitive {
    pub id: &'static str,
    pub owner: &'static str,
    pub summary: &'static str,
    pub semantics: &'static [Fact],
    pub distinction: &'static str,
}

pub const PREFIX: &str = "runtime::";

pub const RESTART: Primitive = Primitive {
    id: "runtime::restart",
    owner: "BlaBla verifier",
    summary: "trusted process restart of the application under verification",
    semantics: &[
        Fact {
            key: "process_recreated",
            holds: true,
            statement: "terminates the owned application process tree and launches a fresh application process",
        },
        Fact {
            key: "process_memory_preserved",
            holds: false,
            statement: "does not preserve process memory",
        },
        Fact {
            key: "persistent_environment_preserved",
            holds: true,
            statement: "preserves the verifier-managed persistent data directory and its contents across the fresh process",
        },
        Fact {
            key: "reset_requested",
            holds: false,
            statement: "sends no application reset command; the fresh process starts from what the previous one persisted",
        },
    ],
    distinction: "This is not an application-level reset or restart action; the application receives no command for it.",
};

pub const ALL: &[Primitive] = &[RESTART];

pub fn find(id: &str) -> Option<&'static Primitive> {
    ALL.iter().find(|primitive| primitive.id == id)
}

pub fn for_action(kind: ActionKind) -> Option<&'static Primitive> {
    match kind {
        ActionKind::Restart => Some(&RESTART),
        ActionKind::Application => None,
    }
}

pub fn ids() -> Vec<&'static str> {
    ALL.iter().map(|primitive| primitive.id).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primitives_have_unique_ids_and_complete_semantics() {
        let ids = ids();
        let mut unique = ids.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(ids.len(), unique.len());
        for primitive in ALL {
            assert!(primitive.id.starts_with(PREFIX));
            assert!(!primitive.owner.is_empty());
            assert!(!primitive.summary.is_empty());
            assert!(!primitive.distinction.is_empty());
            assert!(!primitive.semantics.is_empty());
            for fact in primitive.semantics {
                assert!(!fact.key.is_empty());
                assert!(!fact.statement.is_empty());
            }
        }
    }

    #[test]
    fn restart_actions_resolve_to_the_restart_primitive_and_application_actions_to_none() {
        assert_eq!(for_action(ActionKind::Restart).unwrap().id, RESTART.id);
        assert!(for_action(ActionKind::Application).is_none());
        assert_eq!(find("runtime::restart").unwrap().id, RESTART.id);
        assert!(find("runtime::reset").is_none());
    }
}
