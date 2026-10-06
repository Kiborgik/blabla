# structure.bla

Structure contracts check static codebase facts without launching the application. `status` and `finish` evaluate them live; no cached structure result supplies current GREEN.

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
literal  := STRING | INTEGER | "true" | "false"
```

Modules bind one file relative to the manifest root. Undeclared module names are `E_UNKNOWN_MODULE`; labels are unique per contract and become `group::label` using the file stem or manifest alias. Empty registered contracts are rejected. An initial `module` declaration selects the structure language; mixed behavior declarations are `E_LAYER_MIX`.

## Facts

| Fact | Meaning |
| --- | --- |
| `module m` | file exists |
| `symbol m::Name` / `m::Owner.member` | own top-level symbol / one member level |
| `dependency a -> b` | syntactically observed reference to declared module `b` |
| `dependency a -> "name"` | external module/crate/package or a descendant |
| `value m::Name contains L` | literal collection contains string/integer/Boolean `L`; dict/object membership uses keys |
| `value m::Name maps K to V` | an entry with literal key `K` has scalar or literal-collection payload containing `V`; the key is not its own payload |

Top-level scalar constants are not `contains` collections. Supported literal container forms depend on the language below.

### Associations

```text
module gate "experiments/gate.py"
require "clippy-gate": value gate::STEPS maps "clippy" to "clippy"
```

An entry is a two-element tuple/list or a dict/object key-value pair. Every element must have a literal key and entry shape; one computed key or three-element record makes `maps` over the collection ERROR. Within a valid entry collection, an unreadable payload makes only that key's rules ERROR. An absent key is an absent fact: RED for `require`, GREEN for `forbid`. A scalar payload is allowed even though a standalone scalar is not a collection.

## Status of a rule

| Status | Meaning |
| --- | --- |
| GREEN | required fact holds / forbidden fact is established absent |
| RED | required fact absent / forbidden fact holds; evidence names file/line |
| ERROR | cannot establish the fact: unavailable provider/interpreter, parse failure, unreported module, unreadable value or excessive symbol depth |

Missing files are observed absence, not unreadability: `require module m` is RED; `forbid symbol m::X` can be GREEN when the file is absent. A provider that fails to report a module has not established absence. An explicitly unreadable value is ERROR even if no corresponding symbol was recorded.

## Providers

The first extension match selects a provider. All produce the same facts/evaluator semantics and execute no project code. Unsupported extensions are ERROR. `status` prints the actual registry.

| Provider | Extensions | Backend |
| --- | --- | --- |
| Python | `.py` | isolated interpreter, embedded `ast` extractor |
| Rust | `.rs` | in-process `syn` |
| TypeScript/JavaScript | `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` | tree-sitter |
| Go | `.go` | tree-sitter |
| Java | `.java` | tree-sitter |
| C | `.c` | tree-sitter |
| C++ | `.h` `.hpp` `.hh` `.hxx` `.cpp` `.cc` `.cxx` | tree-sitter |

The five tree-sitter providers share parse/error/line/fact handling. `.h` uses C++ deliberately; a C-only construct its grammar cannot parse is ERROR. Every provider exposes symbols two levels deep, not arbitrary nesting.

### Found, absent, and unknown

Providers distinguish found, established absent and unknown. Unknown is ERROR. A scoped unknown affects only the declared target it could hide; a genuinely unbounded unknown affects all dependency questions from that source. Examples include same-package Go/Java references, Java wildcard imports, unseen C include paths and dynamic TypeScript import expressions. This prevents recognized analysis gaps from silently satisfying `forbid`; it is not full compiler resolution.

### Python

Uses `python`, then `python3`, once per inspection in isolated `-I` mode. Reads text through `ast.parse`, without imports/initialization/evaluation. Reports top-level and one class-level symbols; imports including `from . import x`; tuple/list/set literals and dict keys; entry-pair/dict associations. Dynamic imports/attributes and computed values are outside the static surface.

### Rust

Reports own top-level functions, types, traits, constants/statics, modules and macro definitions; named struct fields, enum variants, trait items and associated items of inherent/trait impls. Generic parameters do not alter the owner name. Inline module bodies add no nested symbols, but their imports still count as file dependencies, including `#[cfg(test)]` code.

Dependencies include `use`, `mod x;`, visible syntax paths and macro-token paths. `crate::`, `self::`, `super::`, declared child modules and imported names resolve syntactically against `.rs` / `/mod.rs` files, longest prefix first. Other lowercase multi-segment roots denote external crates. Values come from const/static array/tuple literals, unwrapping a leading `&`; pair arrays provide associations.

Limits: no compiler name/type resolution, cross-file re-export/type-alias chasing or macro expansion. Crate roots are found by walking to `lib.rs`/`main.rs`, not Cargo `[lib] path` overrides. A single unresolved item segment can fall back to its owning module (`super::Thing` to parent `mod.rs`); an unresolved multi-segment route becomes a scoped unknown rather than an invented edge. Paths visible inside macros remain observable even without expansion.

### TypeScript and JavaScript

Reports top-level declarations and one class/interface/enum member level, static imports/exports and literal `require`/dynamic-import routes, literal arrays/object keys and key/payload entries. Relative module routes resolve syntactically; external package targets remain external. Nonliteral import/require targets are unknown.

No type resolution, `tsconfig` aliases, namespaces/decorators or re-export-chain chasing beyond a direct `export … from`. Literal wrappers such as `as`/`satisfies` can be unwrapped; computed payloads remain unreadable rather than evaluated.

### Go

Reports top-level/grouped function/type/const/var declarations, struct fields, interface methods and receiver methods (`Storage.Save`). Imports resolve via the nearest textual `go.mod`; an internal package dependency covers declared files in that directory. Other import paths remain external. Slice/array literals provide collections; maps and pair literals provide associations.

Does not interpret build tags/cgo or run code generators. Same-package cross-file references need no import and are reported as scoped unknowns.

### Java

Reports top-level class/interface/enum/record/annotation types and one level of fields, methods, constructors, enum constants, record components and nested-type names. Fully qualified single/static imports resolve against declared package+file names; other imports remain external. Arrays, `List.of`, `Set.of` provide collections; `Map.of`, `Map.entry` and pair arrays provide associations.

No classpath, reflection, annotation processing, generics or overload resolution. Wildcard imports and same-package references are scoped unknowns.

### C and C++

Reports function definitions/prototypes, struct/union/enum/class/typedef names, file variables and object-like defines, plus one level of fields/enumerators/members. Out-of-line `Foo::bar` contributes `Foo.bar`; deeper qualifiers use the innermost owner/member. Namespace members appear at the top level.

Dependencies are `#include` only. Quoted paths try the including directory then manifest root; angle operands are external targets. File-scope literal brace lists provide collections; two-element brace groups provide associations.

No preprocessing: both conditional arms contribute facts, macro-generated declarations are invisible and `-D`/`-I` settings are unknown. Unresolved include paths/macros are unknown. Braces split across conditionals can make a file unparseable, including some `extern "C"` guards.

### Shared limits

No provider performs compiler name/type resolution. A dependency target outside the project root has no observable project-relative name; do not use it as a dependency target (falsification reports VACUOUS). Outside modules can still support symbol/value rules. Structure does not check call order, attribute access, naming style, line counts or runtime behavior.

## Falsification

```sh
blabla check contracts/architecture.bla
blabla check --falsify contracts/architecture.bla
blabla check --falsify
```

Standalone `check FILE` discovers a manifest upward from the contract, resolves modules against its root and inspects only that contract's modules. Without a manifest it compiles but does not inspect modules. Standalone IDs are bare labels; exits are 0 all GREEN, 1 any RED, 3 any ERROR. This authoring check is not completion.

`--falsify` instead inverts each named fact in the already-inspected map and reruns the same evaluator. It edits no source, launches no application and writes no completion record. The project form inspects active structure contracts together, once per provider; drafts are excluded/named and behavior is not examined.

| Verdict | Meaning |
| --- | --- |
| FALSIFIABLE | inversion moves the rule between GREEN and RED |
| VACUOUS | the counterfactual lacks the observed anchor needed to construct it |
| UNEVALUABLE | the original rule is ERROR and has no truth value to invert |

Removing a present fact is constructible. Injecting an absent symbol needs an existing module and supported depth; a dependency needs an existing source and target; membership/association needs a reported collection of that form. External targets must be observable by the provider. No counterfactual invents unsupported fact shapes.

Exits: 0 all falsifiable; 1 any vacuous; 3 any unevaluable; 2 no active structure contracts. Original RED does not itself fail falsification. FALSIFIABLE proves evaluator sensitivity, not correct spelling/intent or that a real source edit produces the injected facts. `status` and `finish` never consume this result as completion credit.
