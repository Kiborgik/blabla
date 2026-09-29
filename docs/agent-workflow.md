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
6. **Implement inside the scope.** Ordinary code, only in the paths the task names. When a call
   is yours to make and you are not sure of it, ask it with `blabla task decide` instead of
   guessing; see [Asking instead of guessing](#asking-instead-of-guessing). When `task show`
   lists a question under **Questions from the orchestrator** with no pick, its first route line
   says to pick it: do that before anything else with `blabla task decide <name> --on <id>`,
   because `task ready` is refused until every question has a pick; see
   [Questions from the orchestrator](#questions-from-the-orchestrator).
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
    evidence, receipt and project report satisfy the close prerequisites and every record made
    under an orchestrator model while the worker carried the task is confirmed; see
    [What --model attests](#what---model-attests).
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
blabla task open <name> … --goal <name>   record the declared goal the task serves; task show prints Serves goal::<name>
blabla task show <name>                 what this task may write and what it owes, then its routes
blabla task accept <name> --model <id>  take the assignment; the model is compared exactly against what the role lists, and `blabla challenge <name>` reports a mismatch immediately rather than at hand-back
blabla task evidence <name> --exit <code> --tool <tool>   the declared check's result, bound to the inputs it saw
blabla task evidence <name> --run       for a check declared as a program and its arguments: BlaBla runs it from the project root without a shell and records the exit code it observed
blabla task block <name> "…"            stop, and record why as a finding
blabla task note <name> "…"             keep a note on the record; a note is not a finding and blocks nothing
blabla task finding <name> "…"          something discovered and not yet settled
blabla task addressed <name> <id> "…" --model <id>   what the carrying role did about a finding; an addressed finding blocks neither hand-back nor close, and resolving it stays the orchestrator's job
blabla task decide <name> "<question>" --pick <option> --confidence <0-100> --model <id> [--options a,b,c]   ask a call you are not sure of; below the role's floor it blocks the task until the orchestrator answers
blabla task ask <name> "<question>" [--options a,b,c] [--floor <0-100>] --model <id>   the orchestrator asks the carrying role a call it doubts; hand-back is refused until it has a pick
blabla task decide <name> --on <question-id> --pick <option> --confidence <0-100> --model <id>   pick a question the orchestrator asked; below the question's floor it blocks the task until the orchestrator answers
blabla task answer <name> <id> --pick <option> --reason "…" --model <id>   the orchestrator answers a decision below the floor or reviews one that stood; the worker then resumes with task accept
blabla task lens <name> <lens> "…"      one assessment against one lens the role consults, named by its pack; each is recorded before hand-back
blabla task ready <name>                hand back for review
blabla task resolve <name> <id> --evidence "…" --model <id>   what settled a finding; the orchestrator's decision
blabla task attribute <name> <path>... --kind <task|concurrent|unknown> --model <id>   the orchestrator states where a changed path came from
blabla task check <name> "…"            declare the check a record opened without, or correct it; --input <path>... names what it reads
blabla task check <name> --argv <prog> <arg>...   the same check as a program and its arguments; --argv, like --check-argv on task open, takes every argument after it, so it goes last
blabla task deliverable <name> --add <path>...   owe more
blabla task deliverable <name> --remove <path> --reason "…" --model <id>   withdraw what the task owes; a directory withdraws every file owed under it
blabla task scope <name> --add <path>   widen a scope that was declared too narrowly
blabla task confirm <name> --model <id>   after hand-back, confirm every record made under an orchestrator model while a worker carried the task; refused while it is carried; the list is kept
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

## What --model attests

`--model <id>` is an attestation, not proof. On every verb that takes it, BlaBla records the model
the caller says it is and cannot check the claim: a worker that types the orchestrator's model into
`task resolve` leaves a record identical to one the orchestrator made. BlaBla challenges the case
where that matters most, an orchestrator-only record made while a worker holds the task.

A task is carried from the carrying role's `task accept` until its `task ready` or `task block`,
that is, while it is ACCEPTED. The orchestrator-only verbs that write the task are `task resolve`,
`task attribute`, `task scope`, `task check`, `task deliverable --add` and `--remove`,
`task approve-model`, `task answer` and `task ask`. Each one stores the model it was given, the time, and the
model that carried the task if one did; `task scope`, `task check`, `task deliverable --add` and
`task approve-model` take no `--model`, so their records name none. For a record made while a worker
carries the task, BlaBla:

- lists it in `task show <name>` under "Recorded under an orchestrator model while <model> carried
  the task", with its verb, its model and whether it is confirmed;
- grounds the `orchestrator-record-during-carry` challenge while it is unconfirmed;
- does not refuse `task ready`, because the carrying role cannot clear it;
- refuses `task close` until the orchestrator confirms it.

After hand-back the orchestrator reviews each listed record and confirms it with `blabla task
confirm <name> --model <id>`, which is gated like `task resolve`, or undoes it. `task confirm` is
refused with exit 2 while the task is carried, naming the carrier, so the role that holds the task
cannot clear a record from its own carry by typing the orchestrator's model. Undoing a change does
not remove its record: after undoing what it did not make, the orchestrator still confirms before
close. A confirmation covers every record from a carry made so far and keeps the list; a later
record stands until it is confirmed too. A confirmation is itself an attestation under a second `--model`,
not proof of who made either. A record made while nobody carries the task, OPEN, BLOCKED or READY,
stays in the task record that `task show <name> --json` prints, is not listed and grounds nothing.

## Asking instead of guessing

A worker meets calls the statement leaves open: which of two causes explains a failure, what a
flag should be named, whether an edge case is in scope. Stating one with confidence and building
on it is how a small model goes wrong without anyone noticing. `task decide` turns the call into a
typed question with the pick and a stated confidence, on the record:

```text
blabla task decide fix-cache "Is the stale read caused by the cache?" --pick yes --confidence 55 --model haiku-4.5
blabla task decide fix-cache "Which lock guards the entry?" --options read,write,none --pick write --confidence 80 --model haiku-4.5
```

Without `--options` the question is yes-no and the pick is `yes` or `no`; with `--options` the pick
is one of them. A pick outside the options, or a confidence outside 0..100, is refused with exit 2
and nothing is recorded. Only the carrying role decides, once the task is accepted, with a model its
role permits, the same check `task addressed` makes.

The role's `block_below` is the floor. The command prints one of two outcomes:

- **STANDS**: the confidence is at or above the floor. Act on the pick. The orchestrator may still
  review it.
- **BLOCKS THE TASK**: the confidence is below the floor, so the call is the orchestrator's. The
  decision is recorded and the task is BLOCKED on it in the same step. Stop now and do not act on
  the pick.

Only the orchestrator's answer settles a decision below the floor. It answers with `blabla task
answer <name> <id> --pick <option> --reason "…" --model <id>`, which is gated like `task resolve`.
An answer settles a decision below the floor or reviews one that stood, and a pick that differs
from the worker's overrules it. Answering does not unblock the task: the worker reads the answer in
`task show <name>` and resumes with `blabla task accept <name> --model <id>`, which is refused, with
the question named, while a decision below the floor has no answer. Until then `task ready` is
refused and the `decision-unanswered` challenge stands. An answer does not invalidate a challenge
receipt, so a READY task can be reviewed without being handed back again. A BLOCKED task takes no
decision: `task decide` on it is refused with exit 2, records nothing and names the decision that
blocks it.

`task show <name>` lists every decision under **Decisions**, headed by the floor the carrying role
declares: its kind and options, the pick and confidence, STANDS or BLOCKS THE TASK, and the answer if
there is one. `blabla explain role::<name>` prints the floor and, from every task record that role
carried, closed or not, one calibration line per model with answered decisions:

```text
haiku-4.5  12 answered  7 held  mean confidence 84  3 on asked questions
```

`held` counts answers that kept the pick, and `on asked questions` counts the answered picks made
on a question the orchestrator asked. The line shows how well a model's stated confidence matches
what the orchestrator decided. It is a record, like a task: it reaches no layer and never decides
completion.

### Questions from the orchestrator

The floor stops a worker acting on a low-confidence call it chose to record, but an overconfident
worker never records one. The orchestrator knows which calls it doubts, such as a cause, a fix or
whether a failure is this task's, and asks them as typed questions:

```text
blabla task ask fix-cache "Is the failing test this task's?" --floor 90 --model opus-5
blabla task ask fix-cache "Which lock guards the entry?" --options read,write,none --model opus-5
```

`task ask` is gated like `task resolve`: a model role::orchestrator does not permit is refused with
exit 2 and nothing is recorded, and like every orchestrator verb it is attested; see
[What --model attests](#what---model-attests). Without `--options` the question is yes-no. It gets
the id `q1`, `q2` and so on. `--floor` is the confidence a pick needs to stand: without it the
question uses the carrying role's `block_below`, and a floor outside 0..100 or below the role's is
refused with exit 2, so a question can raise the floor but never lower it. Asking is allowed on any
task that is not closed and never changes its state.

The worker picks with `blabla task decide <name> --on <id> --pick <option> --confidence <0-100>
--model <id>`. The question text and options come from the question, so passing a question text or
`--options` as well is refused. The pick is a decision linked to the question, measured against the
question's floor, or the role's if the role's is higher, and it follows every rule above: a pick
outside the options or a confidence outside 0..100 is refused, a BLOCKED task takes no pick, and
below the floor the task is BLOCKED at once until the orchestrator answers. A question is picked
once; a second pick is refused with exit 2 and names the decision that picked it.

`task show <name>` lists the questions under **Questions from the orchestrator**, before
**Decisions**, unpicked first, each with its floor and either its pick or the exact command to pick
it. While a question has no pick, the first route line says to pick it before anything else,
`task ready` is refused and the `question-unpicked` challenge stands with the question's id, text
and options as its evidence and that command as its reconcile text. A question asked after
hand-back stands against the READY task too, so the worker resumes with `task accept` and picks it.
A pick is a decision, so it counts in calibration like any other.

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
| `decision-unanswered` | a decision recorded below its floor, the role's `block_below` or an asked question's, that has no answer from the orchestrator |
| `question-unpicked` | a question the orchestrator asked with `task ask` that has no pick from the carrying role; `task ready` is refused while it stands |
| `orchestrator-record-during-carry` | a record made under an orchestrator model while a worker carried the task that the orchestrator has not confirmed; it does not refuse `task ready`, and `task close` is refused while it stands |
| `readiness-without-evidence` | an accepted or handed-back task with no result recorded for the declared check, or only results for other checks |
| `evidence-superseded` | the most recent result for the declared check ran against inputs that have since changed |
| `lens-unassessed` | an accepted or handed-back task with a lens the role consults carrying no assessment; a lens is one of the knowledge packs `role::<name>` lists under Consult, so `blabla task lens` takes the pack name and not a `ruling::<pack>::<name>` identity |
| `attribution-unknown` | a path changed since the task opened whose origin, this task or concurrent work, is not stated |
| `vacuous-rule` | a structure rule the falsifier reports VACUOUS — a rule standing on absent ground |
| `verification-not-current` | project completion is not current; this remains an orchestrator-owned concern for a selected assignment challenge |
| `goal-outcome-unmet` | with no bounded task selected, a goal in state `done` has an expectation that is not held in the current project view; `finish` never raises it |

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
