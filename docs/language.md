# behavior.bla

A behavior contract declares observable state, callable actions and the rules that must hold after actions. The application stays ordinary code behind a small JSON Lines adapter; BlaBla generates action sequences, observes state and reports GREEN, YELLOW or RED with a minimized counterexample.

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

`action restart()` is reserved: it is the BlaBla-controlled runtime primitive `runtime::restart` (trusted process restart with the persistent directory preserved). `blabla explain runtime::restart` prints its semantics.

## Types and expressions

Types: `bool`, exact JSON-safe `int`, finite `float`, `string`, records, lists `[T]` and `optional<T>` (explicit JSON null; access needs a null guard). Expressions: comparisons, checked `+` and `-`, `and`, `or`, `not`, `count`, and the bounded queries `any(list, x => ...)`, `all(list, x => ...)`, `unique(list, x => key)`. Binders exist only inside queries; there are no user functions, loops or temporal operators. List equality is ordered; observations must carry every declared field with the declared type and extra fields are projected away.

## Verification results

- GREEN: every derived obligation was meaningfully exercised and passed in the recorded campaign.
- YELLOW: no violation, but an obligation was never exercised; the report names the required witness.
- RED: a confirmed violation with a shrunk counterexample.

Obligations are derived from the typed contract (guards, effects, frames, quantifier members, persistence partitions), not from source lines. A campaign is finite and heuristic: GREEN is exercised and satisfied behavior under the configured verifier, not a proof.

## Adapter protocol

One UTF-8 JSON object per line on stdin and stdout, correlated by an opaque `id`:

| Request | Response |
| --- | --- |
| `{"id":"r1","op":"reset"}` | `{"id":"r1","result":{"ok":true}}` |
| `{"id":"r2","op":"call","name":"add","args":["milk"]}` | `{"id":"r2","result":{"ok":true}}` |
| `{"id":"r3","op":"observe"}` | `{"id":"r3","result":{"todos":[...]}}` |

Flush every response, log to stderr, keep data in the current directory (each case runs in a fresh temporary directory), persist each completed operation, and exit cleanly when stdin closes. `blabla run --help` prints the same protocol.
