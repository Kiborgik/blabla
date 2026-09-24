
A challenge is a question, never a verdict. It states ONE contradiction grounded in the task
record, the tree measured against its snapshot, the completion state and a falsification verdict,
or names the evidence it lacked. Silence is not approval: no challenge means none was reachable
from that evidence. It reads no meaning from source code. A selected accepted task records its
challenge receipt: exit 0 means its assignment check is clear, even if project-wide verification
still belongs to the orchestrator. Exit 1 means assignment attention is needed. Without a task,
the exit code describes the project challenge. What each class rests on: docs/agent-workflow.md.

THE REVIEWER reads the task and the whole diff in a context that never saw the work being done,
holds the hand-back against the lenses the role consults, and records what it finds. A finding
recorded here survives the context that found it, which is what lets a later challenge notice it
being dropped instead of settled.

  blabla task lens <name> <lens> "..."   one assessment against one lens the role consults,
                                         named by its knowledge pack rather than by a ruling id
  blabla task finding <name> "..."       a defect, with the file and line that show it

THE ORCHESTRATOR settles each finding against the repository, accepts the result, and decides
completion. The evidence written into a resolution is the agent's claim about the repository,
never BlaBla's verdict on it, and every --model is an attestation, not proof.

  blabla task ask <name> "<question>" --model <id>   ask the carrying role a call you doubt; --options
                                                     a,b,c for a choice, --floor <0-100> to raise the
                                                     confidence its pick needs above the role's floor;
                                                     task ready is refused until it has a pick
  blabla task resolve <name> <id> --evidence "..." --model <id>
  blabla task check <name> "..."                     declare the check a record opened without, or
                                                     correct the one it declares
  blabla task confirm <name> --model <id>            after hand-back, confirm the records made
                                                     under an orchestrator model while a worker
                                                     carried the task; refused while it is carried
  blabla task close <name> --model <id>              refused while a grounded challenge stands,
                                                     including an unconfirmed record from a carry
  blabla finish

PROJECT VERIFICATION AND TASK ACCEPTANCE ARE DIFFERENT QUESTIONS. blabla finish decides whether
the project is complete: structure evaluated live, the canonical behavior campaign run, OVERALL
GREEN or not. A task's transitions decide only whether one handoff is in order, and they check
selected recorded conditions: ready needs acceptance, current successful evidence for the declared
check and an explicit current assignment challenge. A change inside the task's own paths, its scope,
deliverables and declared inputs, invalidates its receipt; a path attributed to concurrent work
never does. Close needs a
current hand-back with no challenge standing. Neither a clean task record nor OVERALL GREEN alone establishes
everything: the record shows what was recorded rather than what was done, and GREEN is bounded
by the campaign that produced it.