CONTRACT BOOTSTRAP: writing the first behavior contracts

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
  4. write draft contracts and register them:  draft behavior "contracts/behavior/<name>.bla"
  5. blabla check   (drafts are compiled and checked against the active contracts)
  6. skeptic pass (below)
  7. a human resolves every CONFLICT and UNKNOWN
  8. promotion: change  draft behavior  to  use behavior  in project.bla
  9. canonical verification: add  verify behavior { command ["program", "argument", ...] seed 0 cases 1 steps 4096 timeout_ms 1000 shrink_budget 256 }
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