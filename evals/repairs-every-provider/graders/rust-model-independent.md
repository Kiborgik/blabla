---
weight: 1
type: "regex"
target: {"source": "file", "path": "rust/src/model.rs"}
pattern: "crate::store|super::store"
match: "not_contains"
---
