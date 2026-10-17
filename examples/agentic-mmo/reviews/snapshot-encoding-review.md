# Independent lossless history encoding review

Reviewed 2026-10-16 by actual gpt-6-astra/high, separate from the gpt-6-astra/xhigh codec author. I authored underlying simulation features used by the fixture, but did not author this codec, benchmark or test patch.

## Verdict

Accept the bounded research packet. No blocking defect found in the self-contained prototype or its recommendation. This does not approve a production codec, encoded writes, migration, live activation or a provider resource budget.

## Source and behavior inspected

Read the complete benchmark, ten tests and author report, plus the actual hosted-storage control generator and retry/replay accounting. Both generators execute the same seven registered releases and deterministic legal actions. The fixture has honest synthetic provenance and ends at recovery despite the newer civic catalogue being present in the source pin.

Each snapshot is independently encoded. The decoder checks envelope size before JSON parsing, strict version/fields and canonical serialization, compressed byte bounds and canonical base64, then streams compressed input in 1 KiB chunks. It rejects a decoded chunk exceeding the remaining declared output allowance before adding that chunk to retained output, cancels the reader on failure, and checks exact byte count, SHA-256 and fatal UTF-8. The encoder rejects unpaired-surrogate replacement, and the decoder preserves a UTF-8 BOM rather than silently stripping it. Hashes establish corruption detection, not authenticity against an attacker replacing both hash and data.

The check-before-retention claim is supported by source inspection and the actual guard-removal counterexample log: both expansion tests then fail because they reach the later length mismatch rather than the required decoded-limit error. The final source restores the early guard. Neither those tests nor the successful retained-byte cap bound native stream buffering, an individual delivered chunk or CPU time; the report explicitly acknowledges this.

Malformed, truncated, trailing, concatenated and corrupt streams, bad hashes/lengths, invalid UTF-8, noncanonical base64, duplicate fields, boundary multibyte input, expanded output, and expanding tiny/poorly compressible inputs are exercised. Local rejection behavior is established. Cloudflare's official [strict compression checking documentation](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#strict-compression-error-checking) confirms that compatibility behavior matters for trailing/incomplete streams. Actual managed deployment settings remain unverified, as the author correctly states.

## Accounting and conclusions

Checked the standalone JSON artifact against the report: source pin `621298ad9828fbaf65c0d216235c27c1808a39ae3f6ff9646912eac855f80a48`; raw 54,790,222 bytes; gzip binary 4,680,740 plus base64 overhead 1,561,552 plus metadata 132,000 equals 6,374,292 stored-envelope bytes. Deflate totals 6,361,292. These are the same 1,000 independent frames, with all three cumulative-byte/final-state controls compared to actual repository storage. The report correctly identifies hypothetical retained-JSON arithmetic separately from physical SQLite/provider allocation.

A raw fallback is necessary because the full envelope can expand a payload. Alternating candidate order helps measurement fairness but does not make local process CPU, sampled memory or RSS a managed-runtime estimate. The reported sample, source and environment are appropriately bounded; no universal performance gate is inferred.

Existing control tests establish raw-storage replay and duplicate-request zero writes. Byte-exact wrapping supports preserving frame content, but does not itself establish mixed-format receipt/restart/atomic-write behavior. The report leaves those as implementation gates. Its dual-reader-before-writer rollout, preservation of old rows/receipts, decoded page-byte budgets, and rollback only to a dual-reader-capable release are sound prerequisites.

## Verification

Independently ran `node --test tests/snapshot-encoding.test.ts`: all ten tests passed, including 1,000 round trips per candidate and actual repository controls. Read the full reviewer evidence log and the author's ten-test, strict-lint and two-failure guard-removal logs. The strict-lint log contains only the npm environment warning. No codec or production source was modified by this review.
