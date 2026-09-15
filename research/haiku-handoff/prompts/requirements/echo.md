# Add echo

Add `echo(source, target, keeper)` to the protocol's declared action set. Echo moves
resonance, not charge.

- Echo requires distinct existing bound vaults, keeper matching the source keeper, source
  resonance of at least 1, the same phase on source and target (unlike transfer, which
  requires different phases), neither vault sealed, and the source not quarantined. A
  quarantined target is allowed only when the source is in phase 0, exactly as for
  transfer; because the phases must also be equal, an echo into a quarantined vault
  requires both vaults in phase 0.
- On success the target's resonance becomes the sum of both resonances, with no upper
  bound, and the source's resonance becomes 0. Charges, phases, keepers, glyphs, sealed
  and quarantined flags are unchanged on both vaults, and the third vault is untouched.
- If any condition fails, echo is an exact no-op.
- Echoed resonance follows every existing resonance rule afterwards: it is consumed by
  attune, reset by the return cap or a phase-0 pulse, and lost on restart.
