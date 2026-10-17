# Protocol build-root review

## Verdict and attribution

No bounded source blocker found. The protocol directory now belongs to the existing source-to-artifact integrity boundary. This is an independent review of the orchestrator's protocol-root continuation by actual gpt-6-astra/high. I authored the original provenance tests, but not these new root-list or TypeScript changes; this is not independent authorship of the entire historical test suite.

Reviewed scope: `scripts/build-provenance.ts`, `tests/build-provenance.test.ts`, `tsconfig.json`, and the existing hosted verification call. The actual import from `server/worker.ts` to `protocol/choice-pages.ts` establishes why this is a build input. No production file was edited for this review.

## Source findings

- `INPUT_DIRECTORIES` includes `protocol` alongside the existing roots. Capture requires an ordinary directory, recursively enumerates its files, sorts the full path list, records each byte count and SHA-256, and hashes that canonical list. There is no second protocol-specific digest implementation.
- The same traversal rejects selected symlinks, symlinked ancestors, and non-file/non-directory children. The required-root guard rejects a missing protocol directory or its replacement with a file. Protocol additions and removals change the captured list; changed bytes change the file digest. These last two structural consequences follow from the shared traversal, rather than a new protocol-only test for every case.
- `sourceRoots` in the test fixture includes protocol. Existing parameterized assertions therefore actually exercise changed protocol bytes, missing protocol root and wrong protocol root type. The symlink cases remain shared traversal coverage using existing roots, not a claim of a separate protocol symlink fixture.
- `tsconfig.json` includes `protocol/**/*.ts` with the existing strict options. This is source inspection of the compilation boundary; the declared ten-test check is not a fresh whole-project typecheck.
- Receipt shape, pre-build versus post-build input comparison, packaged Worker/metadata hashing, and read-only verification remain shared. The hosted verifier checks provenance before importing the built Worker. No new output directory, copied hashing policy, cache, or version-only shortcut is introduced.
- The explicit root lists in implementation and tests serve different roles: production policy and an independently specified fixture expectation. Sharing the production list into tests would weaken the missing-root regression. No new abstraction is warranted. The change extends an existing single-purpose seam without altering its consumers or API.

## Evidence and chronology

I read the entire existing ten-test passing receipt at `.blabla/scratch/verify-build-provenance/evidence-3-31-1792165353619228261.log`: ten pass, zero fail, no skipped tests. It covers actual same-version stale-source refusal, unchanged proof verification, byte changes, additions/removals, missing and malformed inputs/receipts, excluded files, symlinks, changes during compilation and path-type replacements.

The target task explicitly discloses that the orchestrator's one-line fixture root edit and reported three-failure RED preceded reacceptance because a combined shell continued after a refused overlapping-scope amendment. This review preserves that chronology and does not retrospectively characterize that edit as accepted work. The reported `/tmp/protocol-provenance-red.log` is no longer present in this workspace; its three-failure history is therefore author-attested in the target ledger, not independently re-read here. I have not manufactured a substitute historical RED.

After this report text, run the declared `node --test tests/build-provenance.test.ts` through this review task's evidence command. Its recorded child exit and complete log are the deciding current execution evidence; this report does not predeclare its result. The review record supplies that exact log reference and verdict after inspection.

## Limits and next dependency

These are finite local fixtures and source inspection, not proof that a new build or deployment occurred. The independently reviewed root addition closes the identified omission, but publication still requires a frozen protocol-containing build whose current input and packaged-output digests verify. No broad build, deployment, gameplay transition or contract promotion was performed here. The useful successor is the already-owned integration artifact verification, not another root-specific hashing mechanism or a repeated broad audit.
