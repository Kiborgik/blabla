# Accepted effort and freshness publication manifest

Prepared 2026-10-16 by actual gpt-6-astra/high under `prepare-accepted-tooling-publication`. This is an exact local file/dependency handoff for the orchestrator, not Git publication, remote-base reconciliation or a new verification verdict. No product check or campaign was rerun for this report.

## Acceptance and coherent file set

All seven implementation/review tasks below are CLOSED with bounded result bases explicitly retaining stale project verification. Their source acceptance does not establish current overall GREEN. The following25 paths are the union of their approved scopes. All exist. Twenty-four current files match at least one CLOSED result-basis byte pin; the documentation exception is stated separately. SHA-256 identifies current bytes for owner copying. Local baseline labels compare only the preserved `blabla-goal-delivery-accepted-source` directory, not a verified remote commit.

| Path | Local baseline | SHA-256 | Owning closed task(s) |
| --- | --- | --- | --- |
| `bridge/development_effort.rs` | absent | `45f168a73e8656ad9a738680c314c6ff471719fedaf63f83e93202b7a3c7a0ed` | bind-development-effort-contract |
| `bridge/structure_adapter.rs` | changed | `95e3eb15270aaac09456901fdf43c7b6b15f2f5c796bf9421f62bdccb16db3e8` | compose-development-effort |
| `docs/agent-workflow.md` | changed | `85a47774c98e285750436f12be70582c7cea749820c638f9c59b45f229dddfef` | implement-development-effort-budget, implement-precise-task-freshness |
| `reviews/development-effort-bindings-implementation.md` | absent | `eca0dcb1ab508d8dea59d7dafaf0912979589a565e15c5e99f83eeccdc6e2af2` | bind-development-effort-contract |
| `reviews/development-effort-composed.md` | absent | `9813818d1bae8a66610f6a14466dfeab79b0e497ce135714f04f9f357afd4ba2` | compose-development-effort |
| `reviews/development-effort-composition-review.md` | absent | `a1a67b3cd5253a2205bc4d8ec57eb77c3af4d13693f257fe8719a104dfde9268` | review-effort-composition |
| `reviews/development-effort-implementation.md` | absent | `fb704ab158855e32eb1735679852c7fc354780629d913cb758b0bb9d6d356ac4` | implement-development-effort-budget |
| `reviews/development-effort-review.md` | absent | `5eff52c8771ebbc974da0291db31f87de5c63a6cc23bb78a7060d1385a9312a1` | review-development-effort-budget |
| `reviews/task-freshness-implementation.md` | absent | `55d7bd49a5bad480b0d41744032278b5bf9c699c8f4bce4887dc31f4c433bf1d` | implement-precise-task-freshness |
| `reviews/task-freshness-review.md` | absent | `4bfca43b3649f34e7c780b15fbb397786262e3e1b75e5eb479783e4fcf3a271d` | review-precise-task-freshness |
| `src/cli/mod.rs` | changed | `315bf4a356160586f76e683d95bdb27d3015ccc6c4016072509e9975df338d0b` | implement-development-effort-budget, implement-precise-task-freshness |
| `src/cli/project.rs` | same | `05139f7a285eb5213ac246a51290d85de74d3a8c6e410af5508b69ef192bd899` | implement-development-effort-budget |
| `src/cli/task.rs` | changed | `ffef34f59b711b40af34972d42956b8f0278d7b8f2ae292c22950a9bdd56d832` | implement-development-effort-budget, implement-precise-task-freshness |
| `src/cli/task/effort.rs` | absent | `55ffa58a3fd0660bcf1ed16570ed751008dfab6c5439c7ca172b4ca7adac7278` | implement-development-effort-budget |
| `src/cli/task/freshness.rs` | absent | `318d481ba39a6e9636502d9243d84250136fce140ece884a5daaa5686793d324` | implement-precise-task-freshness |
| `src/project/task.rs` | changed | `25fa8306952c910ac044eb8a94540f46f9c69750d433574b8e7321b2a58e3c5c` | implement-development-effort-budget |
| `src/project/task/effort.rs` | absent | `3983aa8be812dd405fe09cc4f44b21cadc700cb129836cd9e8070cda8591f8d0` | implement-development-effort-budget |
| `src/project/task/revision.rs` | same | `a642a2bd23c5009c7a9006690e9607ad64118acce5f8662f2e9bdbe47fe35382` | implement-development-effort-budget |
| `src/skeptic.rs` | changed | `78a1ca79ab3966f5e80a6c319315973625752a8aeedbae127814976c64b6c376` | implement-precise-task-freshness |
| `src/voice.rs` | changed | `26fe5a9fa5ee42ce5970d6b2cea510dd92c411516d599dd79cdd3a6107ad83b2` | implement-development-effort-budget, implement-precise-task-freshness |
| `tests/coverage.rs` | changed | `e1c4e9f9f0fc19c992ba6bc9f79b9e03d5c652f12c1576517ba564c2d9f90a76` | compose-development-effort |
| `tests/development_effort.rs` | absent | `32733448275b1b1f1e4e3b70d344728599b8b86755939cc294c5a0c711784f0a` | implement-development-effort-budget |
| `tests/development_effort_bindings.rs` | absent | `39c14e3c5ca72f531826793e6dbccbb65048a46784bff6af7dc407dafc2ec1da` | bind-development-effort-contract |
| `tests/development_effort_composition.rs` | absent | `cf06e4ef7bd13bfdfa7b1326d8b95cf796fb2433decee9160657d61254c5401f` | compose-development-effort |
| `tests/task_freshness.rs` | absent | `887d96794ebb79eea20aa19d6ad360434b019e71f2903edc646814904b634391` | implement-precise-task-freshness |

`src/cli/project.rs` and `src/project/task/revision.rs` are unchanged against that local baseline despite being authorized effort scope; do not manufacture changes to them. `docs/agent-workflow.md` contains the scoped effort and freshness sections but neither author check/result-basis pinned this path. Its current prose was read and agrees with the accepted commands and limits; the owner should inspect this documentation delta directly before publishing rather than treating it as a recorded byte-pinned check.

## Imported dependency correction

`bridge/structure_adapter.rs` imports and calls `ready_receipts` as well as `development_effort`. The READY receipt bridge is absent from the preserved local baseline. It is CLOSED under `bind-ready-receipt-contract`; include the following accepted prerequisite if the actual remote base also lacks it:

- `bridge/ready_receipts.rs` SHA-256 `bde03f85688c51101b54385e3d37be6d4adb53fa12b4b421390929c4a4032d7d`
- `tests/ready_receipt_bindings.rs` SHA-256 `1846f87d60fed4d2229e318692e9db3c97970b7eeed5df4158e90d80ee13a7a6`
- `reviews/ready-receipt-contract-bindings.md` SHA-256 `e152a97580119bcdfe0e2790c812c5b07aa12ff554280535b261970ee4932c72`

Prerequisite deciding receipt: `.blabla/scratch/bind-ready-receipt-contract/evidence-2-39-1792182204675102588.log`,9/9. Its original prospective evidence and refusal controls remain preserved. Do not copy the dispatcher without all its existing imported peers. The other directly declared peers are assignment, attestation, bounded_results, decisions, expert, goals, lifecycle, questions, task_roles and voice; these match the preserved local baseline.

The effort bridge directly imports the existing memory/process and project/task APIs and invokes the current-source Cargo CLI. `Cargo.toml`, `Cargo.lock`, `src/memory/{mod,process,syntax}.rs` and `src/project/mod.rs` match the local baseline. Cargo already declares the example at `bridge/structure_adapter.rs`, and tempfile/serde_json/libc support already exists. `tests/coverage.rs` includes that dispatcher but has its own explicit App routes; both paths were independently checked. `tests/development_effort_composition.rs` includes the actual development-effort contract. `bridge/goal_delivery.rs` is separately CLOSED but is not imported by this dispatcher or effort bridge; it is not an automatic dependency of this packet.

## Owner declarations and exclusions

The coherent metadata is owner-controlled: `contracts/development-effort.bla`, its `draft behavior` registration in `project.bla`, `policy::development-time-budget` in `process.bla`, and `goal::measured-proportionate-development-effort` in `goals.bla`. These files remain in the ACCEPTED `author-bounded-result-policy` task, not one of the closed worker scopes. Reconcile only the intended declaration changes against the actual remote tree; do not sweep every concurrent owner edit into publication. Effort remains draft. Canonical seed0,8×512,5000ms,shrink256 remains unchanged.

- Current owner file `contracts/development-effort.bla` SHA-256 `adb0578375c8e94ad3d1f3ea70a0f95fe50cca0f570791b68d18eeaebc19ce32`
- Current owner file `project.bla` SHA-256 `e485a46c465888cf034b402387b8515fb2e74b649f0b92692ae91e384fc73d42`
- Current owner file `process.bla` SHA-256 `9a2c24931ce3344a053869c780af7384fef4d5363c2f81b3891c40d20be3db56`
- Current owner file `goals.bla` SHA-256 `9aebbd3dfa7083dfa7f1f51f97f80fee751e0f64e88b0d8a7014b7cbae13989b`

Exclude unrelated game changes under `examples/agentic-mmo`, ignored build output, local task/status stores, scratch receipts and temporary native-play files. References to local logs below are evidence locations, not instructions to publish private operational stores. `docs/project.md` is not part of these accepted effort/freshness scopes. Provisional paths `src/cli/effort.rs`, `bridge/effort_adapter.rs` and `tests/effort.rs` do not exist.

The design/context reports `reviews/development-time-budget.md`, `reviews/development-effort-bindings.md`, `reviews/development-effort-composition.md` and `reviews/precise-freshness-feedback.md` remain READY in their own tasks. They are useful retained research, but are not silently upgraded to CLOSED by this manifest. Other READY research/review reports and this still-active publication report require their own owner disposition before being described as accepted. Separately closed goal-delivery bridge files may be selected by the owner as a distinct packet; this manifest does not imply their composition or promotion.

## Existing accepted receipts

| Closed task | Deciding receipt | Scope of evidence |
| --- | --- | --- |
| `implement-development-effort-budget` | `.blabla/scratch/implement-development-effort-budget/evidence-4-15-1792178395607623642.log` | 17 integration +4 private final-reread cases |
| `review-development-effort-budget` | `.blabla/scratch/review-development-effort-budget/evidence-1-2-1792178756206841355.log` | 17 independent integration cases; existing4 race results reused |
| `bind-development-effort-contract` | `.blabla/scratch/bind-development-effort-contract/evidence-2-2-1792185620918846923.log` | 8 current standalone cases after freshness dispatch-only drift |
| `compose-development-effort` | `.blabla/scratch/compose-development-effort/evidence-1-25-1792182746822013467.log` | 2 transport +1 in-process integration cases |
| `review-effort-composition` | `.blabla/scratch/review-effort-composition/evidence-1-2-1792183410193770711.log` | Independent2+1 cases and source review |
| `implement-precise-task-freshness` | `.blabla/scratch/implement-precise-task-freshness/evidence-1-189-1792184252388427153.log` | 16 focused CLI cases; separate5 voice controls retained |
| `review-precise-task-freshness` | `.blabla/scratch/review-precise-task-freshness/evidence-1-2-1792185396916836493.log` | 16 independent focused CLI cases and source review |

The latest effort-binding refresh reconstructed both previous dispatch digests by removing only the freshness module declaration, command variant, pre-lock route and unreachable locked-match branch: task.rs `5566ffab68f22ea9`, mod.rs `e5a3bc5ea7f6ce49`. It did not change effort behavior. Earlier genuine REDs and invocation mistakes remain in their original logs; shell127 is not behavioral RED.

The single supplementary composed draft campaign is retained in `.blabla/scratch/compose-development-effort/campaign.json` with its command, stderr and metadata: seed0,2×64,5000ms,shrink32;27/27 obligations,128actions,6resets,4replay,0reductions;21.347s external elapsed and51–447ms local requests. Root status SHA-256 was unchanged. It is neither a current canonical campaign nor a whole-profile cost guarantee. No repeat was needed for this manifest.

## Measured overhead and supported reduction

One read-only cross-project budget snapshot at approximately21:29UTC, root plus example, reported valid captured totals: development6476s, verification4507s, review2026s, integration839s; active13848s, overhead7372s, observed53.2351%, above the20% target. External blocked615s is separate. Coverage is partial:220 legacy tasks,6 pending intervals,5 unknown intervals,118 rows with68 omitted from the50-row presentation. No overlap/input diagnostic was reported. Pending/unknown time is excluded, not assumed free or reconstructed. The report-preparation interval was still pending. Source: `/tmp/tooling-publication-budget.json`; this is one snapshot, not a historical-compliance claim.

The freshness implementation alone previously recorded470s development,89s verification and103s integration:192/662=29.00%, also above target. Neither synthetic exact20% test arithmetic nor a GREEN campaign changes those observations.

The smallest supported remedy is already in use: run the read-only receipt-relative freshness view, inspect the exact changed paths/identities and unavailable boundaries, wait for affected inputs to settle, then reassess explicit claims and run only the required focused receipt once. Preserve unaffected author/reviewer evidence and use one substantive independent review. The binding refresh isolated two dispatch files and reused the accepted mechanics/composition evidence. This is an observed reduction in scope, not a measured causal time-saving estimate. Required correctness/release work still needs an explicit owner budget exception when warranted; no gate or outcome obligation is waived.

## Handoff boundary

Owner directly reviews the unpinned documentation and intended declaration hunks, reconciles the listed files and prerequisite against the actual remote base, retains the required release checks, then publishes and verifies the remote reference. No new implementation mechanism, contract promotion, canonical rerun or Git mutation was performed by this worker.
