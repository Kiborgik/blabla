# Add resonance

Every observable vault now includes `resonance: int`, zero or greater with no upper bound.
Unbound vaults have resonance 0. Successful bind initializes resonance to 0. Add
`attune(vault, keeper)` to the protocol's declared action set.

- Resonance is transient. It is never persisted: after a trusted process restart every
  vault has resonance 0, while keeper, glyph, charge, sealed and quarantined keep their
  existing persistence and phase resets to 0 as before.
- A successful rotate changes resonance. When the rotation applies the return cap (the
  vault was in phase 1 with charge above 5, so charge becomes 5) resonance becomes 0.
  Every other successful rotate, in either direction, increases resonance by exactly 1.
  A failing rotate (wrong keeper, unbound, unknown, sealed) changes nothing.
- A successful pulse in phase 0, which replaces the charge, sets resonance to 0, even when
  the new charge equals the old one. A successful pulse in phase 1, which adds, leaves
  resonance unchanged. Failing pulses change nothing.
- Transfer leaves the resonance of both vaults unchanged. Seal, unseal, quarantine and
  clear_quarantine leave resonance unchanged. Rotate on a quarantined vault follows the
  rotate rule above together with the existing quarantine parity rule.
- Release sets resonance to 0 together with the existing clearing of keeper, glyph and
  phase.
- `attune(vault, keeper)` requires a bound vault, matching keeper, phase 1, not sealed, not
  quarantined, and resonance of at least 2. It adds the resonance to the charge, capped at
  9, and sets resonance to 0. Nothing else changes. Failure is an exact no-op.
- All fields and other vaults not explicitly affected remain unchanged.
