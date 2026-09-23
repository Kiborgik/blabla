# Research package

Active agent integration diagnostics and unresolved findings live in [evals/](../evals/README.md).
This directory holds curated evidence for published claims; raw local runs stay in ignored `artifacts/`.

Curated, auditable material behind the results quoted in `docs/research.md`. Everything here is a copy of the frozen benchmark inputs and outputs; nothing was re-run for publication. Raw session transcripts and run directories (hundreds of megabytes, containing absolute local paths) are not published; `haiku-handoff/methodology.md` describes how they were produced and they can be released separately after sanitisation.

```text
haiku-handoff/
    methodology.md        the frozen design as written before any subject ran, with the critique of the proposal
    manifest.json         frozen inputs for Conditions A and B (hashes, model settings, execution order)
    manifest-C.json       frozen inputs for the Condition C rerun under BlaBla 0.4.2
    results.json          per-stage measurements for A, B and the original C attempt; local path prefixes replaced by <benchmark>/
    results-v042.json     per-stage measurements for A, B and C under 0.4.2
    results.md            A/B tables
    results-v042.md       A/B/C tables
    report-A-B.md         narrative report of the A and B chains
    report-C-v042.md      narrative report of the Condition C chain
    controller.py         the controller that prepared, ran, measured and scored every session
    prompts/              the exact prompt files per stage and condition, the C AGENTS.md block, the requirements and decisions given to A
    scorers/              the hidden black-box behavior scorers, the architecture scorer and the JSONL driver they share
    contracts/stage-N/    the authoritative BlaBla contracts landed for Condition C at each stage
    reference/stage-N/    the hidden reference implementations used for validation
```

The scorers import the JSONL driver from their own directory here (in the original tree it lived beside the Glyph Vault base tests); no other line was changed.

`results.json` also carries the abandoned first Condition C attempt that the A/B report discusses only as background; the headline C numbers are those of `results-v042.json`.
