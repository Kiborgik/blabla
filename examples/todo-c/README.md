# todo-c

The same behavior contract as [`../todo/`](../todo/README.md), satisfied by an ordinary C program.

```text
cd examples/todo-c
blabla status
blabla finish
```

## Preparation is a profile field, not a build system

C has to be compiled before it can answer anything, so the profile builds it:

```text
prepare ["gcc", "-std=c17", "-O1", "-I", "../../adapters/c", "-o", ".blabla/todo-c", "main.c", "../../adapters/c/blabla_adapter.c"]
command [".blabla/todo-c"]
timeout_ms 1000
```

`prepare` compiles once, outside the response timeout, into `.blabla/` so the run does not go STALE.

`main.c` holds a `Store`, a `Todo`, three actions and a length-prefixed file format, and no protocol
code: that is [`../../adapters/c`](../../adapters/README.md). `todo-c.bla` makes the split a rule.

The C provider runs no preprocessor, so `#include "blabla_adapter.h"` through an `-I` path is an
unknown, not an absent dependency. That is why the contract asserts no dependency of `main.c`:
`check --falsify` would show such a rule cannot be decided.
