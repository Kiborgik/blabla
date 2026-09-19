# BlaBla 0.7.0-alpha

BlaBla keeps project intent in the repository as queryable memory and executable contracts. Version 0.7 brings broader language support, reusable application adapters, and a task workflow that connects completion to verification evidence.

## More languages, shared requirements

Structure contracts now inspect **Python, Rust, TypeScript, JavaScript, Go, Java, C, and C++**.

The new providers share parsing infrastructure while retaining language-specific analysis. When BlaBla cannot understand a reference, it reports uncertainty instead of treating the dependency as absent. Where that uncertainty can be limited to a particular module, unrelated checks remain usable.

Reusable JSON Lines adapters now support **Python, TypeScript, Go, Java, C, and C++**. Applications provide their state and actions; the adapters handle the protocol. All six language examples satisfy the same behavior contract.

## Tasks backed by evidence

Tasks now have an explicit lifecycle: accept an assignment, record check results, report findings, request review, and accept the result.

BlaBla distinguishes missing evidence, failed checks, and results made stale by relevant changes. A result cannot be accepted while a grounded challenge remains. Task records also support model-policy exceptions, review-lens assessments, and declared attribution for concurrent work.

Existing task names can no longer be overwritten, including closed tasks. Directory deliverables track their files, and changes of unknown origin are not automatically blamed on the worker.

These checks govern BlaBla's task records. They do not turn it into a sandbox or give it control over arbitrary agent tool use.

## Build time is not response time

Verification profiles gain two options:

- `prepare` runs a build or other preparation command before the application starts.
- `startup_ms` gives the first exchange after startup its own allowance, separate from the normal response timeout.

Compiled examples can now start from a clean build without treating compilation or JVM startup as an application-response failure.

## A consistent entry for agents

`task show`, `guide loop`, and the generated skill now share the same workflow routes. The entry shows the assignment's check, scratch location, and how to accept work, record evidence, report blockers, and hand back results.

`blabla init --agents` installs the skill in both `.agents/skills/blabla/` and `.claude/skills/blabla/`.

## Stronger self-verification

New behavior contracts exercise BlaBla's own evaluator and task lifecycle through their production paths. This work corrected cases where unreadable facts could satisfy a forbidden-value rule, unresolved Rust routes produced invented dependencies, and incomplete task evidence could permit acceptance.

The language examples also exposed application defects. The Java campaign found both a todo containing a newline being lost after restart and a valid integer being incorrectly narrowed to 32 bits.

The product gate now runs every example, validates its own required step order, and blocks release publication when it fails.

## Optional blunt diagnostics

Set `voice blunt` in `project.bla` for more direct wording when a challenge is grounded. Neutral remains the default. The setting changes no verdict, exit code, or machine-readable field.

## Limitations

- Verification is bounded and heuristic. GREEN means the declared obligations were exercised and satisfied under the recorded campaign, not that the software has been proved correct.
- Adapter observations are trusted. BlaBla is not a sandbox.
- Project memory is checked for internal consistency, not independently proved against the repository. Process guidance alone does not enforce agent actions.
- Compiled examples require their toolchains on `PATH`. Unix-specific process containment still lacks recorded Unix validation.
- Requires Rust 1.90 or newer.
- This remains an experimental alpha. Contract syntax, CLI options, JSON fields, and exit codes may change.
