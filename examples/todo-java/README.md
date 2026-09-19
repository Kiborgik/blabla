# todo-java

Three Java packages, a binding onto the reusable transport, and both layers under contract.

```text
cd examples/todo-java
blabla finish
```

`prepare` compiles `Main.java`, the three packages and `adapters/java/blabla/Adapter.java` into
`.blabla/classes`, which is outside the tree BlaBla fingerprints, and `command` launches
`java -cp .blabla/classes Main`. `startup_ms` is 5000 while `timeout_ms` stays at 1000, because a
JVM start is not a response. A JDK on `PATH` is all it needs; structural analysis needs none, since
the provider parses source text.

## What the behavior campaign found the first time it ran

Two defects that the structure contract could not see, both in this example's own code:

- **A todo whose text contained a newline did not survive a restart.** `TodoStore` writes one
  tab-separated record per line, so a newline in the text split the record in two on read. The
  minimized counterexample was two actions — `add("\"\\\n")` then `restart()` — and the store now
  escapes its own delimiters.
- **A legal call was refused.** The transport read a whole number into a Java `int`, and BlaBla's
  `int` is 64-bit: the generator reached `9007199254740991`, which saturated to `Integer.MAX_VALUE`
  and came back as `{"ok": false}`, which BlaBla correctly reported as an application failure rather
  than a passing case. `Args.integer` returns `long`, and `Todo.id` is a `long` with it.

Neither was reachable while this example carried a structure contract alone.

## What the contract exercises

`todo-java.bla` covers the provider's whole supported surface against real, idiomatic source:

- **types and members at one level**: `Todo.id`, `Todo.completed`, `TodoStore.load`, `TodoApp.add`.
- **static final collections**: `Todo.FIELDS` contains `"id"`, `"text"` and `"done"`;
  `TodoApp.ACTIONS` contains `"add"`, `"complete"` and `"remove"`.
- **cross-package imports resolved to declared modules**: `app` depends on `store` and on `model`,
  and `store` depends on `model`, each through a single-type import matched against that module's
  `package` declaration and file stem.
- **an external dependency**: `store` depends on `java.nio.file.Files`.
- **the layering, as `forbid` rules**: the model reaches neither the store nor the application and
  touches no filesystem, and the store does not reach the application.
- **the split between application and transport, as a requirement**: `Main` binds the application
  and launches the transport, the transport declares `Adapter.serve`, `Adapter.action`, `Adapter.Args`
  and `Adapter.LINE_LIMIT`, and `forbid` rules keep a protocol loop out of `TodoApp` and any todo or
  store out of the transport. `dependency entry -> transport` is deliberately absent: the transport
  lies outside this project root, so that fact cannot be observed, and `blabla check --falsify`
  reports such a rule as VACUOUS rather than letting it stand.

## What the provider does not see

The classpath, reflection, annotation processing, generics and overload resolution. Two cases are
reported as unknown rather than absent, because Java can hide a reference from static reading: a
wildcard import `import a.b.*;`, which could supply any type in that package, and a reference between
two types in the same package, which needs no import at all. Each unknown names the declared module
it could be hiding, so it makes the rules over that one target ERROR and leaves every other
dependency on the file decidable. This example keeps its three types in three different packages, so
neither case arises here; both are covered by the provider's own tests.
