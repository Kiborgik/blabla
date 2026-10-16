# todo-ts

The first example with **both** layers in a language other than Python. `project.bla` composes
[`../todo.bla`](../todo.bla) — the same behavior contract [`../todo/`](../todo/README.md) and
[`../todo-go/`](../todo-go/README.md) use — with [`todo-typescript.bla`](todo-typescript.bla),
and points them at an ordinary TypeScript program.

```text
cd examples/todo-ts
blabla status
blabla finish
```

**No build step.** The profile runs `node app.ts`: Node strips the types. Strip-only mode refuses
syntax that needs generated code, such as parameter properties
(`constructor(private readonly store: Store)`), `enum` and `namespace`; BlaBla reports that as
`APP_CRASH`, not a rule violation. A project using them must build first with `prepare`.

**Structure** repeats the six rules of [`../todo/todo-python.bla`](../todo/todo-python.bla) with the
same labels, so the two read side by side. It adds what a separate storage module allows: the app
reaches persistence only through `storage.ts`, storage never imports the app, and the action list
holds `add` and `complete` but not `drop`. `check --falsify` reports all 13 rules falsifiable.
Provider limits: [structure](../../docs/structure.md#providers).
