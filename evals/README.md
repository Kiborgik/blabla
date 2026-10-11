# Agent integration smoke tests

These cases test how small local models (`qwen3.5:4b` workers, `qwen3.5:9b` reviewer) find and use
BlaBla as workers and reviewers. Orchestrator work is not given to them; `coverage.json` lists it as
unmeasured. This is a diagnostic for fresh hosts, not a benchmark. Results and retest status:
[findings.md](findings.md).

| Location | Contents | In Git |
| --- | --- | --- |
| `evals/<case>/` | prompt, `fixture.json`, rubric, generated Claude graders | yes |
| `evals/materials.py`, `evals/materials/` | the one fixture builder and shared material | yes |
| `experiments/claude_eval.py`, `plugin_eval.sh` | Claude Code runner (plugin evaluator, or `claude -p` with `--driver direct`) | yes |
| `experiments/codex_eval.py` | Codex CLI runner | yes |
| `experiments/run_agent_suite.py`, `grade_agent_eval.py` | whole-suite runner and shared grading and reports | yes |
| `artifacts/agent-evals/<campaign>/` | raw traces, reports, workspaces | no |

| Case | Question |
| --- | --- |
| `repairs-a-red-project` | repairs four structure violations, two stated only by the contract, without editing it? |
| `carries-an-assigned-task` | as a worker: accepts, repairs, records the check, challenges, hands back? |
| `ignores-a-project-with-no-contracts` | the skill stays quiet without contracts? |
| `repairs-behavioral-drift` | repairs persistence across a restart through the format module the contract names? |
| `navigates-project-memory` | answers an ownership question with the identities BlaBla prints? |
| `repairs-every-provider` | repairs the same violations in Rust, TypeScript, Go, Java and C? |
| `reports-an-impossible-assignment` | reports a contradicting assignment instead of editing the contract? |
| `repairs-red-behavior-from-counterexample` | uses the recorded counterexample to fix only the right module? |
| `diagnoses-yellow-verification` | names the unexercised rule and its witness? |
| `repairs-adapter-protocol` | finds the helper that writes to stdout and fixes only it? |
| `reviews-a-handback` | as a reviewer: one lens each, the empty `save` as a finding, no edits? |
| `stops-on-an-unknowable-call` | records an unsettleable call below its floor and stops? |
| `picks-an-asked-question` | picks the orchestrator's question with a confidence before hand-back? |
| `stays-inside-a-narrow-scope` | leaves an out-of-scope file alone and reports it through the record? |

**Two arms.** With BlaBla, the workspace has the manifest, contracts, task record, onboarding block,
skill and binary, and the agent reads `prompt.md`. Without it, all of that is removed and the agent
reads `prompt-without.md`: the same task in plain words, plus a `README.md` that states every
contract rule in prose, so both arms know the same intent. Neither prompt names the fix. Criteria
that need BlaBla are not applicable without it, so the arms are compared on outcomes only. A case
with no `prompt-without.md` runs only with BlaBla. The runners refuse a `--model` other than the one
the fixture declares.

## Run inside WSL2 or Linux

Needs Cargo, a C/C++ toolchain, Python 3, Bash, curl, the native Linux agent CLI (Claude Code
≥ 2.1.269 or Codex CLI 0.155.1) and Ollama 0.34.1 serving `qwen3.5:4b` and `qwen3.5:9b`. The
scripts default to the WSL gateway on port 11434; otherwise set `ANTHROPIC_BASE_URL` (Claude) or
`--endpoint` (Codex). They never download models or change global config.

```sh
bash experiments/plugin_eval.sh --runs 3 --arm both --case carries-an-assigned-task
python3 experiments/codex_eval.py --runs 3 --arm both --case carries-an-assigned-task
python3 experiments/run_agent_suite.py final --runs 3                  # every case, both hosts
python3 experiments/run_agent_suite.py final --regrade <suite dir>     # regrade without a model
python3 experiments/codex_eval.py --prepare-only --runs 1              # check setup only
python3 experiments/grade_agent_eval.py artifacts/agent-evals/<campaign>
python3 experiments/generate_eval_graders.py --check                   # after editing a rubric
```

`--runs` counts per arm. Reports land in `artifacts/agent-evals/<label>-suite-<stamp>/`: read
`overview.html` first, then `report.html` (every check against every run) and `scorecard.html`.
Arms are compared only on checks both arms face. The subject's PATH stubs out `git`, `find`, `curl`
and similar tools with exit 127, the same in both arms. `--driver direct` runs `claude -p` without
the plugin sandbox, with only `Bash`, `Write`, `Edit`, `Read`, `Glob`, `Grep` and `Skill`, and with
no host `CLAUDE_*` settings leaking in.

## Reading results

- Pass, fail, unknown and not applicable are different; a required failure overrides a high score
- A command in a trace is not proof it succeeded, and a `ready` record is not proof the check ran
- A runner's exit code describes the harness, not the task. Incomplete runs stay in the report
- Claude's sandbox plants placeholder files; the builder pre-creates them so they do not count as
  unattributed changes
- Ollama runs priced as Claude tokens are not real costs

Commit cases, runner code, regression tests and short findings; keep raw sessions, workspaces,
binaries and local paths out of Git. Mark findings **fixed in source**, **observed after the fix**
or **needs retest**. A deterministic product defect gets a regression test; model runs never join
the product gate. Stronger claims need a curated package under `research/`.
