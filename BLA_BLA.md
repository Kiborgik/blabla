# BlaBla: project rules

`project.bla` is the machine entry and `blabla status` the human one. The owner's intent decides what the project is for; evidence against it becomes a proposal, never a silent change. Tool output outranks what an agent says it did.

1. **What, not how.** Contracts describe what can be observed; code stays ordinary code
2. **Only Behavior and Structure decide done.** Memory, tasks and expert advice never do
3. **No GREEN from missing evidence.** Unexercised is YELLOW; unreadable is ERROR
4. **No stale GREEN.** Behavior results are bound to source, contracts, profile and verifier; structure is checked live
5. **Never weaken a contract to pass.** Changing intent is a separate, authorized act
6. **Same inputs, same answer.** Fixed source, contracts, settings and seed give the same result
7. **One implementation per meaning.** Human and JSON reports render the same values

| Trusted part | Limit |
| --- | --- |
| App adapter | must report the real app; BlaBla is not a sandbox |
| Behavior search | finite; inputs it never tried are not certified |
| Structure | reads source without running it; [per-language limits](docs/structure.md#providers) |
| Memory | checked against itself, never against the code |
| Task records, `--model` | claims, not authentication |
| Expert advice | never correctness authority |
| Process cleanup | Windows Job Objects, Unix process groups; macOS untested |
| Fingerprint | code loaded implicitly from outside the project tree, not named on the command line, is not tracked |

**Not goals.** A general-purpose language, BDD framework, theorem prover, agent orchestrator or prose-to-contract generator. No loops, user functions, temporal checks or compatibility copies of old syntax. Whether each memory kind helps, and at which model size, is still open.
