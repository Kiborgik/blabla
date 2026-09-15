# Add quarantine

Every observable vault now includes `quarantined: bool`. Unbound vaults are never
quarantined. Successful bind initializes quarantined to false. Add
`quarantine(vault, keeper)` and `clear_quarantine(vault, keeper)` to the protocol's
declared action set.

- Quarantine requires a bound vault, matching keeper, phase 1, an odd charge (1, 3, 5,
  7 or 9), not sealed, and not already quarantined. It sets only quarantined to true.
  Failure is an exact no-op.
- While a vault is quarantined, pulse and release on it are exact no-ops. A transfer
  whose source is quarantined is an exact no-op. A transfer into a quarantined target is
  allowed only when the source is in phase 0 and every other transfer condition holds;
  otherwise it is an exact no-op. Seal on a quarantined vault is an exact no-op, and
  quarantine on a sealed vault is an exact no-op: a vault is never both sealed and
  quarantined.
- Rotate is not blocked by quarantine. On a successful rotate of a quarantined vault the
  existing phase toggle and return cap apply first; if the resulting charge is even the
  quarantine clears, if it is odd the quarantine remains. The return cap therefore keeps
  quarantine (it lands on 5, which is odd), and a phase-0 to phase-1 rotation with an even
  charge clears it.
- `clear_quarantine` requires a bound vault and matching keeper. It sets only quarantined
  to false. Wrong keeper, unknown or unbound vault is an exact no-op. Clearing a vault that
  is not quarantined leaves its state unchanged.
- Quarantined persists across trusted process restart. Phase still resets to 0, so a
  quarantined vault sits in phase 0 after restart until it is rotated. Keeper, glyph,
  charge and sealed keep their existing persistence.
- All fields and other vaults not explicitly affected remain unchanged.
