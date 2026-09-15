# Add resonance recovery

Add `recover(vault, keeper)` to the protocol's declared action set.

- Recover requires a bound vault, matching keeper, the vault quarantined, and resonance of
  at least 3. Sealed vaults are never quarantined, so recover never applies to them.
- On success the vault leaves quarantine (quarantined becomes false), its phase becomes 0
  and its resonance becomes 0. Keeper, glyph, charge and sealed are unchanged. Unlike
  rotate, recover never applies the return cap: a quarantined vault recovered from phase 1
  with charge 7 keeps charge 7. A vault already in phase 0 stays in phase 0.
- If any condition fails (wrong keeper, unbound, unknown, not quarantined, resonance below
  3), recover is an exact no-op.
- Resonance for recovery follows the existing rules: it is built by rotations that neither
  cap the charge nor clear the quarantine (odd resulting charge), or arrives through echo
  (which, into a quarantined vault, needs both vaults in phase 0). Because resonance is
  transient, a quarantined vault has resonance 0 after every restart and needs fresh
  resonance before it can recover.
- All fields and other vaults not explicitly affected remain unchanged.
