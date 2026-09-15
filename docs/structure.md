# structure.bla

A structure contract states what must remain true about the codebase: which modules exist, which symbols they define, which dependencies are allowed and which literal collections hold which members. It is evaluated statically from the repository on every `blabla status`, `blabla finish` and project `blabla check`; no application is launched and no result is cached.

## Grammar

```text
contract   := module* rule*
module     := "module" IDENT STRING
rule       := ("require" | "forbid") STRING ":" fact
fact       := "module" IDENT
            | "symbol" IDENT "::" IDENT ("." IDENT)*
            | "dependency" IDENT "->" (IDENT | STRING)
            | "value" IDENT "::" IDENT ("." IDENT)* "contains" literal
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
| `symbol m::Name` | the module defines `Name` at top level (class, function, assignment) |
| `symbol m::Class.member` | the class body defines `member` (method or class-level assignment); one nesting level |
| `dependency a -> b` | `a` imports the declared module `b` by its file stem, its dotted path from the manifest root or its path relative to `a`'s package |
| `dependency a -> "name"` | `a` imports the external module `name` or a submodule of it |
| `value m::Name contains literal` | `Name` is a literal tuple, list or set whose elements are strings, integers or booleans (or a dict whose keys are), and the literal is one of them |

## Status of a rule

| Status | Meaning |
| --- | --- |
| GREEN | the fact holds under `require`, or is absent under `forbid` |
| RED | the fact is absent under `require`, or holds under `forbid`; `blabla explain <rule>` prints the observed file and line |
| ERROR | the fact could not be established: no provider for the file extension, the interpreter is missing, the module does not parse, the constant is not a literal collection, or the symbol path is deeper than the provider reports |

A missing module file is observed state, not an error: `require ... module m` is RED and `forbid ... symbol m::X` is GREEN. ERROR blocks completion exactly like RED; a rule the verifier cannot evaluate is never counted GREEN.

## Providers

Facts come from a language provider chosen by file extension. v0.5 ships the Python provider: it runs the interpreter (`python`, then `python3`) once per verification in isolated mode (`-I`) with BlaBla's own embedded extractor, which reads each declared module as text and walks `ast.parse` output. It never imports a project module, never runs module initialisation and never evaluates expressions. Symbols are reported for the module top level and one class level; imports include `from . import x` resolved against the manifest root; literal collections are tuples, lists, sets and dict keys of string, integer and boolean constants.

Other languages need another provider behind the same `Provider` trait (`src/structure/mod.rs`); the contract grammar does not change. A `.rs` or `.ts` module today is ERROR for every rule that names it.

## What structure does not do

It does not check call order, line counts, naming style, attribute access or anything that needs execution or type inference. Those are either behavior (verify them through `behavior.bla`) or style (keep them out of the contract). Determinism: the same repository and contracts produce the same facts, rule ids and output ordering.
