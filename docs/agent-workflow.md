# Agent workflow

BlaBla is executable project memory. Agents should not read every contract up front; start from the project state and drill down only when needed.

```text
blabla status                 current layers, rules needing attention, completion state
blabla explain <group>::<label>   one rule and its evidence/counterexample
blabla explain contract::<group>  one contract: its path, its state, the id of every rule
blabla explain mission::<name>    why the project exists, what decides a tradeoff, the non-goals
blabla explain system::<name>     one system, the responsibilities it owns and its seams
blabla explain knowledge::<pack>  one knowledge pack and the id of every ruling it holds
blabla explain flow::<name>       the order the roles are meant to work in, one line per step
blabla guide memory               how project memory is authored, when you are adding to it
# edit ordinary application code
blabla challenge              one grounded challenge to the current account of the work
blabla finish                 canonical behavior run + live structure check
```

Only `OVERALL GREEN` means the declared project state is complete.

## Progressive disclosure

Pull context in only as far as the question needs:

1. `blabla status`
2. the one rule it names
3. `blabla explain <group>::<label>`, or `blabla explain contract::<group>` for the whole contract
4. `blabla explain runtime::<id>`, if that rule depends on a runtime primitive
5. the contract source, only when the rule is still unclear

The point is not to replace a large prompt with a large `.bla` dump. Contracts stay in the
repository and enter context only when they are needed.

Knowledge follows the same path, and this is where the saving is largest:

1. `blabla explain system::<name>` for the part you are about to touch, which names the packs
   its work commonly needs; `blabla explain role::<name>` names the packs your role consults
2. `blabla explain knowledge::<pack>` prints the pack's purpose and the **identity** of every
   ruling in it, never the rulings themselves
3. `blabla explain ruling::<pack>::<name>` for the one ruling that bears on the decision

A pack therefore costs one line per ruling to survey and one ruling to read. Enumerating every
pack in a project is cheap; reading every ruling is not, and is almost never what the question
needs. A ruling is reusable expertise about how to do the work well — it is not permission to
widen the task you were given, which comes from your assignment and from `role::<name>`.

## Reading status

```text
BEHAVIOR   54/54 rules  GREEN
STRUCTURE  45/47 rules  RED
OVERALL    BLOCKED

Structure violations:
  RED    architecture::no-domain-restart    glyph_vault/domain.py:86 defines VaultDomain.restart
  RED    architecture::no-protocol-restart  glyph_vault/protocol.py:4 ARGUMENTS contains "restart"

Next:
  blabla explain architecture::no-domain-restart
```

- **RED:** fix the counterexample (behavior) or observed fact (structure).
- **YELLOW:** no violation was found, but required behavior was not exercised. Not complete.
- **STALE / UNVERIFIED / INTERRUPTED:** run `blabla finish`.
- **VERIFYING:** another `finish` is still running.
- **OVERALL GREEN:** completion gate passed.

## Long verification runs

`blabla finish` prints `COMPLETION GATE: VERIFYING` immediately, then periodic progress and the final verdict. In `--json` mode, progress goes to stderr and stdout remains one JSON document.

Give the command enough time to finish. A run that is killed or detached does not leave behind a current GREEN.

## Runtime primitives

Some actions are controlled by BlaBla rather than implemented by the application. For example, `action restart()` maps to `runtime::restart`.

Every explainable object has one canonical identity — `contract::<group>`, `<group>::<label>`, `mission::<name>`, `priority::<name>`, `knowledge::<pack>`, `ruling::<pack>::<name>`, `system::<name>`, `responsibility::<name>`, `seam::<name>`, `role::<name>`, `policy::<name>`, `flow::<name>`, `step::<name>`, `runtime::<name>` — and the command before it prints that identity. Copy it; never build one by guessing a separator. A ruling identity has three segments because it carries its pack: two reusable packs may declare the same ruling name and both must stay reachable. `status` lists every coarse identity even when everything is GREEN, so the path from `status` to any rule, ruling, responsibility or seam is two explains.

If a rule depends on a runtime primitive, `blabla explain <group>::<label>` shows the dependency. Use `blabla explain runtime::restart` for the exact semantics.

Do not add an application-level implementation of a BlaBla runtime primitive.

## The development loop

A project that declares a `flow` describes how work moves between agents. The order below is the
normal path:

1. **Enter the project.** `blabla status` — what project this is, what is GREEN, what needs attention.
2. **Recover only the relevant context.** `blabla explain <identity>` for the system you are about to
   touch, the rulings it routes to, and nothing else.
3. **Find your role and the flow.** `blabla explain role::<name>` for what you own and which
   verification is yours; `blabla explain flow::<name>` for the order, one line per step, and
   `blabla explain step::<name>` for one step in full.
4. **Open or read the bounded task.** The orchestrator opens it with `blabla task open`, naming
   the scope, the deliverables and the check that covers it; a worker reads its assignment with
   `blabla task show <name>`, which prints the routes below in the order they are taken.
5. **Accept the assignment.** `blabla task accept <name> --model <id>` before changing anything.
   Acceptance records that a role took the work through BlaBla and nothing about what it read.
6. **Implement inside the scope.** Ordinary code, only in the paths the task names.
7. **Run the declared check and record it while the task is ACCEPTED.** `blabla task evidence <name> --exit <code> --tool <tool>`
   after reading the whole run — not a summary line alone. Evidence is bound to the task tree and
   only a current successful result can support READY.
8. **Challenge the account.** `blabla challenge <name>` records or clears the explicit assignment
   challenge receipt. Project-wide verification concerns remain orchestrator-owned.
9. **Hand back.** `blabla task ready <name>` requires ACCEPTED ownership, current successful evidence
   and that explicit challenge receipt. A READY task must be accepted again before edits or new evidence.
10. **Independent review.** A reviewer reads the task and the diff in a context that never saw the
    work being done, records one assessment per lens the role consults with `blabla task lens`, and
    records defects with `blabla task finding`.
11. **Integrate.** The orchestrator settles each finding against the repository and records what
    settled it with `blabla task resolve`.
12. **Accept the result.** `blabla task close <name> --model <id>`, refused until the fresh task
    evidence, receipt and project report satisfy the close prerequisites.
13. **Decide completion.** `blabla finish`.

In this repository that flow is `flow::development`, and `role::orchestrator`, `role::worker` and
`role::reviewer` are the roles its steps name.

Process describes the intended loop. Task transitions enforce the recorded prerequisites
described below. BlaBla does not schedule work or launch agents.

`challenge` and the reviewer are not the same thing. `challenge` is a deterministic check over
recorded evidence and reads no meaning from source code. The reviewer is a role: it reads the diff,
forms judgements BlaBla cannot, and records them as findings. Neither decides completion.

## Project verification versus task acceptance

Two different questions, answered by different commands. `blabla finish` decides whether the
**project** is complete: structure evaluated live, the canonical behavior campaign run, `OVERALL`
GREEN or not. A task's transitions decide only whether one **handoff** is in order, and they enforce
recorded prerequisites. Tasks render as
`OPEN`, `ACCEPTED`, `BLOCKED`, `READY` or `CLOSED`. Evidence is accepted only in ACCEPTED; READY
requires accepted ownership, current successful evidence and an explicit assignment challenge receipt
tied to the task's own paths. An edit inside the write scope, the deliverables or the declared
inputs, new evidence, findings or policy metadata invalidate that receipt; an edit anywhere else,
including a path attributed to concurrent work, does not. A READY worker resumes by accepting before changing anything. CLOSE still requires fresh
task evidence, a current receipt and the current project report. Neither a clean task record nor
`OVERALL GREEN` alone establishes everything: a record shows what was recorded rather than what was
done, and GREEN is bounded by the campaign and the providers that produced it.

## Bounded tasks

Check evidence covers the write scope and deliverables by default. Use `--input PATH` on
`task open` or `task check` to declare the actual check dependencies, including read dependencies
outside the write scope; deliverables are always included. Directory inputs cover their descendants.
Creating, deleting or changing an input invalidates evidence, including a path absent when checked.
Declaring inputs is an orchestrator claim, not automatic dependency discovery. Omitting `--input`
when correcting a check restores the scope default.

A bounded task is the handoff record between an orchestrator and a worker. It is **machine state,
not project memory**: BlaBla writes it under `.blabla/tasks/`, no manifest registers it, nothing
validates it for truth, and no state of it reaches `OVERALL`.

```text
blabla task open <name> --role worker --statement "…" --scope src/cli --deliverable tests/cli.rs --check "…"
blabla task show <name>                 what this task may write and what it owes, then its routes
blabla task accept <name> --model <id>  take the assignment; the model is compared exactly against what the role lists, and `blabla challenge <name>` reports a mismatch immediately rather than at hand-back
blabla task evidence <name> --exit <code> --tool <tool>   the declared check's result, bound to the inputs it saw
blabla task evidence <name> --run       for a check declared as a program and its arguments: BlaBla runs it from the project root without a shell and records the exit code it observed
blabla task block <name> "…"            stop, and record why as a finding
blabla task note <name> "…"             keep a note on the record; a note is not a finding and blocks nothing
blabla task finding <name> "…"          something discovered and not yet settled
blabla task addressed <name> <id> "…" --model <id>   what the carrying role did about a finding; an addressed finding blocks neither hand-back nor close, and resolving it stays the orchestrator's job
blabla task lens <name> <lens> "…"      one assessment against one lens the role consults, named by its pack; each is recorded before hand-back
blabla task ready <name>                hand back for review
blabla task resolve <name> <id> --evidence "…" --model <id>   what settled a finding; the orchestrator's decision
blabla task attribute <name> <path>... --kind <task|concurrent|unknown> --model <id>   the orchestrator states where a changed path came from
blabla task check <name> "…"            declare the check a record opened without, or correct it; --input <path>... names what it reads
blabla task check <name> --argv <prog> <arg>...   the same check as a program and its arguments; --argv, like --check-argv on task open, takes every argument after it, so it goes last
blabla task deliverable <name> --add <path>...   owe more
blabla task deliverable <name> --remove <path> --reason "…" --model <id>   withdraw what the task owes; a directory withdraws every file owed under it
blabla task scope <name> --add <path>   widen a scope that was declared too narrowly
blabla task close <name> --model <id>   accept the result; refused while a grounded challenge stands
```

A task moves `OPEN → ACCEPTED → READY → CLOSED`, with `BLOCKED` reachable from `ACCEPTED` and
back. `blabla guide loop` prints the worker's routes in the order they are taken, generated from
the same source as `task show`, so the two cannot drift apart.

Opening a task snapshots the tree it starts from. That snapshot is the only reason a later
challenge can distinguish a deliverable that was produced from one that was never touched, and a
file changed inside the write scope from one changed outside it. `blabla status` lists every
recorded task.

A deliverable is measured per file, so a directory named as one becomes the files under it, the way
`git add` treats a directory. `blabla task deliverable <name> --add <dir>` re-reads it and owes any
file that appeared since. The files it walks are the ones the implementation fingerprint walks, so
build output and `.blabla` are never owed.

A recorded finding outlives the context that found it. A finding with neither a resolution nor an
addressed mark is evidence still outstanding, and `challenge` reports it while it stays that way. The evidence written into a
resolution is the recording agent's claim about the repository, not BlaBla's verdict on it.

## Challenging the account of the work

```text
blabla challenge
```

`challenge` holds the current account of the work against evidence BlaBla already has and states
**one** grounded challenge to reconcile — the strongest available — or says that nothing can be
grounded. For a selected ACCEPTED task it records or clears the assignment challenge receipt; a
project-only inspection remains nonmutating. Run it before reporting a task done, before writing a
review verdict and before the gate. Without a task it exits 0 when no challenge stands and 1 when
one does; with a task that is not closed it exits on the assignment check, 0 when the assignment is
clear and 1 when it needs attention, because project-wide verification stays the orchestrator's.

The evidence it may use, and nothing else:

| Class | Grounded in |
| --- | --- |
| `unresolved-finding` | a finding recorded against an open task with neither a resolution nor an addressed mark |
| `deliverable-unchanged` | a declared deliverable absent, or byte-identical to the task's snapshot |
| `scope-breach` | a file changed since the task opened that no declared scope covers |
| `work-without-acceptance` | a file changed since the task opened while no role accepted the assignment |
| `model-outside-role-policy` | the task was accepted on a model the role's declared choices do not list, with no owner ruling |
| `exception-unresolved` | a model exception was proposed and no owner ruling answers it |
| `declared-check-failed` | the most recent result for the declared check exited non-zero |
| `readiness-without-evidence` | an accepted or handed-back task with no result recorded for the declared check, or only results for other checks |
| `evidence-superseded` | the most recent result for the declared check ran against inputs that have since changed |
| `lens-unassessed` | an accepted or handed-back task with a lens the role consults carrying no assessment; a lens is one of the knowledge packs `role::<name>` lists under Consult, so `blabla task lens` takes the pack name and not a `ruling::<pack>::<name>` identity |
| `attribution-unknown` | a path changed since the task opened whose origin, this task or concurrent work, is not stated |
| `vacuous-rule` | a structure rule the falsifier reports VACUOUS — a rule standing on absent ground |
| `verification-not-current` | project completion is not current; this remains an orchestrator-owned concern for a selected assignment challenge |

One challenge is reported at a time, the strongest available; the classes it could not ground are
listed with the evidence each lacked.

What it does **not** do: it decides no correctness, grants no completion and withholds none, and
`blabla status` and `blabla finish` remain the only authority over that. `finish` prints a
standing challenge beside its verdict and its exit code is unchanged by it. Silence is not
approval — no challenge means no contradiction was reachable from that evidence, which is a
statement about the evidence and not about the work. BlaBla reads no meaning from source code, so
it cannot tell whether a branch is reachable or whether a test asserts the thing it claims; a
challenge about those never appears, because it could not be grounded.

## Authoring a structure contract

```text
blabla check contracts/architecture.bla
```

This evaluates that one contract against the real project root, so an author learns whether their
rules evaluate before the contract is registered. Exit 0 all GREEN, 1 on any RED, 3 on any ERROR;
rule ids print as bare labels because the file is checked standalone.

An ERROR means BlaBla cannot establish the fact at all and the rule is worthless as written — fix it
or delete it, never leave it. A GREEN result proves each rule evaluates; it does not prove any rule
can fail. A `forbid` rule that could never be violated is indistinguishable from a satisfied one, so
check that the fact you wrote is the fact you meant.

```text
blabla check --falsify contracts/architecture.bla
```

That is the command for the second question. For each rule it inverts the fact the rule names inside
the facts already inspected and decides the rule again: FALSIFIABLE when the verdict moves between
GREEN and RED, VACUOUS when it does not because the fact has no ground to stand on, UNEVALUABLE when
the rule is ERROR and has no truth value to invert. Exit 0 every rule falsifiable, 1 any vacuous,
3 any unevaluable. It never writes to the repository, and a FALSIFIABLE verdict is about the
evaluator, not about whether you named the concept you meant.

`blabla status` and `blabla finish` remain the only authority over whether the project is complete.

## Authoring project memory

```text
blabla guide memory
blabla check mission.bla
```

`guide memory` is the authoring procedure: what Mission, System, Process and Knowledge each answer,
the declaration and registration shape, the direction routing runs, and what memory deliberately
does not do. `check <file>.bla` reports VALID or INVALID for one memory file while it is still being
written, and `blabla status` reports each registered kind once the manifest names it.

Memory is validated within itself and never against the repository, so neither VALID nor a GREEN
status is a claim that a system, role or ruling describes this project accurately. That judgment
stays with the author.

## Contracts vs implementation

Implementation work should change ordinary source code. Do not edit `.bla` contracts or the canonical verification profile just to obtain GREEN.

Changing intended product behavior is a separate contract-authoring operation:

```text
blabla guide change
```

For a new project:

```text
blabla init --agents
blabla guide bootstrap
```

`init --agents` writes a small managed `AGENTS.md` block and a portable skill under `.agents/skills/blabla/` and `.claude/skills/blabla/`.

The [agent integration smoke tests](../evals/README.md) exercise discovery and this workflow in
Claude Code and Codex. Their [findings](../evals/findings.md) distinguish source fixes from observed
agent behavior; these manual diagnostics are separate from the product completion gate.
