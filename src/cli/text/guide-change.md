CHANGING BEHAVIOR VERSUS IMPLEMENTING BEHAVIOR

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