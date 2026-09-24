---
name: blabla
description: "Use when a repository contains project.bla or .bla contracts to verify behavior, structure, counterexamples and GREEN/YELLOW/RED states, handle persistence through campaign restarts, or when you are handed a bounded task or assignment, or challenge with `blabla finish`. BlaBla records executable memory: inspect status, explain rules, accept work, record evidence and hand it back."
---

# BlaBla

BlaBla turns behavioral and structural intent into executable contracts and reports GREEN, YELLOW or RED per layer.
`project.bla` is the machine entry point; `blabla status` is the agent entry point; the contracts are the authority. This skill runs nothing; every blabla command is run in the shell.

## Working under an assignment

A project may hand you a bounded task instead of the whole repository. `blabla task show <name>` prints the assignment -- statement, role, write scope, deliverables, findings, declared check, scratch -- then the routes below, in the order they are taken. That view is the authority, never this file.

  blabla task accept <name> --model <id>   take the assignment before changing anything; unaccepted work is challenged as work done outside BlaBla

Declared check:
  <the declared check>
  Run that command from the project root; --tool is an evidence label, not the command to execute, and --exit is its real exit code
  blabla task evidence <name> --exit <code> --tool <tool>   record what the whole run reported; when <the declared check> exits 0 that is --exit 0 --tool check
  blabla task block <name> "..."   record the blocker and stop
  blabla task note <name> "..."   keep a note on the record; a note is not a finding and blocks nothing
  blabla task finding <name> "..."   record unsettled work; it blocks hand-back until it is addressed or resolved
  blabla task addressed <name> <id> "..." --model <id>   say what you did about a finding; the orchestrator still resolves it
  blabla task decide <name> "<question>" --pick <option> --confidence <0-100> --model <id>   a call you are not sure of (a cause, a name, a behavior the statement leaves open) is asked, not guessed; --options a,b,c for a choice; --on <question-id> in place of the question picks one the orchestrator asked. BLOCKS THE TASK means stop now and do not act on your pick until the orchestrator answers
  blabla task lens <name> <pack> "..."   one assessment against one lens the role consults
  blabla challenge <name>   ask BlaBla for one contradiction grounded in the record and tree; no challenge is recorded until the command runs
  blabla task ready <name>   hand back for review; closing it is the orchestrator's, never yours

Run the declared check from the project root. `--tool` is an evidence label, not the command to execute; `--exit` records the command's real exit code.
Acceptance records that a role took the work through BlaBla, not that it read what it retrieved. Hand-back requires current successful evidence and an explicit assignment challenge receipt. Changes to the task or its inputs require another challenge; resume a READY task with `task accept` before further work. A path outside the write scope is a finding, never a widening; read the whole run before recording it.
A hand-back is not acceptance: READY means await orchestrator review; assigned workers hand back without running `blabla finish`, closing is the orchestrator's decision, and only `blabla finish` decides project completion.
When multiple tasks are open, choose a name explicitly; status never assigns one to the caller. Project verification GREEN and unfinished task obligations remain separate.

## Project-level implementation workflow

1. `blabla status`: project name, BEHAVIOR / STRUCTURE / OVERALL state, per-contract summary, next rules, completion gate.
2. `blabla explain <group>::<label>`: owning contract and line, the rule text, required witnesses and counterexample, or the observed structural fact.
   Coarser identities open the level above: `contract::<group>` lists a contract's rules, `system::<name>` its responsibilities and seams.
   Every identity is printed by the command before it; never construct one by guessing a separator.
3. Implement.
4. `blabla finish`: verifies structure, runs the project's canonical behavior verification and decides completion (exit 0 only for OVERALL GREEN).
5. RED: repair using the minimized counterexample or the observed fact. YELLOW: supply the missing witness; NOT COMPLETE. OVERALL GREEN: done.

Read a contract file only when `explain` is not enough. Never edit a `.bla` file to reach GREEN.
`blabla run -- <application>` is a quick manual check; only `blabla finish` decides completion.

## Contract authoring and bootstrap

`blabla guide bootstrap` is the canonical procedure: source authority ordering, conflicts,
unknowns, draft contracts (`draft behavior "path"` in `project.bla`), the skeptic pass and
promotion to `use behavior` by a human.

## Authoring project memory

`blabla guide memory`: the declaration and registration shape for Mission, System, Process and
Knowledge, and the check/register/explain loop. No memory state reaches OVERALL.

## Changing intended behavior

`blabla guide change`: the contract-author phase edits the rule first, then the
implementation phase reaches GREEN.

## Commands

| Command | Purpose |
| --- | --- |
| `blabla status` | BEHAVIOR, STRUCTURE and OVERALL state with the completion gate, exit 0 only for OVERALL GREEN |
| `blabla explain <group>::<label>` | one rule with evidence |
| `blabla explain contract::<group>` | one contract: path, state and the canonical id of every rule |
| `blabla explain mission::<name>` | why the project exists, the priorities that decide a tradeoff and the non-goals |
| `blabla explain system::<name>` | one system: purpose, paths, the responsibilities it owns and its seams |
| `blabla explain knowledge::<pack>` | one reusable knowledge pack and the id of every ruling in it |
| `blabla explain flow::<name>` | the order the roles are meant to work in, one line per step |
| `blabla task <action>` | record one bounded change; `show <name>` prints the routes your role takes next; `open`, `ask`, `resolve`, `attribute`, `deliverable --remove`, `confirm` and `close` are the orchestrator's; a question it asks is picked with `task decide <name> --on <id>` before hand-back; every `--model` is an attestation, not proof |
| `blabla challenge` | one grounded challenge to the current account of the work; without a task, exit 1 when one stands; with a task that is not closed, exit 0 when its assignment check is clear and 1 otherwise |
| `blabla finish` | structure check plus canonical behavior verification from project.bla; exit 0 only for OVERALL GREEN |
| `blabla run -- <app>` | manual verification with explicit settings; records the result |
| `blabla check` | compile the project, including drafts |
| `blabla guide <topic>` | agent, bootstrap, change, memory, loop |
