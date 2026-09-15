# Persistence refactor (no behavior change)

The on-disk format is one JSON object keyed by vault id, `{"A": {...}, "B": {...}, "C": {...}}`,
whose per-vault records contain exactly the durable vault fields: keeper, glyph, charge,
sealed and quarantined. The durable field names are declared once as `DURABLE_FIELDS`, a
tuple of field-name strings in `model.py`; `store.py` serializes and deserializes through
that tuple and names no field itself.

- Phase and resonance stay transient: they are never written and always start at 0 after
  a process restart.
- `DurableVault`, `VaultStore.load`, `VaultStore.save`, `VaultStore.clear`, the atomic write
  (temporary file, then replace) and the five module roles are kept. Domain still builds the
  durable projection (`snapshot`) and restores transient state; store still decides nothing
  about phase, charge or ownership.
- Every existing behavioral rule holds exactly as before; verification starts from fresh
  storage, so no migration of old files is needed.
