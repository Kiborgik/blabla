# Glyph Vault: project summary

Glyph Vault is a small JSONL-driven service with exactly three vaults `A`, `B`, `C`. Each
vault has `id`, nullable `keeper` and `glyph` (null means unbound; empty strings are valid
tokens), `charge` 0..9, `phase` 0 or 1, `sealed`, `quarantined` and `resonance` (an
integer, 0 or more, no upper bound). An unbound vault has null keeper and glyph, charge 0,
phase 0, resonance 0, and is neither sealed nor quarantined. Every non-null glyph is held
by at most one vault.

Every failing domain action is an exact no-op (nothing changes, still acknowledged with
`{"ok":true}`); unknown vault IDs are no-ops. Successful actions change only the fields
they name and never touch other vaults.

Existing actions:

- `bind(vault, keeper, glyph, charge)`: unbound vault, glyph not held elsewhere, charge 1..9;
  sets keeper, glyph, charge, phase 0, sealed false, quarantined false, resonance 0.
- `pulse(vault, keeper, amount)`: bound, matching keeper, amount 0..9, not sealed, not
  quarantined; phase 0 replaces charge and sets resonance to 0 (even if the charge value is
  unchanged), phase 1 adds with cap 9 and leaves resonance alone.
- `rotate(vault, keeper)`: bound, matching keeper, not sealed; toggles phase; only the
  phase-1 to phase-0 return caps a charge above 5 to 5. A rotate that applies that cap sets
  resonance to 0; every other successful rotate, in either direction, adds exactly 1.
- `transfer(source, target, keeper, amount)`: distinct bound vaults, keeper matches the
  source, different phases, amount > 0, source charge >= amount, target charge + amount <= 9,
  neither sealed, source not quarantined, and a quarantined target only if the source is in
  phase 0; atomic, no partial or clipped transfer; resonance of both vaults unchanged.
- `release(vault, keeper)`: bound, matching keeper, charge 0, not sealed, not quarantined;
  clears keeper and glyph, phase 0, resonance 0.
- `seal(vault, keeper)`: bound, matching keeper, phase 1, charge exactly 5, not sealed, not
  quarantined; sets sealed. While sealed, pulse, rotate, release and both transfer
  directions are no-ops. `unseal(vault, keeper)` needs only the matching keeper. Neither
  touches resonance.
- `quarantine(vault, keeper)`: bound, matching keeper, phase 1, odd charge (1, 3, 5, 7, 9),
  not sealed, not already quarantined; sets only quarantined. While quarantined: pulse and
  release are no-ops, transfers out are no-ops, transfers in need a phase-0 source, seal is a
  no-op, rotate still works. Rotate on a quarantined vault applies the toggle and the return
  cap first; if the resulting charge is even the quarantine clears, if odd it stays (the cap
  to 5 keeps it). `clear_quarantine(vault, keeper)`: bound, matching keeper; sets only
  quarantined to false. Sealed and quarantined never hold together. Neither touches
  resonance.
- `attune(vault, keeper)`: bound, matching keeper, phase 1, not sealed, not quarantined,
  resonance >= 2; charge becomes charge + resonance capped at 9, resonance becomes 0.
- `echo(source, target, keeper)`: distinct bound vaults, keeper matches the source, source
  resonance >= 1, the SAME phase on both vaults (the opposite of transfer), neither sealed,
  source not quarantined, and a quarantined target only if the source is in phase 0 (so an
  echo into a quarantined vault needs both in phase 0). Target resonance becomes the sum (no
  cap), source resonance becomes 0, nothing else changes.
- Trusted `restart`: process is killed and relaunched on the same data directory; keeper,
  glyph, charge, sealed and quarantined persist, every phase resets to 0, resonance resets
  to 0 (it is never persisted), and rotate's cap is NOT applied (charge 9 stays 9). Persist
  each completed action before acknowledging it; never rely on clean exit. Fresh storage for
  every verification run: no migrations.

Persistence: `store.py` writes `vaults.json` as one JSON object keyed by vault id whose
records hold exactly `DURABLE_FIELDS` (declared in `model.py`: keeper, glyph, charge,
sealed, quarantined), written to a temporary file and replaced atomically; `load()` returns
`DurableVault` records or an empty list; `clear()` deletes the file. Phase and resonance
are transient and start at 0 after every restart.

New recovery behavior:

- `recover(vault, keeper)`: bound, matching keeper, quarantined, resonance >= 3 (sealed
  vaults are never quarantined, so recover never applies to them).
- On success: quarantined becomes false, phase becomes 0 (a vault already in phase 0 stays
  there), resonance becomes 0; keeper, glyph, charge and sealed are unchanged. Unlike
  rotate, recover NEVER applies the return cap: recovering from phase 1 with charge 7 keeps
  charge 7.
- Any failing condition is an exact no-op.
- Resonance for recovery comes from rotations that neither cap the charge nor clear the
  quarantine (odd resulting charge) or from echo (into a quarantined vault: both in phase
  0); after a restart resonance is 0, so a quarantined vault needs fresh resonance first.

Architecture constraints (scored separately): five modules `model.py` (data only, no
functions), `domain.py` (all business rules, observable and durable projections),
`store.py` (JSON file persistence only, no rule decisions, serializes through
`DURABLE_FIELDS`), `protocol.py` (JSONL dispatch and wire types, never inspects vault
fields), `main.py` (composition only). Dependencies: main -> domain -> model, main -> store
-> model, main -> protocol. Public names: `Vault`, `DurableVault`, `VaultDomain`,
`VaultStore`, `Protocol`; domain exposes each action plus `observe` and `snapshot`, store
`load`/`save`/`clear`, protocol `dispatch`/`serve`. Standard library only.
