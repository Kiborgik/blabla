# Agent integration findings

Working triage, not a published comparison. [Run guide](README.md).
Raw reports and transcripts are retained under ignored `artifacts/agent-evals/`. The suite runs
`qwen3.5:4b` as the worker and `qwen3.5:9b` as the reviewer through Ollama, Claude Code and
Codex CLI; the arms are with BlaBla and without BlaBla as the run guide defines them. No suite
has been run under those arms yet; this ledger holds what preparing it found.

## Preparing the suite: 2026-09-21, dogfooding the workflow and the harness

The BlaBla workflow was used, through its own CLI, to prepare the suite: six bounded fix tasks
with `haiku-4.5` workers and `opus-5` reviews, then the case material authored by the
orchestrator, then six stale records from earlier releases closed through their own routes.
Every friction below was recorded on a task record when it was met and either fixed in source
or left as an owner question.

| Observation | Disposition | Evidence |
| --- | --- | --- |
| Six haiku fix tasks: one of six first patches was sound; four scope breaches; nine findings resolved by the worker that raised them; twice a reported test count hid missing tests | Fixed in source: `task resolve` is orchestrator-only and records its model; `task addressed` gives the worker its own mark; `task note` separates chatter from unsettled work; evidence needs a real exit code or `--run` | Records `wave1-review`, `batch2-review`, `final-review`; commit `fbd311d` |
| A challenge receipt died on any edit anywhere in the tree, so one integration edit invalidated five hand-backs | Fixed in source: the receipt covers the task's scope, deliverables, declared inputs and attributed paths | `receipt_covers` in `src/project/task.rs`; three closures survived later edits without a re-hand-back |
| An argv-only declared check was treated as undeclared by the hand-back route | Fixed in source and CLI-tested | `Task::declares_check`; observed closing `v07-slice-1` |
| Reopening a record from an earlier release grounded attribution-unknown once per changed path, 39 paths on one record and 10,831 on another because ignored artifacts sit in the tree snapshot, one `attribute` call each | Fixed: `attribute` takes several paths and the challenge lists every undeclared path; by the owner's ruling of 2026-09-22 `ignore from ".gitignore"` leaves ignored artifacts out of the snapshot, and this repository's `project.bla` declares it | Records `v07-slice-1`, `capability-coverage-audit` |
| A READY record whose worker is gone cannot be re-verified by an orchestrator model without the exception route | Exercised as designed: `propose-model` then `approve-model` transcribing the owner's ruling, then accept, evidence, challenge, close | Records `capability-point-report`, `capability-coverage-audit` |
| The suite runner aborted when the frozen inputs changed mid-run because the orchestrator edited `coverage.json` during a pilot | Harness fixed: documentation files are outside the frozen input set; the rule is now in the run guide | `test_agent_eval.py` |
| A `status` on a RED project and `check --falsify` with a vacuous rule exit non-zero, so a "successful command" criterion could never credit them | Grader fixed: `outcome: any` credits a completed invocation whatever its exit | `test_grade_agent_eval.py` |
| Suite-level efficiency rows read zero because merged rows had their actions stripped | Harness fixed: the suite reads each run's summary | `run_agent_suite.py`, `campaign_rows` |
| A subject run can end without a completed turn: API error, a response past the host's output cap, the time limit | Harness fixed: the run is kept as incomplete with its terminal reason and the suite continues; only a harness failure stops it | `agent_eval_traces.py` |
| Claude's native evaluator plants 23 unreadable guard files in the project root after `task open`, so the challenge blocks every hand-back with attribution-unknown on paths the worker never touched | Grader fixed: a hand-back refused only for those paths, with nothing else standing, counts as ready | `test_grade_agent_eval.py`, the challenge text in every with-run trace |
| Every mutating task command printed the whole task view, and `task attribute` accepted paths that had not changed | Fixed in source: mutations print one line, `attribute` refuses an unchanged path | `tests/task_workflow.rs` |
| The runner exported its native staging tree per run, and summed cached prompt tokens into the prompt figure | Harness fixed: staging is excluded from export; new and cached prompt tokens are separate columns | `test_agent_eval.py` |
| A permission denial from the host made the 4b stop or drift in both arms | Harness fixed: banned commands are stubs on the subject's PATH that exit 127, not host denials | `test_agent_eval.py` |
| The three behavior cases declared `blabla finish` as the worker's check while the brief and the onboarding forbid a worker to run it, and their rubrics rewarded running it; the recovery case gave a worker an orchestrator's job | Cases fixed: the behavior cases declare `python3 checks/restart.py` in both arms and lose a point for `finish`; the recovery case is a plain orchestrator instruction again | `evals/materials/checks/`, the probe run of every changed fixture |
| Running the adapter compiles `__pycache__`, which the "adapter unchanged" check counted as a change | Grader fixed: bytecode caches are outside every protected-path check | `test_grade_agent_eval.py` |
| The paired cases were one-file repairs whose defect is visible from the sources, so the 4b solved them without any memory | Cases grown: the structure cases carry a format module and an id minter with rules only the contract states (the store encodes through the format, never through `json` itself); the behavior cases register the persistence pack and its atomic-write ruling and score it | `evals/materials/structure-plus/`, `evals/materials/behavior/knowledge/` |

## Claude shakedown and test run: 2026-09-22, one run per arm on local models

An eleven-case shakedown (`qwen3.5:4b` worker, `qwen3.5:9b` reviewer, Ollama 0.34.2, Claude Code
2.1.278) and a four-case test run after the fixes. Setup-dominated numbers are not results; the
table records what the runs exposed and where each fix stands.

| Observation | Class | Disposition | Evidence after the fix |
| --- | --- | --- | --- |
| Claude's sandbox plants placeholders for protected paths after the task opens; every with-arm hand-back was refused for them and the worker looped to the turn cap | Harness | Fixed in source: the builder creates those paths before the task opens on Claude and scopes the evaluator's reserved `.eval-artifacts` | Probe trace: the challenge named only paths the subject changed |
| Every shell call printed a `$HOME/.bashrc` permission error in both arms, about ten times more often in the with arm | Harness | Fixed in source: the scaffold gives `$HOME` a readable `.bashrc` and `.profile` | Test run: no occurrence in any trace |
| The behavior cases' declared check writes `widget.json` at the root, outside the task scope | Case design | Fixed in source: `widget.json` is in scope and the check inputs are pinned to the sources | Needs retest |
| The worker brief told workers to record discoveries as findings, so small workers blocked their own hand-back and looped until the conversation overflowed the model's context | BlaBla product | Fixed in source: discoveries go to `task note`; a finding is for work the worker could not settle | Test run: the drift case finished in 36 turns rather than 113, with no finding raised |
| Report-only tasks declared `blabla status` on projects that cannot end GREEN, so hand-back was impossible | Case design | Fixed in source: they declare `test -s` on the report | Test run: the YELLOW diagnosis reached READY in 48 s |
| The adapter case granted `app.py` in scope while its rubric protects it, and its with-arm statement named `blabla finish` | Case design | Fixed in source: scope, rubric and both statements agree | Test run: the with-arm worker still edited `app.py`; see the attribution row |
| The reviewer brief had no accept or hand-back step and one `<name>` for two tasks; the 9b recorded its lenses on the worker's task and left the review OPEN | BlaBla product | Fixed in source: the brief names the review task and the task under review and carries accept, evidence and hand-back | Test run: accepted, three lenses, two findings including the empty save, READY |
| Three cases gave a small worker orchestrator work: bootstrapping, recovering an interrupted verification, project-wide falsification | Case design | Removed from the suite by the owner's ruling; `coverage.json` names the capabilities unmeasured | Not applicable |
| The arm without BlaBla had no statement of rules only the contracts carried, so it lost those criteria by construction | Case design | Fixed in source by the owner's ruling: both arms carry the same rules `README.md`, held to every contract rule by a test | Needs retest |
| A worker edited `app.py` outside its scope, declared it with `task attribute --kind concurrent` and reached READY | BlaBla product | Fixed in source by the owner's ruling: `task attribute` requires a model `role::orchestrator` permits and records it, and it left the worker's routes | Needs retest |
| The onboarding block ended with "Before declaring project work complete: blabla finish" after telling assigned workers not to run it; workers ran `finish` in all four with-arm runs of the test run | BlaBla product | Fixed in source by the owner's ruling: the close says deciding project completion belongs to the orchestrator, never to a worker on a task | Needs retest |
| A 4b worker overwrote its task record by hand and wrote memory-style notes beside it, despite the brief's new rule; the record did not reach READY | Model behavior | owner-ruling: parked by the owner on 2026-09-22 — model behavior on one run, no product change; the grader already catches hand-edited records — taken by never | Test run, drift case, with arm |

## Grader rework and the nine-case run: 2026-09-22

The nine cases the test runs had not reached, one run per arm on Claude with the same models, and
the grader and report changes they exposed.

| Observation | Class | Disposition | Evidence after the fix |
| --- | --- | --- | --- |
| The with/without comparison counted checks only the arm with BlaBla faces, such as leaving the contracts untouched, and the report's difference compared whole-rubric means | Grader | Fixed in source: both compare only the checks both arms face in a case, found from the graded runs | Re-grade of the test run: 94% against 47% over the same 34 points |
| The counterexample case scored its scope as `widget/store.py` while the fault sits in `widget/format.py`, and scored an atomic-write pattern in a store it requires unchanged; both arms lost 4 points by construction | Case design | Fixed in source: the scope is `widget` and `widget.json` (`stays-in-scope`) and the unsatisfiable criterion is gone | Rerun: the arm without BlaBla scored 100% |
| The polyglot case declared its five language directories as deliverables; BlaBla owes every file inside a directory deliverable, so nine untouched files (format modules, `main.rs`, `go.mod`, headers) blocked every correct hand-back | Case design | Fixed in source: the ten store and model files a repair must change are the deliverables, in the fixture and the brief | Rerun: the arm with BlaBla passed every required check and reached READY |
| Re-grading an older suite after a criterion rename raised in the scorecard | Grader | Fixed in source: a reference the graded runs lack is reported unmeasured; a test holds `coverage.json` to the current rubrics | `test_agent_eval.py`, `test_eval_scorecard.py` |
| Putting the evaluator's `.eval-artifacts` in the task scope made a challenge before acceptance name it as the worker's own change; a 4b spent the whole counterexample run trying to undo that file and never accepted | Harness and BlaBla product | Fixed in source by the owner's ruling: `ignore "pattern"` and `ignore from "file"` in `project.bla` leave paths out of change tracking, and the builder ignores `.eval-artifacts` instead of scoping it | Rerun: no challenge named `.eval-artifacts`; the worker accepted, read the counterexample and repaired the format |
| The attribution-unknown challenge told a worker that changed a path outside its scope to record a finding; the adapter worker edited `app.py`, recorded and addressed a finding, found the challenge still standing, then hand-edited its task record until the output cap | BlaBla product | Fixed in source: the challenge tells such a worker to restore the path or record why with `task block` and stop, and says a finding does not clear it | Rerun: the adapter worker stayed in its scope and reached READY in 32 s, so this path was not exercised |
| The counterexample case scored 100% in both arms: its fault, a `[:-1]` slice in a twelve-line `format.py`, is visible in the source and reproduced by the declared restart check both arms run, so BlaBla's counterexample carried nothing the arm without it lacked | Case design | Fixed in source: the fault now rebuilds ids from row positions on reload; the restart check compares texts only and passes, while BlaBla's counterexample and the grader's persistence check compare ids; the check `format-reads-stored-ids` replaces `format-keeps-every-row` | Rerun: the arm without BlaBla still read the fault in `format.py` and fixed it in 18 s; the arm with BlaBla read the counterexample (id 1 came back as 0), blamed a working-directory path, edited `store.py` and handed back with the fault in place, 47% against 100% |
| The counterexample worker's hand-back was refused before its challenge; the challenge then printed CLEAR without naming the next route, and the worker wrote a note and stopped at ACCEPTED after 14 minutes | BlaBla product | Fixed in source: a clear challenge on an accepted task names `blabla task ready <name>` | Rerun: in the counterexample and adapter cases the worker handed back on the next call after that line |
| The no-contracts control read −33: the worker with BlaBla present read two of the five widget modules, wrote a `load()` that returns dicts and failed the restart check; it ran no `blabla` command and opened no skill | Model behavior | No change: BlaBla took no part in the run | Rerun: 100% in both arms |

## Retest record

For each new observation, record the case, host, model/digest, input revision or hashes, number of
completed runs, concrete failing step, and whether a fix has been exercised. Keep machine-specific
artifact locations and full transcripts out of this ledger. Separate setup failures, grader defects,
host differences and BlaBla product defects before deciding on a repair.
