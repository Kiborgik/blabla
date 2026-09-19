use super::task;
use clap::ValueEnum;
use serde::Serialize;
use std::borrow::Cow;

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

const LOOP_HEAD: &str = r#"THE DEVELOPMENT LOOP: BOUNDED TASKS AND THE CHALLENGE

blabla explain flow::<name> prints the order this project's roles are meant to work in, one line
per step, and blabla explain step::<name> opens one step in full. Advisory, like the rest of
Process: BlaBla describes the loop and enforces no part of it.

A BOUNDED TASK is the handoff record between an orchestrator and a worker. It is machine state,
not project memory: BlaBla writes it under .blabla/tasks/, no manifest registers it, nothing
validates it for truth, and no state of it reaches OVERALL.

THE ORCHESTRATOR opens it, which snapshots the tree the task starts from. That snapshot is the
only reason anything can later tell a deliverable that was produced from one never touched, or a
file changed inside the write scope from one changed outside it.

  blabla task open <name> --role worker --statement "..." --scope <path> --deliverable <path> --check "..."

THE WORKER takes it up in this order. blabla task show <name> prints these same routes for the
task it was given, and that view is the authority over this text.
"#;

const LOOP_TAIL: &str = r#"
A challenge is a question, never a verdict. It states ONE contradiction grounded in the task
record, the tree measured against its snapshot, the completion state and a falsification verdict,
or names the evidence it lacked. Silence is not approval: no challenge means none was reachable
from that evidence. It reads no meaning from source code. Exit 0 when nothing stands, 1 when
something does. What each class rests on: docs/agent-workflow.md.

THE REVIEWER reads the task and the whole diff in a context that never saw the work being done,
holds the hand-back against the lenses the role consults, and records what it finds. A finding
recorded here survives the context that found it, which is what lets a later challenge notice it
being dropped instead of settled.

  blabla task lens <name> <lens> "..."   one assessment against one lens the role consults,
                                         named by its knowledge pack rather than by a ruling id
  blabla task finding <name> "..."       a defect, with the file and line that show it

THE ORCHESTRATOR settles each finding against the repository, accepts the result, and decides
completion. The evidence written into a resolution is the agent's claim about the repository,
never BlaBla's verdict on it.

  blabla task resolve <name> <id> --evidence "..."
  blabla task check <name> "..."                     declare the check a record opened without, or
                                                     correct the one it declares
  blabla task close <name> --model <id>              refused while a grounded challenge stands
  blabla finish

PROJECT VERIFICATION AND TASK ACCEPTANCE ARE DIFFERENT QUESTIONS. blabla finish decides whether
the project is complete: structure evaluated live, the canonical behavior campaign run, OVERALL
GREEN or not. A task's transitions decide only whether one handoff is in order, and they check
selected recorded conditions: ready needs an acceptance on record, close needs a hand-back with
no challenge standing. Neither a clean task record nor OVERALL GREEN alone establishes
everything: the record shows what was recorded rather than what was done, and GREEN is bounded
by the campaign that produced it.
"#;

pub fn loop_text() -> String {
    format!(
        "{LOOP_HEAD}{}{LOOP_TAIL}",
        task::routes_text("<name>", Some("<the check the assignment declares>"))
    )
}

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

pub fn text(topic: Option<Topic>) -> Cow<'static, str> {
    match topic {
        None => Cow::Borrowed(TOPICS),
        Some(Topic::Agent) => Cow::Borrowed(AGENT),
        Some(Topic::Bootstrap) => Cow::Borrowed(BOOTSTRAP),
        Some(Topic::Change) => Cow::Borrowed(CHANGE),
        Some(Topic::Memory) => Cow::Borrowed(MEMORY),
        Some(Topic::Loop) => Cow::Owned(loop_text()),
    }
}
