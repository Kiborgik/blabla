# BlaBla 0.11.0

Small coding models drift from the goal and say "done" too early. BlaBla catches that: a human or a strong model writes the intent once, as contracts, and cheap models do bounded work that BlaBla checks. Version 0.11 says this plainly and makes the docs about four times shorter.

## Changed

- README, project rules, workflow, language, structure, project, expert and adapter docs are rewritten short, in plain English, with tables where people read them
- The native host schema is replaced by a short wire-contract section in `adapters/native/README.md`; the Rust types are the schema
- Test ownership moved into `CONTRIBUTING.md`
- The text printed after every `task` command is shorter
- Project memory states the drift and overconfidence problem; its prose is shorter and its existing identities are unchanged
- Five goals are added: `goal::short-plain-docs` for this release, and four backlog items found while dogfooding (evidence in `task show`, expert `--help` descriptions, a docs link check, self-carried task confirmation)

No contract syntax, CLI behavior, JSON field or exit code changed. History files are unchanged.

See the [full changelog](https://github.com/Kiborgik/blabla/blob/v0.11.0/CHANGELOG.md#0110-2026-10-11).
