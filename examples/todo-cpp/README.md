# todo-cpp

The same behavior contract again, in ordinary C++.

```text
cd examples/todo-cpp
blabla status
blabla finish
```

## One transport, two languages

There is no C++ adapter. `main.cpp` uses
[`../../adapters/c`](../../adapters/README.md) directly, compiled by `g++` alongside it, because the
protocol machinery does not become different work when the application changes language. The
application is idiomatic C++ — `std::vector`, `std::string`, `std::fstream`, a `Store` class with
`add`, `complete` and `remove` — and holds no line reading, no JSON and no argument checking.

```text
prepare ["g++", "-std=c++20", "-O1", "-static-libstdc++", "-static-libgcc", "-I", "../../adapters/c", "-o", ".blabla/todo-cpp", "main.cpp", "../../adapters/c/blabla_adapter.c"]
command [".blabla/todo-cpp"]
```

`-static-libstdc++` is not decoration. Without it the binary resolves `libstdc++-6.dll` from whatever
comes first on PATH, which on a Windows development machine can be a different toolchain's copy, and
the process dies constructing an `std::ifstream` before it reads a single request. A verification
run should fail because the application is wrong, not because it loaded the wrong runtime.

## What the structure contract covers

`todo-cpp.bla` names the class and its members — `Store.items`, `Store.add`, `Store.save`,
`Store.load`, `Todo.id` — and forbids the transport from holding any of them. The C++ provider reads
classes, their members, out-of-line `Foo::bar` definitions and namespace members flattened to the top
level, at one member level; it runs no preprocessor and resolves no types.
