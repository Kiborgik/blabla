# Diagrams

The Mermaid sources (`*.mmd`) are the source of truth; the SVGs under `docs/assets/` are generated from them by `python experiments/render_diagrams.py` (Mermaid CLI through `npx`) and recorded in `manifest.json` with the hash of the source they were rendered from. `python experiments/render_diagrams.py --check` fails when a source changed without a re-render or an SVG was edited by hand. The renderer sizes each SVG to its content and paints an opaque plate behind it, so the dark strokes and labels stay readable on a dark page. Each source carries `accTitle` and `accDescr`; the text equivalents below are the same descriptions for readers without the images.

## concept

Human intent (requirements, decisions, architecture) is written into executable project memory: `project.bla` composing behavior and structure contracts. A coding agent reads that memory through `blabla status` and `blabla explain`, writes an ordinary implementation in any language behind a JSON Lines adapter, and runs `blabla finish`. Finish verifies structure and runs the behavior campaign; it reports OVERALL GREEN only when every active contract is satisfied, otherwise BLOCKED (RED, YELLOW, STALE or INTERRUPTED) and the agent returns to the memory.

## architecture

`project.bla` composes behavior and structure contracts. Behavior contracts pass through the parser and semantic checks (`src/syntax`, `src/semantics`) into one typed contract IR (`src/ir`), which the behavior verifier (`src/verify`) runs as a coverage-guided campaign against the application through the trusted runtime (`src/runtime`, JSON Lines adapter, `runtime::restart`), with counterexample shrinking. Structure contracts pass through their own parser (`src/structure/syntax.rs`) into a structure IR that the rule evaluator checks against facts from a provider chosen by file extension; v0.5 ships the Python provider, an isolated interpreter running BlaBla's embedded AST extractor that only reads source text. The behavior result and the run-state marker are written under `.blabla/` (`src/project/status.rs`, `runstate.rs`); structure is evaluated live. The CLI (`src/cli`) renders `status`, `explain` and `finish` from both, ending in the BEHAVIOR, STRUCTURE and OVERALL lines.

## agent-workflow

The `AGENTS.md` block sends the agent to `blabla status`, which shows BEHAVIOR, STRUCTURE and OVERALL and names the rules to inspect. `blabla explain <rule>` gives the counterexample or the observed structural fact; the agent edits the implementation, never the contracts, and runs `blabla finish`, which prints VERIFYING, progress and a verdict. RED or YELLOW mean NOT COMPLETE and lead back to explain and edit; OVERALL GREEN is completion.
