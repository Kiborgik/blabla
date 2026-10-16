# todo-java

Three Java packages, a binding onto the reusable transport, and both layers under contract.

```text
cd examples/todo-java
blabla finish
```

`prepare` compiles the app and `adapters/java/blabla/Adapter.java` into `.blabla/classes`, and
`command` runs `java -cp .blabla/classes Main`. `startup_ms` is 5000 and `timeout_ms` 1000, because
a JVM start is not a response. It needs a JDK on `PATH`.

**What the first behavior run found**, which the structure contract alone could not:

- A todo with a newline in its text did not survive a restart: the store wrote one record per line.
  The shortest failing example was `add("\"\\\n")`, `restart()`. The store now escapes its delimiters
- A legal call was refused: the transport read integers into a Java `int`, but BlaBla generates
  64-bit values up to `9007199254740991`. `Args.integer` and `Todo.id` are now `long`

**What `todo-java.bla` covers**: members one level down (`Todo.id`, `TodoStore.load`), static final
collections (`Todo.FIELDS`, `TodoApp.ACTIONS`), cross-package imports resolved to declared modules,
an external dependency (`java.nio.file.Files`), layering as `forbid` rules, and the app/transport
split. `dependency entry -> transport` is left out on purpose: the transport is outside this project
root, and `check --falsify` would report the rule VACUOUS.

The provider does not see the classpath, reflection, annotation processing, generics or overloads.
Wildcard imports and same-package references are unknown, so rules they could hide are ERROR.
