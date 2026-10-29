CHANGING BEHAVIOR VERSUS IMPLEMENTING BEHAVIOR

Implementation task (the normal case):
  contracts stay unchanged -> implement -> blabla finish
  RED: fix the counterexample. YELLOW: supply the missing witness. GREEN: done.

Product behavior change (intended behavior differs from the contract):
  1. contract-author phase: change the .bla rule to the new intent, citing the requirement
  2. blabla check
  3. implementation phase: make the application satisfy the changed contract
  4. blabla finish  until GREEN

A .bla edit or a smaller verification profile made only to reach GREEN is a weakening, not a change of intent.
When one agent plays both roles, do the phases in this order and say which phase you are in.
With several tasks in flight, give each task not started yet its own draft contract (draft behavior
or draft structure in project.bla) and promote it to use when that task opens: a draft serves one
task, so promoting it never turns another task's work RED, and every task close needs a current GREEN finish.