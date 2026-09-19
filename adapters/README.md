# Adapters

One JSON Lines protocol, one transport per language, no registry.

An adapter is the thin layer between BlaBla and an ordinary application: it reads one request per
line, echoes the opaque `id`, dispatches `reset`, `call` and `observe`, checks that a call names a
known action with the right number of arguments of the right types, flushes every response, logs to
stderr and exits cleanly on EOF. None of that is application logic, and none of it should be written
twice. The application supplies a reset handler, an observe handler and a table of actions; the
transport supplies everything else.

| Language | File | How an application reaches it |
| --- | --- | --- |
| Python | `python/blabla_adapter.py` | put the directory on `sys.path`, or copy the file beside your application |
| TypeScript / JavaScript | `typescript/blabla_adapter.ts` | import it by relative path, or copy it into your source tree |
| Go | `go/blabla/adapter.go` | `require blabla.dev/adapter` with a `replace` to this directory, or copy the package |
| Java | `java/blabla/Adapter.java` | compile it with your application, or copy the file into your source tree |
| C | `c/blabla_adapter.h`, `c/blabla_adapter.c` | compile the `.c` with your application and pass `-I` to this directory |
| C++ | `c/blabla_adapter.h`, `c/blabla_adapter.c` | the same C transport; compile it with `g++` alongside your `.cpp` |

There is nothing to install and nothing to publish. Copying a file into your project is a supported
way to use it, and is what the table means by "copy".

## What the transport guarantees

- **Request identity is echoed verbatim.** The `id` is opaque; it is never parsed, renumbered or
  assumed to be a string.
- **A malformed line is reported and skipped, never answered.** A line that is not JSON, or not a
  JSON object, has no readable `id`, so there is nothing to answer; it goes to stderr and the loop
  continues.
- **An unknown op, an unknown action, a wrong argument count and a wrong argument type are all
  answered** with `{"ok": false, "error": "..."}` inside `result`, because those requests do carry
  an id.
- **A whole number is read at 64 bits.** BlaBla's `int` is 64-bit and its generator reaches
  `9007199254740991`, the largest integer a JSON double carries exactly. Python and TypeScript are
  wide enough by construction, Go and C read 64 bits, and the Java transport returns `long` rather
  than `int` for the same reason — narrowing to 32 bits turns a legal call into a refused one, which
  BlaBla reports as an application failure. An application that wants a narrower type narrows it
  itself, knowing what it is discarding.
- **One response per request, in order, and pushed out before the next request is read.** Python,
  Go, Java and C flush explicitly; the TypeScript transport writes to `process.stdout`, which Node
  delivers in order without an explicit flush call, so there is nothing to call there. The
  verifier's exchange timeout applies per response either way.
- **Application failures are not swallowed, with one difference worth knowing.** In Python,
  TypeScript, Java and C only a protocol failure becomes `ok: false`; an exception from the
  application propagates and the process dies, which BlaBla reports as a crash rather than as a
  passing case. The Go transport has no exceptions to propagate, so a handler that returns an
  `error` becomes `ok: false` and a genuine application failure is expected to panic, as Go code
  normally does.
- **Java carries its own minimal JSON.** The JDK ships no JSON API, so `java/blabla/Adapter.java`
  holds a small reader and writer, like the C transport. It keeps the raw text of the `id` rather
  than re-serialising a parsed value, which is how the opaque-identity guarantee is met.

## What belongs to the application, not here

Storage, domain rules, identity allocation and observation shape. The examples under `examples/`
show the split: `examples/todo-go/main.go` holds a `Storage` and an `Application` and binds three
actions; it contains no line reading, no JSON envelope and no argument checking. The structure
contracts beside those examples state that split as a requirement — `forbid` rules that the
application defines no `serve` and no `emit`, and that the transport defines no `Todo` and no
`Store`.

## The C transport and `extern "C"`

`c/blabla_adapter.h` deliberately carries no `#ifdef __cplusplus` / `extern "C"` guard. A project
that compiles the transport as C and the application as C++ needs that guard and should add it. Be
aware of the consequence for BlaBla itself: a brace opened inside one preprocessor conditional and
closed inside another cannot be balanced without running a preprocessor, so a header written that
way is reported as unparseable, and every structural rule over it becomes ERROR rather than a
guess. The examples here compile both translation units with one compiler, so they need no guard.

## Compiled languages need preparation

A compiled application must be built before it is launched, and the build must not run inside the
verifier's per-response timeout. Use the profile's `prepare` command and write the output under
`.blabla/`, which is outside the tree BlaBla fingerprints. A runtime that is slow to start also
wants `startup_ms`, which is the allowance for the first exchange after each spawn: `examples/todo-java`
sets it to 5000 while keeping `timeout_ms` at 1000, because a JVM start is not a response.

```text
verify behavior {
    prepare ["go", "build", "-o", ".blabla/todo-go", "."]
    command [".blabla/todo-go"]
    timeout_ms 1000
}
```

Writing the build output anywhere else changes the implementation fingerprint after `finish`
records the run, and the next `status` reports STALE.
