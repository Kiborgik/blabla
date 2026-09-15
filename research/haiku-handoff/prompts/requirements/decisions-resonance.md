
## Resonance decisions

- Resonance is transient by decision, like phase: it is never written to storage, and every
  vault has resonance 0 after a trusted restart. Do not persist it "for safety".
- The rotate rule looks at whether the rotation reduced the charge, not at the direction of
  the rotation: a phase-1 to phase-0 return with charge 5 or less builds resonance like any
  other rotate; only a return that caps a charge above 5 resets it to 0.
- A phase-0 pulse resets resonance to 0 regardless of whether the charge value changed
  (pulsing 4 onto a charge of 4 still resets). A phase-1 pulse never touches resonance.
- Resonance has no upper bound. Attune's cap of 9 applies to the charge only.
- Attune requires phase 1 so that the added charge follows the additive (phase-1) pulse
  semantics; quarantine and seal block attune exactly as they block pulse.
- Transfer moves charge only; both vaults keep their resonance. Rotating a quarantined vault
  builds or resets resonance by the same rule as any other vault, independently of whether
  the parity rule clears the quarantine.
