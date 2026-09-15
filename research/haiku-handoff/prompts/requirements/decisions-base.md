# Glyph Vault: recorded decisions and edge cases

These decisions were settled while the existing behavior was built and verified. They are
binding for every change.

## Domain conventions

- Every failing domain operation is an exact no-op: no field changes, no list reordering,
  and the adapter still acknowledges `{"ok":true}`. Rejections are never protocol errors.
- Null keeper/glyph means absence. Empty strings, whitespace and Unicode are valid keeper
  and glyph tokens and flow through every operation like any other string.
- The vault registry is fixed to `A`, `B`, `C`; no action creates or removes a vault, and
  an unknown vault ID makes the action an exact no-op.
- Glyph ownership is exclusive across bound vaults; unbound vaults hold null glyph, zero
  charge and phase 0.
- Only the fields named by an operation change; every other field and every other vault is
  preserved. List order after a successful operation is not otherwise constrained.

## Existing rules that interact with new features

- Pulse replaces charge in phase 0 and adds with a cap of 9 in phase 1.
- Rotate toggles phase. Only the phase-1 to phase-0 return applies the cap: a charge above 5
  becomes 5. Charge is otherwise unchanged by rotate.
- Transfer requires distinct bound vaults, the source keeper, different phases, a positive
  amount, enough source charge and room at the target (at most 9). Target ownership need
  not match the supplied keeper. Partial transfer, partial debit and clipping are not
  permitted; any failing condition leaves both vaults unchanged.
- Release requires charge zero and clears keeper, glyph and phase; it leaves charge zero.
- Seal requires phase 1 and charge exactly 5; while sealed, pulse, rotate, release and both
  transfer directions are exact no-ops. Unseal needs only the matching keeper.
- Trusted restart kills the process and relaunches it on the same data directory. It
  preserves keeper, glyph, charge and sealed but resets every phase to 0 and does NOT apply
  rotate's cap: a phase-1 vault with charge 9 restarts with charge 9.
- Completed actions must be persisted before they are acknowledged; persistence must not
  depend on a clean process exit.
- Reset initializes a fresh environment with all three vaults unbound. Verification always
  starts from fresh storage, so no migrations or compatibility branches for old data.

## Quarantine decisions

- Oddness is a property of the observed charge (1, 3, 5, 7, 9); the rule is checked on the
  charge as observed, not on how it was produced.
- The parity check on rotate runs after the return cap: cap first, then parity. A quarantined
  vault rotated back from charge 6 or 8 lands on 5 and remains quarantined.
- Sealed and quarantined are mutually exclusive by construction: seal is refused while
  quarantined, quarantine is refused while sealed.
- The transfer-into-quarantined rule (source must be in phase 0) only matters after a
  restart, because a quarantined vault is in phase 1 until restart resets its phase to 0.
- `clear_quarantine` has no phase or charge condition; only ownership.
- Quarantine survives restart exactly like sealed does; phase reset applies regardless.
