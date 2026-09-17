use clap::ValueEnum;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Topic {
    Agent,
    Bootstrap,
    Change,
    Memory,
    Loop,
}

pub const TOPICS: &str = "BlaBla guides

  blabla guide agent       how an implementation agent works with BlaBla
  blabla guide bootstrap   how a contract author writes the first contracts
  blabla guide change      implementing behavior versus changing intended behavior
  blabla guide memory      how an author writes Mission, System, Process and Knowledge
  blabla guide loop        delegating one bounded change, and challenging the account of it
";

pub const LOOP: &str = r#"THE DEVELOPMENT LOOP: BOUNDED TASKS AND THE CHALLENGE

blabla explain flow::<name> prints the order this project's roles are meant to work in: one line
per step, each naming the roles that may carry it and the command that runs it, with
blabla explain step::<name> opening one step in full. Advisory, like the rest of Process.

A BOUNDED TASK is the handoff record between an orchestrator and a worker. It is machine state,
not project memory: BlaBla writes it under .blabla/tasks/, no manifest registers it, nothing
validates it for truth, and no state of it reaches OVERALL.

  blabla task open <name> --role worker --statement "..." --scope <path> --deliverable <path>
  blabla task show <name>                          what it may write and what it owes
  blabla task finding <name> "..."                 discovered, not yet settled
  blabla task resolve <name> <id> --evidence "..." what settled it
  blabla task scope <name> --add <path>            widen a scope declared too narrowly
  blabla task close <name>

Opening a task snapshots the tree it starts from. That snapshot is the only reason anything can
later tell a deliverable that was produced from one never touched, or a file changed inside the
write scope from one changed outside it.

Recording a finding is what survives the context that found it. An agent that discovers a
contradiction, reasons on for an hour and then quietly drops it is the failure this record exists
to catch. A finding with no resolution is evidence still outstanding, and the evidence written
into a resolution is your claim about the repository, never BlaBla's verdict on it.

  blabla challenge

CHALLENGE holds the current account of the work against evidence BlaBla already has and states
ONE challenge to reconcile -- the strongest available -- or says that nothing can be grounded.
Run it before reporting a task done, before writing a review verdict and before the gate.
Exit 0 when no challenge stands, 1 when one does. What it may use, and nothing else:

  unresolved-finding        a finding on an open task with no resolution
  deliverable-unchanged     a declared deliverable absent, or identical to the task's snapshot
  scope-breach              a file changed since the task opened that no declared scope covers
  vacuous-rule              a structure rule the falsifier reports VACUOUS: absent ground
  verification-not-current  the completion state is not GREEN

It decides no correctness, grants no completion and withholds none; blabla status and blabla
finish remain the only authority over that, and finish prints a standing challenge beside its
verdict without changing its exit code. Silence is not approval: no challenge means no
contradiction was reachable from that evidence, which is a statement about the evidence rather
than about the work. BlaBla reads no meaning from source code -- it cannot tell whether a branch
is reachable, whether a name is the one you meant, or whether a test asserts what it claims -- so
a challenge about any of those never appears, because it could not be grounded.
"#;

pub const AGENT: &str = "BlaBla is this project's executable memory.
`blabla` is a command-line tool on PATH; `blabla --help` lists its commands.

Start with:
  blabla status

Layers: BEHAVIOR (runtime behavior, verified by a campaign) and STRUCTURE (codebase and architecture constraints, checked statically); status shows each, OVERALL and every identity.

Every object BlaBla explains has one canonical identity, printed by the command before it; copy it rather than inventing a separator of your own:
  blabla explain contract::<group>   a contract: its path, its state, the id of every rule
  blabla explain <group>::<label>    one rule, its evidence and its counterexample
  blabla explain mission::<name>     why this project exists; priority::<name> opens one priority
  blabla explain system::<name>      one system; responsibility::<name> and seam::<name> open one
  blabla explain role::<name>        one development role; policy::<name> opens one policy
  blabla explain flow::<name>        the order the roles are used in; step::<name> opens one step
  blabla explain knowledge::<pack>   one pack; ruling::<pack>::<name> opens one ruling in full
  blabla explain runtime::<name>     one BlaBla-controlled runtime primitive
Process roles, policies and flows are ADVISORY; a ruling is expertise, never permission to widen a task.
Delegating one bounded change, and asking BlaBla to contradict your account of it: blabla guide loop

Before declaring work complete: blabla finish. It checks structure, runs the canonical
behavior verification (project.bla defines it) and decides:
RED:    a rule is violated; use the minimized counterexample or the observed structural fact. NOT COMPLETE.
YELLOW: no known violation, but required behavior remains unverified; supply the listed witness. NOT COMPLETE.
GREEN:  every active layer passed. Only OVERALL GREEN means completion.

Do not modify .bla contracts or the verification profile merely to make the implementation pass.
Changing intended behavior is a separate contract-author task: blabla guide change
";

pub const BOOTSTRAP: &str = "CONTRACT BOOTSTRAP: writing the first behavior contracts

Roles: the contract author decides what observable behavior must stay true.
The implementation agent makes it true. One model may play both roles, in separate phases.

Authority of sources, highest first:
  1. explicit current human or product requirements
  2. approved product and specification documents
  3. public API and acceptance tests
  4. other existing tests
  5. README and docs (may be stale)
  6. current implementation (evidence, not truth)
  7. observed runtime behavior (evidence, not truth)
  8. your own inference (candidate only)
Never promote a lower source over a higher one silently. Existing code may be wrong;
a contract must not canonize a bug because the code happens to behave that way.

Workflow:
  1. collect the intent sources above
  2. extract observable candidate behaviors: state, actions, what must hold after each action
  3. list CONFLICTS between sources and UNKNOWNS that no source answers
  4. write draft contracts and register them:  draft behavior \"contracts/behavior/<name>.bla\"
  5. blabla check   (drafts are compiled and checked against the active contracts)
  6. skeptic pass (below)
  7. a human resolves every CONFLICT and UNKNOWN
  8. promotion: change  draft behavior  to  use behavior  in project.bla
  9. canonical verification: add  verify behavior { command [\"program\", \"argument\", ...] seed 0 cases 1 steps 4096 timeout_ms 1000 shrink_budget 256 }
     to project.bla; paths resolve against the project root; blabla finish uses exactly this profile

Report conflicts and unknowns explicitly, for example:
  CONFLICT renew-semantics
    requirements.md: renewal replaces remaining lifetime
    README.md: renewal adds to remaining lifetime
    implementation: adds
    cannot establish authoritative behavior automatically
  UNKNOWN release by the wrong keeper
    observed implementation: no-op; no authoritative requirement found
BlaBla does not resolve these. A human decision or an approved source does.

Skeptic pass, for every draft rule:
  What meaningful regression could still happen while this contract stays GREEN?
  Did I encode implementation details (collections, call order, files, algorithms) instead of behavior?
  Did I infer current bugs as intended behavior?
  Did I ignore a contradicting source?
  Is the rule stricter than the intent requires?
  Which rules exist only because current code happens to behave that way?
Before adding a rule ask: what regression becomes possible if this rule disappears?
For a structure contract, blabla check --falsify <contract.bla> answers part of that mechanically:
it names every rule whose verdict does not depend on the fact the rule states. It cannot tell you
that a rule names the wrong thing, so it narrows the skeptic pass and never replaces it.

Drafts are visible in blabla status, are never verified and are never treated as truth.
Only contracts listed with  use behavior  are authoritative.
";

pub const CHANGE: &str = "CHANGING BEHAVIOR VERSUS IMPLEMENTING BEHAVIOR

Implementation task (the normal case):
  contracts stay unchanged -> implement -> blabla finish
  RED: fix the counterexample. YELLOW: supply the missing witness. GREEN: done.

Product behavior change (intended behavior differs from the contract):
  1. contract-author phase: change the .bla rule to the new intent, citing the requirement
  2. blabla check
  3. implementation phase: make the application satisfy the changed contract
  4. blabla finish  until GREEN

A .bla edit made only to turn RED or YELLOW into GREEN is a contract weakening, not a change of intent.
Shrinking the verification profile in project.bla to reach GREEN is the same weakening.
When one agent plays both roles, do the phases in this order and say which phase you are in.
";

pub const MEMORY: &str = r#"AUTHORING PROJECT MEMORY

Contracts say what must remain true. Project memory says the rest of what an agent would
otherwise be told by hand. Four kinds, each answering one question, none repeating another.

  Mission    mission, priority               why the project exists, what decides a tradeoff
  System     system, responsibility, seam    what part is being touched and who owns it
  Process    role, policy, flow, step        who is expected to do what, and in what order
  Knowledge  knowledge, ruling               reusable expertise, portable between projects

Declaration shape:

  mission "blabla" { statement "..." non_goals ["..."] }
  priority "truthful-over-convenient" { statement "..." }

  system "cli" { purpose "..." paths ["src/cli/mod.rs"] knowledge ["engineering"] }
  responsibility "render" { owner "cli" statement "..." }
  seam "provider" { between ["a", "b"] value "ModuleFacts" statement "..." moves_with ["..."] }

  role "worker" { purpose "..." owns ["..."] verification "focused" model ["..."] consult ["testing"] }
  policy "explicit-write-scope" { statement "..." applies_to ["worker"] }
  flow "development" { purpose "..." }
  step "assign" { flow "development" role ["orchestrator"] statement "..." command "blabla task open" }

  knowledge "engineering" { purpose "..." }
  ruling "smallest-correct-change" { pack "engineering" statement "..." }

Registration in project.bla, one mission, one system, one process, any number of knowledge:

  mission "mission.bla"
  system "system.bla"
  process "process.bla"
  knowledge "knowledge/engineering.bla"

A flow declares the order its roles are meant to work in; its steps are separate declarations
naming the flow they belong to, and their declaration order is the flow's order. A step names
every role that may carry it and, where one exists, the command that runs it. A flow with no
step is invalid, because a loop with no steps describes nothing. Steps are surveyed one line
each from the flow and cost one more explain to read in full, the same asymmetry a pack and its
rulings already have. A step's command is a description of the intended loop and never an
enforcement of it: nothing checks that anyone ran it.

Routing points into Knowledge and never out of it: a system names the packs its work needs,
a role or a policy names the packs it consults. No content crosses. A ruling has exactly two
fields and can name no system, role, contract or path, which is what lets another project
register the same pack file unchanged.

Authoring loop:

  blabla check mission.bla     VALID or INVALID, while the file is still being authored
  (register the path in project.bla)
  blabla status                every declared kind, its state, and the identities it holds
  blabla explain <identity>    mission::, system::, role::, knowledge::, then one level deeper

A name becomes part of an identity, so it starts with a letter or digit and continues with
letters, digits, _ or -. A pack that declares no ruling is invalid: routing would point at nothing.

What this is not:
  Project memory is never checked against the repository, and no state of it reaches OVERALL.
  A project that declares none of it is not thereby incomplete; author the kind you need.
  Process is ADVISORY. BlaBla describes the intended authority and does not enforce it.
  Mission is owner intent rather than a gate; a planner who finds the evidence points elsewhere
  is expected to say so instead of complying.
  A ruling is expertise, never permission to widen the task you were given.

Every field and every diagnostic: docs/project.md.
"#;

pub fn text(topic: Option<Topic>) -> &'static str {
    match topic {
        None => TOPICS,
        Some(Topic::Agent) => AGENT,
        Some(Topic::Bootstrap) => BOOTSTRAP,
        Some(Topic::Change) => CHANGE,
        Some(Topic::Memory) => MEMORY,
        Some(Topic::Loop) => LOOP,
    }
}
