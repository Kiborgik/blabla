# Private action receipt readback

Independent review by actual `gpt-6-astra/xhigh`, 2026-10-16. The server author is distinct. No production or live-world change was made by this review.

## Verdict

No bounded source blocker. The new MCP tool reuses the existing injected identity, enrollment and origin checks before database access. It accepts only a nonblank bounded command ID, preserves its exact bytes and reads only the configured world's `action:` receipt namespace. No new enrollment, credential, public receipt route or generic query surface exists.

The repository delegates to one focused reader. Its single prepared left join uses both existing primary keys and reads the world revision and receipt together, without loading state snapshots or history. Output fields are constructed explicitly. A caller-owned successful receipt returns its original accepted revision; a well-formed foreign-owned key has the same `not_found` shape as absence. Foreign response JSON is not parsed. Malformed ownership and corrupt owned success records fail explicitly rather than fabricating absence or acceptance. Stored private requests and identities are not returned or logged.

The read path never calls mutation, clock catchup or an agent policy. It writes no receipt, advances no revision and spends no tactical allowance. Existing successful retry fingerprints and write transaction behavior are unchanged. Existing MCP response construction provides `no-store` and identical structured/text result values.

## Evidence

Read the complete new reader, repository delegation, authorization/discovery/dispatch and all sixteen prospective tests. Read the full author 87-test receipt/hosting log. The independent declared sixteen-test check exercises the new boundary only.

Actual local SQLite fixtures establish two indexed lookups in one statement, no snapshot query, zero changes on every read branch, original acceptance after later commits and process restart, foreign-owner isolation, input rejection before SQL, explicit corrupt-record failures and rollback absence. An injected commit after the SELECT result is obtained demonstrates that a read can correctly return revision-zero absence even though the action commits before its response is delivered. This is a deterministic test fixture, not a statement about the uncertain live command.

Authorization tests use synthetic platform headers inside the Worker test harness. They verify application handling, not independent platform header sanitization. Existing deployed boundary evidence is separate. Source discovery, actual deployed discovery and native connector availability must each be verified before claiming this tool is usable online.

## Meaning and limits

`accepted` proves ownership of an accepted command key in the selected world. It does not identify a particular model process sharing the Site identity, or prove a lost request's content if that ID was reused. `not_found` is scoped to the observed database revision; a pending operation may commit later. It does not prove denial, rejection, cancellation or permission to retry.

No query of the live uncertain Verdant command occurred. Deployment and an authorized supported read are the useful next steps. Any future retry must retain the original authorization boundary regardless of what this read reports. No new world capability is activated by this reader.
