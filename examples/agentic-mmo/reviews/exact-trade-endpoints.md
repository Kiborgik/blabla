# Exact trade endpoints: independent implementation review

Reviewed 2026-10-16 13:42 UTC by gpt-6-astra, independently of the implementation author. The intended gameplay direction was previously supplied by this reviewer; this review checks the actual implementation and evidence.

## Verdict and scope

No blocking correctness finding in the bounded exact-town increment. Inspected shared action parsing, plan identity/revalidation, trade choice generation and execution, the additive release definition and all nine endpoint tests. Read the complete author 125-test log and scoped strict lint output. No production source was changed. Compact observation scaling needs the concrete follow-on below; the measured large fixture must not be presented as a compactness success.

## Exact consent without substitution

New-release proposals require both `sourceCityId` and `recipientCityId`. Strict parsing rejects one-sided fields, blank identities and unknown extras. Legal choices enumerate owned source towns and towns owned by the selected recipient. Execution resolves those exact IDs, rather than falling back to a capital or first surviving city. The shared action comparison includes both endpoint identities, so a plan head cannot substitute a different source or destination while retaining the same partner and recipe.

Pending offers store the exact selected town IDs with their existing cloned recipe terms. Acceptance rechecks those towns and their ownership. A missing offered endpoint refuses the action even if another eligible city exists; no stock or admission state changes. Reordering the city array between proposal and acceptance does not change the agreed endpoints. The planner reports unavailable exact targets without executing a replacement.

The compact explanation includes canonical terrain, deposit and base production facts through the shared site helper, plus explicitly labeled straight-line hex distance. It says that distance is neither a traversed path nor travel time and that supplies remain civilization-wide. The increment does not create town-local inventories, new transport costs, faster cargo, terrain paths or Navigation.

## Compatibility

The registered endpoint successor is explicit and additive after the charter release. Applying it preserves cities, civilizations, tiles, routes, pending offers, public commitments and independent timing state. Earlier releases keep untargeted first-city proposal semantics and reject the new targeted form as an unavailable action. New releases reject an untargeted proposal rather than silently selecting a town.

Previously accepted routes keep their original endpoint IDs, terms and scheduling. An unexpired older pending offer can still be accepted after the upgrade using its already recorded towns, even when the city array has been reordered. No new endpoint requirement is retroactively imposed on that original consent record.

## Legal witness and synthetic probes

One witness starts from an ordinary seeded world, applies the registered compatible release chain and uses actual legal conserved founding actions for two civilizations. It creates two noncapital towns without editing stocks, population or geography, then proposes and accepts an exchange between exactly those new towns. The submitted plan matches the exact proposal. Each accepted command is compared with the same command against a detached clone, and the resulting canonical state validates.

That witness proves legal founding-to-consent reachability. It does not itself wait for a shipment, prove host command-ID deduplication or perform a JSON serialization round trip. Existing delivery, historical replay and persistence evidence retain their separate scope; the new implementation intentionally leaves the shipment resolver unchanged.

The other multicity, missing-town and scale fixtures are explicitly synthetic. Their added towns and adjusted population/buildings are not claimed as a naturally reached campaign. They check refusal atomicity, ownership, array-order independence, legacy behavior, grandfathered quotes and the complete candidate set. The detached-state comparison proves deterministic engine results for the checked command, not autonomous model strategy or online activation.

## Measured observation growth

The author diagnostic reports the actual finite fixture sizes:

- Five cities: four trade proposals, ten total legal choices, 10,660 observation bytes and 4,742 choice bytes.
- Twenty-five cities: one hundred trade proposals, 122 total legal choices, 96,247 observation bytes and 89,616 choice bytes.

Every eligible pair remains available; the test does not hide growth with an arbitrary truncation. Repeating both towns' site descriptions for every pair accounts for substantial avoidable payload. These measurements are not a universal maximum, hosted response size, latency benchmark or proof of a resource budget. No new byte threshold is invented by this review.

The useful successor is a factored compact observation: publish each town's canonical site facts and each recipe's terms once, then reference those identities from exact choices. Preserve the complete candidate set, existing exact typed commands and explanatory availability. If paging is later necessary, it needs an explicit query/selection protocol rather than silently dropping options. Measure before/after on the same five- and twenty-five-city fixtures, including the actual host envelope, before claiming a speed or token improvement.

## Verification and remaining boundary

The complete author log is `specify-exact-trade-endpoints/evidence-3-2-1792157876196906578.log`, with 125 passing tests; its scoped lint output has no failure diagnostic. The independent review runs only the declared nine endpoint tests and reads the complete result. Wider engine, planning, charter, visual and hosted suites are not repeated merely to re-prove unchanged behavior.

The inhabited world remains on foundations capabilities until an authorized release is applied. This report does not authorize activation or claim live town-to-town trade. The separately prepared geographic transport design is a future connected outcome; observation factoring can improve the current exact-choice interface without waiting for that larger mechanic.
