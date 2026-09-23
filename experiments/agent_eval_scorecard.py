import argparse
import html
import json
import statistics
from pathlib import Path

from agent_eval_overview import html_page


STATUSES = {"pass", "fail", "unknown", "not_applicable"}
AXES = ("systems", "capabilities", "behaviors")


def _results(value):
    if isinstance(value, dict):
        return list(value.get("runs", []))
    return list(value)


def _ref(value):
    if not isinstance(value, dict) or set(value) != {"case", "criterion"}:
        raise ValueError(f"invalid coverage reference: {value!r}")
    return value["case"], value["criterion"]


def _checks(item):
    return item.get("checks", [])


def _case_criteria(results):
    found = {}
    for run in results:
        case = run.get("case")
        for criterion in run.get("criteria", []):
            found.setdefault(case, set()).add(criterion.get("id"))
    return found


def _observations(results):
    observations = []
    for run_index, run in enumerate(results):
        for criterion in run.get("criteria", []):
            status = criterion.get("status")
            if status not in STATUSES:
                raise ValueError(f"unknown criterion status: {status!r}")
            observations.append({
                "key": (run.get("host"), run.get("arm"), run.get("case"), criterion.get("id"), run.get("run", run_index)),
                "opportunity": (run.get("case"), criterion.get("id")),
                "host": run.get("host", "unknown"),
                "arm": run.get("arm", "unknown"),
                "case": run.get("case"),
                "criterion": criterion.get("id"),
                "run": run.get("run", str(run_index)),
                "status": status if run.get("valid", True) else "unknown",
                "reported_status": status,
                "invalid": run.get("valid", True) is False,
                "weight": criterion.get("weight", 0),
                "scored": criterion.get("scored", True),
                "reason": criterion.get("reason", ""),
                "evidence": list(criterion.get("evidence", [])),
            })
    return observations


def _validate_refs(items, found):
    valid = {}
    for item in items:
        item_id = item.get("id")
        refs = []
        missing = []
        for value in _checks(item):
            case, criterion = _ref(value)
            refs.append((case, criterion))
            if case in found and criterion not in found[case]:
                missing.append(f"{case}/{criterion} is not in the rubric these runs were graded with")
            if case not in found:
                missing.append(f"{case}/{criterion} is not measured in the supplied runs")
        authored = [str(value) for value in item.get("missing", [])]
        missing.extend(authored)
        valid[item_id] = {"item": item, "refs": tuple(dict.fromkeys(refs)), "missing": missing, "authored": authored}
    return valid


def _point_stats(observations):
    stats = {"earned": 0, "lost": 0, "unknown": 0, "available": 0, "diagnostic": 0, "not_applicable": 0}
    opportunities = set()
    details = []
    for observation in observations:
        details.append(observation)
        if not observation["scored"]:
            stats["diagnostic"] += 1
            continue
        status = observation["status"]
        weight = observation["weight"]
        if status == "not_applicable":
            stats["not_applicable"] += 1
            continue
        opportunities.add(observation["opportunity"])
        stats["available"] += weight
        if status == "pass":
            stats["earned"] += weight
        elif status == "fail":
            stats["lost"] += weight
        elif status == "unknown":
            stats["unknown"] += weight
    stats["lower"] = stats["earned"]
    stats["upper"] = stats["earned"] + stats["unknown"]
    stats["complete"] = stats["unknown"] == 0 and bool(opportunities)
    stats["percent"] = stats["earned"] / stats["available"] if stats["complete"] and stats["available"] else None
    stats["opportunities"] = sorted(opportunities)
    stats["multiplicity"] = {}
    stats["weights"] = {}
    for observation in observations:
        if observation["scored"] and observation["status"] != "not_applicable":
            key = observation["opportunity"]
            label = f"{key[0]}/{key[1]}"
            stats["multiplicity"][label] = stats["multiplicity"].get(label, 0) + 1
            stats["weights"].setdefault(label, set()).add(observation["weight"])
    stats["weights"] = {key: tuple(sorted(values)) for key, values in stats["weights"].items()}
    stats["status"] = "UNMEASURED" if not opportunities else ("COMPLETE" if stats["complete"] else "INCOMPLETE")
    stats["details"] = details
    return stats


def _axis_rows(axis, items, observations, hosts, arms):
    rows = []
    for item_id, entry in items.items():
        for host in hosts:
            for arm in arms:
                selected = [observation for observation in observations
                            if observation["host"] == host and observation["arm"] == arm
                            and observation["opportunity"] in entry["refs"]]
                unique = {}
                for observation in selected:
                    unique.setdefault(observation["key"], observation)
                stats = _point_stats(list(unique.values()))
                if entry["missing"]:
                    stats["complete"] = False
                    stats["percent"] = None
                    stats["status"] = "UNMEASURED" if not stats["opportunities"] else "INCOMPLETE"
                rows.append({
                    "id": item_id,
                    "title": entry["item"].get("title", item_id),
                    "system": entry["item"].get("system"),
                    "host": host,
                    "arm": arm,
                    "missing": entry["missing"],
                    "points": {**{key: stats[key] for key in ("earned", "lost", "unknown", "available", "lower", "upper", "diagnostic", "not_applicable", "complete", "percent")}, "status": stats["status"]},
                    "opportunities": stats["opportunities"],
                    "multiplicity": stats["multiplicity"],
                    "weights": stats["weights"],
                    "status": stats["status"],
                    "details": stats["details"],
                })
    return rows


def _deltas(rows):
    grouped = {}
    for row in rows:
        grouped.setdefault((row["id"], row["host"]), {})[row["arm"]] = row
    result = []
    for (item_id, host), pair in sorted(grouped.items()):
        with_row, without_row = pair.get("with"), pair.get("without")
        if not with_row or not without_row:
            continue
        common = set(map(tuple, with_row["opportunities"])) & set(map(tuple, without_row["opportunities"]))
        with_stats = _point_stats([o for o in with_row["details"] if tuple(o["opportunity"]) in common])
        without_stats = _point_stats([o for o in without_row["details"] if tuple(o["opportunity"]) in common])
        comparable = bool(common) and all(
            with_stats["multiplicity"].get(f"{opportunity[0]}/{opportunity[1]}") == without_stats["multiplicity"].get(f"{opportunity[0]}/{opportunity[1]}")
            and with_stats["weights"].get(f"{opportunity[0]}/{opportunity[1]}") == without_stats["weights"].get(f"{opportunity[0]}/{opportunity[1]}")
            for opportunity in common
        )
        if comparable:
            lower = with_stats["lower"] - without_stats["upper"]
            upper = with_stats["upper"] - without_stats["lower"]
            available = with_stats["available"]
            reason = "Descriptive within-host difference over the case/criterion exposure both arms share, with equal multiplicity and weights"
        else:
            lower = upper = available = None
            reason = "No case/criterion exposure shared by both arms with equal multiplicity and weights"
        result.append({"id": item_id, "host": host, "comparable": comparable, "lower": lower, "upper": upper,
                       "available": available, "shared": sorted(f"{case}/{criterion}" for case, criterion in common),
                       "reason": reason})
    return result


def _case_rows(observations):
    grouped = {}
    for observation in observations:
        key = (observation["case"], observation["host"], observation["arm"])
        grouped.setdefault(key, {status: 0 for status in STATUSES})[observation["status"]] += 1
    return [{"case": case, "host": host, "arm": arm, **counts}
            for (case, host, arm), counts in sorted(grouped.items())]


def build_scorecard(results, coverage):
    results = _results(results)
    coverage = coverage or {}
    observations = _observations(results)
    found = _case_criteria(results)
    capabilities = coverage.get("capabilities", [])
    systems = []
    for system in coverage.get("systems", []):
        system_id = system["id"]
        checks = []
        missing = list(system.get("missing", []))
        for capability in capabilities:
            if capability.get("system") == system_id:
                checks.extend(capability.get("checks", []))
                missing.extend(capability.get("missing", []))
        systems.append({**system, "checks": list({json.dumps(check, sort_keys=True): check for check in checks}.values()), "missing": missing})
    catalog = {"systems": systems, "capabilities": capabilities, "behaviors": coverage.get("behaviors", [])}
    validated = {axis: _validate_refs(catalog[axis], found) for axis in AXES}
    hosts = sorted({observation["host"] for observation in observations})
    arms = sorted({observation["arm"] for observation in observations})
    axes = {}
    for axis in AXES:
        rows = _axis_rows(axis, validated[axis], observations, hosts, arms)
        axes[axis] = {"rows": rows, "deltas": _deltas(rows),
                      "missing": sorted({m for entry in validated[axis].values() for m in entry["authored"]})}
    absent_cases = sorted({_ref(check)[0] for axis in AXES for item in catalog[axis] for check in _checks(item)} - set(found))
    return {
        "purpose": "Weighted capability evidence with uncertainty; diagnostic, not a model or host ranking",
        "arm_note": "with: BlaBla present, its manifest, contracts, task record, onboarding, skill and CLI; without: none of it, the same job stated in plain language",
        "hosts": hosts,
        "arms": arms,
        "systems": axes["systems"],
        "capabilities": axes["capabilities"],
        "behaviors": axes["behaviors"],
        "case_summaries": _case_rows(observations),
        "runs": results,
        "missing": {axis: axes[axis]["missing"] for axis in AXES},
        "absent_cases": absent_cases,
    }


EFFICIENCY_MEASURES = (("seconds", "Seconds", ".1f"), ("turns", "Turns", ".0f"), ("total_actions", "Actions", ".0f"),
                       ("actions_to_done", "Actions until done", ".0f"), ("actions_after_done", "Actions after done", ".0f"),
                       ("blabla_invocations", "BlaBla calls", ".0f"), ("file_edits", "File edits", ".0f"),
                       ("prompt_tokens", "New prompt tokens", ".0f"), ("cached_tokens", "Cached prompt tokens", ".0f"),
                       ("output_tokens", "Output tokens", ".0f"))
EFFICIENCY_TITLE = "Efficiency (descriptive)"
EFFICIENCY_NOTE = "Medians with the min–max spread over the runs of one case, host and arm; these rows never enter a score, a delta or an interval."


def source_edit(action):
    paths = [path or "" for path in action.get("paths", [])]
    return action.get("kind") == "write" and any("/.blabla/" not in f"/{path}" for path in paths)


def runs_check(action, check):
    if action.get("kind") != "command" or action.get("success") is not True or not check:
        return False
    words = check.split()
    if words[0] == "blabla":
        return any(argv[:len(words) - 1] == words[1:] for argv in action.get("invocations", []))
    return check in action.get("command", "")


def done_index(actions, check):
    edits = [index for index, action in enumerate(actions) if source_edit(action)]
    if not edits:
        return None
    for index in range(edits[-1] + 1, len(actions)):
        if runs_check(actions[index], check):
            return index + 1
    return None


def efficiency_of(run):
    actions = run.get("actions", [])
    tokens = run.get("tokens") or {}
    done = done_index(actions, run.get("check"))
    return {"seconds": run.get("seconds"), "turns": run.get("turns"), "total_actions": len(actions),
            "actions_to_done": done, "actions_after_done": len(actions) - done if done is not None else None,
            "blabla_invocations": sum(len(action.get("invocations", [])) for action in actions if action.get("kind") == "command"),
            "file_edits": sum(1 for action in actions if action.get("kind") == "write"),
            "prompt_tokens": tokens.get("prompt"), "cached_tokens": tokens.get("cached"), "output_tokens": tokens.get("output")}


def efficiency_rows(results):
    groups = {}
    for run in results:
        groups.setdefault((run["case"], run["host"], run["arm"]), []).append(efficiency_of(run))
    rows = []
    for (case, host, arm), stats in sorted(groups.items()):
        row = {"case": case, "host": host, "arm": arm}
        for key, _, _ in EFFICIENCY_MEASURES:
            values = [entry[key] for entry in stats if entry[key] is not None]
            row[key] = {"median": statistics.median(values), "min": min(values), "max": max(values), "runs": len(values)} if values else None
        rows.append(row)
    return rows


def efficiency_cell(row, key, spec):
    measure = row.get(key)
    if not measure:
        return "unknown"
    median = f"{measure['median']:{spec}}"
    if measure["min"] == measure["max"]:
        return median
    return f"{median} [{measure['min']:{spec}}–{measure['max']:{spec}}]"


def efficiency_markdown(rows):
    if not rows:
        return []
    header = " | ".join(title for _, title, _ in EFFICIENCY_MEASURES)
    lines = ["", f"## {EFFICIENCY_TITLE}", "", f"| Case | Host | Arm | {header} |",
             "| --- | --- | --- |" + " ---: |" * len(EFFICIENCY_MEASURES)]
    for row in rows:
        cells = " | ".join(efficiency_cell(row, key, spec) for key, _, spec in EFFICIENCY_MEASURES)
        lines.append(f"| {_md(row['case'])} | {_md(row['host'])} | {row['arm']} | {cells} |")
    lines.extend(["", EFFICIENCY_NOTE])
    return lines


def efficiency_html(rows):
    if not rows:
        return []
    header = "".join(f"<th class=num>{title}</th>" for _, title, _ in EFFICIENCY_MEASURES)
    page = [f"<h2>{EFFICIENCY_TITLE}</h2><div class=scroll><table><tr><th>Case</th><th>Host</th><th>Arm</th>{header}</tr>"]
    for row in rows:
        cells = "".join(f"<td class=num>{efficiency_cell(row, key, spec)}</td>" for key, _, spec in EFFICIENCY_MEASURES)
        page.append(f"<tr><td>{html.escape(row['case'])}</td><td>{html.escape(row['host'])}</td><td>{row['arm']}</td>{cells}</tr>")
    page.append(f"</table></div><p class=note>{html.escape(EFFICIENCY_NOTE)}</p>")
    return page


def _md(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def _matrix(rows):
    grouped = {}
    for row in rows:
        grouped.setdefault((row["id"], row["title"], row.get("system")), {}).setdefault(row["host"], {})[row["arm"]] = row
    return grouped


def _cell(row):
    if row is None:
        return "unmeasured"
    points = row["points"]
    if points["status"] == "UNMEASURED":
        counted = {}
        for detail in row.get("details", []):
            if not detail["scored"] and detail["status"] != "not_applicable":
                counted[detail["status"]] = counted.get(detail["status"], 0) + 1
        if not counted:
            return "unmeasured"
        return "observed only: " + ", ".join(f"{count} {status}" for status, count in sorted(counted.items()))
    text = f"{points['earned']:g}/{points['available']:g}"
    if points["available"]:
        text += f" ({points['earned'] / points['available']:.0%})"
    if points["unknown"]:
        text += f", {points['unknown']:g} unknown, so {points['lower']:g} to {points['upper']:g}"
    return text


def _delta_text(delta):
    if not delta or not delta["comparable"]:
        return "not comparable"
    if delta["lower"] == delta["upper"]:
        return f"{delta['lower']:+g} points"
    return f"{delta['lower']:+g} to {delta['upper']:+g} points"


def _measured(rows, deltas):
    delta_map = {(row["id"], row["host"]): row for row in deltas}
    shown, idle = [], []
    for (item_id, item_title, system), hosts in _matrix(rows).items():
        label = f"{item_title} ({system})" if system else item_title
        entries = [(host, arms.get("with"), arms.get("without"), delta_map.get((item_id, host))) for host, arms in sorted(hosts.items())]
        entries = [entry for entry in entries if _cell(entry[1]) != "unmeasured" or _cell(entry[2]) != "unmeasured"]
        if entries:
            shown.append((label, item_title, system, entries))
        else:
            idle.append(label)
    return shown, idle


SCORECARD_GUIDE = ("A cell reads earned/available points and their share; when unknown observations leave the score open, "
                   "it adds the range they allow, and an unknown never counts as earned. The difference is with BlaBla minus "
                   "without BlaBla over the case checks both arms faced with the same weights; a check that needs BlaBla "
                   "does not apply in the arm without it. A row that only carries unscored observations shows their counts, "
                   "never a score.")


def _markdown_axis(lines, title, rows, deltas):
    shown, idle = _measured(rows, deltas)
    lines.extend(["", f"## {title}", ""])
    if shown:
        lines.extend(["| Item | Host | With BlaBla | Without BlaBla | Difference |", "| --- | --- | --- | --- | --- |"])
        for label, _, _, entries in shown:
            for host, with_row, without_row, delta in entries:
                lines.append(f"| {_md(label)} | {_md(host)} | {_md(_cell(with_row))} | {_md(_cell(without_row))} | {_md(_delta_text(delta))} |")
    else:
        lines.append("Nothing on this axis was measured in these runs.")
    if idle:
        lines.extend(["", f"No check in these runs ({len(idle)}): " + "; ".join(_md(label) for label in idle) + "."])


def _markdown(scorecard):
    lines = ["# Capability scorecard", "", scorecard["purpose"] + ".", scorecard["arm_note"] + ".", "", SCORECARD_GUIDE,
             "Per-run evidence is in `scorecard.html` and `scorecard.json`."]
    _markdown_axis(lines, "Systems", scorecard["systems"]["rows"], scorecard["systems"]["deltas"])
    _markdown_axis(lines, "Capabilities", scorecard["capabilities"]["rows"], scorecard["capabilities"]["deltas"])
    _markdown_axis(lines, "Behaviors", scorecard["behaviors"]["rows"], scorecard["behaviors"]["deltas"])
    lines.extend(efficiency_markdown(scorecard.get("efficiency", [])))
    lines.extend(["", "## Not measured", ""])
    if scorecard.get("absent_cases"):
        lines.append("- Cases not in these runs: " + ", ".join(_md(case) for case in scorecard["absent_cases"]) + ".")
    for axis in ("capabilities", "behaviors"):
        for entry in scorecard["missing"].get(axis, []):
            lines.append(f"- {axis}: {_md(entry)}")
    return "\n".join(lines) + "\n"


def _html(scorecard):
    def esc(value):
        return html.escape(str(value), quote=True)
    def matrix(title, rows, deltas):
        shown, idle = _measured(rows, deltas)
        out = [f"<h2>{esc(title)}</h2>"]
        if shown:
            out.append("<div class=scroll><table><tr><th>Item</th><th>Host</th><th>With BlaBla</th><th>Without BlaBla</th><th>Difference</th><th>Evidence</th></tr>")
            for _, item_title, system, entries in shown:
                for host, with_row, without_row, delta in entries:
                    evidence = [f"<li>{esc(detail['arm'])} · {esc(detail['case'])}/{esc(detail['criterion'])}: <b>{esc(detail['status'])}</b>. "
                                f"{esc(detail['reason'])} <code>{esc(', '.join(detail['evidence']))}</code></li>"
                                for row in (with_row, without_row) if row for detail in row.get("details", [])]
                    folded = (f"<details><summary>{len(evidence)} observations</summary><ul class=why>{''.join(evidence)}</ul></details>"
                              if evidence else "none")
                    system_text = f"<small>{esc(system)}</small>" if system else ""
                    out.append(f"<tr><td class=check>{esc(item_title)}{system_text}</td><td>{esc(host)}</td><td>{esc(_cell(with_row))}</td>"
                               f"<td>{esc(_cell(without_row))}</td><td class=nowrap>{esc(_delta_text(delta))}</td><td>{folded}</td></tr>")
            out.append("</table></div>")
        else:
            out.append("<p class=note>Nothing on this axis was measured in these runs.</p>")
        if idle:
            out.append(f"<details><summary>No check in these runs ({len(idle)})</summary><ul class=why>"
                       + "".join(f"<li>{esc(label)}</li>" for label in idle) + "</ul></details>")
        return out
    page = ["<p class=eyebrow>BlaBla agent evaluation</p>", "<h1>Capability scorecard</h1>",
            f"<p class=lede>{esc(scorecard['purpose'])}. {esc(scorecard['arm_note'])}.</p>", f"<p class=note>{esc(SCORECARD_GUIDE)}</p>"]
    page.extend(matrix("Systems", scorecard["systems"]["rows"], scorecard["systems"]["deltas"]))
    page.extend(matrix("Capabilities", scorecard["capabilities"]["rows"], scorecard["capabilities"]["deltas"]))
    page.extend(matrix("Behaviors", scorecard["behaviors"]["rows"], scorecard["behaviors"]["deltas"]))
    page.extend(efficiency_html(scorecard.get("efficiency", [])))
    page.append("<h2>Not measured</h2><ul class=why>")
    if scorecard.get("absent_cases"):
        page.append("<li>Cases not in these runs: " + ", ".join(esc(case) for case in scorecard["absent_cases"]) + ".</li>")
    for axis in ("capabilities", "behaviors"):
        for entry in scorecard["missing"].get(axis, []):
            page.append(f"<li>{esc(axis)}: {esc(entry)}</li>")
    page.append("</ul><footer>This scorecard does not rank hosts or models.</footer>")
    return html_page("Capability scorecard", page)


def without_actions(results):
    return [{key: value for key, value in run.items() if key != "actions"} for run in _results(results)]


def write_scorecard(results, coverage, out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    efficiency = efficiency_rows(_results(results))
    scorecard = build_scorecard(without_actions(results), coverage)
    scorecard["efficiency"] = efficiency
    (out_dir / "scorecard.json").write_text(json.dumps(scorecard, indent=2), encoding="utf-8")
    (out_dir / "scorecard.md").write_text(_markdown(scorecard), encoding="utf-8")
    (out_dir / "scorecard.html").write_text(_html(scorecard), encoding="utf-8")
    return scorecard


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("results", type=Path)
    parser.add_argument("coverage", type=Path)
    parser.add_argument("out_dir", type=Path)
    arguments = parser.parse_args()
    results = json.loads(arguments.results.read_text(encoding="utf-8"))
    coverage = json.loads(arguments.coverage.read_text(encoding="utf-8"))
    write_scorecard(results, coverage, arguments.out_dir)


if __name__ == "__main__":
    main()
