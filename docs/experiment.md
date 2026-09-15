# Low-effort Todo experiment

Status: execution protocol prepared; no model outcomes measured yet. Start only after Milestone 1 acceptance.

## Questions and fixed conditions

First, can one Luna/low agent implement and repair a Todo application from a short request plus a precise contract? Second, does contract/verifier feedback reduce accumulated regressions during matched modifications?

Use `gpt-5.6-luna`, reasoning `low`, throughout the subject runs. Root administers, snapshots and scores; root never repairs subject implementations or adds implementation hints. Model availability is confirmed by the current collaboration allowlist; no claim is made that this is empirically the weakest possible model.

Keep the existing Todo `.bla` contract fixed. Added feature requirements are given identically as prose in both conditions; the experiment deliberately measures preservation of the existing core behavior as implementation changes. The independent scorer also checks the new requirements, so ignoring requested changes cannot count as successful work. New actions can expose gaps outside the frozen contract's generated action space; report those outcomes explicitly.

Use ordinary isolated task directories under `artifacts/experiment/`, never Git worktrees. Each subject may edit only its assigned application directory. Keep the contract, scorer, source baselines, prompts, reports and other conditions outside its owned files. Fresh contexts must not receive another condition's outcomes or code. Audit available tool transcripts and file changes; instruction-based separation is not a security sandbox claim.

## Pilot

Initial request:

> Build a simple Todo app. Support adding, completing, deleting, and keeping tasks after restart. Expose it through the supplied JSON Lines protocol. The attached contract defines the required behavior. Keep that contract unchanged.

Provide the fixed protocol instructions and a command invoking the accepted verifier with the absolute application path. The subject can read the contract. Capture its first implementation before verifier-driven repairs. Then allow at most five edit/verify repair rounds, preserving code and actual verifier output after each. If the first attempt passes, record zero repairs rather than inventing a failure. A missing or unrunnable implementation counts as a failed attempt.

Use an administratively bounded turn for each submission: one first implementation, then one repair submission at a time to the same warm subject. Return exact verifier output without extra advice. The subject may perform its own local tests, but must preserve its submitted snapshots. Each submission has a ten-minute wall-clock ceiling and a requested cap of 20 tool calls. Root enforces the wall-clock ceiling using the live agent handle; tool counts are measured/enforced only if authoritative transcript telemetry is available. Do not claim a hard tool/token cap when the runtime cannot enforce it. No more than five repair submissions are allowed even if resources remain.

## Paired drift runs

Three pairs, each with control and BlaBla conditions. Both begin from byte-identical copies of the independently verified normal Todo source. A pair shares the same modification order, instructions, verifier-independent scoring sequences, resource rules, and planned context resets.

Control receives the complete core requirement prose below and ordinary development tools. BlaBla receives identical prose plus the fixed `.bla` file and accepted verifier command. Both can write and run ordinary tests. The control must not invoke/read BlaBla or the held-out scorer. The treatment may run BlaBla; neither gets held-out scoring feedback while its trajectory is active.

Every modification is one bounded submission plus up to two self-directed follow-up repair submissions if the subject says its own checks failed. Use the same ten-minute submission ceiling and requested 20-call cap in both conditions. Preserve each first and final submission. Subject completion claims do not determine scores. Failed and unfinished submissions remain in the dataset and count against requested-change completion; do not silently restart a trajectory from a clean solution.

Continue in the same subject context for steps 1–2, start a fresh subject context for steps 3–4, and start another fresh context for steps 5–6. Each fresh context receives its own current source, all accumulated prose requirements, and only the tools/files appropriate to its condition. It receives no previous conversation or strong-model guidance. Root snapshots after every step, before independent scoring.

## Core requirement prose supplied to both conditions

- Observe an ordered list `todos`; each item has integer `id`, string `text`, and Boolean `done`. The adapter may expose additional fields. Core checks observe these declared fields.
- Reset creates the clean initial application state in the isolated working directory. Observation is read-only and reflects real application state.
- `add(text)` with nonempty text adds exactly one new item, whose ID is not currently present, whose text exactly matches the input, and whose done value is false. Preserve every existing item's ID, text, and done value. Duplicate texts and whitespace-only text are allowed.
- `add("")` preserves the complete core observable state, including list order.
- `complete(id)` sets the existing target's done value to true, preserving its ID/text, the item count, and all other items. A missing target preserves complete core state, including order. Completing an already completed item leaves it completed.
- `remove(id)` removes the target if present, preserves every other item, and introduces no new item. A missing target preserves complete core state, including order.
- `restart()` discards in-memory state and reloads actual persisted data. Preserve the complete core observation, including order. Restart is not reset.
- IDs are unique among current items, initially and after every action. No item may have empty text, initially or after any action. Historical non-reuse is not required.
- Successful add/complete/remove have only the order restrictions stated above. Keep the JSON Lines adapter actions compatible with these requirements as internals change.

## Protocol instructions supplied to both conditions

Launch with `python <absolute app.py path>`. Use Python standard library only. Application data belongs in cwd, which is a fresh isolated verification directory; application source lives elsewhere. Read UTF-8 JSON Lines from stdin and flush exactly one JSON response to stdout for every request. Echo the request's opaque `id` and place the response value inside `result`. Logs go to stderr. Exit cleanly when stdin closes; do not emit unsolicited or trailing stdout.

Requests are `{"id":"r1","op":"reset"}`, `{"id":"r2","op":"call","name":"add","args":["milk"]}`, and `{"id":"r3","op":"observe"}`; actual IDs are opaque strings chosen by the caller. Reset and calls return `{"id":<echoed id>,"result":{"ok":true}}` after completion, including intentional domain no-ops. Observe returns `{"id":<echoed id>,"result":{"todos":[...]}}` with real current state. Bad protocol requests may put `{"ok":false,"error":"explanation"}` inside result. Core action signatures are add(string), complete(int), remove(int), and restart(). Operations are synchronous. This transport instruction is identical in both conditions.

## Six fixed requests

1. **Priorities.** Add an observable integer `priority` to every todo, default 1. Values 0, 1, and 2 are valid. Add `set_priority(id, priority)`; update only an existing target with a valid value, otherwise do nothing. Persist priorities across restart. Preserve all core behavior.
2. **Filtering.** Add `filter(mode)` for `all`, `active`, and `completed`; invalid modes do nothing. Observe `filter_mode` and `visible_todos` as well as the complete unfiltered `todos`. Visible todos preserve their order from todos and match the selected done state. Reset and restart set filter mode to all. Filtering must never delete data or change complete/remove lookup scope. Preserve priorities and all core behavior.
3. **Tags.** Add observable `tags`, default an empty list. Add `tag(id, text)` and `untag(id, text)`. Tag appends a nonempty, case-sensitive tag once; empty or duplicate tags and missing IDs do nothing. Untag removes that tag if present; otherwise do nothing. Preserve tag order and persist tags across restart. Preserve filtering, priorities and all core behavior.
4. **Persistence format.** Store current todos in `todos.jsonl`, one JSON object per line, replacing the previous JSON-array document. Empty storage may be an empty file or absent. Reset removes current persisted items; restart reloads them. No migration, legacy reader or compatibility branch is needed. Preserve all accumulated behavior and the public observation shape.
5. **Storage refactor.** Move persistence implementation into `storage.py` and centralize load/save/reset there. Keep `app.py` as the executable entrypoint. Preserve the JSONL format and all accumulated behavior. Do not add third-party dependencies.
6. **Representation and module split.** Represent each Todo using a dataclass in `domain.py`, put JSONL protocol dispatch in `adapter.py`, and retain `app.py` as the entrypoint. Keep the external request and observation formats unchanged. Preserve the storage module and every accumulated behavior.

## Independent scoring

Implement the scorer directly from these requirements, without importing BlaBla parser, IR, evaluator, generator, shrinker, or subject domain helpers. Drive the actual adapter protocol and inspect real observations. Hold its implementation and results out of subject contexts. Use literal expected outcomes and state comparisons derived from the prose, not an output produced by BlaBla.

Score each saved first and final submission on the current feature set and all earlier required behavior. Include invalid/missing IDs, empty and duplicate text, repeated completion/removal, nonempty restart, unrelated-item preservation, unique identity, priority bounds/persistence, filtering followed by mutation, tag deduplication/removal/persistence, and cross-feature restart. Check the requested file-format and module changes as separate completion evidence, so returning an unchanged baseline is not credited.

Record old-behavior violations at each checkpoint and the unresolved violations after subject repairs. Accumulated regression rate is the sum of failed applicable old-behavior checks divided by all applicable old-behavior checks across checkpoints; additionally report each named behavior's failed-checkpoint count and raw paired results. Keep newly requested feature completion separate from regression preservation.

Unavailable/unrunnable applications cannot pass any applicable behavior check. Preserve infrastructure failures separately and investigate them; do not relabel application crashes as harness errors to remove poor outcomes. Report time and steps as observed; mark unavailable token telemetry as unavailable. Concurrent execution can confound elapsed-time comparisons, so elapsed time is descriptive unless scheduling supports stronger attribution.

Do not make a general reliability claim from three pairs. Report whether this pilot supports further investigation and which failures escaped the frozen contract.
