## BlaBla

BlaBla is executable project memory; `blabla` is a command-line tool on PATH (`blabla --help`).
Start with:
  blabla status
Inspect what status printed, by its canonical identity; never invent one:
  contract::<group>  <group>::<label>  mission::<name>  priority::<name>
  system::<name>  responsibility::<name>  seam::<name>  role::<name>  policy::<name>
  flow::<name>  step::<name>  knowledge::<pack>  ruling::<pack>::<name>  runtime::<name>
  blabla explain <identity>
  blabla guide agent
Process roles, policies and flows bind the role that carries the work. Rulings never widen your assignment.
Delegating one bounded change, and challenging the account of it: blabla guide loop

For a bounded task, status lists its name; the assignment is the authority:
  blabla task show <name>
Accept before changing anything; work only inside its write scope, record the declared check's evidence,
challenge the account, then hand back. Run that command from the project root; `--tool` labels evidence and `--exit` records its real code. Example: `cargo test --lib` exits 0 -> `blabla task evidence <name> --exit 0 --tool cargo-test-lib`.
Hand-back requires current successful evidence and an explicit `blabla challenge <name>` receipt; changes require rechecking. READY means await review; assigned workers do not run `blabla finish`.
With multiple tasks choose a name explicitly; status never assigns one to the caller. Work without accepting first is challenged as outside BlaBla.
Deciding that the whole project is complete belongs to the orchestrator, never to a worker on a task:
  blabla finish
Only OVERALL GREEN means completion.
YELLOW means NOT COMPLETE. Do not weaken contracts to obtain GREEN.
