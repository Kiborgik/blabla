# Independent task-role guard review

Reviewer: gpt-6-astra, high reasoning, registered reviewer role. I did not author
this CLI guard. I authored the earlier game adapter whose mistaken assignment
helped reveal the role-resolution gap; that context is not independent proof.

## Verdict

No blocking source finding in the bounded change. Exact declared roles now fail
closed before task-store creation, while explicit role-free bootstrap remains
available. This is approval of the inspected source and focused evidence, not
contract promotion, historical assignment repair or project completion.

NONBLOCKING evidence-accounting gap: the author's declared check inputs omit
`src/cli/mod.rs`, although its later scope includes that path. Thus its receipt
must not be described as fingerprinting the pre-lock dispatch change. This review
explicitly includes that file, executes the real compiled CLI, and covers the
missing evidence pin independently. Carry-amendment confirmation belongs to the
orchestrator.

## Source and boundary inspection

I read every hunk in the two Rust files and the workflow paragraph, all fifteen
new tests, the author's report and the prospective draft. The author provided
`/tmp/task-role-guard-reviewed.patch` and reconstructed pre-edit sources whose
path/length/content fingerprints match the recorded opened tree. These are
reported digest-verified reconstructions, not contemporaneous backups. I also
read the controlling project loader, task-store lock, process builder/validator,
Memory classification and existing role/model/lens lookup paths.

- `src/cli/task.rs:726`: `validate_open_role` reuses `memory::read`,
  `process::build` and `process::validate`. An explicitly registered process must
  produce Present memory. Missing/nonfile input, decoding/read failures, syntax
  failure and semantic duplicate-role failure cannot become empty-role bootstrap.
  Successful parsing with no roles is a distinct allowed state. No registered
  process deliberately bypasses role lookup; an unregistered conventional file
  does not acquire authority.
- Exact string membership applies as soon as one role exists. Case, whitespace,
  prefixes and empty requested names are not aliases. The refusal reports the
  requested name and sorted available names. There is no new role framework.
- `src/cli/mod.rs:1144` checks only TaskAction::Open before `task::locked`, whose
  existing store lock creates directories and a lock file. The second check at
  `src/cli/task.rs:990` protects the creation entry point. Tests compare complete
  directory/file snapshots, including falsification-copy absence, for static
  role/configuration refusals. Other invalid task arguments retain their existing
  locking behavior. No atomic guarantee against concurrent process-file edits is
  claimed; the workflow documentation states this limit.
- Existing declared-role model restrictions, exceptions, consulted lenses and
  named-lens rejection remain on their existing paths. Historical task reads are
  not routed through the new open guard. The legacy bootstrap-task test checks
  its original role and unchanged bytes after process registration, then rejects
  a fresh use of the obsolete role.
- The workflow paragraph accurately covers both bootstrap branches and the
  concurrency limit. The new draft contract describes intent; this review does
  not claim it has executable adapter coverage. Later binding work is separate.

## Evidence and falsification history

The corrected prospective author log
`.blabla/scratch/guard-project-task-roles/evidence-2-14-1792164108802977257.log`
contains five passes and eight genuine failures at exit-zero-versus-refusal
assertions, before the implementation. I read the complete log, including the
actual created records. The earlier run included an overstrong lock-absence lens
control and an overlapping-scope existing-record fixture; the author discloses
both corrections. The post-fix empty-process fixture was corrected to a genuinely
valid zero-role process without weakening the guard. Non-UTF-8 and historical
read checks were added later and are regression evidence, not retrospective RED.

I read the complete final author fifteen-test log and independently ran only
`cargo test --locked --test task_role_resolution`. Initial independent receipt
`.blabla/scratch/review-task-role-guard/evidence-1-5-1792164577965996899.log`
passed 15/15, child exit 0. After the review-target refresh and this deliverable,
the current task receipt records the same focused command. No broad suite or
canonical finish is represented as part of this review.

Tests invoke the compiled CLI in isolated temporary projects. Their primary
assertions are actual exit codes, structured task/error fields, grounded challenge
classes and filesystem bytes. Diagnostic substrings supplement those checks;
they are not an authored boolean oracle. Registered worker/reviewer successes,
model challenge retention, consulted-lens assessment, disjoint existing records,
invalid syntax/semantics/encoding and both explicit bootstrap cases are covered.

## Registered reviewer lenses and disposition

Reviewing: original assignment, all changed hunks, controlling helpers and sibling
failure paths were inspected. The author-input gap is disclosed rather than
silently absorbed into its evidence. No production edits were made by me.

Engineering: the fix reuses the established parser and validates at the two
necessary boundaries. It introduces no role aliases, migration, model authority,
second parser or generalized admission subsystem.

Testing: the genuine failing assertions and full final logs were read. The
independent focused run includes the dispatch file in its inputs. Real CLI and
filesystem observations distinguish malformed configuration from explicit
bootstrap, and prevent a success message from substituting for preserved policy.

Design: command diagnostics stay concrete, bootstrap stays explicit, and the
existing memory/model/lens architecture remains authoritative. The repeated
validator call is intentional boundary protection, not duplicated parsing logic.

The goal's bounded implementation is supported. Historical wrongly assigned tasks
still require explicit owner reconciliation; this patch cannot retroactively
supply their missing authority. Recommend accepting this guard after the parent
confirms its carry amendment, then separately evaluating the already assigned
contract binding. No additional engine change is justified by this review.
