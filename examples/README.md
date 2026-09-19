# Examples

| Example | Level | What it shows |
| --- | --- | --- |
| [`hello/`](hello/README.md) | minimal | the smallest possible contract: one state, one action, one postcondition |
| [`todo/`](todo/README.md) | introductory | a two-layer project: `project.bla`, a behavior contract and a structure contract, verified by `blabla finish` |
| [`todo-go/`](todo-go/README.md) | introductory | the same behavior contract as `todo`, satisfied by a Go application instead of a Python one |
| [`todo-ts/`](todo-ts/README.md) | introductory | the same behavior contract again, in TypeScript, with a structure contract over the same sources |
| [`todo-c/`](todo-c/README.md) | introductory | the same contract in C, built by the profile's `prepare` command before the campaign starts |
| [`todo-cpp/`](todo-cpp/README.md) | introductory | the same contract in C++, sharing the C transport rather than a second protocol loop |
| [`todo-java/`](todo-java/README.md) | introductory | the same contract in Java, compiled by `prepare` and given its own `startup_ms` because a JVM start is not a response |
| [`leases/`](leases/README.md) | behavioral | a richer behavior contract: guards, frame conditions, quantified queries, expiry and restart persistence |
| [`glyph-vault/`](glyph-vault/README.md) | research / advanced | the benchmark project: five modules, seven behavior contracts and a 47-rule structure contract |

Start with `todo`. It is the Quick Start of the repository README and the shortest path to an `OVERALL GREEN`.

This table is the only index. Each example explains itself in its own `README.md`.

`todo.bla` is one behavior contract satisfied by six applications — Python, TypeScript, Go, C, C++
and Java — which is the point: a behavior contract describes what must be observable, never how it is
written. A structure contract names files and language symbols, so there is one per language.

None of the six applications contains a JSON Lines loop. The protocol machinery lives once per
language in [`adapters/`](../adapters/README.md) and each application supplies only storage, domain
logic and a table of actions; the structure contracts state that split as a requirement rather than a
convention, with `forbid` rules that the application defines no `serve` and no `emit` and that the
transport defines no `Todo` and no store.

The shared contracts live in this folder and the example folders hold the applications, their
`project.bla` and their README; `todo-c/`, `todo-cpp/` and `todo-java/` keep their structure
contracts beside their sources.
