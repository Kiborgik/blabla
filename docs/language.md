# behavior.bla

A behavior contract names what the running app shows (state), what can be done to it (actions) and the rules that must hold. BlaBla drives the app through a small JSON Lines adapter, generates action sequences, and reports GREEN, YELLOW or RED with the shortest failing example.

```text
type Todo {
    id: int,
    text: string,
    done: bool
}

state todos: [Todo]

action add(text: string)
action complete(id: int)
action restart()

when add {
    expect "empty-add-noop": input.text != "" or after.todos == before.todos
    expect "add-count": input.text == "" or count(after.todos) == count(before.todos) + 1
}

when restart {
    expect "persistence": after.todos == before.todos
}

always "unique-ids" { unique(todos, t => t.id) }
never "empty-text" { any(todos, t => t.text == "") }
```

## Declarations

| Declaration | Meaning |
| --- | --- |
| `type Name { field: T, ... }` | a structured observable value |
| `state name: T` | an observation the application returns on `observe`; storage is the application's business |
| `action name(param: T, ...)` | a callable input; parameters are scalar or optional scalar |
| `when action { expect "label": predicate ... }` | postconditions with `before`, `input` and `after` in scope |
| `always "label" { predicate }` | an invariant checked initially and after every action |
| `never "label" { predicate }` | a forbidden state; normalized to a negated invariant with its own label |

`action restart()` is reserved for `runtime::restart`: BlaBla restarts the process and keeps its data directory. `blabla explain runtime::restart` says more.

## Types and expressions

Types: `bool`, JSON-safe `int`, finite `float`, `string`, records, lists `[T]` and `optional<T>` (JSON null; guard before use). Expressions: comparisons, checked `+` and `-`, `and`, `or`, `not`, `count`, `any(list, x => ...)`, `all(list, x => ...)`, `unique(list, x => key)`. No user functions, loops or temporal operators. List equality is ordered. An observation must carry every declared field; extra fields are ignored.

## Verification results

- **GREEN**: every obligation was exercised and passed
- **YELLOW**: nothing broke, but an obligation was never exercised; the report names the witness to reach
- **RED**: a confirmed violation, shrunk to the shortest failing steps

Obligations come from the contract (guards, effects, frames, quantifiers, persistence), not from source lines. A campaign is finite: GREEN is not a proof.

## Adapter protocol

One UTF-8 JSON object per line on stdin and stdout, correlated by an opaque `id`:

| Request | Response |
| --- | --- |
| `{"id":"r1","op":"reset"}` | `{"id":"r1","result":{"ok":true}}` |
| `{"id":"r2","op":"call","name":"add","args":["milk"]}` | `{"id":"r2","result":{"ok":true}}` |
| `{"id":"r3","op":"observe"}` | `{"id":"r3","result":{"todos":[...]}}` |

Return `{"ok":false,"error":"message"}` inside `result` for an adapter failure. Crashes, timeouts and protocol errors are app failures, not rule violations. Flush every response, log to stderr, keep data in the current directory (each case gets a fresh one), persist each completed operation and exit when stdin closes. Give an interpreter an absolute script path. `blabla run --help` prints the protocol. Reuse the [adapters](../adapters/README.md); the app supplies storage, logic and an action table. BlaBla trusts the adapter to report the real app.
