THE DEVELOPMENT LOOP: BOUNDED TASKS AND THE CHALLENGE

blabla explain flow::<name> prints the order this project's roles are meant to work in, one line
per step, and blabla explain step::<name> opens one step in full. Task transitions enforce the
recorded hand-back prerequisites.

A BOUNDED TASK is the handoff record between an orchestrator and a worker. It is machine state,
not project memory: BlaBla writes it under .blabla/tasks/, no manifest registers it, nothing
validates it for truth, and no state of it reaches OVERALL.

THE ORCHESTRATOR opens it, which snapshots the tree; only that snapshot tells a produced
deliverable from an untouched one, and a change inside the write scope from one outside it.

  blabla task open <name> --role worker --statement "..." --scope <path> --deliverable <path> --check <prog> <arg>...

Add --falsify <path> for each production file the change touches: the worker's task falsify then
runs the declared check in a copy of the tree on the current files and on those files as they were
at open, and the hand-back waits until it passed on the first and failed on the second.

THE WORKER takes it up in this order. blabla task show <name> prints these same routes for the
task it was given, and that view is the authority over this text.