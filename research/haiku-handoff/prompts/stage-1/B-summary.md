# Glyph Vault: project summary

Glyph Vault is a small JSONL-driven service with exactly three vaults `A`, `B`, `C`. Each
vault has `id`, nullable `keeper` and `glyph` (null means unbound; empty strings are valid
tokens), `charge` 0..9, `phase` 0 or 1, `sealed`, `quarantined` and, after this task,
`resonance` (an integer, 0 or more, no upper bound). An unbound vault has null keeper and
glyph, charge 0, phase 0, resonance 0, and is neither sealed nor quarantined. Every
non-null glyph is held by at most one vault.

Every failing domain action is an exact no-op (nothing changes, still acknowledged with
`{"ok":true}`); unknown vault IDs are no-ops. Successful actions change only the fields
they name and never touch other vaults.

Existing actions:

- `bind(vault, keeper, glyph, charge)`: unbound vault, glyph not held elsewhere, charge 1..9;
  sets keeper, glyph, charge, phase 0, sealed false, quarantined false, resonance 0.
- `pulse(vault, keeper, amount)`: bound, matching keeper, amount 0..9, not sealed, not
  quarantined; phase 0 replaces charge, phase 1 adds with cap 9.
- `rotate(vault, keeper)`: bound, matching keeper, not sealed; toggles phase; only the
  phase-1 to phase-0 return caps a charge above 5 to 5.
- `transfer(source, target, keeper, amount)`: distinct bound vaults, keeper matches the
  source, different phases, amount > 0, source charge >= amount, target charge + amount <= 9,
  neither sealed, source not quarantined, and a quarantined target only if the source is in
  phase 0; atomic, no partial or clipped transfer.
- `release(vault, keeper)`: bound, matching keeper, charge 0, not sealed, not quarantined;
  clears keeper and glyph, phase 0.
- `seal(vault, keeper)`: bound, matching keeper, phase 1, charge exactly 5, not sealed, not
  quarantined; sets sealed. While sealed, pulse, rotate, release and both transfer
  directions are no-ops. `unseal(vault, keeper)` needs only the matching keeper.
- `quarantine(vault, keeper)`: bound, matching keeper, phase 1, odd charge (1, 3, 5, 7, 9),
  not sealed, not already quarantined; sets only quarantined. While quarantined: pulse and
  release are no-ops, transfers out are no-ops, transfers in need a phase-0 source, seal is a
  no-op, rotate still works. Rotate on a quarantined vault applies the toggle and the return
  cap first; if the resulting charge is even the quarantine clears, if odd it stays (the cap
  to 5 keeps it). `clear_quarantine(vault, keeper)`: bound, matching keeper; sets only
  quarantined to false. Sealed and quarantined never hold together.
- Trusted `restart`: process is killed and relaunched on the same data directory; keeper,
  glyph, charge, sealed and quarantined persist, every phase resets to 0, and rotate's cap is
  NOT applied (charge 9 stays 9). Persist each completed action before acknowledging it;
  never rely on clean exit. Fresh storage for every verification run: no migrations.

New resonance behavior:

- Resonance is transient: never persisted, 0 for every vault after a restart.
- A successful rotate that applies the return cap (phase 1 to 0 with charge above 5) sets
  resonance to 0; every other successful rotate, in either direction, adds exactly 1.
- A successful phase-0 pulse sets resonance to 0 even if the charge value is unchanged; a
  successful phase-1 pulse leaves it alone.
- Transfer, seal, unseal, quarantine and clear_quarantine leave resonance unchanged on every
  vault. Release sets it to 0 with the rest of the clearing.
- `attune(vault, keeper)`: bound, matching keeper, phase 1, not sealed, not quarantined,
  resonance >= 2; charge becomes charge + resonance capped at 9, resonance becomes 0,
  nothing else changes.

Architecture constraints (scored separately): five modules `model.py` (data only, no
functions), `domain.py` (all business rules, observable and durable projections),
`store.py` (JSON file persistence only, no rule decisions), `protocol.py` (JSONL dispatch
and wire types, never inspects vault fields), `main.py` (composition only). Dependencies:
main -> domain -> model, main -> store -> model, main -> protocol. Public names: `Vault`,
`DurableVault`, `VaultDomain`, `VaultStore`, `Protocol`; domain exposes each action plus
`observe` and `snapshot`, store `load`/`save`/`clear`, protocol `dispatch`/`serve`.
Standard library only.
