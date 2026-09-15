
## Recovery decisions

- Recover is the only way out of quarantine besides rotate's parity rule and
  clear_quarantine; it does not check phase or charge, only quarantine, ownership and
  resonance of at least 3.
- Recover resets phase to 0 the way restart does, without rotate's return cap: charge above 5
  survives recovery unchanged.
- Recover consumes all resonance. Because resonance is transient, a quarantined vault that
  survived a restart always needs new rotations or an echo before it can recover.
- Sealed and quarantined are mutually exclusive, so recover never meets a sealed vault; no
  separate sealed rule is needed.
