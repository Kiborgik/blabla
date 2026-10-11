# Working in this repository

This is BlaBla's own source. Run the working tree through Cargo. Never run an installed `blabla`
or a binary under `target/`: it checks source that is no longer there.

Start any BlaBla work by invoking the `blabla` skill. Where it says plain `blabla`, run
`cargo run --quiet --bin blabla --` here.

```text
cargo run --quiet --bin blabla -- status
cargo run --quiet --bin blabla -- explain <identity>
cargo run --quiet --bin blabla -- finish
```

`status` prints every layer, contract, memory file and what to read next. Start there. Ask for
intent instead of reading whole files: `explain mission::blabla`, `explain system::<name>`,
`explain flow::development`.

`finish` drives a bridge that is a Cargo example. Build it from current source first, or run
`python experiments/gate.py`, which does it for you:

```text
cargo build --quiet --example structure-adapter
```

`README.md`, `blabla guide agent` and the block from `blabla init --agents` say plain `blabla`.
That is right for installed users and wrong here. If BlaBla seems not to understand its own
project, you are running the wrong binary.

| File | Holds |
| --- | --- |
| `BLA_BLA.md` | the rules BlaBla never breaks |
| `project.bla` | contracts and registered memory |
| `docs/` | language, structure, project and workflow reference |
| `experiments/gate.py` | the product gate |
