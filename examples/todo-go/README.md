# todo-go

The same contract, a different language. `project.bla` composes [`../todo.bla`](../todo.bla) — the
identical behavior contract [`../todo/`](../todo/README.md) uses — with the identical verification
profile, and points it at an ordinary Go program instead of a Python one.

```text
cd examples/todo-go
blabla status
blabla finish
```

Go is compiled, so the profile builds it first:

```text
prepare ["go", "build", "-o", ".blabla/todo-go", "."]
command [".blabla/todo-go"]
timeout_ms 1000
```

`prepare` runs once, before any process is spawned and outside the per-response timeout, which is
the whole point: `go run main.go` would have to compile, link, start and answer inside `timeout_ms`,
and on a cold build cache that takes seconds rather than milliseconds. The binary goes under
`.blabla/` because that directory is outside the tree BlaBla fingerprints; written anywhere else it
would change the implementation fingerprint a moment after `finish` recorded the run against it, and
the next `status` would report STALE.

`todo-go.bla` is the structure contract over `main.go`. It names the Go symbols the application owes
— `Todo.ID`, `Storage.Save`, `Application.Add` and the rest, including methods reached through their
receiver type — requires the imports that make it work, and forbids the ones that would make it
something else. It also forbids `serve` and `Request`: the JSON Lines loop is not this application's
business. That loop lives in [`../../adapters/go`](../../adapters/README.md) and arrives through an
ordinary `require` and a local `replace` in `go.mod`, so the application holds storage, domain logic
and a table of three actions and nothing else.
