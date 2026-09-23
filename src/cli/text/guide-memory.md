AUTHORING PROJECT MEMORY

Contracts say what must remain true. Project memory says the rest of what an agent would
otherwise be told by hand. Four kinds, each answering one question, none repeating another.

  Mission    mission, priority               why the project exists, what decides a tradeoff
  System     system, responsibility, seam    what part is being touched and who owns it
  Process    role, policy, flow, step        who is expected to do what, and in what order
  Knowledge  knowledge, ruling               reusable expertise, portable between projects

Declaration shape:

  mission "blabla" { statement "..." non_goals ["..."] }
  priority "truthful-over-convenient" { statement "..." }

  system "cli" { purpose "..." paths ["src/cli/mod.rs"] knowledge ["engineering"] }
  responsibility "render" { owner "cli" statement "..." }
  seam "provider" { between ["a", "b"] value "ModuleFacts" statement "..." moves_with ["..."] }

  role "worker" { purpose "..." owns ["..."] verification "focused" model ["..."] consult ["testing"] }
  policy "explicit-write-scope" { statement "..." applies_to ["worker"] }
  flow "development" { purpose "..." }
  step "assign" { flow "development" role ["orchestrator"] statement "..." command "blabla task open" }

  knowledge "engineering" { purpose "..." }
  ruling "smallest-correct-change" { pack "engineering" statement "..." }

Registration in project.bla, one mission, one system, one process, any number of knowledge:

  mission "mission.bla"
  system "system.bla"
  process "process.bla"
  knowledge "knowledge/engineering.bla"

A flow declares the order its roles are meant to work in; its steps are separate declarations
naming the flow they belong to, and their declaration order is the flow's order. A step names
every role that may carry it and, where one exists, the command that runs it. A flow with no
step is invalid, because a loop with no steps describes nothing. Steps are surveyed one line
each from the flow and cost one more explain to read in full, the same asymmetry a pack and its
rulings already have. A step's command names the command that carries that step.

Routing points into Knowledge and never out of it: a system names the packs its work needs,
a role or a policy names the packs it consults. No content crosses. A ruling has exactly two
fields and can name no system, role, contract or path, which is what lets another project
register the same pack file unchanged.

Authoring loop:

  blabla check mission.bla     VALID or INVALID, while the file is still being authored
  (register the path in project.bla)
  blabla status                every declared kind, its state, and the identities it holds
  blabla explain <identity>    mission::, system::, role::, knowledge::, then one level deeper

A name becomes part of an identity, so it starts with a letter or digit and continues with
letters, digits, _ or -. A pack that declares no ruling is invalid: routing would point at nothing.

What this is not:
  Project memory is never checked against the repository, and no state of it reaches OVERALL.
  A project that declares none of it is not thereby incomplete; author the kind you need.
  Process binds the role that carries the work; task transitions check acceptance, evidence,
  the challenge receipt, scope and attribution.
  Mission is owner intent rather than a gate; a planner who finds the evidence points elsewhere
  is expected to say so instead of complying.
  A ruling is expertise, never permission to widen the task you were given.

Every field and every diagnostic: docs/project.md.