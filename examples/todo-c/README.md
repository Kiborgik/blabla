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

`prepare` runs once, before the command is even resolved, so a cold compile never competes with the
per-response timeout. The binary goes under `.blabla/` because that directory is outside the tree
BlaBla fingerprints; a build artifact written anywhere else invalidates the run it was preparing.

## What is application and what is not

`main.c` holds a `Store`, a `Todo`, three actions and a length-prefixed file format. It contains no
line reading, no JSON parsing, no argument checking and no response writing: that is
[`../../adapters/c`](../../adapters/README.md), compiled alongside it. `todo-c.bla` states the split
as a requirement — it forbids the transport from defining `Todo` or `Store`, and requires the
application to define the store, the actions and the two halves of persistence.

## What this example is honest about

The C provider runs no preprocessor. Both arms of an `#ifdef` contribute symbols, a macro-generated
declaration is invisible, and `-D` and `-I` flags are unknown — so the `#include "blabla_adapter.h"`
here resolves through an include path BlaBla cannot see and is reported as an unknown rather than as
an absent dependency. That is why this contract asserts no external dependency on `main.c`: while a
module carries an unresolvable include, no dependency fact about it is decidable, and
`blabla check --falsify` says so rather than letting such a rule stand.
