# Examples

| Example | Level | What it shows |
| --- | --- | --- |
| [`hello.bla`](hello.bla) + [`hello/app.py`](hello/app.py) | minimal | the smallest possible contract: one state, one action, one postcondition |
| [`todo/`](todo) | introductory | a two-layer project: `project.bla`, a behavior contract and a structure contract, verified by `blabla finish` |
| [`leases.bla`](leases.bla) + [`leases/app.py`](leases/app.py) | behavioral | a richer behavior contract: guards, frame conditions, quantified queries, expiry and restart persistence |
| [`glyph-vault/`](glyph-vault) | research / advanced | the benchmark project: five modules, seven behavior contracts and a 47-rule structure contract |

Start with `todo`. It is the Quick Start of the README and the shortest path to an `OVERALL GREEN`.

## hello

The one-screen contract. There is no `project.bla`; verify the single contract directly against the application.

```text
blabla check examples/hello.bla
blabla run examples/hello.bla --cases 1 --steps 1 -- python <absolute path to examples/hello/app.py>
```

The adapter runs in a fresh temporary working directory for every case, so an interpreter script argument must be an absolute path.

## todo

A project with both layers. `examples/todo/project.bla` composes the behavior contract `examples/todo.bla` and the structure contract `examples/todo/structure.bla`, and carries the canonical verification profile.

```text
cd examples/todo
blabla status
blabla finish
```

`examples/todo/test_app.py` is an ordinary unit-test file for the same application: BlaBla complements tests, it does not replace them.

## leases

A behavior contract with real complexity — time-to-live claims, renewal, release, expiry on `tick` and persistence across `restart`. Useful for reading how guards, `all`/`any` queries and frame conditions are written. Verify it like `hello`, against `examples/leases/app.py`.

## glyph-vault

The mature research project, with its own [README](glyph-vault/README.md). It is the reference tree of the Haiku handoff benchmark and takes about a minute to verify. Do not start here.
