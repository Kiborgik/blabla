THE DEVELOPMENT LOOP: BOUNDED TASKS AND THE CHALLENGE

blabla explain flow::<name> prints the order this project's roles are meant to work in, one line
per step, and blabla explain step::<name> opens one step in full. Task transitions enforce the
recorded hand-back prerequisites.

A BOUNDED TASK is the handoff record between an orchestrator and a worker. It is machine state,
not project memory: BlaBla writes it under .blabla/tasks/, no manifest registers it, nothing
validates it for truth, and no state of it reaches OVERALL.

THE ORCHESTRATOR opens it, which snapshots the tree the task starts from. That snapshot is the
only reason anything can later tell a deliverable that was produced from one never touched, or a
file changed inside the write scope from one changed outside it.

  blabla task open <name> --role worker --statement "..." --scope <path> --deliverable <path> --check "..."

THE WORKER takes it up in this order. blabla task show <name> prints these same routes for the
task it was given, and that view is the authority over this text.