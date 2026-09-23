# Agent integration smoke tests

These cases find problems in how small local coding agents, carrying worker and reviewer work,
discover and use BlaBla: skill activation, navigating project memory, repairing structure in
every supported language, carrying an assigned task, reporting one that cannot be done,
repairing behavior from a recorded counterexample, diagnosing YELLOW, repairing an adapter
protocol fault, and reviewing a hand-back. Orchestrator work, bootstrapping a project, rerunning
the canonical verification and project-wide falsification, is not given to these models, and
`coverage.json` names those capabilities as unmeasured. The suite is for fresh-host diagnostics; it is not a benchmark or evidence that one
host or model is better. The current findings and their retest status are in
[findings.md](findings.md); which capability each criterion measures is in
[coverage.json](coverage.json).

## Layout

| Location | Contents | In Git? |
| --- | --- | --- |
| `evals/<case>/` | Shared prompt, fixture, authoritative rubric and generated Claude graders | Yes |
| `evals/materials.py` and `evals/materials/` | One host-independent fixture builder and shared case material | Yes |
| `experiments/plugin_eval.sh` | Claude Code's native plugin-eval runner: sets the Linux-only PATH and runs `claude_eval.py` | Yes |
| `experiments/claude_eval.py` | Claude Code runner over its native plugin evaluator | Yes |
| `experiments/codex_eval.py` | Codex CLI runner using the portable BlaBla skill | Yes |
| `experiments/run_agent_suite.py` | Runs every case through both hosts and grades the whole suite | Yes |
| `experiments/grade_agent_eval.py` | Shared grading and JSON/Markdown/HTML reports for either host | Yes |
| `experiments/agent_eval_traces.py` | Host trace normalization, including command outcomes and ordering | Yes |
| `evals/coverage.json` | Measured capabilities and explicit coverage gaps | Yes |
| `experiments/collect_claude_eval.py` | Collects only sandboxes named by this Claude report | Yes |
| `evals/findings.md` | Compact observations, fixes and remaining questions | Yes |
| `artifacts/agent-evals/<campaign>/` | Raw traces, reports, manifests and workspace snapshots | No |
| `~/.cache/blabla-agent-evals/` | Linux staging and Cargo build cache | No |
| `research/` | Curated, frozen evidence supporting published claims | Yes |

The older `evals/results/` location stays ignored so running Claude's native command directly
cannot accidentally publish raw reports. Do not ignore every JSON or JSONL file: contracts,
fixtures and curated research can legitimately use those formats.

## Cases

| Case | Question |
| --- | --- |
| `repairs-a-red-project` | Does the agent repair four structure violations, two visible from the sources and two that only the contract states, the store routing its encoding through the format module, without changing the contract? |
| `carries-an-assigned-task` | Does a worker accept, repair the same four violations, record the declared check, challenge and hand back? |
| `ignores-a-project-with-no-contracts` | Does the skill stay quiet when there are no contracts? |
| `repairs-behavioral-drift` | Does the agent repair real WidgetStore persistence across a process restart through the format module the contract names, while preserving the app, adapter and contracts? |
| `navigates-project-memory` | Does the agent answer an ownership question with the system and ruling identities BlaBla prints, without editing memory? |
| `repairs-every-provider` | Does the agent repair the same three violations in Rust, TypeScript, Go, Java and C sources, the third stated only by the contract, with every contract unchanged? |
| `reports-an-impossible-assignment` | Does a worker whose assignment contradicts the contract report it through the record instead of editing the contract? |
| `repairs-red-behavior-from-counterexample` | Does the agent use the recorded minimal counterexample, trace the loss from the store to the format module it decodes through, repair only that module and rerun the check to green? |
| `diagnoses-yellow-verification` | Does the agent name the unexercised rule and its witness rather than weakening the contract or the app? |
| `repairs-adapter-protocol` | Does the agent find that the diagnostics helper, not the application, writes to stdout, and fix it there so the adapter protocol runs, with adapter, store and application unchanged? |
| `reviews-a-handback` | Does a reviewer record one assessment per lens, record the empty `save` as a finding on the worker's task, edit nothing and hand back? |

Each case's `fixture.json` names the model its prompt addresses; workers run `qwen3.5:4b` and the
review case runs `qwen3.5:9b`. The runners refuse a `--model` that differs from the declared one,
because the prompt, the role's model list and the rubric all name it: change every input or none.

Each case has a small `fixture.json` that the builder reads: the material layers it copies, in
order; whether the model file is broken by an import of the store; whether the canonical Python
adapter is copied; commands run before the arm is applied, such as `blabla init --agents`, and
after it, such as opening the assignment task, applying a worker patch or running `blabla finish`
to retain a record; and the independent observations the grader takes afterwards. A step that
exits with a code other than the one declared stops the build. Behavioral cases copy the canonical
adapter; they do not reimplement the JSONL protocol. A structure fixture naming `save` does not
prove persistence; only the behavioral cases exercise a real restart.

The two arms are with BlaBla and without BlaBla. With it, the workspace carries the manifest, the
contracts, the task record, the onboarding block, the portable skill in both discovery paths and
the `blabla` binary on PATH, and the agent reads `prompt.md`. Every fixture runs
`blabla init --agents` before the arm so the onboarding block is there, except the bootstrap
case, which measures whether the agent runs it, and the no-contracts case, which keeps the block
and the skill but no manifest. The builder mirrors that block into `CLAUDE.md`, because Claude
Code loads that file and not `AGENTS.md`. Without BlaBla, the builder removes every `.bla` file,
`.blabla`, `AGENTS.md`, `CLAUDE.md`, `.agents`, `.claude` and `contracts`, the after-arm steps
do not run, the binary is not on the subject's PATH, and the agent reads `prompt-without.md`.
Both prompts are an orchestrator's brief to a worker, built from the same bounded task. With
BlaBla the fixture opens that task with `blabla task open`, statement, write scope, deliverables
and declared check, and `prompt.md` is the worker agent definition from `.claude/agents/`
followed by the task name and the model, so the worker reads the assignment from the record.
Without BlaBla, `prompt-without.md` states the same task inline, statement, scope, deliverables
and a check the worker can run without the tool, with the BlaBla references replaced by plain
words. Neither prompt names the diagnosis or the fix. Both arms are the same project: a paired
case whose contracts state rules also ships a `README.md` in both arms that states every one of
those rules in plain prose, rules and never faults, so the arm without BlaBla is not scored on
intent it could not have known; a test holds each such doc to every rule its case's contracts
declare. What the comparison measures is whether BlaBla's memory and workflow help beyond an
ordinary rules document. A test holds the two prompts to the fixture's task. The declared check
is one a worker may run and that can succeed once the task is done: the structure repairs declare
`blabla status`, the behavior cases declare `python3 checks/restart.py`, a driver shipped in both
arms that speaks the adapter protocol, adds two widgets, restarts the application and expects both
back, and a task whose deliverable is a report on a project that stays YELLOW, RED or unverified
declares `test -s` on that report, because `blabla status` exits non-zero there and hand-back
needs a successful check; `blabla finish` is the
orchestrator's and a worker that runs it loses a point. A case with no
`prompt-without.md` exists only with BlaBla, such as a hand-back, a review or a YELLOW diagnosis,
and the runners skip its without arm and say so. The grader marks every criterion that needs
BlaBla, a command, a task record, a status or finish observation, not applicable in the without
arm, so the two arms are compared on the outcome checks only: sources parse, the right symbols
exist, the store persists, protected files stay untouched, the write scope holds.

## Run inside WSL2 or Linux

Prerequisites: Cargo with this repository's pinned toolchain, a C/C++ build toolchain, Python 3,
Bash, curl, and the native Linux agent CLI on PATH. Windows CLI shims do not count. Claude's
plugin evaluator was exercised with Claude Code 2.1.278 and requires at least 2.1.269. The Codex
runner was prepared with Codex CLI 0.155.1. Both use Ollama 0.34.1.
Models and agent CLIs are installed separately; the scripts do not download them or change global config.

Start Ollama and make `qwen3.5:4b` and `qwen3.5:9b` available. The scripts default to the WSL gateway on port 11434.
For another network arrangement, set `ANTHROPIC_BASE_URL` to the Ollama root URL for Claude or
pass `--endpoint` for Codex, for example `http://localhost:11434`. Codex receives the `/v1`
endpoint through `CODEX_OSS_BASE_URL`; do not override its reserved `ollama` provider ID.

From the repository root:

```sh
bash experiments/plugin_eval.sh --runs 3 --arm both --case carries-an-assigned-task
python3 experiments/codex_eval.py --runs 3 --arm both --case carries-an-assigned-task
python3 experiments/run_agent_suite.py final --runs 3
```

The suite runner takes every case with a rubric, or `--cases <name>...`, alternates host order
per case, freezes the executable hash and shared inputs across campaigns, and writes its reports
under `artifacts/agent-evals/<label>-suite-<stamp>/`. `python3 experiments/run_agent_suite.py
<label> --regrade <suite dir>` re-grades the retained runs and re-renders every report without
running a model, which is how a grader or renderer change reaches a finished suite.

- `overview.html` is the page to read first: the headline comparison, a case-by-case grid, what
  each run got wrong, the per-capability difference as bars, costs, and, with
  `--section "<heading>"`, the matching section of `evals/findings.md` as prose.
- `report.md` and `report.html` show, per case, every check in plain words against every run
  (✓ passed, ✗ failed, ? unknown, – does not apply to this arm) and why each check that did not
  pass failed.
- `scorecard.md` and `scorecard.html` roll the checks up by system, capability and behavior;
  items no case in the run measures collapse to one line.
- `grades.json` and `scorecard.json` carry the same data for tools.

The comparison between arms counts only the checks both arms face in a case, found from the graded
runs themselves. A check that does not apply without BlaBla, such as leaving the contracts
untouched, is reported on the BlaBla side and never enters the difference. Each run also prints
one line as it finishes: whether it passed its required checks, its score, how it ended and the
checks it failed.

The subject's PATH starts with a stub directory the runner builds, the same in both arms: `git`,
`find`, `env`, `stat`, `sha256sum`, `node`, `curl`, `chmod`, `tree`, `xargs` and a few more
exit 127 with "not available in this workspace", an ordinary shell error the subject handles like
any other. A host-level permission denial is not used, because a small model reads a denial as a
reason to stop, and the host itself keeps the tools its sandbox needs. The prompts carry no such
rule: tools are set up for workers by the harness, not asked for in prose.

Both runners default to both arms; Claude uses separate native invocations so each fixture
captures the correct starting state. Use `--arm with` or `--arm without` for one. `--runs` is the
number per arm, so three means six subject runs for a case that has both arms. Order alternates
by repetition. With BlaBla, Codex sees the skill as `.agents/skills/blabla/SKILL.md` and Claude
Code as a loaded plugin; these are different host integrations of the same guidance, and the
scripts do not produce a combined ranking. Pilots and failed attempts remain diagnostics, not
published scores. The fixture applies `BLABLA_EVAL_ARM` before any task is opened, so the arm is
part of the starting project, never a later change attributed to the subject.

Check Codex setup without running a model:

```sh
python3 experiments/codex_eval.py --prepare-only --runs 1
python3 -m unittest discover -s experiments -p test_agent_eval.py
```

Use `--codex /path/to/codex` if the Linux executable is not on PATH. Each invocation creates a
fresh campaign. Both runners build BlaBla from the current source before copying its executable
into external fixture workspaces. They stage outside mounted Windows drives and use a Linux-only
PATH. Claude's executable copy sits in its Linux cache, where the native sandbox can expose PATH
tools. Its generated scaffold wrapper restores the arm, binary identity and capture settings that
the native scaffold environment drops. Fixture setup rejects a mismatched executable hash.
No fixture writes to the source checkout. Claude fixture capture can be directed outside the subject
workspace with `BLABLA_EVAL_CAPTURE_ROOT`; captures include input hashes, workspace and arm metadata.
Product commands in this repository still go through Cargo.

Codex preserves the rendered prompt, stdout JSONL, stderr, final response, input hashes, before/after workspaces,
command outcomes and post-run `status`/`challenge` observations. Those post-run checks belong to
the evaluator: they are not evidence that the subject invoked them. A run the subject ends
without a completed turn, by an API error, a runaway response or the time limit, is kept as an
incomplete observation with its terminal reason in the report, and the campaign continues; a
harness failure, such as a fixture that does not build or a missing capture, stops it. A runner's
exit code describes execution, not success on the task. `--prepare-only` is never a subject result.
Claude preserves native reports and the sandboxes referenced by those reports, with a trusted
fixture capture taken before the subject starts. Missing capture or trace evidence fails the
harness. Campaigns are not overwritten or deleted by the runners.
Codex's per-run home and plugin download caches stay in WSL staging and are excluded from export.

## Interpret and share

The shared report is authoritative for both hosts; native Claude reports are supplemental.
Inspect criterion reasons and event references, not just the weighted score. Pass, fail, unknown
and not applicable are distinct. Unknown required or scored evidence prevents a complete score;
required failures override an otherwise high score. Ambiguous shell ordering remains unknown.
A command appearing in a trace is not proof it succeeded. A `ready` record is not proof that the
declared check actually ran. Claude's sandbox plants unreadable placeholders in the project root
for protected paths that do not exist yet, `.bashrc`, `.gitconfig`, `.mcp.json`, `.claude/*` and
the like, which BlaBla's challenge would report as unattributed changes. On Claude the builder
therefore creates those paths in the arm with BlaBla before the task opens, and declares
`ignore ".eval-artifacts"` in the generated `project.bla` for the evaluator's reserved file, which a
scaffold may not create; the native scaffold also gives `$HOME` a readable `.bashrc` and `.profile`, so shell
output carries no startup-file errors. A hand-back refused only for planted paths, with no other
class standing, is still graded as ready. A command criterion marked `outcome: any` counts a completed
invocation whatever its exit code, for commands whose informative result is non-zero, such as
`status` on a RED project or `check --falsify` with a vacuous rule. A report file matched by a rubric pattern shows that the agent wrote
the verdict BlaBla printed, not that it understood it.
The structure fixtures do not prove runtime persistence, even when a method is named `save`.
Codex disables subagents for these bounded runs; their absence is not a measured policy-compliance win.
Local Ollama cost figures priced as Claude tokens are not real monetary costs.

Replay grading from a retained campaign without calling the model, or verify the generated native
grader projections after editing a rubric:

```sh
python3 experiments/grade_agent_eval.py artifacts/agent-evals/<campaign>
python3 experiments/generate_eval_graders.py --check
```

Commit reusable cases, runner code, regression tests and short findings. Keep raw sessions,
generated HTML, model files, binaries, copied workspaces, auth/config directories and local paths
out of Git. Environment files are ignored; only sanitized `.env.example` files are eligible.
Before sharing an artifact bundle, remove credentials, personal paths and unrelated workspace
content; retain the model digest, tool versions, input hashes and failed attempts needed to explain it.
Do not link documentation to ignored local outputs as though they ship with the repository.

Update findings to distinguish **fixed in source**, **observed after the fix**, and **needs retest**.
A deterministic product defect should receive an ordinary regression test. Model smoke runs are
manual diagnostics and do not belong in the product completion gate. Publish stronger claims only
with a curated package under `research/` and its limitations stated in `docs/research.md`.
