# structure.bla

A structure contract states what must remain true about the codebase: which modules exist, which symbols they define, which dependencies are allowed, which literal collections hold which members and which keys map to which values. It is evaluated statically from the repository on every `blabla status` and `blabla finish`; no application is launched and no result is cached.

`blabla check <contract.bla>` evaluates ONE structure contract on its own. It looks upward from the contract file for a `project.bla`, resolves the contract's module paths against that manifest's directory, and inspects only the modules that contract declares — a sibling contract's modules are not read and its rules are not evaluated. It exits 0 when every rule in that file is GREEN, 1 on any RED and 3 on any ERROR, and it reports bare labels rather than `group::label` because the file is being checked standalone. Without a `project.bla` above it the contract is compiled and its modules are not evaluated. This is a contract-author's check, not a completion signal: `blabla status` and `blabla finish` remain the authority over the whole project. `blabla check --falsify <contract.bla>` asks the other authoring question — whether each rule *can fail* — and is described below.

## Grammar

```text
contract   := module* rule*
module     := "module" IDENT STRING
rule       := ("require" | "forbid") STRING ":" fact
fact       := "module" IDENT
            | "symbol" IDENT "::" IDENT ("." IDENT)*
            | "dependency" IDENT "->" (IDENT | STRING)
            | "value" IDENT "::" IDENT ("." IDENT)* "contains" literal
            | "value" IDENT "::" IDENT ("." IDENT)* "maps" literal "to" literal
literal    := STRING | INTEGER | "true" | "false"
```

- `module <name> "<path>"` binds a name to one file, relative to the manifest directory. Every fact names declared modules; an undeclared name is `E_UNKNOWN_MODULE`.
- A rule is `require "label": fact` or `forbid "label": fact`. Labels are unique per contract; the rule identity is `<group>::<label>` where the group is the contract's file stem or its `as` alias in `project.bla`.
- A file whose first declaration is `module` is a structure contract; `blabla check <file>` recognises it and behavior declarations inside it are `E_LAYER_MIX`.

```text
module model    "glyph_vault/model.py"
module domain   "glyph_vault/domain.py"
module store    "glyph_vault/store.py"

require "durable-fields":              symbol model::DURABLE_FIELDS
require "domain-recover":              symbol domain::VaultDomain.recover
forbid  "domain-independent-of-store": dependency domain -> store
forbid  "domain-no-json":              dependency domain -> "json"
require "durable-keeper":              value model::DURABLE_FIELDS contains "keeper"
forbid  "id-is-the-key":               value model::DURABLE_FIELDS contains "id"
forbid  "no-domain-restart":           symbol domain::VaultDomain.restart
```

## Facts

| Fact | Holds when |
| --- | --- |
| `module m` | the file exists |
| `symbol m::Name` | the module declares `Name` at its own top level |
| `symbol m::Owner.member` | the type, class or trait `Owner` declares `member`; one nesting level |
| `dependency a -> b` | `a` references the declared module `b` |
| `dependency a -> "name"` | `a` references the external module or crate `name`, or something below it |
| `value m::Name contains literal` | `Name` is a literal tuple, list or set whose elements are strings, integers or booleans (or a dict whose keys are), and the literal is one of them |
| `value m::Name maps K to V` | `Name` is a collection of key/payload entries, one entry has key exactly `K`, and that entry's payload satisfies `contains V`. The key is never searched as part of its own payload |

## Associations

`contains` answers whether a literal is present. `maps` answers whether two literals are
*associated*, which is a different question: a gate step named `"clippy"` existing is not the same
fact as that step still running clippy.

```text
require "clippy-gate":  value gate::GATES maps "clippy" to "clippy"
require "audit-exempt": value auditor::ALLOWED maps "experiments/audit_public_tree.py" to "owner-handle"
```

An entry is a key/payload pair: a two-element tuple or list, or one key/value pair of a dict. The
key must be a string, integer or boolean literal. The payload is the second element, and `V` is
tested against it with the same rule `contains` uses, so a payload may be a scalar or a literal
collection. The key itself is never part of its own payload, so
`maps "clippy" to "clippy"` is not satisfied by the key.

A name is a collection of entries only when *every* element is such a pair; one three-element
record or one computed key and the name reports no entries at all, and every `maps` rule over it is
ERROR. Within an eligible collection, an individual payload that is not statically readable — a
variable reference, a call — makes rules for *that key* ERROR while leaving the other keys
evaluable. A key that is simply absent is RED; a key whose payload cannot be read is ERROR. The two
are never conflated, because "the gate step is gone" and "we cannot see what the gate step runs"
are different facts and only the first is a regression.

## Status of a rule

| Status | Meaning |
| --- | --- |
| GREEN | the fact holds under `require`, or is absent under `forbid` |
| RED | the fact is absent under `require`, or holds under `forbid`; `blabla explain <rule>` prints the observed file and line |
| ERROR | the fact could not be established: no provider for the file extension, the interpreter is missing, the module does not parse, the provider returned without reporting that module at all, the constant is not a literal collection, the provider reported the name as one whose value it could not read, or the symbol path is deeper than the provider reports |

A missing module file is observed state, not an error: `require ... module m` is RED and `forbid ... symbol m::X` is GREEN. ERROR blocks completion exactly like RED; a rule the verifier cannot evaluate is never counted GREEN.

## Providers

Facts come from a language provider chosen by file extension, behind the `Provider` trait in
`src/structure/mod.rs`. A module in any other language is ERROR for every rule that names it. No
provider executes project code, and the contract grammar is the same for all of them: a provider
adds a language, never a fact. `blabla status` prints the live list, which is read from the
providers themselves rather than from this table.

| Provider | Extensions | Backend |
| --- | --- | --- |
| `python` | `.py` | one isolated interpreter running BlaBla's embedded `ast` extractor |
| `rust` | `.rs` | `syn`, in process |
| `typescript` | `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` | tree-sitter |
| `go` | `.go` | tree-sitter |
| `java` | `.java` | tree-sitter |
| `c` | `.c` | tree-sitter |
| `cpp` | `.h` `.hpp` `.hh` `.hxx` `.cpp` `.cc` `.cxx` | tree-sitter |

`.h` belongs to the `cpp` provider on purpose. A provider is chosen by first match, `.h` is used by
both languages, and the C++ grammar accepts C while the reverse fails on any class or template. A C
construct that is not valid C++ is then a parse ERROR rather than a silently absent fact.

The five tree-sitter providers share one harness, `src/structure/treesitter.rs`, which performs the
read, the parse and the error classification identically for every grammar, and holds the single
accumulator that turns a walk into `ModuleFacts`. A language module supplies its extensions, its
grammar and its own walk over that grammar's node kinds — nothing else.

### Found, absent, and unknown

Three answers, never two. A fact the provider observed is found; a fact it looked for and did not
find is absent; a fact it could not decide is unknown, and unknown is ERROR. The third answer is
what stops a `forbid` from passing through analysis blindness, and several languages force it:

- **Go and Java** let one file reference another in the same package with no import at all, so
  whether `a` uses `b` inside one package cannot be decided statically.
- **A Java wildcard import** `import a.b.*;` can supply any type in that package.
- **A C or C++ `#include`** whose target sits on an include path BlaBla cannot see, or whose
  operand is a macro, names something real that cannot be located.
- **A TypeScript dynamic `import()` or `require()` of an expression** could resolve to anything.

An unknown carries the ONE declared module it could be hiding wherever the provider can name it,
and names nothing only when the unknown is genuinely unbounded. A bounded unknown makes exactly the
rules over that one target ERROR and leaves every other dependency on the same module decidable; an
unbounded one makes every dependency question on that module ERROR. `contracts/evaluator.bla` holds
the evaluator to both halves of that, including the case where a scoped unknown must leave an
unrelated target GREEN.

A provider that returns successfully must report one entry for every module it was handed, and a
file that is not there is reported as an entry that does not exist rather than as silence. Silence
is not an absent fact: a module a provider never reported is ERROR for every rule that names it,
because "the symbol is not there" and "nobody looked" are different answers and only the first may
satisfy a `forbid`.

The same rule covers a name inside a module. A provider that sees a name but cannot read its value
reports it as unreadable, and the evaluator decides the `value` rules over it as ERROR whether or not
the provider also listed it as a symbol. That decision lives in one place, so a language provider
cannot reintroduce the difference by forgetting to record something: `contracts/evaluator.bla` drives
the real evaluator through the `structure-adapter` bridge and holds it to that, and the case where a
name is reported unreadable and nothing else was a confirmed RED before the evaluator was corrected.

### Python

One interpreter run per verification (`python`, then `python3`) in isolated mode (`-I`) with
BlaBla's own embedded extractor, which reads each declared module as text and walks `ast.parse`
output. It never imports a project module, never runs module initialisation and never evaluates
expressions. Symbols are reported for the module top level and one class level; imports include
`from . import x` resolved against the manifest root; literal collections are tuples, lists, sets
and dict keys of string, integer and boolean constants.

### Rust

In-process, using `syn` to parse each declared module as text. Nothing is compiled, expanded or
run, which makes it strictly quieter than the Python provider: no subprocess at all.

**Symbols** are the file's own top-level items — `fn`, `struct`, `enum`, `union`, `trait`, `type`,
`const`, `static`, a `mod` declaration, a `macro_rules!` definition — plus one member level:

- the named fields of a struct and the variants of an enum;
- the required and provided items of a trait, so `symbol m::Provider.inspect` states that the trait
  still requires that method;
- the associated items of **any** `impl` block for a type in that file, inherent and trait impls
  alike, so `symbol m::PythonProvider.inspect` holds whether `inspect` is inherent or arrives
  through `impl Provider for PythonProvider`.

Generic parameters are ignored when naming the owning type: `impl<T> Foo<T>` contributes to `Foo`.
**Inline module bodies are not walked.** `mod tests { ... }` contributes the symbol `tests` and
nothing inside it, so a file's test internals never become contractible structural surface and
`symbol_depth` stays at two.

**Dependencies** are read from `use` declarations, `mod x;` declarations, every statically visible
path in the syntax tree, and paths inside macro token streams. A route beginning `crate::`,
`self::`, `super::`, a declared child module, or a name introduced by a `use` in that file resolves
to a file by trying `<route>.rs` and `<route>/mod.rs` from the longest prefix down; a route that
resolves to no file is attributed to the module owning the base directory, which is how
`use super::Thing` becomes a dependency on the parent's `mod.rs`. Any other lowercase first segment
of a multi-segment path is an external crate.

Widening the syntax does not bypass a rule. Rewriting `use crate::store; store::save(x)` as a bare
`crate::store::save(x)`, or moving the call inside `vec![...]`, keeps the dependency visible — which
matters most for `forbid`, where the alternative would be a silent false GREEN.

**Values** are `const` and `static` initialisers: an array or tuple of string, integer or boolean
literals is a literal collection (a leading `&` is unwrapped), and an array of two-element tuples is
a collection of key/payload entries. This mirrors the Python extractor element for element.

#### What the Rust provider does not see

These are limitations, not bugs, and a contract author should know them:

- **No name resolution and no type resolution.** Routes are resolved syntactically against the
  filesystem, never through the compiler's view of the crate.
- **No re-export or alias chasing.** A dependency reached only through `pub use` somewhere else, or
  through a `type` alias, is invisible.
- **No macro expansion.** Paths are read from macro token streams as tokens; a path that only exists
  after expansion is not there to read.
- **The crate source root is found by walking up for the first directory holding `lib.rs` or
  `main.rs`.** A layout that puts sources somewhere a `[lib] path` override names is not followed,
  and `crate::` routes in it will not resolve.
- **Test code inside a module counts.** A `#[cfg(test)]` block's imports are that file's
  dependencies, exactly as in the Python provider. This is deliberate: excluding them would let any
  dependency be hidden by wrapping it in a test-only module.
- **A route that reaches no file at all is an unknown, not an edge.** The base-directory fallback
  above applies while the route still names something the provider can place. Where no prefix of the
  route resolves to a file and more than one segment remains — `use crate::absent::Thing` — the
  provider cannot tell an item path on that module from a module it failed to locate, which a
  `#[path]` attribute, a macro-generated module or a non-standard source layout all produce. It
  reports an unknown **scoped to the one module the route could be hiding** rather than inventing an
  edge to it, so rules naming that module are `ERROR` while every other dependency stays decidable.
  Where exactly one segment remains — `use crate::Thing`, `use super::Thing` — the fallback still
  applies and is sound: a module needs a file to compile, so a single unresolved segment can only be
  an item of the module that owns it, and `use super::Thing` still becomes a dependency on the
  parent's `mod.rs`. `contracts/providers.bla` requires the decision to live in one place
  (`rustp::route` over `Resolution.Module`, `Resolution.Item` and `Resolution.Undecidable`), and
  three tests in `src/structure/rust.rs` hold the three arms apart.

### Go

Symbols are the file's top-level `func`, `type`, `const` and `var` names, including every name
inside a grouped `const (...)`, `var (...)` or `type (...)` block, plus one member level: a struct
type's fields, an interface's method names, and a method named by its receiver type, so
`func (s *Storage) Save()` is `Storage.Save`.

Dependencies are import specs, in both the single and the parenthesised block form. An import path
that resolves inside this module — the module path comes from the nearest `go.mod`, which is read
as text — becomes a dependency on every declared module in the directory that path names. Anything
else is the import path verbatim, as an external target. Values are `var` and `const` composite
literals: a slice or array of string, integer or boolean literals is a collection, and a
`map[K]V{...}` or an array of two-element literals is a collection of key/payload entries.

Not seen: build tags, cgo, generated code, and any reference between two files of the same package,
which Go makes with no import at all and which is therefore reported as an unknown scoped to that
sibling rather than as an absent dependency.

### Java

Symbols are the top-level `class`, `interface`, `enum`, `record` and annotation types, plus one
member level: fields, methods, constructors, enum constants, record components and the simple name
of a nested type. A nested type contributes its own name and nothing deeper.

Dependencies are resolved by fully qualified name. A single-type import whose name equals a
declared module's `package` declaration joined with its file stem becomes a dependency on that
module; anything else is the fully qualified name verbatim. A static import names its owning type
and is treated the same way. Values are field initialisers: array initialisers, `List.of` and
`Set.of` are collections, and `Map.of`, `Map.entry` and arrays of two-element arrays are key/payload
entries.

Not seen: the classpath, reflection, annotation processing, generics and overload resolution. A
wildcard import and a same-package reference are both reported as unknowns scoped to the declared
modules they could be hiding.

### C and C++

One walk serves both grammars, because tree-sitter-cpp's node kinds are a superset of
tree-sitter-c's. Symbols are top-level function definitions and prototypes, `struct`, `union`,
`enum` and `class` names, `typedef` names, file-scope variables and object-like `#define` names,
plus one member level of fields, enumerators and class members. A C++ out-of-line definition
`void Foo::bar() {}` contributes `Foo.bar`; a qualified name deeper than two segments contributes
its innermost owning type and member, because `symbol_depth` is two for every provider and a
three-segment path is ERROR by design. A `namespace` contributes its members at the top level
rather than as a third segment.

Dependencies are `#include` only. A quoted include is resolved against the including file's own
directory and then the manifest root; an angle include is the operand verbatim, as an external
target. Values are file-scope initialisers: a brace-init list of literals is a collection, and an
array of two-element brace groups is a collection of key/payload entries.

**There is no preprocessing at all**, and the consequences are not small. Both arms of an `#if` or
`#ifdef` are read, so a symbol inside a disabled arm is still reported. A declaration produced by a
macro is invisible. `-D` and `-I` flags are unknown, so an include that only resolves through an
include path is an unknown rather than an absent dependency. A brace opened inside one preprocessor
conditional and closed inside another — the `#ifdef __cplusplus` / `extern "C" {` idiom — leaves the
file unparseable, and every rule over it is ERROR.

### What no provider does

Two limits apply to every language and are worth knowing before writing a contract.

- **No name resolution and no type resolution.** Routes are resolved syntactically against the
  filesystem or against declared modules, never through a compiler's view of the program.
- **A `dependency` rule whose TARGET module lies outside the project root cannot be observed.** The
  name a dependency is matched against is the target's dotted path from the manifest directory, and
  a file above that directory has none. Declaring such a module still works for `symbol` and
  `value` rules; only `dependency` rules naming it as the target are unobservable, and the
  falsifier reports them as VACUOUS rather than letting them stand.

## Falsification

A GREEN rule proves the fact was checked. It does not prove the rule constrains anything: a `forbid`
rule whose module was deleted is GREEN forever while saying nothing about the symbol it names, and
five such rules passed `blabla check` with exit 0 when `contracts/rust.bla` was first authored.

```text
blabla check --falsify <contract.bla>
blabla check --falsify
```

The first form falsifies one structure contract on its own, and looks upward from that contract's own
directory for a `project.bla`. The second form falsifies every structure contract the project declares
with `use structure`, using the manifest discovered from the working directory or the one named by
`--project`. Either way module paths resolve against that manifest's directory. A contract listed as
`draft structure` is excluded from the project-wide form and named in the output, and behavior
contracts are never examined because this command falsifies structural facts.

For each rule it evaluates, BlaBla inverts the fact the rule names inside the facts the providers
already reported, and decides the rule again against those counterfactual facts. Nothing is written,
no source file is changed, and the project-wide form runs the providers once per provider rather
than once per provider per contract. The counterfactual lives in memory and rule evaluation is a
function of the fact map, so the same evaluator answers both times.

| Verdict | Meaning |
| --- | --- |
| FALSIFIABLE | inverting the fact moves the rule between GREEN and RED, so both statuses are reachable; the transition is printed |
| VACUOUS | the inverted fact cannot be built from what the providers reported, so the rule's status rests on absent ground rather than on the fact it names |
| UNEVALUABLE | the rule is ERROR as it stands and has no observed truth value to invert |

Exit 0 when every rule is falsifiable, 1 on any vacuous rule, 3 on any unevaluable one. A project
with no active structure contract exits 2 and reports an error; nothing was proven, so it does not
report as if something had been. `--falsify` deliberately does not inherit `check`'s exit 1 for a
RED rule: an author mid-authoring carries deliberate REDs, and "the repository violates this rule"
is `check`'s question, not this one's.

### What a counterfactual may change

Only fact surface a provider actually reports. Inverting a fact that *holds* is always constructible
— the reported symbol, import, member or value is removed. Inverting a fact that is *absent* needs
its anchor present:

| Fact | Anchor the absent-to-present direction needs |
| --- | --- |
| `module m` | none; existence toggles both ways |
| `symbol m::Name` | `m` exists, and the name is no deeper than the provider's `symbol_depth` |
| `dependency a -> b` | `a` exists, and the declared module `b` exists too — importing a file that is not there is not a one-step change in any language |
| `value m::N contains L` | `N` is a reported literal collection |
| `value m::N maps K to V` | `N` is a reported collection of key/payload entries |

A dependency on a declared module is injected under the module's dotted path from the manifest root,
because that is the one spelling both providers emit: the Rust provider reports every internal route
as that path, and the Python extractor reports it for `import pkg.module`. The target module must
also exist: the Rust provider resolves routes against the filesystem and would report nothing for an
absent file, and a Python import naming a file that is not there is a dangling name rather than the
dependency the rule means. A dependency on an
external target is injected verbatim, which is safe because `external_target_error` has already made
a target the provider could never observe an ERROR. No counterfactual invents a fact shape its
provider cannot produce; where one would have to, the rule is VACUOUS and the reason is printed.

### What it does not establish

- **FALSIFIABLE is a statement about the evaluator, not about the contract's intent.** A rule with a
  typo in the symbol name is still falsifiable — inject the misspelled symbol and it goes RED. The
  operation cannot tell you that you named the wrong thing.
- **It is not proof that a source edit produces those facts.** The counterfactual is a change to the
  observed facts; the provider was not re-run against a changed file, because no file was changed.
- **It is not a completion gate.** It writes nothing, records nothing, and `status` and `finish`
  never read it. Wiring it into a project's gate would make an authoring finding block completion,
  which is the opposite of what it is for.

## What structure does not do

It does not check call order, line counts, naming style, attribute access or anything that needs execution or type inference. Those are either behavior (verify them through `behavior.bla`) or style (keep them out of the contract). Determinism: the same repository and contracts produce the same facts, rule ids and output ordering.
