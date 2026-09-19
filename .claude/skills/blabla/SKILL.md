---
name: blabla
description: Use when a repository contains project.bla or .bla contracts. BlaBla is the project's executable memory: check status, explain rules, verify an implementation, author or change contracts.
---

# BlaBla

BlaBla turns behavioral and structural intent into executable contracts and reports GREEN, YELLOW or RED per layer.
`project.bla` is the machine entry point; `blabla status` is the agent entry point.
The contracts are the authority; this skill only teaches the workflow.

## Implementation workflow

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

## Working under an assignment

A project may hand you a bounded task instead of the whole repository. `blabla task show <name>` prints the assignment -- statement, role, write scope,
deliverables, findings, declared check, scratch -- then the routes below, in the order they are taken: acceptance, the declared check and its evidence,
a blocker, a finding, the challenge, the hand-back. That view is the authority, never this file.

  blabla task accept <name> --model <id>   take the assignment before changing anything; unaccepted work is challenged as work done outside BlaBla

Declared check:
  <the declared check>
  blabla task evidence <name> --exit <code> --tool <tool>   record what the whole run reported

  blabla task block <name> "..."   stop and say what blocks it
  blabla task finding <name> "..."   record what you cannot settle inside the task
  blabla challenge <name>   one contradiction grounded in the record and the tree, before handing back
  blabla task ready <name>   hand back for review; closing it is the orchestrator's, never yours

Acceptance records that a role took the work through BlaBla, not that it read what it retrieved. `blabla explain role::<name>` and its policies outrank
any brief; a path outside the write scope is a finding, never a widening; a summary prints a passing count on a red run, so read the whole run before
recording it. A hand-back is not acceptance: closing is the orchestrator's decision, and only `blabla finish` decides whether the project is complete.

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
| `blabla task <action>` | record one bounded change; `show <name>` prints the routes your role takes next; `open`, `resolve` and `close` are the orchestrator's |
| `blabla challenge` | one grounded challenge to the current account of the work; exit 1 when one stands |
| `blabla finish` | structure check plus canonical behavior verification from project.bla; exit 0 only for OVERALL GREEN |
| `blabla run -- <app>` | manual verification with explicit settings; records the result |
| `blabla check` | compile the project, including drafts |
| `blabla guide <topic>` | agent, bootstrap, change, memory, loop |
