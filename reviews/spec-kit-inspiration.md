# What to borrow from Spec Kit for growing BlaBla intent

Research: 2026-10-16, 08:23–08:29 UTC. Research task: `research-spec-kit-intent`; researcher: `gpt-6.1-sol`.

## Recommendation

Borrow a **read-only registered-file inventory and a bounded, evidence-linked coverage review**. Reuse BlaBla's existing manifest, canonical identities, goals, tasks, review revisions and new opt-in intent dispositions. Do not import Spec Kit's installation, workflow, extension, preset or second planning-ledger machinery. Neither matching names nor an agent-generated coverage percentage proves that requirements are implemented or mutually consistent.

The first useful increment is an opt-in inventory that makes forgotten `.bla` files and unresolved registrations visible without automatically loading them. Requirement-to-contract/task coverage is a separate subsequent read-only report. Memory sharding is a genuine language limitation, but should follow demonstrated need and a separate prospective design.

## Source pin and method

The official `github/spec-kit` default branch was verified as `main` through GitHub repository metadata, then pinned to [commit f6e72bc8523de8ec8368129cbdea78d45f27cef8](https://github.com/github/spec-kit/commit/f6e72bc8523de8ec8368129cbdea78d45f27cef8), dated **2026-10-15T18:57:23Z**. All external source links below use that immutable commit. This means current at the start of this inspection, not a promise that `main` will remain there. The checkout's `pyproject.toml` declares `1.2.1.dev0`; the commit's mention of an evaluator-extension version is not the Spec Kit release version.

I read official command templates, prerequisite and feature-path helpers, artifact catalog/resolver implementation, and reference/upgrade documentation using the GitHub connector. Public search was used for discovery only. No external package, template, hook or script was installed or executed. The local comparison reads this BlaBla working tree, including the independently reviewed `add-intent-disposition` patch and its legacy adapter repair; it does not imply that every concurrent change has completed the canonical gate.

Sources: [package and CLI entry point](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/pyproject.toml#L1-L25), [CLI command registration](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/src/specify_cli/__init__.py#L391-L497).

## What current Specify and Analyze actually do

### Feature specification is agent-guided authoring

`specify` is the Python CLI that installs and manages the surrounding assets. The feature-authoring process is the agent command represented by `templates/commands/specify.md`, not a deterministic requirements compiler. It creates one feature directory and `spec.md`, resolves the active template, and persists the chosen feature path independently of a Git branch. Branch creation is now optional through a hook. It asks for testable requirements, measurable outcomes, documented assumptions and a separate quality checklist; unresolved important questions are bounded. The spec template supplies explicit `FR-###` and `SC-###` examples and independently testable stories.

Useful borrowing: stable references, concise scope and visible assumptions. Do not adopt its suggested guesses about authentication, retention or other consequential choices as BlaBla policy. Keep technical constraints when the owner actually requires them; a generic what/why writing convention must not erase executable architecture intent.

Sources: [Specify command](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/templates/commands/specify.md#L65-L144), [spec template](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/templates/spec-template.md#L11-L118), [feature-path helper](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/scripts/python/common.py#L83-L185).

### Analyze is structured semantic review, not executable proof

The Analyze template directs an agent to inspect `spec.md`, `plan.md`, `tasks.md` and the live constitution after tasks exist. It inventories requirements and stories, maps tasks through explicit references or inference, and reports duplication, ambiguity, underspecification, authority conflicts and coverage gaps. It requests source locations, severity, a compact coverage summary and proposed next actions. Buildable success criteria are distinguished from later business outcomes. Findings are bounded to 50, with overflow summarized.

The prerequisite helper resolves feature paths and checks required files, including a nonempty plan; it does not perform the template's semantic analysis. Therefore a task mentioning a requirement ID is a claimed link, not evidence that its implementation satisfies that requirement. Spec Kit's task template also makes tests conditional on the requested feature; this is not a replacement for BlaBla's declared checks and executable contracts.

The core Analyze instructions forbid source edits and require approved remediation, but the same template permits executable extension hooks before and after analysis. The Python path helper can also persist feature selection when an override is supplied. Do not treat the complete invocation as inherently side-effect-free or execute it merely to obtain inspiration.

Sources: [Analyze model and detection passes](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/templates/commands/analyze.md#L52-L151), [reporting and hooks](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/templates/commands/analyze.md#L153-L257), [prerequisite implementation](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/scripts/python/check_prerequisites.py#L205-L263), [conditional test tasks](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/templates/tasks-template.md#L10-L20).

### The most directly reusable idea is inventory over an existing resolver

The read-only `specify artifact list/info` surface describes known commands, templates, scripts and hooks, including provenance and the effective composition stack. Its implementation projects the existing preset resolver rather than introducing a competing resolution algorithm. Inventory visibility is explicitly distinguished from successful content composition. That separation is valuable for BlaBla even though BlaBla does not need a preset stack.

Current constitution handling is also instructive: its template and upgrade guide say to read the live constitution at runtime and update only that document, with a temporary impact summary. They explicitly moved away from propagating copied policy into templates. The higher-level agentic reference still has looser wording about keeping templates synchronized; the pinned specific template and upgrade explanation settle that detail.

Sources: [artifact catalog implementation](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/src/specify_cli/artifacts/catalog.py#L277-L407), [projection over the existing resolver](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/src/specify_cli/artifacts/resolution.py#L373-L407), [inventory semantics](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/docs/reference/artifacts.md#L128-L164), [constitution scope](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/templates/commands/constitution.md#L21-L35), [runtime-authority upgrade](https://github.com/github/spec-kit/blob/f6e72bc8523de8ec8368129cbdea78d45f27cef8/docs/upgrade.md#L211-L239).

## BlaBla already has important parts

| Concern | Actual existing support | Remaining gap or limit |
| --- | --- | --- |
| Register growing contract files | Explicit active/draft behavior and structure entries; missing/repeated paths and duplicate/reserved groups are rejected; `as` supplies stable group aliases | No recursive project-wide orphan inventory. Registration is explicit, not automatic discovery |
| Names and composition | Canonical `contract::group` and `group::rule` identities; active behavior files compile together | Group aliases namespace rule identities, not independent hierarchical modules. A nested project manifest cannot be included as a contract |
| Memory growth | Multiple knowledge files, validated references between systems, responsibilities, seams, goals and consulted packs | Mission, system, process and goal registration each permit one file. They cannot currently be split across independently registered shards |
| Status and references | Status/explain expose registered layers and identities; memory validation reports unresolved references | Unregistered-file warnings cover conventional root memory names and immediate knowledge-directory files, not every `.bla` under the project |
| Requirements and work | Goals name expected rules/contracts; tasks may link a declared goal; scoped resolution identifies affected contracts | There is no complete reverse inventory proving that each owner requirement has a sufficiently specific contract and active/closed implementation task. A broad contract proxy may cover only part of a prose goal |
| Current evidence | Task inputs, scope, acceptance epochs, challenge receipts and review dependencies bind concrete revisions | Hash freshness detects change, not meaning or completeness |
| Current intent accountability | The new opt-in disposition gate uses the same review identities and relevant revision, plus every scoped source digest; it retains removed identities as explicit obligations | It enforces current reasons and accountability, not the truth of an `updated` claim. Flow/step prose is not separately enumerated by the existing resolver; declare those files as review inputs when needed |

Local source basis: [manifest model and registration](../src/project/mod.rs#L59-L76), [duplicate and alias checks](../src/project/mod.rs#L354-L516), [manifest inclusion rejection](../src/project/mod.rs#L1024-L1048), [conventional-file warnings](../src/memory/mod.rs#L68-L104), [goal reference validation](../src/memory/goal.rs#L160-L241), [shared review identities](../src/cli/task.rs#L360-L477), [relevant revision](../src/project/task/revision.rs), [intent receipts](../src/project/task.rs#L615-L697), [grounded intent gate](../src/skeptic.rs#L1071-L1107), [prospective integration tests](../tests/intent_disposition.rs).

## Bounded next work, in order

### 1. Add a read-only registration inventory

Project the existing manifest/parser/status data into rows containing declared path, kind/layer, active/draft state, canonical group or memory identities, readability and incoming references. Separately report discovered but unregistered `.bla` paths. Do not parse a forgotten file as authoritative, promote a draft, rewrite a manifest or change OVERALL from this report.

A scoped scan must honor existing ignore rules, reject unsafe traversal/symlink behavior consistently, stop at nested project boundaries, and distinguish explicitly registered external shared knowledge from accidental orphans. Start with a bounded, deterministic listing and diagnostics; add filters/paging only after actual volume warrants them. This borrows visibility and provenance, not Spec Kit's layering machinery.

Acceptance examples: a newly added forgotten contract is listed; a registered missing file stays an error; duplicate aliases retain existing diagnostics; ignored/generated files and the nested MMO do not become false orphans; output remains stable across runs; the inventory never activates a contract.

### 2. Add a separate requirements-to-work coverage view

Reuse `goal.expect`, task goals, canonical rule identities, current evidence and review receipts. Report expected rule/contract with no linked task, tasks with no declared requirement link, coarse proxies needing review, stale evidence and missing/unreviewed mappings. An unlinked maintenance task may be legitimate; show it for review rather than inventing a goal or silently failing it.

Keep explicit links distinct from inferred candidate matches. Every semantic finding needs the conflicting statements, source locations, impact and a bounded repair suggestion. A percentage can describe recorded links only; it must never become semantic confidence, automatic goal completion or GREEN. Source authors approve intent changes in separate scoped work.

### 3. Reuse scoped review and disposition rather than add a second lifecycle

An optional analysis packet can use an existing review task, explicit relevant inputs and progressive disclosure. Record findings through normal task ownership, then require the existing updated/confirmed-unchanged disposition where opted in. Consult live mission/process/knowledge instead of copying their rules into generated plans. Do not add another scheduler, agent launcher, task database, universal specification template or automatic remediation path.

### 4. Design memory sharding only as a later language change

If a single system/process/goal file becomes the demonstrated bottleneck, separately specify multi-file registration, global identity uniqueness, cross-file references, deterministic loading, source-location reporting and freshness under rename/removal. Preserve one authority and existing behavior for projects that do not opt in. File hierarchy alone must not imply semantic coverage or a new namespace. No such production change is proposed inside this research task.

## Verification and limits

The declared command is `python3 experiments/check_text.py links`. It checks repository Markdown link hygiene, not external source truth, semantic conclusions or research completeness; it skips external URLs and obtains its file list from Git, so an unstaged new report is not included until tracked. External pin/path claims above were verified by connector reads. No Spec Kit command was run. No BlaBla production file was changed by this research; the separately assigned adapter repair is recorded under its own tooling task. The existing root canonical gate remains the orchestrator's responsibility.
