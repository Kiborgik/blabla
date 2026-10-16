# Declared task-role resolution

Author: `gpt-6-astra` (high), `guard-project-task-roles`.

## Finding and repair

Actual dogfooding used `core-engine` / `independent-reviewer` in a project whose
registered roles were `worker` / `reviewer`. Task creation accepted the unknown
names; subsequent role lookup returned no model list or consulted lenses. The
owner withdrew and corrected those assignments. This patch does not rewrite
historical tasks.

`src/cli/task.rs::validate_open_role` reads the explicitly registered process
through the existing parser and validator. With any declared roles, the requested
name must match exactly; refusal names the process and sorted available roles.
Missing, unreadable, syntactically malformed or semantically invalid registered
process memory refuses creation. Owner-confirmed bootstrap remains available
with no process registration, or a successfully parsed valid process with zero
roles. An unregistered conventional file is not implicitly loaded.

The same validation runs in `src/cli/mod.rs` before the task-store lock and again
inside `task::open`. The preflight is necessary because the existing lock creates
`.blabla/tasks/.store.lock`. Static unknown-role/configuration refusals now leave
the complete fixture tree unchanged, including task records and falsification
copies. The existing lock and remaining creation validations stay in place.
This is not filesystem-wide atomic protection against process-file edits between
preflight, lock, validation and persistence; no such race claim is made.

Registered roles retain existing model challenges, model exceptions, consulted
lenses and named-lens checks. No role alias/renaming framework, automatic migration,
new model authority or broader task-lifecycle policy is introduced.

## Evidence

- Prospective evidence `evidence-1-14-1792164060092667297.log` in this task's scratch
  ran thirteen tests: five passed, eight failed. Seven failures were actual
  unwanted exit-zero task creation. The lens control overclaimed absence of lock
  files; the existing-record test accidentally refused for overlapping scope.
- Both controls were corrected before production edits: the lens control checks
  unchanged task records, and existing work has disjoint scope. Preserved
  `evidence-2-14-1792164108802977257.log` has five passes and **eight genuine
  exit-zero-versus-refusal failures**, including the corrected existing-record
  case. The actual missing-role and broken-configuration paths were exercised.
- Initial post-fix `/tmp/task-role-green-initial.log` has twelve passes and one
  invalid test fixture: a role-free flow with no steps fails the real process
  validator. The valid-zero-role case now checks that empty process memory truly
  parses successfully. The guard was not relaxed to accept malformed process.
- `/tmp/task-role-green.log` passes fifteen tests. Additional non-UTF-8 and legacy
  read-preservation checks were added after the initial repair and are regression
  evidence, not claimed pre-fix executions. Missing/nonfile and parser/semantic
  failures remain distinct cases. Exact-name cases include case, whitespace,
  prefixed names and an empty requested name.
- The final declared `cargo test --locked --test task_role_resolution` receipt is
  retained in the task ledger after this report and docs are complete. Formatting
  is checked on the three scoped Rust files. No global gate was run by this worker.

This closes the concrete creation-policy gap related to
`goal::tasks-name-their-lenses`. The new explicit
`goal::declared-task-roles-retain-authority` and owner-authored
`contracts/task-role-resolution.bla` describe the stronger role-resolution intent.
The contract remains draft; these CLI tests do not claim adapter bindings or
canonical coverage for its observation fields. Independent acceptance and any
later executable contract binding remain owner decisions.
