# Spectator policy contract coverage

Proposal by `gpt-6-astra` (high), 2026-10-16. Research only; no UI, production,
contract or goal edits. The existing 50 web/visual tests are regression evidence,
not execution of the proposed adapter.

## Actual gap and scope

`explain goal::watchable-spectator`, `goal::public-updated-presentation` and
`goal::spectator-comfort-and-history` report these exact identities unregistered:

- `spectator::no-world-command-controls`
- `spectator::events-drive-playback`
- `spectator::version-update-reloads-once`
- `spectator::accessible-preferences`

`explain spectator::events-drive-playback` fails exact resolution.
`contracts/spectator-preview.bla` is registered structure: it establishes named
symbols/import edges for preview content, preferences and reload policy, not
these behavioral identities. `architecture.bla` establishes canonical validation
reuse by live projection. Neither proves actual browser controls or authorization.
Do not relabel those structural facts to make the unresolved goals appear held.

## Smallest owner-authored contract and binding

Add one cohesive `contracts/spectator.bla`, initially registered as draft behavior.
Use an isolated `SpectatorPolicyProbes` in `cli/spectator-probes.ts`, wire its reset,
prefixed observations and actions into the existing adapter, and add
`tests/contract-spectator.test.ts`. Preserve every campaign/feature/operation probe.
The probe imports actual `parseRelease`, `shouldReload` and
`createEventCueTracker`; synthetic releases/events are explicit policy inputs,
not model play, browser execution or a second implementation of their decisions.

### Deployment policy

Fixed current release plus mutable remote and retained attempted-build list.
`deployment_offer(kind: int)` selects a bounded representative fixture: invalid,
same build, older different build, equal-time different build, or valid newer
build. Repeated newer offers may use a fresh deterministic build/time sequence.
`deployment_poll()` invokes actual `shouldReload`, records the returned decision,
and, when true, appends that build ID retaining the last 20 just as `main.ts` does.
No real reload, session storage or network request occurs in this probe.

Fields: `reload_remote_valid`, `reload_distinct`, `reload_newer`,
`reload_attempted`, `reload_requested` (bool); `reload_requests` (int).
The first four project parsed release fields and list membership, independently
of `shouldReload`; the last two record its actual returned decision and count.

Proposed exact rule under `when deployment_poll`:

```text
expect "version-update-reloads-once":
  after.reload_requested == (before.reload_remote_valid and before.reload_distinct and before.reload_newer and not before.reload_attempted)
expect "reload-request-count-matches-policy":
  after.reload_requested and after.reload_requests == before.reload_requests + 1 or not after.reload_requested and after.reload_requests == before.reload_requests
```

The existing identity is justified only if the owner explicitly defines it as
this **reload-request policy**, with browser integration reviewed separately.
Otherwise choose a narrower rule name and deliberately update the goal reference;
do not silently redefine a claim of actual page reload. This predicate is not a
permanent once-ever guarantee: `main.ts` stores only the last 20 IDs in session
storage, writes the attempt before reloading, and catches storage failures. Test
attempt retention/eviction explicitly without asserting that evicted IDs stay
suppressed. Actual preference save, session persistence, navigation and deployment
availability require browser integration evidence.

### Event cue policy

Persistent actual tracker, explicit run identity and synthetic typed `GameEvent`
window. Reset leaves the tracker unobserved. Actions:

- `cue_poll()`: observe the unchanged current window.
- `cue_append(kind: int)`: append a fresh recognized event or unknown-type event,
  retain the last 96, then call the real tracker.
- `cue_flood()`: supply 100 fresh recognized events with deterministic priorities,
  then call the tracker; the helper itself selects its last-96 input window.
- `cue_new_run()`: change identity with the existing window and call the tracker.

Fields: `cue_count: int`, `cue_ids_from_window: bool`,
`cue_ids_not_in_previous_window: bool`, `cue_first_observation: bool`,
`cue_appended_known: bool` (the selected append fixture is a recognized event type).
The two membership fields compare actual returned IDs to the current last-96 and
previous observed windows; they never construct the returned cues themselves.
Capture whether the tracker has seen this run before calling it, including the
initial unobserved state. Reset all fixture state deterministically.

```text
always "events-drive-playback" {
  cue_count >= 0 and cue_count <= 3 and cue_ids_from_window and cue_ids_not_in_previous_window
}
when cue_poll { expect "unchanged-events-do-not-replay": after.cue_count == 0 }
when cue_new_run { expect "new-run-history-does-not-replay": after.cue_count == 0 }
when cue_append {
  expect "new-recognized-event-emits-cue": before.cue_first_observation or not after.cue_appended_known or after.cue_count == 1
}
```

Initialize the membership booleans true for an empty result. Add a first-observation
rule for append/flood: `not before.cue_first_observation or after.cue_count == 0`.
Require a positive cue witness after priming the tracker; zero-output-only checks
would be vacuous. Unit tests must check exact returned IDs, importance ordering,
unknown-event omission, unchanged-poll suppression, new-run suppression, last-96
selection, maximum three cues and unmodified source events. Deduplication is only
against the immediately previous window: an old ID absent from that window can
reappear. Do not claim permanent deduplication or guaranteed display of every
event. The helper selects cues; it does not prove rendering, animation timing,
visibility, accessible narration or a delivered frame.

## Remaining claims and evidence

`no-world-command-controls` stays unresolved in this first increment. Read
`web/main.ts`: current polling uses GET `/api/world`; handlers control camera,
inspection, layers, settings and dialogs. That is useful source review, not a
universal executable guarantee. A future bounded browser/request-capture test
should exercise rendered controls and assert no mutation requests, paired with
server authentication tests for unauthorized mutation. Browser control coverage
and server authorization are distinct responsibilities. Import forbids alone
cannot detect inline `fetch` mutations or prove the absence of arbitrary controls.

`accessible-preferences` also stays unresolved. Existing `parsePreferences` tests
cover schema rejection, clamping, compatible round trips and omission of world
state; `resolveAppearance` tests cover theme selection and reduced-motion override.
`mountViewerSettings` uses native selects and device media queries. These support
future narrowly named policy bindings, not complete keyboard/tap/focus/contrast
or screen-reader usability claims. Existing mathematical contrast/target-size
checks and actual visual reviews remain useful but are not universal accessibility
proof. `hosting::bounded-history-pages` belongs to the host, not this contract.

## Prospective acceptance

Owner authors and checks the draft before implementation. Add meaningful RED tests
through the existing adapter entry point, then actual helper bindings and GREEN.
Test reset, identical sequences and two-way isolation from all prior probe worlds.
Reuse the current web/visual regression suites; no broad audit is required. Promote
only after independent review and canonical nonvacuous witnesses. Appearance,
public no-auth delivery and goal outcome acceptance remain separate owner checks.
