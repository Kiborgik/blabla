---
weight: 2
type: "regex"
target: {"source": "file", "path": "widget/store.py"}
pattern: "^\\s*import\\s+json|^\\s*from\\s+json\\s+import"
match: "not_contains"
---
