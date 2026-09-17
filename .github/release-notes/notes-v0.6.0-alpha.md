BlaBla 0.6 extends executable project memory beyond contracts and connects it to the development workflow.

Mission, System, Process and Knowledge are now queryable through the same status/explain path used to enter a BlaBla project. Process can describe roles, policies and ordered flows without turning BlaBla into an agent orchestrator.

Bounded tasks preserve write scope, deliverables and review findings across handoffs. The new blabla challenge command acts as a deterministic skeptic: it checks the current account of the work against evidence BlaBla already has, including unresolved findings, unchanged deliverables, scope breaches, vacuous structure rules and stale verification. It does not replace code review and does not decide completion.

Structure also gains a Rust provider, key/payload association facts with value ... maps K to V, and blabla check --falsify for finding rules whose result does not depend on observable structure.

BlaBla now uses its own Mission, System, Process, Knowledge and Structure memory. This release was developed through that same project memory and development flow, and the new challenge path exposed defects in its own implementation before release. That is deliberate dogfooding under human direction, not autonomous self-modification.

0.6.0-alpha remains an experimental alpha. Behavior verification is bounded and heuristic, project memory is advisory, and the public language/CLI may still change.
