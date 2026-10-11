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

`prepare` builds once, outside the per-response timeout; `go run` would have to compile inside
`timeout_ms`. The binary goes under `.blabla/` so the run does not go STALE.

`todo-go.bla` names the symbols the app owes (`Todo.ID`, `Storage.Save`, `Application.Add`, methods
through their receiver), requires the imports it needs and forbids `serve` and `Request`: the JSON
Lines loop lives in [`../../adapters/go`](../../adapters/README.md), pulled in by `require` and a
local `replace` in `go.mod`.
