# Hosted build provenance review

Reviewer: `gpt-6-astra` (high), `review-build-provenance`.
Scope: the allowlisted local source/output receipt and its hosted build/verifier
integration. No managed artifact, publication, activation or secret scan performed.

## Findings and disposition

The initial helper had three observable source-level gaps: required file/directory
kinds were interchangeable when stamping; the receipt was read without rejecting
its symlink; and multi-component allowlist entries did not reject symlinked
ancestors (`.openai` and `dist`). The author repaired all three in the current
helper. The ancestor concern was independently reported before my reproduction
ran, but that reproduction executed after the repair: both ancestors correctly
refused with `Build provenance refuses symlink`. It is post-fix evidence, not an
invented pre-fix executed RED.

Current source review finds no remaining blocker to this bounded local safeguard.
The focused author/regression evidence is recorded below; acceptance does not
establish the content of any previously saved hosted artifact.

## Actual boundary inspected

- `scripts/build-provenance.ts` hashes only seven explicit input files and six
  source directories: package/lock, both tsconfigs, Vite config, HTML, hosting
  manifest; `core`, `server`, `web`, `visuals`, `public`, `scripts`. It reads no
  arbitrary repository root files or ignored dependency/cache directory.
- Source entries have relative path, byte length and SHA-256. Directory children
  and the final input list are lexically sorted; the combined input digest hashes
  that exact JSON list. Output roots use fixed order and sorted recursive children:
  `dist/server` and `dist/.openai`, including copied migration data. No timestamps
  or machine-specific absolute paths enter the receipt.
- Selected input/output roots require their declared kinds. The Worker entry must
  be an ordinary file. Recursive traversal rejects symlinks and non-file leaves;
  every selected path's ancestors are checked for symlinks. The existing receipt
  must be an ordinary file before writing, and its path is checked before reading.
- `scripts/build-hosted.ts` captures source before the browser build and retains
  that digest through Worker bundling and migration copying. The final writer
  captures inputs again, rejects a changed digest before writing, and hashes the
  produced output trees. The production caller always supplies the earlier digest.
- `scripts/verify-hosted.ts` checks provenance before importing or executing the
  Worker artifact. Missing, invalid JSON, wrong-schema, stale-input and stale-output
  receipts refuse; verification never writes or regenerates a receipt. Exact
  decoded-object serialization comparison is deliberately conservative about shape
  and order, rather than a permissive schema migration.
- Existing artifact checks still verify embedded HTML/client assets, uncached
  version response matching local source, anonymous mutation denial, hosted
  metadata and migration journal. Receipt equality supplements those checks;
  it does not replace them or prove authentication beyond that existing assertion.

`package.json` runs build-hosted followed by verify-hosted. A new source with an old
ignored `dist` or absent receipt is therefore rejected when this verification is
run against the actual pair being packaged. The reviewer did not execute the
external save helper or establish what it packages after local verification.

## Focused tests and limits

The declared check is `node --test tests/build-provenance.test.ts`. Its isolated
fixtures cover the artifact-only predecessor accepting a plausible stale Worker,
current verifier rejection without proof, deterministic receipt bytes, unchanged
filesystem snapshots on verify/refusal, every selected source/output mutation,
added/removed inputs, missing roots/files, malformed proofs, excluded README/cache/
test files, symlink files/directories/ancestors/receipt, wrong filesystem kinds and
a source change between pre-build capture and the final stamp.

The predecessor counterexample is an actual isolated execution of the old verifier
shape with its provenance import/call removed. It is not a managed-runtime replay
or a claim to have reproduced the external helper's internals.

This is a trusted local build-consistency receipt, not a signed supply-chain
attestation or proof of reproducible compilation. It does not bind installed
`node_modules` bytes, Node/OS/toolchain versions, environment variables, external
inputs, or files outside its explicit allowlist. Lock/config files are bound;
installed package integrity is not established by hashing the lock alone. No current
application/config source inspected here consumes an environment variable, but
future build dependencies must trigger an explicit allowlist review.

The before/after captures are not a filesystem transaction: a change followed by
an exact restoration between captures is not detected, and a later write can stale
the result after verification. Build from frozen inputs, verify the exact artifact
pair at the packaging boundary, and preserve the receipt alongside those bytes.
The helper's writer is exported with an optional expected digest for isolated use;
only the build integration's supplied pre-build digest establishes the checked
build window. Manually stamping arbitrary outputs is not independent provenance.

No hosted quota, immutable saved-version repair, compression activation, new
permissions, or successful save is inferred from these local results.

## Deciding evidence

- Author prospective RED: `.blabla/scratch/verify-build-provenance/evidence-1-5-1792160293543829738.log`, seven pass and three fail for the absent Worker, symlinked receipt and wrong required-root kind. The ancestor regression was added after repair.
- Author GREEN: `.blabla/scratch/verify-build-provenance/evidence-2-5-1792160370883734858.log`, ten pass; scoped `final-lint.log` exits zero. Both full test logs were read. Initial fixture omissions were corrected and disclosed by the test author.
- Independent execution: `.blabla/scratch/review-build-provenance/evidence-1-8-1792160491916752060.log`, ten pass, full log read. The final report revision receives the same exact check in the task evidence ledger; no unrelated suite is counted as proof here.

The parent authored the helper and integrations; the core worker authored the
focused tests. This report records independent source and evidence review.
