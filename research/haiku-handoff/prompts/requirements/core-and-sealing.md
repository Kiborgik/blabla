# Glyph Vault: behavioral requirements

Glyph Vault has exactly three vaults with case-sensitive IDs `A`, `B`, and `C`.
No action creates or removes a vault. Unknown vault IDs make domain actions exact no-ops.
Each observation contains `vaults`, a list of records with `id`, `keeper`, `glyph`,
`charge`, and `phase`. Keeper and glyph are nullable strings. Charge is an integer
from 0 through 9. Phase is either 0 or 1. All strings, including empty strings,
whitespace, and Unicode, are valid keeper/glyph tokens. Null means absence; an empty
string does not mean absence. Inputs are the declared string and JSON-safe integer types.

An unbound vault has null keeper and glyph, zero charge, and phase 0. A bound vault
has non-null keeper and glyph; its charge may be zero. Every non-null glyph is held
by at most one vault. These constraints hold after reset and every operation.

All failing domain operations are exact no-ops: no field or list ordering changes.
On a successful operation, every field and every other vault not explicitly affected
below is preserved. List order on successful operations is not otherwise constrained.

- `bind(vault, keeper, glyph, charge)` requires an existing unbound vault, a glyph
  not held by another vault, and charge from 1 through 9 inclusive. It sets the supplied
  keeper, glyph, and charge and sets phase to 0. Otherwise it is an exact no-op.
- `pulse(vault, keeper, amount)` requires a bound vault, matching keeper, and amount
  from 0 through 9 inclusive. In phase 0 it replaces charge with amount. In phase 1
  it adds amount to charge, capped at 9. Otherwise it is an exact no-op.
- `rotate(vault, keeper)` requires a bound vault and matching keeper. It toggles phase.
  When the old phase was 1 and the new phase is 0, charge greater than 5 becomes 5.
  In every other case charge is unchanged. Wrong keeper/unbound/unknown is an exact no-op.
- `transfer(source, target, keeper, amount)` requires distinct existing bound vaults,
  keeper matching the source keeper, different source/target phases, positive amount,
  enough source charge, and room for the full amount at the target without exceeding 9.
  If all conditions hold, subtract amount from source and add it to target atomically.
  Target ownership need not match the supplied keeper. If any condition fails, neither
  vault nor anything else may change. Partial transfer, partial debit, and clipping
  the amount are not permitted.
- `release(vault, keeper)` requires a bound vault, matching keeper, and charge zero.
  It clears keeper and glyph, leaves charge zero, and resets phase to 0. Otherwise
  it is an exact no-op.
- Trusted process `restart` terminates the process and launches a fresh process using
  the same data directory, without reset. It preserves every vault's ID, keeper,
  glyph, and charge, but resets every phase to 0. This does not apply rotate's cap:
  restarting a phase-1 vault with charge 9 preserves charge 9. Completed actions must
  persist before acknowledgement; persistence cannot depend on clean process exit.

The adapter uses UTF-8 JSONL on stdin/stdout, one flushed response per request.
Requests carry `id` plus `op`: `reset`, `observe`, or `call`. Calls carry `name` and
positional `args`. Responses echo `id` and put the acknowledgement or observation in
`result`. Domain no-ops acknowledge `{"ok":true}`. Logs use stderr, never stdout.
Close cleanly on stdin EOF. Test storage is relative to the working directory.

Reset initializes a fresh test environment. The clean implementation initializes all
three vaults unbound. The compared executable authorities check the registry and state
invariants after reset and then model all transitions; they do not add a separate
reset-only initial-content predicate. Fresh test directories are used consistently.

# Add sealing

Start from the clean pre-feature Glyph Vault implementation. Add the behavior below
while preserving all existing requirements and the documented architecture. Modify
application code, not the supplied behavioral authority. Do not add migrations or
compatibility branches for old test data; every verification case starts from fresh storage.

Every observable vault now includes `sealed: bool`. Unbound vaults are unsealed.
Successful bind initializes sealed to false. Add `seal(vault, keeper)` and
`unseal(vault, keeper)` to the protocol's declared action set.

- Seal requires a bound vault, matching keeper, phase 1, charge exactly 5, and not
  already sealed. It sets only sealed to true. Failure is an exact no-op.
- While sealed, pulse, rotate, and release are exact no-ops. Transfer is an exact
  no-op if either source or target is sealed. All other existing guards still apply.
- Only the matching keeper of a bound vault may unseal it. Unseal sets only sealed
  to false; wrong keeper/unknown/unbound is an exact no-op. Unsealing an already
  unsealed vault leaves its state unchanged.
- Sealed persists across trusted process restart. Phase still resets to 0, even
  for sealed vaults. Keeper, glyph, and charge retain their existing persistence.
- All fields and other vaults not explicitly affected remain unchanged.

Implement through the existing model, domain, persistence, and protocol boundaries.
Keep main as composition rather than moving business rules into it.

