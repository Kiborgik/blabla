# structure.bla

Structure contracts check facts in the source code without running it. `status` and `finish` check them live every time.

```text
module model  "glyph_vault/model.py"
module domain "glyph_vault/domain.py"
module store  "glyph_vault/store.py"

require "durable-fields": symbol model::DURABLE_FIELDS
require "recover": symbol domain::VaultDomain.recover
forbid "independent-store": dependency domain -> store
forbid "no-json": dependency domain -> "json"
require "durable-keeper": value model::DURABLE_FIELDS contains "keeper"
forbid "id-is-not-durable": value model::DURABLE_FIELDS contains "id"
```

## Grammar

```text
contract := module* rule*
module   := "module" IDENT STRING
rule     := ("require" | "forbid") STRING ":" fact
fact     := "module" IDENT
          | "symbol" IDENT "::" IDENT ("." IDENT)*
          | "dependency" IDENT "->" (IDENT | STRING)
          | "value" IDENT "::" IDENT ("." IDENT)* "contains" literal
          | "value" IDENT "::" IDENT ("." IDENT)* "maps" literal "to" literal
          | "lines" IDENT "<=" INTEGER
literal  := STRING | INTEGER | "true" | "false"
```

A module binds one file, relative to the manifest; only a `lines` fact may name a module bound to a directory. Labels are unique per contract and become `group::label`.

| Fact | Meaning |
| --- | --- |
| `module m` | the file exists |
| `symbol m::Name` / `m::Owner.member` | a top-level symbol / one member level down |
| `dependency a -> b` | `a` refers to declared module `b` |
| `dependency a -> "name"` | `a` uses an external module, crate or package |
| `value m::Name contains L` | a literal collection holds string, integer or Boolean `L`; for a dict or object, its keys |
| `value m::Name maps K to V` | the entry with literal key `K` has a payload containing `V`; entries are pairs or dict items |
| `lines m <= N` | every file of `m` has at most `N` lines; a directory module counts each tracked file under it |

- **GREEN**: a required fact holds, or a forbidden fact is shown absent
- **RED**: a required fact is absent, or a forbidden one holds; the evidence names file and line
- **ERROR**: the fact cannot be read (no interpreter, parse failure, unreadable value, too deep). A missing file is absence, not ERROR

## Providers

The first extension match picks the provider. All give the same facts and never run project code. `status` prints the list.

| Provider | Extensions | Backend |
| --- | --- | --- |
| Python | `.py` | isolated interpreter, embedded `ast` extractor |
| Rust | `.rs` | in-process `syn` |
| TypeScript/JavaScript | `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` | tree-sitter |
| Go | `.go` | tree-sitter |
| Java | `.java` | tree-sitter |
| C | `.c` | tree-sitter |
| C++ | `.h` `.hpp` `.hh` `.hxx` `.cpp` `.cc` `.cxx` | tree-sitter |

Every provider reports symbols two levels deep. `.h` is parsed as C++.

**Unknown is ERROR, never absence.** When a provider cannot see a reference (same-package Go or Java code, Java wildcard imports, unseen C include paths, dynamic TypeScript imports), rules that it could hide are ERROR, so an analysis gap never satisfies a `forbid`.

**Limits by language.** No provider resolves names or types like a compiler.

- **Python**: runs `python -I` with `ast.parse` only; dynamic imports and computed values are invisible
- **Rust**: `use`, `mod`, paths and macro-token paths resolve by syntax; no macro expansion or re-export chasing; crate roots are `lib.rs`/`main.rs`
- **TypeScript/JavaScript**: static and literal dynamic imports; no `tsconfig` aliases or re-export chains beyond one `export … from`
- **Go**: imports resolve through the nearest `go.mod`; build tags, cgo and generated code are not interpreted
- **Java**: fully qualified imports resolve against declared files; no classpath, reflection or generics
- **C/C++**: `#include` only, no preprocessing: both `#if` arms count and macro-made declarations are invisible. Braces split across `#if` arms can make a file unparseable

Structure does not check call order, style, line counts or runtime behavior. A dependency target outside the project root cannot be observed.

## Falsification

```sh
blabla check contracts/architecture.bla           # 0 all GREEN, 1 any RED, 3 any ERROR
blabla check --falsify contracts/architecture.bla
blabla check --falsify                            # every active structure contract
```

`--falsify` flips each named fact in memory and reruns the same evaluator; it edits no source and records no result. FALSIFIABLE means the flip moves the rule between GREEN and RED. VACUOUS means the flip could not be built (exit 1); fix the rule so it points at something real. UNEVALUABLE means the rule is already ERROR (exit 3). Exit 0 means every rule is falsifiable; exit 2 means no structure contract is active. FALSIFIABLE shows the rule depends on the fact, not that the fact is the right intent. Neither form of `check` decides done.
