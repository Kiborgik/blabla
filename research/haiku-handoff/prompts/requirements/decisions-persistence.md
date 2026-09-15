
## Persistence decisions (after the storage refactor)

- The on-disk format is one JSON object keyed by vault id; each record holds exactly the
  fields named by `DURABLE_FIELDS` in `model.py`: keeper, glyph, charge, sealed,
  quarantined. Adding a durable field means extending that tuple and `DurableVault`.
- Phase and resonance are transient and are never written; domain starts both at 0 when it
  restores records.
- Writes stay atomic (temporary file, then replace); `load()` on a missing file returns no
  records; `clear()` deletes the file. Store makes no decision about any field value.
