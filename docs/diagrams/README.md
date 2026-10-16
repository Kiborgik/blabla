# Diagrams

The Mermaid sources here are the truth; the SVGs in `docs/assets/` are generated and never edited by hand. `manifest.json` binds each source to its SVG by SHA-256.

```sh
python experiments/render_diagrams.py           # render (pinned Mermaid CLI via npx; BLABLA_CHROME picks the browser)
python experiments/render_diagrams.py --check   # hashes and accessibility text, not looks
```

Look at the SVGs after rendering. The current set was rendered with Mermaid CLI 11.4.2 (Mermaid 11.17.2) in Playwright 1.63.0 WebKit.

## concept

Owner intent enters `project.bla` in two forms: executable Behavior and Structure contracts, and queryable memory (Mission, System, Process, Knowledge, Goals). People and agents use `status` and `explain` to find context, then change ordinary code. `finish` checks the code against the active contracts; only those checks decide OVERALL GREEN or BLOCKED.

## architecture

Two pipelines: behavior parsing and typed IR feed a finite campaign through the app adapter; structure parsing feeds the source providers and one fact evaluator. `finish` combines fresh behavior and live structure into OVERALL. Beside them, memory answers queries, task records feed the challenge, and host checkpoints feed optional expert advice. None of these decide done.

## agent-workflow

The orchestrator finds context with `status` and `explain` and opens a bounded task. The worker accepts, works inside its scope, records evidence and lens assessments, challenges the record and hands back. A separate reviewer checks the diff and evidence and records findings; fixes go back through acceptance and new evidence. The orchestrator resolves findings, confirms its records, closes the task and runs `finish`. Optional expert advice enters only at eligible checkpoints and has no scope or gate authority.
