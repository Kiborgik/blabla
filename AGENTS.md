# Working in this repository

This repository is BlaBla's own source. **The BlaBla that answers questions here is the working
tree, not an installed binary**, so every command in this repository goes through Cargo:

```text
cargo run --quiet --bin blabla -- status
```

That one command is the entry point: it prints the project, every layer's state, the contracts,
the registered project memory and the next identity worth expanding. Everything else follows from
what it prints.

```text
cargo run --quiet --bin blabla -- explain <identity>
cargo run --quiet --bin blabla -- guide agent
cargo run --quiet --bin blabla -- check --falsify
cargo run --quiet --bin blabla -- finish
```

This repository's own behavior contract is driven by a bridge that is a Cargo example, so build it
from the current source before `finish`, or run `experiments/gate.py`, which does it for you:

```text
cargo build --quiet --example structure-adapter
```

A stale bridge is the same hazard as a stale binary: it verifies source that is no longer there.

## Do not run a built binary here

`target/debug/blabla.exe` and `target/release/blabla.exe` are build outputs.

The same applies to a `blabla` on PATH. If a command in this repository fails in a way that looks
like BlaBla does not understand its own project, you are running the wrong binary.

## The installed-user path is a different thing

`README.md`, `blabla guide agent`, the managed `AGENTS.md` block written by `blabla init --agents`
and every example for an ordinary project all say plain `blabla`, because that is what someone who
installed BlaBla has on PATH. Those surfaces are correct for them and wrong here. Do not copy a
command out of `README.md` into this repository.

## Where the authority lives

| File | Holds |
| --- | --- |
| `BLA_BLA.md` | current project authority: layers, completion, trust boundaries, self-hosting |
| `project.bla` | the machine entry point: contracts and registered project memory |
| `docs/` | the canonical language, structure, project and workflow references |
| `experiments/gate.py` | the product verification gate |

Project intent, architecture and process are queried, not read whole: `cargo run --quiet --bin
blabla -- explain mission::blabla`, `... explain system::<name>`, `... explain flow::development`.
