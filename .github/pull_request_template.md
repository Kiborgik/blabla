## What changed

## Why

## Tests

Which checks you ran, and what they said:

```text
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
python -m unittest discover -s examples/todo -p "test_*.py"
python -m unittest discover -s experiments -p "test_*.py"
```

## Checklist

- [ ] Language semantics changed (grammar, IR, evaluation, verdicts). If yes, say what and why.
- [ ] A new acceptance example is included: a project that is RED before the change and GREEN after, or the reverse.
- [ ] Backward compatible for existing contracts and `--json` consumers. If not, the break is described above and in `CHANGELOG.md`.
- [ ] Docs updated (`docs/language.md`, `docs/project.md`, `docs/structure.md`, `docs/agent-workflow.md`, `README.md`).
- [ ] Tests assert ids, JSON fields and structure, not translatable prose.
- [ ] No new way for a rule BlaBla cannot evaluate to be counted GREEN.
