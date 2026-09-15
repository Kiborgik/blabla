# Glyph Vault (research example)

This is the mature project of the Haiku handoff benchmark, not a beginner tutorial: five Python modules, seven behavior contracts (54 rules, 355 obligations under the canonical profile) and one structure contract with 47 rules. Start with `examples/todo` if you are learning BlaBla.

```text
project.bla                         composition and the canonical profile (seed 2, 1 case, 4096 actions)
contracts/behavior/*.bla            core, persistence, sealing, quarantine, resonance, echo, recovery
contracts/structure/architecture.bla module boundaries, durable-field membership, required operations, no application-level restart
glyph_vault/*.py                    model, domain, store, protocol, main
```

From this directory:

```text
blabla status      BEHAVIOR UNVERIFIED, STRUCTURE 47/47 GREEN, OVERALL BLOCKED
blabla finish      about one minute: 355/355 obligations, BEHAVIOR 54/54 rules GREEN, STRUCTURE 47/47 GREEN, OVERALL GREEN
```

Two sibling fixtures under `tests/fixtures/structure/` keep the behavior exactly as correct and break only the architecture: `glyph-durable-id` stores the vault id inside `DURABLE_FIELDS` (the Condition B deviation of the benchmark) and `glyph-dead-restart` carries an application-level `restart` action (what the Condition C subject left behind). Both are `BEHAVIOR GREEN / STRUCTURE RED / OVERALL BLOCKED`, which is the case the structure layer exists for. See `docs/research.md` and `research/haiku-handoff/` for the benchmark.
