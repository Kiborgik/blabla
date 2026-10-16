# Adapters

One JSON Lines protocol, one small transport per language. The transport reads requests, echoes
the `id`, dispatches `reset`, `call` and `observe`, checks action names and argument types, flushes
each response, logs to stderr and exits on EOF. The app supplies only a reset handler, an observe
handler and a table of actions. Copy the file into your project or reference it; nothing is installed.

| Language | File | How an application reaches it |
| --- | --- | --- |
| Python | `python/blabla_adapter.py` | put the directory on `sys.path`, or copy the file beside your application |
| TypeScript / JavaScript | `typescript/blabla_adapter.ts` | import it by relative path, or copy it into your source tree |
| Go | `go/blabla/adapter.go` | `require blabla.dev/adapter` with a `replace` to this directory, or copy the package |
| Java | `java/blabla/Adapter.java` | compile it with your application, or copy the file into your source tree |
| C | `c/blabla_adapter.h`, `c/blabla_adapter.c` | compile the `.c` with your application and pass `-I` to this directory |
| C++ | `c/blabla_adapter.h`, `c/blabla_adapter.c` | the same C transport; compile it with `g++` alongside your `.cpp` |

## What the transport guarantees

- **The `id` is echoed as-is**, never parsed or renumbered
- **A line that is not a JSON object** is logged to stderr and skipped; it has no `id` to answer
- **Unknown op or action, wrong argument count or type** get `{"ok": false, "error": "..."}` inside `result`
- **Integers are 64-bit** (Java returns `long`), since BlaBla generates values up to `9007199254740991`
- **One response per request, in order**, flushed before the next read
- **App exceptions are not swallowed**: the process dies and BlaBla reports a crash. Go has no exceptions, so a handler's returned `error` becomes `ok: false` and a real failure should panic
- **Java and C carry their own small JSON reader and writer**

Storage, domain rules, ID allocation and the observation shape belong to the app. The example
structure contracts enforce that split: the app defines no `serve` or `emit`, the transport no `Todo` or `Store`.

`c/blabla_adapter.h` has no `extern "C"` guard; add one if you compile it as C and your app as
C++. Braces split across `#if` arms make the header unparseable for BlaBla's structure check.

Compiled apps build in the profile's `prepare` step, with output under `.blabla/` so the run does
not go STALE. Slow starters set `startup_ms`: `examples/todo-java` uses 5000 with `timeout_ms` 1000.

```text
verify behavior {
    prepare ["go", "build", "-o", ".blabla/todo-go", "."]
    command [".blabla/todo-go"]
}
```
