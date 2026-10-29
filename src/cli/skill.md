---
name: blabla
description: "Use when a repository contains project.bla or .bla contracts to verify behavior, structure, counterexamples and GREEN/YELLOW/RED states, handle persistence through campaign restarts, or when you are handed a bounded task or assignment, or challenge with `blabla finish`. BlaBla records executable memory: inspect status, explain rules, accept work, record evidence and hand it back."
---

# BlaBla

BlaBla turns behavioral and structural intent into executable contracts and reports GREEN, YELLOW or RED per layer.
`project.bla` is the machine entry point; `blabla status` is the agent entry point; the contracts are the authority. This skill runs nothing; every blabla command is run in the shell.

## Working under an assignment

A project may hand you a bounded task instead of the whole repository. `blabla task show <name>` prints the assignment -- statement, role, write scope, deliverables, findings, declared check, scratch -- then the routes below, in the order they are taken. That view is the authority, never this file.
`blabla task evidence <name> --run` runs the declared check and records its exit code; read the whole log, not only the exit.
{{routes}}
Acceptance (`task accept`) records that a role took the work through BlaBla, not that it read what it retrieved. Executed evidence stays current across a new acceptance while the check and its inputs are unchanged; `task freshness` says what changed. Never rerun an unchanged check.
The hand-back is one write: `task ready <name> --lens <pack> "..."` for each consulted pack, `--outcome` when the task serves a goal, `--claim <intent>=updated|unchanged` when it asks for intent claims. Ready runs the assignment challenge itself; a refused ready records nothing. Resume a READY task with `task accept`. A path outside the write scope is a finding, never a widening.
READY awaits orchestrator review: workers never run `blabla finish` or close, and only `blabla finish` decides project completion. With several tasks open, name yours; status never picks one.

## Project-level implementation workflow

1. `blabla status`: project name, BEHAVIOR / STRUCTURE / OVERALL state, per-contract summary, next rules, completion gate.
2. `blabla explain <group>::<label>`: owning contract and line, the rule text, required witnesses and counterexample, or the observed structural fact.
   Coarser identities open the level above: `contract::<group>` lists a contract's rules, `system::<name>` its responsibilities and seams.
   Every identity is printed by the command before it; never construct one by guessing a separator.
3. Implement.
4. `blabla finish`: verifies structure, runs the project's canonical behavior verification and decides completion (exit 0 only for OVERALL GREEN).
5. RED: repair using the minimized counterexample or the observed fact. YELLOW: supply the missing witness; NOT COMPLETE. OVERALL GREEN: done.

Read a contract file only when `explain` is not enough. Never edit a `.bla` file to reach GREEN. `blabla run -- <application>` is a quick manual check; only `blabla finish` decides completion.

## Guides

`blabla guide bootstrap` writes the first contracts: source authority, conflicts, unknowns, drafts, the skeptic pass and promotion by a human. `blabla guide memory` gives the Mission, System, Process and Knowledge shapes; no memory state reaches OVERALL. `blabla guide change` edits the rule first, then the implementation reaches GREEN. `blabla guide loop` is the task loop.

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
| `blabla task <action>` | record one bounded change; `show <name>` prints your next routes; opening, scoping, asking, answering, resolving, confirming and closing are the orchestrator's; every `--model` is an attestation, not proof |
| `blabla challenge` | one grounded challenge to the current account of the work; without a task, exit 1 when one stands; with a task that is not closed, exit 0 when its assignment check is clear and 1 otherwise |
| `blabla finish` | structure check plus canonical behavior verification from project.bla; exit 0 only for OVERALL GREEN |
| `blabla run -- <app>` | manual verification with explicit settings; records the result |
| `blabla check` | compile active and draft contracts only; validate an edited memory file with `blabla check FILE.bla` |
| `blabla guide <topic>` | agent, bootstrap, change, memory, loop |
