
A challenge is a question, never a verdict. It states ONE contradiction grounded in the task
record, the tree measured against its snapshot, the completion state and a falsification verdict,
or names the evidence it lacked. Silence is not approval: no challenge means none was reachable
from that evidence. It reads no meaning from source code. A selected accepted task records its
challenge receipt: exit 0 means its assignment check is clear, even if project-wide verification
still belongs to the orchestrator. Exit 1 means assignment attention is needed. Without a task,
the exit code describes the project challenge. Every challenge class: docs/agent-workflow.md.

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

  blabla task ask <name> "<question>" --model <id>   a call you doubt; --options a,b,c, --floor <0-100>;
                                                     task ready waits for the pick
  blabla task resolve <name> <id> --evidence "..." --model <id>
  blabla task check <name> --check <prog> <arg>...   declare or correct the check
  blabla task scope <name> --add|--remove <path>     widen the scope, or release a path not changed since open
  blabla task statement <name> "..." --model <id>    replace the statement; the hand-back is challenged again
  blabla task confirm <name> --model <id>            confirm records made under an orchestrator model during a carry
  blabla task close <name> --model <id>              refused while a grounded challenge stands
  blabla task budget <name>                          time per phase, read from the record
  blabla finish

PROJECT VERIFICATION AND TASK ACCEPTANCE ARE DIFFERENT QUESTIONS. blabla finish decides whether
the project is complete: structure evaluated live, the canonical behavior campaign run, OVERALL
GREEN or not. A task's transitions decide only whether one handoff is in order: ready needs
acceptance, current successful evidence for the declared check, a goal outcome when the task
serves a goal, a claim per affected intent when it asks for them, and a clear assignment
challenge, which ready records itself when it carries the lens assessments. A change inside the
task's own paths invalidates its receipt; a path attributed to concurrent work never does. Close
needs a current hand-back with no challenge standing. Neither a clean task record nor OVERALL GREEN alone establishes
everything: the record shows what was recorded rather than what was done, and GREEN is bounded
by the campaign that produced it.