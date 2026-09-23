BlaBla is this project's executable memory.
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
Process roles, policies and flows bind the role you carry; a ruling is expertise, never permission to widen a task.
Delegating one bounded change, and asking BlaBla to contradict your account of it: blabla guide loop

Before declaring work complete: blabla finish. It checks structure, runs the canonical
behavior verification (project.bla defines it) and decides:
RED:    a rule is violated; use the minimized counterexample or the observed structural fact. NOT COMPLETE.
YELLOW: no known violation, but required behavior remains unverified; supply the listed witness. NOT COMPLETE.
GREEN:  every active layer passed. Only OVERALL GREEN means completion.

Do not modify .bla contracts or the verification profile merely to make the implementation pass.
Changing intended behavior is a separate contract-author task: blabla guide change