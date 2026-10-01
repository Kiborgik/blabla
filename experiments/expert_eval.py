import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "evals" / "expert-loop"
FAMILIES = ("goal-drift", "expertise", "claim-support", "failed-approach")
ARMS = ("off", "shadow", "advisory")
LIVE_KINDS = {"matched_live_pilot", "matched_live_expanded"}
COMPONENTS = ("retrieval_ms", "inference_ms", "queue_ms", "delivery_ms")
MAX_FILE_BYTES = 8 * 1024 * 1024


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key: " + key)
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("non-finite JSON number: " + value)


def parse_json(contents):
    return json.loads(contents, object_pairs_hook=unique_object, parse_constant=reject_constant)


def bounded_bytes(path):
    path = Path(path)
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("input file exceeds byte budget")
    contents = path.read_bytes()
    if len(contents) > MAX_FILE_BYTES:
        raise ValueError("input file exceeds byte budget")
    return contents


def read_json(path):
    return parse_json(bounded_bytes(path))


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def file_hash(path):
    return hashlib.sha256(bounded_bytes(path)).hexdigest()


def number(value, minimum=0, maximum=None):
    try:
        valid = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value) and value >= minimum
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError("invalid finite nonnegative number")
    if maximum is not None and value > maximum:
        raise ValueError("number exceeds maximum")
    return value


def integer(value):
    number(value)
    if not isinstance(value, int):
        raise ValueError("nonnegative integer count required")
    return value


def validate_fields(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ValueError("invalid object fields; missing or unknown protocol keys")
    return value


def validate_protocol(protocol):
    validate_fields(protocol, ("schema_version", "protocol_id", "status", "approved_by", "approved_utc", "evidence_kind", "datasets", "budgets", "quality_interval", "latency_quantile", "calibration", "budget_rationale", "host", "pilot", "expanded", "promotion"))
    validate_fields(protocol["datasets"], ("development", "holdout"))
    for dataset in protocol["datasets"].values():
        validate_fields(dataset, ("manifest_sha256",))
    validate_fields(protocol["budgets"], FAMILIES)
    for budget in protocol["budgets"].values():
        validate_fields(budget, ("false_nudge_max", "p95_delivery_ms", "min_delivered_nudges", "min_justified_opportunities", "min_evaluable_coverage"))
    validate_fields(protocol["quality_interval"], ("method", "confidence", "zero_denominator", "ungraded_nudges"))
    validate_fields(protocol["calibration"], ("allowed_split", "candidate_thresholds", "signal", "holdout_access"))
    validate_fields(protocol["budget_rationale"], ("false_nudge", "latency", "timing_evidence_kind", "timing_evidence_sha256"))
    validate_fields(protocol["host"], ("status", "capabilities", "stop_reason", "evidence_path", "evidence_sha256"))
    validate_fields(protocol["host"]["capabilities"], ("host", "version", "adapter", "checkpoints", "pauses_worker", "same_task_delivery", "delivery_receipts", "pre_tool_control", "gaps"))
    validate_fields(protocol["pilot"], ("phase", "task_id", "task", "arms", "order", "runs_per_arm", "max_wall_ms", "call_limit_per_arm", "cost_limit_per_arm", "snapshot_files", "controls", "grading", "stop_reasons", "promotion_eligible"))
    validate_fields(protocol["pilot"]["controls"], ("worker", "tools", "host", "onboarding", "rules", "environment"))
    validate_fields(protocol["pilot"]["grading"], ("correctness", "scope", "owner_interventions", "steering_ms", "rework_ms", "acknowledgment"))
    validate_fields(protocol["expanded"], ("status", "stop_reason", "promotion_eligible"))
    validate_fields(protocol["promotion"], ("required_evidence_kind", "requires_independent_correctness_and_scope", "requires_observed_steering_reduction", "replay_fixture_pilot_allowed"))
    if protocol.get("schema_version") != 1 or protocol.get("status") != "frozen" or not protocol.get("approved_by"):
        raise ValueError("protocol must be frozen and approved before calibration")
    if set(protocol.get("budgets", {})) != set(FAMILIES):
        raise ValueError("per-family budgets required")
    for budget in protocol["budgets"].values():
        number(budget["false_nudge_max"], 0, 1)
        number(budget["p95_delivery_ms"], 1)
        number(budget["min_evaluable_coverage"], 0, 1)
        for name in ("min_delivered_nudges", "min_justified_opportunities"):
            if isinstance(budget[name], bool) or not isinstance(budget[name], int) or budget[name] < 1:
                raise ValueError("positive integer sample floor required")
    interval = protocol.get("quality_interval", {})
    if interval.get("method") != "exact-one-sided-clopper-pearson":
        raise ValueError("unsupported quality interval")
    number(interval["confidence"], 0.5, 0.999999)
    if protocol.get("latency_quantile") != "nearest-rank":
        raise ValueError("unsupported latency quantile")
    if protocol["calibration"].get("allowed_split") != "development" or protocol["calibration"].get("holdout_access") is not False:
        raise ValueError("calibration requires development only")
    for threshold in protocol["calibration"]["candidate_thresholds"]:
        number(threshold, 0, 1)
    if protocol["pilot"]["arms"] != list(ARMS) or protocol["pilot"]["order"] != list(ARMS) or protocol["pilot"]["runs_per_arm"] != 1:
        raise ValueError("bounded pilot requires one fixed-order run per arm")
    number(protocol["pilot"]["max_wall_ms"], 1, 600000)
    if protocol["pilot"].get("promotion_eligible") is not False:
        raise ValueError("pilot cannot promote")
    return protocol


def load_protocol(path):
    return validate_protocol(read_json(path))


def load_split(path, protocol, expected_split):
    path = Path(path)
    manifest_path = path / "manifest.json"
    manifest = read_json(manifest_path)
    validate_fields(manifest, ("schema_version", "split", "evidence_kind", "label_author", "count", "files", "case_ids"))
    if expected_split not in ("development", "holdout") or manifest.get("split") != expected_split:
        raise ValueError("expected " + expected_split + " split")
    expected = protocol["datasets"][expected_split]["manifest_sha256"]
    if file_hash(manifest_path) != expected:
        raise ValueError("frozen split manifest fingerprint mismatch")
    if set(manifest["files"]) != {"cases.jsonl", "observations.jsonl"}:
        raise ValueError("unexpected split files")
    records = {}
    for filename, digest in manifest["files"].items():
        contents = bounded_bytes(path / filename)
        if hashlib.sha256(contents).hexdigest() != digest:
            raise ValueError("frozen split data fingerprint mismatch")
        records[filename] = [parse_json(line) for line in contents.splitlines() if line.strip()]
    cases = records["cases.jsonl"]
    ids = [case["case_id"] for case in cases]
    if ids != manifest["case_ids"] or len(ids) != len(set(ids)) or len(ids) != manifest["count"]:
        raise ValueError("split case identities mismatch")
    for case in cases:
        if case["family"] not in FAMILIES or not isinstance(case["gold"]["justified_nudge"], bool):
            raise ValueError("invalid family or independent nudge label")
        if fingerprint(case["input"]) != case["snapshot_fingerprint"]:
            raise ValueError("task snapshot fingerprint mismatch")
    return {"split": expected_split, "fingerprint": expected, "cases": cases, "observations": records["observations.jsonl"], "manifest": manifest}


def ratio(numerator, denominator):
    return {"numerator": numerator, "denominator": denominator, "rate": numerator / denominator if denominator else None}


def quantiles(values, missing=0):
    values = sorted(number(value) for value in values)
    result = {"samples": len(values), "missing": missing, "p50": None, "p95": None}
    if values:
        for name, percentile in (("p50", .5), ("p95", .95)):
            result[name] = values[max(0, math.ceil(percentile * len(values)) - 1)]
    return result


def binomial_cdf(k, n, p):
    if p == 0:
        return 1.0
    if p == 1:
        return 1.0 if k == n else 0.0
    logs = [math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1) + i * math.log(p) + (n - i) * math.log1p(-p) for i in range(k + 1)]
    largest = max(logs)
    return math.exp(largest) * math.fsum(math.exp(value - largest) for value in logs)


def exact_upper(false_nudges, nudges, confidence=.95):
    if isinstance(false_nudges, bool) or isinstance(nudges, bool) or not isinstance(false_nudges, int) or not isinstance(nudges, int) or not 0 <= false_nudges <= nudges:
        raise ValueError("invalid binomial counts")
    number(confidence, .5, .999999)
    if nudges == 0:
        return None
    if false_nudges == nudges:
        return 1.0
    if false_nudges == 0:
        return 1 - (1 - confidence) ** (1 / nudges)
    low, high = 0.0, 1.0
    for _ in range(80):
        midpoint = (low + high) / 2
        if binomial_cdf(false_nudges, nudges, midpoint) > 1 - confidence:
            low = midpoint
        else:
            high = midpoint
    return high


def observation_current(case, observation):
    return observation.get("current") is True and all(observation.get(key) == case[key] for key in ("snapshot_fingerprint", "question_fingerprint", "template_fingerprint"))


def expertise_selection(case, observation, observations, cases_by_id):
    pair = observation.get("pair_id")
    if not pair:
        return None
    matches = [item for item in observations if item.get("run_id") == observation["run_id"] and item.get("pair_id") == pair and cases_by_id.get(item.get("case_id"), {}).get("judgment") == "expertise-selection"]
    if len(matches) != 1:
        return None
    selected = matches[0]
    selected_case = cases_by_id[selected["case_id"]]
    if selected.get("snapshot_fingerprint") != observation.get("snapshot_fingerprint") or selected_case["task_id"] != case["task_id"] or not observation_current(selected_case, selected) or selected.get("evaluable") is not True or selected.get("outcome") not in {"nudge", "silence"}:
        return None
    return selected, selected_case


def nudge_eligible(case, observation, observations, cases_by_id):
    if case["judgment"] == "expertise-selection":
        return False
    if case["judgment"] != "expertise-useful":
        return True
    selected = expertise_selection(case, observation, observations, cases_by_id)
    return selected is not None and selected[0].get("selected_candidate") in {"candidate-1", "candidate-2", "candidate-3", "candidate-4"}


def nudge_correct(case, observation, observations, cases_by_id):
    if not case["gold"]["justified_nudge"]:
        return False
    if case["judgment"] != "expertise-useful":
        return True
    selected = expertise_selection(case, observation, observations, cases_by_id)
    return selected is not None and selected[0].get("selected_candidate") == selected[1]["gold"]["label"]


def run_metrics(runs):
    completed = [run for run in runs if run.get("status") == "completed"]
    observed_times = [run["steering_ms"] for run in completed if run.get("steering_ms") is not None]
    rework_times = [run["rework_ms"] for run in completed if run.get("rework_ms") is not None]
    return {"planned": len(runs), "completed": len(completed), "incomplete": len(runs) - len(completed),
            "records": runs, "correctness_failures": sum(run.get("correctness") == "fail" for run in completed),
            "scope_violations": sum(run.get("scope") == "fail" for run in completed),
            "unknown_grades": sum(run.get("correctness") not in ("pass", "fail") or run.get("scope") not in ("pass", "fail") for run in completed),
            "owner_interventions": sum(integer(run["owner_interventions"]) for run in completed) if completed and all(run.get("owner_interventions") is not None for run in completed) else None,
            "steering_ms_per_completed_task": sum(observed_times) / len(completed) if completed and len(observed_times) == len(completed) else None,
            "rework_ms_per_completed_task": sum(rework_times) / len(completed) if completed and len(rework_times) == len(completed) else None,
            "worker_overhead_ms": quantiles([run["worker_overhead_ms"] for run in completed if run.get("worker_overhead_ms") is not None], sum(run.get("worker_overhead_ms") is None for run in completed))}


def run_cases(cases, run, known_cases=None):
    known_cases = known_cases or cases
    if "case_ids" in run:
        values = run["case_ids"]
        known = {case["case_id"] for case in known_cases}
        field = "case_id"
    elif "task_ids" in run:
        values = run["task_ids"]
        known = {case["task_id"] for case in known_cases}
        field = "task_id"
    else:
        return [case for case in cases if case["task_id"] == run["task_id"]]
    if not isinstance(values, list) or any(not isinstance(value, str) for value in values) or len(values) != len(set(values)) or not set(values) <= known:
        raise ValueError("invalid explicit run/case assignment")
    return [case for case in cases if case[field] in values]


def score_metrics(cases, observations, runs, eligibility_cases=None, eligibility_observations=None):
    cases_by_id = {case["case_id"]: case for case in cases}
    if len(cases_by_id) != len(cases):
        raise ValueError("duplicate case identity")
    runs_by_id = {run["run_id"]: run for run in runs}
    if len(runs_by_id) != len(runs):
        raise ValueError("duplicate run identity")
    expected = {(run["run_id"], case["case_id"]): case for run in runs for case in run_cases(cases, run, eligibility_cases)}
    counts = {name: 0 for name in ("observed_checkpoints", "evaluable_checkpoints", "delivered_nudges", "simulated_deliveries", "acknowledgments", "observed_corrections", "abstentions", "failures", "stale_rejections", "duplicate_rejections", "suppressions", "observation_gaps", "invalid_delivery_receipts", "unresolved_corrections", "selection_only", "selection_evaluated", "selection_errors", "selection_observation_gaps", "wrong_target_nudges", "calls", "input_tokens", "output_tokens")}
    valid, seen, usage_seen, delivery_seen = {}, set(), {}, set()
    eligibility_by_id = {case["case_id"]: case for case in (eligibility_cases or cases)}
    eligibility_observations = eligibility_observations or observations
    latencies, components, costs = [], {name: [] for name in COMPONENTS}, []
    component_missing = {name: 0 for name in COMPONENTS}
    usage_missing = {name: 0 for name in ("calls", "input_tokens", "output_tokens")}
    false_proposed = proposed = delivered_false = opportunities = missed_proposed = 0
    decisions, correct_decisions, delivered_keys = {}, {}, set()
    for observation in observations:
        key = (observation.get("run_id"), observation.get("case_id"))
        if key not in expected:
            raise ValueError("observation outside planned run/case identities")
        usage = observation.get("usage")
        if usage:
            batch = usage.get("local_batch_id")
            usage_key = (observation["run_id"], fingerprint(runs_by_id[observation["run_id"]].get("provider")), batch, usage.get("provider_request_id")) if batch else key
            if usage_key in usage_seen and usage_seen[usage_key] != usage:
                raise ValueError("conflicting shared batch usage")
            if usage_key not in usage_seen:
                usage_seen[usage_key] = usage
                for field in ("calls", "input_tokens", "output_tokens"):
                    if usage.get(field) is None:
                        usage_missing[field] += 1
                    else:
                        counts[field] += integer(usage[field])
                if usage.get("cost") is not None:
                    costs.append(number(usage["cost"]))
        if key in seen:
            counts["duplicate_rejections"] += 1
            continue
        seen.add(key)
        counts["observed_checkpoints"] += 1
        case = expected[key]
        if not observation_current(case, observation) or observation.get("outcome") == "stale":
            counts["stale_rejections"] += 1
            continue
        if observation.get("outcome") not in {"nudge", "silence", "abstain", "failure", "suppressed", "duplicate"}:
            raise ValueError("unknown evaluation outcome")
        valid[key] = observation
        counts["evaluable_checkpoints"] += observation.get("evaluable") is True and observation["outcome"] != "failure"
        for outcome, count in (("abstain", "abstentions"), ("failure", "failures"), ("suppressed", "suppressions"), ("duplicate", "duplicate_rejections")):
            counts[count] += observation["outcome"] == outcome
    for key, case in expected.items():
        observation = valid.get(key)
        action_case = case["judgment"] != "expertise-selection"
        justified = case["gold"]["justified_nudge"] and action_case
        opportunities += justified
        eligible = observation is not None and observation.get("evaluable") is True and nudge_eligible(case, observation, eligibility_observations, eligibility_by_id)
        nudged = eligible and observation["outcome"] == "nudge"
        proposed += nudged
        correct = nudged and nudge_correct(case, observation, eligibility_observations, eligibility_by_id)
        false_proposed += nudged and not correct
        counts["wrong_target_nudges"] += nudged and case["judgment"] == "expertise-useful" and not correct
        if case["judgment"] == "expertise-selection":
            if observation is not None and observation.get("evaluable") is True and observation.get("outcome") in {"nudge", "silence"} and observation.get("selected_candidate") in {"candidate-1", "candidate-2", "candidate-3", "candidate-4", "none"}:
                counts["selection_evaluated"] += 1
                counts["selection_errors"] += observation["selected_candidate"] != case["gold"]["label"]
            else:
                counts["selection_observation_gaps"] += 1
        if observation is not None and case["judgment"] == "expertise-selection" and observation["outcome"] == "nudge":
            counts["selection_only"] += 1
        decisions[key] = nudged
        correct_decisions[key] = correct
        missed_proposed += justified and not correct
    for observation in observations:
        key = (observation["run_id"], observation["case_id"])
        case = expected[key]
        receipt = observation.get("delivery")
        if receipt is None:
            continue
        receipt_id = (key[0], receipt.get("receipt_id"))
        recognized = isinstance(receipt.get("same_task"), bool) and isinstance(receipt.get("receipt_id"), str) and bool(receipt["receipt_id"])
        live_receipt = runs_by_id[key[0]]["evidence_kind"] in LIVE_KINDS
        if recognized and receipt_id in delivery_seen:
            continue
        if recognized:
            delivery_seen.add(receipt_id)
        eligible_receipt = recognized and receipt.get("same_task") is True and decisions.get(key, False) and observation is valid.get(key) and (not live_receipt or runs_by_id[key[0]]["arm"] == "advisory")
        if not eligible_receipt:
            counts["invalid_delivery_receipts"] += 1
        if not recognized:
            continue
        if not live_receipt:
            counts["simulated_deliveries"] += 1
            continue
        counts["delivered_nudges"] += 1
        delivered_false += not eligible_receipt or not correct_decisions.get(key, False)
        if eligible_receipt and correct_decisions.get(key, False):
            delivered_keys.add(key)
        counts["acknowledgments"] += observation.get("acknowledged") is True
        correction_ids = observation.get("correction_evidence_ids", [])
        resolved = {item.get("id") for item in observation.get("correction_observations", []) if item.get("source") in {"host_observation", "deterministic_output"} and item.get("current") is True and item.get("observed_after_delivery") is True and item.get("task_id") == case["task_id"] and isinstance(item.get("capture_sha256"), str) and len(item["capture_sha256"]) == 64}
        correction_observed = eligible_receipt and bool(correction_ids) and all(identity in resolved for identity in correction_ids)
        counts["observed_corrections"] += correction_observed
        counts["unresolved_corrections"] += bool(correction_ids) and not correction_observed
        if receipt.get("event_to_delivery_ms") is not None:
            latencies.append(number(receipt["event_to_delivery_ms"]))
        timing = observation.get("latency") or {}
        for name in COMPONENTS:
            if timing.get(name) is None:
                component_missing[name] += 1
            else:
                components[name].append(number(timing[name]))
    missed_delivered = sum(case["gold"]["justified_nudge"] and case["judgment"] != "expertise-selection" and key not in delivered_keys for key, case in expected.items())
    for field, missing in usage_missing.items():
        counts["measured_" + field] = counts[field]
        counts[field + "_missing"] = missing
        if missing:
            counts[field] = None
    counts["observation_gaps"] = len(expected) - counts["observed_checkpoints"]
    counts.update(planned_checkpoints=len(expected), would_nudge=ratio(proposed, len(expected)), false_would_nudge=ratio(false_proposed, proposed), missed_would_nudge=ratio(missed_proposed, opportunities), false_nudge=ratio(delivered_false, counts["delivered_nudges"]), missed_nudge=ratio(missed_delivered, opportunities), coverage=ratio(counts["evaluable_checkpoints"], len(expected)), event_to_delivery_ms=quantiles(latencies, counts["delivered_nudges"] - len(latencies)), latency_components={name: quantiles(components[name], component_missing[name]) for name in COMPONENTS}, measurable_cost=sum(costs) if costs and len(costs) == len(usage_seen) else None, cost_observation_gaps=len(usage_seen) - len(costs), usage_observation_gaps=sum(observation.get("usage") is None for observation in observations))
    return counts


def score(cases, observations, runs):
    metrics = score_metrics(cases, observations, runs)
    groups = []
    for run in runs:
        assigned = run_cases(cases, run)
        identities = sorted({(case["judgment"], case["question_fingerprint"], case["template_fingerprint"]) for case in assigned})
        for judgment, question, template in identities:
            selected = [case for case in assigned if (case["judgment"], case["question_fingerprint"], case["template_fingerprint"]) == (judgment, question, template)]
            selected_ids = {case["case_id"] for case in selected}
            group_observations = [observation for observation in observations if observation.get("run_id") == run["run_id"] and observation.get("case_id") in selected_ids]
            group_metrics = score_metrics(selected, group_observations, [run], cases, [observation for observation in observations if observation.get("run_id") == run["run_id"]])
            if judgment == "expertise-useful":
                group_metrics["expertise_pair_required"] = True
            groups.append({"judgment": judgment, "family": selected[0]["family"], "provider": run["provider"], "arm": run["arm"], "run_id": run["run_id"], "task_ids": sorted({case["task_id"] for case in selected}), "question_fingerprint": question, "template_fingerprint": template, "evidence_kind": run["evidence_kind"], "metrics": group_metrics})
    return {"metrics": metrics, "groups": groups, "runs": run_metrics(runs)}


def fixture_run(split, cases=()):
    return {"run_id": "fixture-" + split, "task_id": "authored-" + split, "case_ids": [case["case_id"] for case in cases], "arm": "shadow", "evidence_kind": "fixture", "provider": {"provider": "authored-fixture", "model": "fixed-output-v1", "checkpoint": "no-inference"}, "status": "completed", "correctness": None, "scope": None, "wall_ms": None, "worker_overhead_ms": None, "owner_interventions": None, "steering_ms": None, "rework_ms": None}


def promotion_assessment(groups, protocol):
    result = []
    for group in groups:
        metrics = group["metrics"]
        budget = protocol["budgets"][group["family"]]
        false = metrics["false_nudge"]
        upper = exact_upper(false["numerator"], false["denominator"], protocol["quality_interval"]["confidence"])
        reasons = []
        if group["evidence_kind"] != "matched_live_expanded":
            reasons.append("no_matched_live_expanded_evidence")
        if false["denominator"] < budget["min_delivered_nudges"]:
            reasons.append("insufficient_held_out_deliveries")
        if upper is None or upper > budget["false_nudge_max"]:
            reasons.append("false_nudge_upper_bound_not_passing")
        if metrics["missed_nudge"]["denominator"] < budget["min_justified_opportunities"]:
            reasons.append("insufficient_justified_opportunities")
        if metrics["coverage"]["rate"] is None or metrics["coverage"]["rate"] < budget["min_evaluable_coverage"]:
            reasons.append("incomplete_evaluable_coverage")
        timing = metrics["event_to_delivery_ms"]
        if timing["missing"] or timing["p95"] is None or timing["p95"] > budget["p95_delivery_ms"]:
            reasons.append("latency_not_passing")
        if metrics["invalid_delivery_receipts"]:
            reasons.append("invalid_delivery_receipts")
        reasons.append("matched_live_correctness_and_steering_not_established")
        result.append({"judgment": group["judgment"], "provider": group["provider"], "mode": "shadow", "quality_upper_bound": upper, "budget": budget, "reasons": reasons})
    return result


def replay(path, protocol):
    manifest = read_json(Path(path) / "manifest.json")
    split = load_split(path, protocol, manifest["split"])
    report = score(split["cases"], split["observations"], [fixture_run(split["split"], split["cases"])])
    report.update(schema_version=1, evidence_kind="fixture_replay", split=split["split"], data_fingerprint=split["fingerprint"], protocol_fingerprint=fingerprint(protocol), promotion_records=[], promotion_assessment=promotion_assessment(report["groups"], protocol))
    return report


def calibrate(path, protocol):
    split = load_split(path, protocol, "development")
    policies = []
    identities = sorted({(case["judgment"], case["question_fingerprint"], case["template_fingerprint"]) for case in split["cases"]})
    for judgment, question, template in identities:
        cases = [case for case in split["cases"] if (case["judgment"], case["question_fingerprint"], case["template_fingerprint"]) == (judgment, question, template)]
        ids = {case["case_id"] for case in cases}
        observations = [observation for observation in split["observations"] if observation["case_id"] in ids]
        candidates = []
        for threshold in protocol["calibration"]["candidate_thresholds"]:
            changed = copy.deepcopy(observations)
            for observation in changed:
                probability = observation.get("signal_probability")
                if probability is None or not observation_current(next(case for case in cases if case["case_id"] == observation["case_id"]), observation):
                    observation["outcome"] = "abstain"
                else:
                    number(probability, 0, 1)
                    observation["outcome"] = "nudge" if probability >= threshold else "silence"
            context = [observation for observation in split["observations"] if observation["case_id"] not in ids] + changed
            metrics = score_metrics(cases, changed, [fixture_run("development", cases)], split["cases"], context)
            candidates.append({"threshold": threshold, "false_would_nudge": metrics["false_would_nudge"], "missed_would_nudge": metrics["missed_would_nudge"], "coverage": metrics["coverage"]})
        budget = protocol["budgets"][cases[0]["family"]]
        eligible = [candidate for candidate in candidates if candidate["false_would_nudge"]["rate"] is not None and candidate["false_would_nudge"]["rate"] <= budget["false_nudge_max"]]
        selected = min(eligible, key=lambda candidate: (candidate["missed_would_nudge"]["rate"] if candidate["missed_would_nudge"]["rate"] is not None else 1, candidate["threshold"])) if eligible else None
        policies.append({"record_id": "fixture-development-" + judgment + "-" + question[:12], "pair_required": judgment == "expertise-useful", "provider": fixture_run("development")["provider"], "question_fingerprint": question, "template_fingerprint": template, "development_fingerprint": split["fingerprint"], "judgment": judgment, "family": cases[0]["family"], "mode": "shadow", "selected": selected, "candidates": candidates, "reason": "development_fixture_only; holdout_and_live_required" if selected else "no_feasible_development_candidate"})
    return {"schema_version": 1, "fit_split": "development", "evidence_kind": "fixture_calibration", "development_fingerprint": split["fingerprint"], "protocol_fingerprint": fingerprint(protocol), "policies": policies, "policy_fingerprint": fingerprint(policies), "promotion_records": []}


def validate_matched(runs):
    issues = []
    grouped = {}
    for run in runs:
        grouped.setdefault((run.get("task_id"), run.get("repeat", 1)), []).append(run)
    if not grouped:
        issues.append("no_planned_runs")
    for key, matched in grouped.items():
        if sorted(run.get("arm", "") for run in matched) != sorted(ARMS):
            issues.append("missing_or_duplicate_arm:" + str(key))
            continue
        for field in ("snapshot_fingerprint", "controls", "budget", "provider"):
            if any(run.get(field) is None for run in matched) or len({fingerprint(run[field]) for run in matched}) != 1:
                issues.append("mismatched_" + field + ":" + str(key))
    return {"matched": not issues, "issues": issues, "planned_runs": len(runs)}


def live_conclusion(runs, phase):
    matched = validate_matched(runs)
    issues = list(matched["issues"])
    if phase != "expanded":
        issues.append("pilot_is_feasibility_only")
    if any(run.get("evidence_kind") != "matched_live_expanded" for run in runs):
        issues.append("non_expanded_evidence")
    if any(run.get("status") != "completed" for run in runs):
        issues.append("incomplete_runs")
    for run in runs:
        for field in ("wall_ms", "calls", "cost"):
            if run.get(field) is None:
                issues.append("run_budget_measurements_missing")
            elif run.get("budget", {}).get(field) is None:
                issues.append("declared_run_budget_missing")
            elif (integer(run[field]) if field == "calls" else number(run[field])) > (integer(run["budget"][field]) if field == "calls" else number(run["budget"][field])):
                issues.append("run_budget_exceeded")
        if run.get("correctness") != "pass" or run.get("scope") != "pass":
            issues.append("correctness_or_scope_not_passing")
        if run.get("grader", {}).get("independent") is not True or not run.get("grader", {}).get("evidence_ids"):
            issues.append("independent_grade_missing")
    off = [run for run in runs if run.get("arm") == "off"]
    advisory = [run for run in runs if run.get("arm") == "advisory"]
    if not off or not advisory or any(run.get("steering_ms") is None for run in off + advisory):
        issues.append("steering_unobserved")
    elif sum(number(run["steering_ms"]) for run in advisory) >= sum(number(run["steering_ms"]) for run in off):
        issues.append("no_observed_steering_reduction")
    return {"passed": not issues, "matched": matched, "issues": sorted(set(issues)), "promotion_records": []}


def snapshot_status(files, root):
    issues = []
    for name, digest in files.items():
        path = (root / name).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file() or file_hash(path) != digest:
            issues.append(name)
    return {"matched": not issues, "changed": issues, "fingerprint": fingerprint(files)}


def live(protocol, data_root):
    validate_protocol(protocol)
    root = Path(data_root).resolve().parents[1]
    pilot = protocol["pilot"]
    snapshot = snapshot_status(pilot["snapshot_files"], root)
    capabilities = protocol["host"]["capabilities"]
    supported = protocol["host"].get("status") == "supported" and capabilities.get("same_task_delivery") is True and capabilities.get("delivery_receipts") is True and bool(capabilities.get("checkpoints"))
    reason = "snapshot_changed" if not snapshot["matched"] else "host_unsupported" if not supported else "actual_host_adapter_not_implemented"
    runs = [{"run_id": protocol["protocol_id"] + "-pilot-" + arm, "task_id": pilot["task_id"], "repeat": 1, "arm": arm, "evidence_kind": "matched_live_pilot", "status": "blocked" if not supported else "unsupported", "stop_reason": reason, "host_stop_reason": protocol["host"].get("stop_reason"), "snapshot_fingerprint": snapshot["fingerprint"], "snapshot_rechecked": snapshot, "controls": pilot["controls"], "budget": {"wall_ms": pilot["max_wall_ms"], "calls": pilot["call_limit_per_arm"], "cost": pilot["cost_limit_per_arm"]}, "provider": {"provider": "codex-cli", "model": "unverified", "checkpoint": "unverified"}, "correctness": None, "scope": None, "owner_interventions": None, "steering_ms": None, "rework_ms": None, "worker_overhead_ms": None, "wall_ms": None} for arm in pilot["order"]]
    return {"schema_version": 1, "status": "blocked" if not supported else "unsupported", "evidence_kind": "blocked_live_pilot", "protocol_fingerprint": fingerprint(protocol), "host": protocol["host"], "snapshot": snapshot, "planned_runs": len(runs), "completed_runs": 0, "incomplete_runs": len(runs), "runs": runs, "matched": validate_matched(runs), "matched_live": live_conclusion(runs, "pilot"), "expanded": protocol["expanded"], "stop_reason": reason, "next_step": "A fresh campaign requires an explicit new protocol/run identity and newly frozen inputs before calibration; retain the old campaign records and never execute mismatched snapshots.", "promotion_records": []}


def runtime_replay(path, capture_fn=None):
    path = Path(path).resolve()
    if path.stat().st_size > 262144:
        raise ValueError("runtime trace exceeds byte budget")
    trace = read_json(path)
    digest = file_hash(path)
    if capture_fn is None:
        from probe_expert_host import capture
        capture_fn = capture
    command = ["cargo", "run", "--quiet", "--bin", "blabla", "--", "expert", "replay", str(path), "--json"]
    records, results, issues = [], [], []
    for _ in range(2):
        if file_hash(path) != digest:
            issues.append("trace_changed")
            break
        record, stdout, _ = capture_fn(command, ROOT, dict(os.environ), 120)
        records.append(record)
        if record.get("outcome") != "completed" or record.get("exit") != 0:
            issues.append("source_cli_replay_failed")
            continue
        if record.get("stdout", {}).get("capture_complete") is not True or record.get("stdout", {}).get("truncated") is not False:
            issues.append("source_cli_output_incomplete")
            continue
        try:
            result = parse_json(stdout)
        except (ValueError, TypeError):
            issues.append("source_cli_output_invalid")
            continue
        if result != trace["result"]:
            issues.append("source_cli_decision_mismatch")
        results.append(result)
    if file_hash(path) != digest:
        issues.append("trace_changed")
    if len(results) != 2 or results[0] != results[-1]:
        issues.append("two_matching_replays_not_observed")
    request = trace["request"]
    event = request["packet"]["event"]
    return {"status": "incomplete" if issues else "replayed", "evidence_kind": "runtime_fixture_replay", "trace_sha256": digest, "request_id": request["request_id"], "run_id": event["run_id"], "task_id": event["task"], "packet_hash": request["packet"]["hash"], "provider": trace["response"]["provider"], "question_fingerprint": request["question_fingerprint"], "template_fingerprint": request["template_fingerprint"], "implementation_fingerprints": trace["implementation_fingerprints"], "provenance": trace["provenance"], "mode": trace["mode"], "source_cli_argv": command, "commands": records, "results": results, "issues": sorted(set(issues)), "provider_execution": "saved response only; replay does not call the provider", "delivered_nudges": 0, "promotion_records": []}


def write_record(path, record):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    replay_parser = commands.add_parser("replay")
    replay_parser.add_argument("--split", choices=("development", "holdout"), required=True)
    replay_parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    replay_parser.add_argument("--protocol", type=Path, default=DEFAULT_DATA / "protocol.json")
    replay_parser.add_argument("--out", type=Path, required=True)
    replay_parser.add_argument("--runtime-trace", type=Path)
    calibration_parser = commands.add_parser("calibrate")
    calibration_parser.add_argument("--development", type=Path, required=True)
    calibration_parser.add_argument("--protocol", type=Path, default=DEFAULT_DATA / "protocol.json")
    calibration_parser.add_argument("--policy", type=Path, required=True)
    live_calibration_parser = commands.add_parser("calibrate-live")
    for flag in ("--protocol", "--development", "--requests", "--fit-plan", "--config", "--project", "--policy"):
        live_calibration_parser.add_argument(flag, type=Path, required=True)
    live_calibration_parser.add_argument("--timeout", type=float, default=120)
    live_calibration_parser.add_argument("--max-wall-seconds", type=float, default=600)
    live_parser = commands.add_parser("live")
    live_parser.add_argument("--protocol", type=Path, required=True)
    live_parser.add_argument("--out", type=Path, required=True)
    live_parser.add_argument("--native-plan", type=Path)
    live_parser.add_argument("--native-projects", type=Path, help="JSON file mapping run IDs to absolute prepared project roots")
    args = parser.parse_args(argv)
    if args.command == "live" and (args.native_plan is None) != (args.native_projects is None):
        parser.error("--native-plan and --native-projects are required together")
    try:
        if args.command == "calibrate-live":
            if __package__:
                from .expert_calibrate_live import calibrate_live
            else:
                from expert_calibrate_live import calibrate_live
            result = calibrate_live(args.protocol, args.development, args.requests, args.fit_plan,
                args.config, args.project, args.policy, timeout=args.timeout, max_wall_seconds=args.max_wall_seconds)
            print(json.dumps({"status": result["status"], "kind": result["kind"], "output": str(args.policy), "promotion_records": len(result["promotion_records"])}))
            return 4 if result["status"] == "incomplete" else 0
        exit_code = None
        if args.command == "live" and args.native_plan is not None:
            if __package__:
                from . import expert_native_live
            else:
                import expert_native_live
            try:
                result = expert_native_live.live_native(args.protocol, args.native_plan, read_json(args.native_projects))
            except expert_native_live.native.Failure as error:
                parser.exit(error.exit_code, "expert evaluation failed: " + str(error)[:2048] + "\n")
            exit_code = (result.get("uncertainty") or {}).get("exit_code", 0)
        else:
            protocol = load_protocol(args.protocol)
            if args.command == "replay":
                result = replay(args.data / args.split, protocol)
                if args.runtime_trace is not None:
                    result["runtime_replay"] = runtime_replay(args.runtime_trace)
            elif args.command == "calibrate":
                result = calibrate(args.development, protocol)
            else:
                result = live(protocol, args.protocol.parent)
        output = args.policy if args.command == "calibrate" else args.out
        write_record(output, result)
        print(json.dumps({"status": result.get("status", "recorded"), "evidence_kind": result["evidence_kind"], "output": str(output), "promotion_records": len(result["promotion_records"])}))
        return exit_code
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(2, "expert evaluation failed: " + str(error) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
