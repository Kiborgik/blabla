use clap::ValueEnum;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Topic {
    Agent,
    Bootstrap,
    Change,
}

pub const TOPICS: &str = "BlaBla guides

  blabla guide agent       how an implementation agent works with BlaBla
  blabla guide bootstrap   how a contract author writes the first contracts
  blabla guide change      implementing behavior versus changing intended behavior
";

pub const AGENT: &str = "BlaBla is this project's executable memory.
`blabla` is a command-line tool on PATH; `blabla --help` lists its commands.

Start with:
  blabla status

Project memory has layers: BEHAVIOR (runtime behavior, verified by a campaign) and
STRUCTURE (codebase and architecture constraints, checked statically). status shows each
layer and OVERALL; project.bla lists the active contracts and status reads them for you.

During implementation:
  a rule is unclear or not GREEN:    blabla explain <rule>
  before declaring work complete:    blabla finish

Some rules depend on BlaBla-controlled runtime primitives; status lists the ones in use.
If a rule names a runtime primitive you do not understand:  blabla explain runtime::<name>

blabla finish checks structure, runs the canonical behavior verification (project.bla defines it) and decides:
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

pub fn text(topic: Option<Topic>) -> &'static str {
    match topic {
        None => TOPICS,
        Some(Topic::Agent) => AGENT,
        Some(Topic::Bootstrap) => BOOTSTRAP,
        Some(Topic::Change) => CHANGE,
    }
}
