# Agent workflow

BlaBla is executable project memory. Agents should not read every contract up front; start from the project state and drill down only when needed.

```text
blabla status                 current layers, rules needing attention, completion state
blabla explain <rule>         one rule and its evidence/counterexample
# edit ordinary application code
blabla finish                 canonical behavior run + live structure check
```

Only `OVERALL GREEN` means the declared project state is complete.

## Reading status

```text
BEHAVIOR   54/54 rules  GREEN
STRUCTURE  45/47 rules  RED
OVERALL    BLOCKED

Structure violations:
  RED    architecture::no-domain-restart    glyph_vault/domain.py:86 defines VaultDomain.restart
  RED    architecture::no-protocol-restart  glyph_vault/protocol.py:4 ARGUMENTS contains "restart"

Next:
  blabla explain architecture::no-domain-restart
```

- **RED:** fix the counterexample (behavior) or observed fact (structure).
- **YELLOW:** no violation was found, but required behavior was not exercised. Not complete.
- **STALE / UNVERIFIED / INTERRUPTED:** run `blabla finish`.
- **VERIFYING:** another `finish` is still running.
- **OVERALL GREEN:** completion gate passed.

## Long verification runs

`blabla finish` prints `COMPLETION GATE: VERIFYING` immediately, then periodic progress and the final verdict. In `--json` mode, progress goes to stderr and stdout remains one JSON document.

Give the command enough time to finish. A run that is killed or detached does not leave behind a current GREEN.

## Runtime primitives

Some actions are controlled by BlaBla rather than implemented by the application. For example, `action restart()` maps to `runtime::restart`.

If a rule depends on a runtime primitive, `blabla explain <rule>` shows the dependency. Use `blabla explain runtime::restart` for the exact semantics.

Do not add an application-level implementation of a BlaBla runtime primitive.

## Contracts vs implementation

Implementation work should change ordinary source code. Do not edit `.bla` contracts or the canonical verification profile just to obtain GREEN.

Changing intended product behavior is a separate contract-authoring operation:

```text
blabla guide change
```

For a new project:

```text
blabla init --agents
blabla guide bootstrap
```

`init --agents` writes a small managed `AGENTS.md` block and a portable skill under `.agents/skills/blabla/`.
