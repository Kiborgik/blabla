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

## No build step, and why that is not luck

The verification profile is `command ["node", "app.ts"]`. Node runs TypeScript directly by stripping
the types, so there is no compiler in the loop and no artifact to keep fresh.

That is strip-only mode, and it has real edges. It erases annotations but refuses any syntax that
would need code generated for it. Writing the constructor as
`constructor(private readonly store: Store)` made this example fail with
`SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in
strip-only mode`, reported by BlaBla as `APP_CRASH` and separated from any contract violation. The
same applies to `enum` and `namespace`. A project that uses them has to build before verification,
and BlaBla offers no build hook: the profile's `command` is launched as written.

## What each layer holds

**Behavior** is the shared contract: adding, completing, removing, unique ids, no empty text, and
state that survives `restart`. The adapter is the small JSON Lines protocol — one object per line on
stdin and stdout — so nothing about it is TypeScript-specific.

**Structure** is what runtime behavior cannot see. The first six rules are the same six
[`../todo/todo-python.bla`](../todo/todo-python.bla) asserts, with the same labels — `TodoStorage`,
`TodoApplication` and `TodoAdapter` still exist, `save` is still on the storage, and neither network
nor subprocess is reachable — so the two contracts can be read side by side. The rest are what this
example can assert and the Python one cannot, because it keeps storage in its own module: that the
application reaches persistence only through `storage.ts`, that storage neither imports the
application nor drives the process, and that the declared action list contains `add` and `complete`
but not `drop`. `blabla check --falsify todo-typescript.bla` reports all 13 rules falsifiable and
none vacuous, so each one constrains something.

## The provider's limits

Structure facts come from a tree-sitter parse of the source. There is no type resolution, no
`tsconfig` path-alias resolution, no re-export chasing beyond one direct `export ... from`, and
namespaces and decorators are not inspected. Those limits are listed in full in
[`../../docs/structure.md`](../../docs/structure.md).
