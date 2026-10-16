# Lossless history encoding comparison

Measured 2026-10-16T12:34:37.062Z by actual gpt-6-astra/xhigh. This is an isolated synthetic research prototype, not a production codec, live database measurement or deployed migration.

## Recommendation

Prefer a **versioned self-contained gzip snapshot envelope**, with a raw-storage fallback whenever the complete envelope is larger. At 1,000 frames, it retains every logical snapshot in **6,374,292 bytes instead of 54,790,222 bytes: 88.37% less**, including base64 and metadata. Deflate saves only another 13,000 bytes, about 0.2% of the gzip envelope total; this does not justify a second production codec initially. Both use standard APIs without an added dependency.

Unlike checkpoint omission, decoding needs no historical game interpreter or mutable catalogue. The original world JSON remains byte-exact. This is a recommendation for a separately reviewed implementation; no storage row was changed, removed or rewritten.

## Source, control and reproduction

Run `node benchmarks/snapshot-encoding.ts` from the example root. It prints the source manifest, workload, accounting, timing and memory observations. Verification: `node --test tests/snapshot-encoding.test.ts` and `npx --no-install vp lint benchmarks/snapshot-encoding.ts tests/snapshot-encoding.test.ts`.

Source SHA-256: `621298ad9828fbaf65c0d216235c27c1808a39ae3f6ff9646912eac855f80a48`. Node v24.19.0, Linux x64. The source pin includes the new civic catalogue, but the fixture still applies exactly seven releases ending at `settlement-recovery-1`. No civic release is applied.

The real pure engine regenerates the earlier seed-1701, five-city fixture: seven releases, then six scripted legal actor commands and one strategy beat repeatedly. Tests independently compare the 10/100/1,000-transition cumulative raw snapshot bytes and final-state hashes with the actual repository/SQLite benchmark. All three controls are unchanged after the civic additions: 251,422 / 4,760,485 / 54,790,222 snapshot bytes. Every generated frame is encoded and decoded independently with exact string and native UTF-8 byte checks. No previous frame or dictionary is needed. The generator is artificial test activity, not model play.

## Complete storage cost

Totals across all 1,000 frames; decimal bytes:

| Component | gzip | deflate |
|---|---:|---:|
| Raw UTF-8 snapshots | 54,790,222 | 54,790,222 |
| Compressed binary | 4,680,740 | 4,668,740 |
| Base64 expansion beyond binary | 1,561,552 | 1,557,552 |
| Version/codec/length/hash/JSON metadata | 132,000 | 135,000 |
| Complete stored envelope | **6,374,292** | **6,361,292** |
| Largest raw frame | 56,000 | 56,000 |
| Largest envelope | 7,888 | 7,875 |

Leaving initial/current state, commands, events, provenance and receipts untouched would project the earlier fixture's total retained JSON from 56,115,837 to **7,699,907 bytes** with gzip. That is hypothetical payload arithmetic; it excludes SQL/index overhead and migration mechanics. All exact retry evidence remains. A proposed new format must measure its actual storage representation again.

Tiny and deterministic poorly compressible inputs expand under both envelopes; tests preserve their exact bytes. Therefore the recommendation requires an explicit raw fallback rather than promising compression always saves space. The prototype measures that case but does not implement a production format selector.

## Executable bounds and corruption checks

The research envelope contains only version, codec, UTF-8 byte length, SHA-256 and canonical base64. Limits are 128 KiB uncompressed, 144 KiB compressed and 200 KiB envelope. Oversized envelope text is rejected before JSON parsing; oversized declared output and encoded payload are rejected before decompression. These are fixture/prototype limits, not approved maximum world sizes.

The decoder feeds compressed input in 1 KiB chunks. It checks each output chunk against the declared allowance **before retaining it**, cancels on overflow/error, and verifies exact decoded length, hash and fatal UTF-8 decoding. Tests cover boundary-sized multibyte text, a 512 KiB expansion claiming 32 bytes, malformed metadata/base64, duplicate fields, truncated streams, corruption, trailing bytes, concatenated streams and wrong hashes/lengths. A deliberate removal of the streaming limit makes both expansion tests fail at the expected boundary; restored code passes. SHA-256 detects accidental corruption, not authenticity when an attacker can replace both payload and hash. World-schema validation and revision consistency remain necessary after decoding.

The JavaScript retained output is bounded, but stream internals and a delivered chunk are runtime-owned. The largest observed valid output chunk was 16,384 bytes; that is not a portable hard native-memory bound. No CPU deadline is inferred from byte limits.

## Runtime evidence and local resource observations

Official [Workers web standards](https://developers.cloudflare.com/workers/runtime-apis/web-standards/#compression-streams) document gzip/deflate streams, base64 helpers and UTF-8 APIs; [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) documents SHA-256. [Node's streams documentation](https://nodejs.org/api/webstreams.html#class-compressionstream) and the actual local run establish Node support. No package was fetched. Workers also exposes [strict compression checks](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#strict-compression-error-checking), which matter for incomplete/trailing input. The [compression standard](https://compression.spec.whatwg.org/#supported-formats) specifies those failure conditions. **This managed Sites deployment, its compatibility settings and quotas were not verified.**

Candidate order alternates by frame. The measured gzip encode/decode medians were 1.05/0.97 ms; p95 2.00/1.87 ms. Deflate medians were 1.04/0.96 ms; p95 2.21/1.89 ms. Summed process CPU sampled around the 1,000 encode/decode pairs was 2.751 seconds for gzip and 2.906 seconds for deflate. These include process effects such as GC and are observations, not timing pass thresholds, concurrency capacity or Worker CPU predictions. [Node CPU accounting](https://nodejs.org/api/process.html#processcpuusagepreviousvalue).

The standalone process started at RSS 79,360,000 bytes, sampled at most 188,997,632 after frames, and reported process high-water RSS 189,128,704 bytes. Sampled heap peaked at 45,521,808 bytes and array buffers at 21,547,287. This includes engine generation, both codecs, startup and garbage collection. It is not isolated codec memory or peak Worker memory. The local OS constraint query returned zero, meaning unavailable/unknown constraint information, not unlimited memory. [Node resource accounting](https://nodejs.org/api/process.html#processresourceusage). Production read concurrency and page sizes need separately measured limits.

## Safe implementation gate

1. Verify the actual managed runtime with a permitted synthetic probe, including strict malformed/trailing rejection and memory/CPU observability. Do not infer Sites support or quotas from generic Workers documentation.
2. Design an explicit storage format and deploy readers supporting both legacy raw frames and new envelopes **before** enabling encoded writes. Retain every existing raw snapshot and receipt; keep initial/current state unchanged initially. Old binaries cannot read the new envelope, so rollback must target a dual-reader-capable release, not silently revert to an old reader.
3. Encode only future frames when complete-envelope bytes beat raw bytes. Keep each frame independent, validate its decoded world/revision, preserve atomic state/transition/receipt writes, and prove mixed-format history, replay, restart and exact retries. Bound decoded bytes per page as well as row count; never decode a whole history concurrently.
4. Exercise failures and rollback before activation. No checkpoint omission, historical rewrite, live migration, deletion or receipt pruning belongs to this research result.
