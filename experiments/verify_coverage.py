import argparse
import contextlib
import hashlib
import json
import pathlib
import queue
import shutil
import subprocess
import threading
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts" / "coverage"
CONTRACT = ROOT / "artifacts/glyph-vault/feature/behavior.bla"
REFERENCE = ROOT / "artifacts/glyph-vault/feature_reference/glyph_vault"
BINARY = ROOT / "target/debug/blabla.exe"
CONFIG = {"seed": 0, "cases": 1, "steps": 4096, "timeout_ms": 1000, "shrink_budget": 256}
MUTATIONS = {
    "wrong-keeper": (
        "domain.py",
        "    def seal(self, key, keeper):\n        vault = self.owned(key, keeper)\n",
        "    def seal(self, key, keeper):\n        vault = self.vaults.get(key)\n        if vault is not None and vault.keeper is None:\n            return\n",
        "seal-invalid-noop",
    ),
    "sealed-pulse": (
        "domain.py",
        "if vault is None or vault.sealed or not 0 <= amount <= 9:",
        "if vault is None or not 0 <= amount <= 9:",
        "pulse-invalid-noop",
    ),
    "sealed-persistence": (
        "domain.py",
        "Vault(item.id, item.keeper, item.glyph, item.charge, 0, item.sealed)",
        "Vault(item.id, item.keeper, item.glyph, item.charge, 0, False)",
        "restart-durable-fields-and-zero-phase",
    ),
}
WITNESSES = {
    "eligible-seal": ("seal-effect-and-frame", "root.effect.member.member.right.right.right"),
    "wrong-keeper-seal": ("seal-invalid-noop", "not(($ 3.keeper == input.keeper))"),
    "sealed-pulse": ("pulse-invalid-noop", "not(not($ 3.sealed))"),
    "sealed-rotate": ("rotate-invalid-noop", "not(not($ 3.sealed))"),
    "sealed-release": ("release-invalid-noop", "not(not($ 3.sealed))"),
    "sealed-transfer-source": ("transfer-invalid-noop", "not(not($ 3.sealed))"),
    "sealed-transfer-target": ("transfer-invalid-noop", "not(not($ 4.sealed))"),
    "sealed-restart": ("restart-durable-fields-and-zero-phase", "is true before restart"),
    "phase-reset": ("restart-durable-fields-and-zero-phase", ".phase differs from 0"),
}


def dump(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


@contextlib.contextmanager
def scratch_directory(prefix):
    parent = (ARTIFACTS / "work").resolve()
    parent.mkdir(exist_ok=True)
    path = parent / (prefix + uuid.uuid4().hex)
    path.mkdir()
    try:
        yield path
    finally:
        resolved = path.resolve()
        assert resolved.parent == parent and not path.is_symlink()
        shutil.rmtree(resolved)


def assert_frozen():
    manifest = json.loads((ARTIFACTS / "frozen.json").read_text())
    assert manifest["configuration"] == CONFIG
    for name, expected in manifest["files"].items():
        actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        assert actual == expected, f"Frozen input changed: {name}"


def command(application):
    return [
        str(BINARY), "run", str(CONTRACT),
        "--seed", "0", "--cases", "1", "--steps", "4096",
        "--timeout-ms", "1000", "--shrink-budget", "256",
        "--json", "--", "python", str(application / "main.py"),
    ]


def campaign(directory, name, application):
    assert_frozen()
    args = command(application)
    started = time.perf_counter()
    with (directory / f"{name}.json").open("wb") as output, (directory / f"{name}.stderr").open("wb") as error:
        process = subprocess.run(args, cwd=ROOT, stdout=output, stderr=error)
    seconds = time.perf_counter() - started
    report = json.loads((directory / f"{name}.json").read_text(encoding="utf-8-sig"))
    dump(directory / f"{name}.execution.json", {
        "command": args, "exit": process.returncode, "elapsed_seconds": seconds,
        "configuration": CONFIG,
        "binary_sha256": hashlib.sha256(BINARY.read_bytes()).hexdigest(),
        "source_sha256": {str(p.relative_to(ROOT)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT / "src").rglob("*.rs"))},
    })
    print(f"{name}: {report['status']} exit={process.returncode} actions={report.get('steps_executed')} seconds={seconds:.3f}", flush=True)
    return process.returncode, report


class Replay:
    def __init__(self, application):
        self.application = application
        self.directory = scratch_directory("witness-")
        self.directory_path = self.directory.__enter__()
        self.serial = 0
        self.start()
        self.request("reset")

    def start(self):
        self.process = subprocess.Popen(
            ["python", str(self.application / "main.py")], cwd=self.directory_path,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8",
        )
        self.lines = queue.Queue()
        process, lines = self.process, self.lines

        def read():
            for line in process.stdout:
                lines.put(line)
            lines.put(None)

        threading.Thread(target=read, daemon=True).start()

    def request(self, operation, **values):
        self.serial += 1
        token = f"w{self.serial}"
        self.process.stdin.write(json.dumps({"id": token, "op": operation, **values}) + "\n")
        self.process.stdin.flush()
        line = self.lines.get(timeout=CONFIG["timeout_ms"] / 1000)
        assert line is not None, "Witness replay application exited"
        result = json.loads(line)
        assert result["id"] == token
        if operation != "observe":
            assert result["result"] == {"ok": True}, result
        return result["result"]

    def step(self, call):
        before = self.request("observe")
        old_pid = self.process.pid
        if call["action"] == "restart":
            self.process.kill()
            self.process.wait(timeout=1)
            self.start()
            assert self.process.pid != old_pid
        else:
            self.request("call", name=call["action"], args=call["args"])
        return before, self.request("observe")

    def close(self):
        try:
            self.process.kill()
            self.process.wait(timeout=1)
        finally:
            self.directory.__exit__(None, None, None)


def replay_trace(application, trace):
    replay = Replay(application)
    transitions = []
    try:
        for call in trace:
            before, after = replay.step(call)
            transitions.append((call, before, after))
    finally:
        replay.close()
    return transitions


def meaningful(name, transition):
    call, before, after = transition
    args = call["args"]
    records = {v["id"]: v for v in before["vaults"]}
    updated = {v["id"]: v for v in after["vaults"]}
    if name in ("sealed-restart", "phase-reset", "sealed-persistence"):
        assert call["action"] == "restart"
        if name == "phase-reset":
            return any(v["phase"] == 1 and updated[k]["phase"] == 0 for k, v in records.items())
        return any(v["sealed"] for v in records.values())
    vault = records.get(args[0])
    if vault is None:
        return False
    if name in ("eligible-seal", "wrong-keeper-seal", "wrong-keeper"):
        assert call["action"] == "seal"
        eligible = vault["keeper"] is not None and not vault["sealed"] and vault["phase"] == 1 and vault["charge"] == 5
        return eligible and ((vault["keeper"] == args[1]) if name == "eligible-seal" else (vault["keeper"] != args[1]))
    if name.startswith("sealed-transfer"):
        assert call["action"] == "transfer"
        target = records.get(args[1])
        return target is not None and args[0] != args[1] and vault["keeper"] == args[2] and vault["keeper"] is not None and target["keeper"] is not None and (vault["sealed"] if name.endswith("source") else target["sealed"])
    expected = {"sealed-pulse": "pulse", "sealed-rotate": "rotate", "sealed-release": "release"}[name]
    assert call["action"] == expected
    changes_charge = name != "sealed-pulse" or (
        0 <= args[2] <= 9 and (args[2] if vault["phase"] == 0 else min(9, vault["charge"] + args[2])) != vault["charge"]
    )
    return vault["sealed"] and vault["keeper"] == args[1] and changes_charge


def validate_clean(report, directory):
    assert report["status"] == "green"
    assert report["unexercised"] == report["violated"] == 0
    assert report["verified"] == len(report["coverage"])
    assert report["steps_executed"] == sum(map(len, report["sequences"])) <= 4096
    result = {}
    for name, (property_name, selector) in WITNESSES.items():
        rows = [r for r in report["coverage"] if r["property"] == property_name and (selector in r["id"] or selector in r["required_witness"])]
        assert rows, (name, selector)
        row = rows[0]
        assert row["status"] == "verified" and row["witnesses"] > 0, row
        trace = row["shortest_witness_trace"]
        transitions = replay_trace(REFERENCE, trace)
        assert transitions and meaningful(name, transitions[-1]), (name, trace, transitions[-1])
        call, before, after = transitions[-1]
        if name == "eligible-seal":
            assert next(v for v in after["vaults"] if v["id"] == call["args"][0])["sealed"]
        elif name == "sealed-restart":
            assert all(next(v for v in after["vaults"] if v["id"] == old["id"])["sealed"] == old["sealed"] for old in before["vaults"])
        elif name != "phase-reset":
            assert after == before, (name, before, after)
        result[name] = {
            "obligation": row["id"], "witnesses": row["witnesses"],
            "first_action": row["first_witness_action"], "first_ms": row["first_witness_ms"],
            "shortest_trace": trace, "real_process_replay": "passed",
        }
    dump(directory / "witnesses.json", result)
    return result


def validate_mutation(name, application, report, expected, directory):
    assert report["status"] == "red", report["status"]
    assert report["property"] == expected, report["property"]
    assert report["minimal_sequence_length"] == len(report["minimal_sequence"])
    assert report["minimal_sequence_length"] < report["original_sequence_length"]
    assert report["shrink"]["confirmations"] == 2
    traces = {}
    for key in ("original_sequence", "minimal_sequence"):
        transitions = replay_trace(application, report[key])
        assert meaningful(name, transitions[-1]), (name, key, transitions[-1])
        call, before, after = transitions[-1]
        if name == "wrong-keeper":
            assert before != after
        elif name == "sealed-pulse":
            assert before != after
        else:
            assert any(old["sealed"] and not next(v for v in after["vaults"] if v["id"] == old["id"])["sealed"] for old in before["vaults"])
        traces[key] = "same defect reproduced"
    result = {
        "property": expected, "status": "red",
        "actions_to_detection": report["steps_executed"], "detection_ms": report["metrics"]["detection_ms"],
        "original_length": report["original_sequence_length"], "minimal_length": report["minimal_sequence_length"],
        "shrink_ms": report["metrics"]["shrink_ms"], "shrink_status": report["shrink"]["status"], "replay": traces,
    }
    dump(directory / f"{name}.validation.json", result)
    return result


def logical(value):
    if isinstance(value, dict):
        return {k: logical(v) for k, v in value.items() if not k.endswith("_ms")}
    if isinstance(value, list):
        return [logical(v) for v in value]
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True)
    parser.add_argument("--only", choices=["all", "clean", "mutations"], default="all")
    parser.add_argument("--mutation", choices=list(MUTATIONS))
    args = parser.parse_args()
    assert args.tag and all(c.isalnum() or c in "-_" for c in args.tag)
    directory = ARTIFACTS / args.tag
    directory.mkdir(exist_ok=False)
    assert_frozen()
    summary = {"configuration": CONFIG, "results": {}}
    try:
        if args.only != "mutations":
            exit_code, report = campaign(directory, "clean", REFERENCE)
            assert exit_code == 0
            summary["results"]["clean"] = validate_clean(report, directory)
            exit_code, repeated = campaign(directory, "clean-repeat", REFERENCE)
            assert exit_code == 0 and logical(report) == logical(repeated), "Seeded decisions or logical reports differ"
            summary["determinism"] = "identical actions, corpus choices, targets, coverage and final result; elapsed times excluded"
        if args.only != "clean":
            for name, (filename, old, new, expected) in MUTATIONS.items():
                if args.mutation and args.mutation != name:
                    continue
                with scratch_directory("mutation-") as temp:
                    application = pathlib.Path(temp) / "app"
                    shutil.copytree(REFERENCE, application, ignore=shutil.ignore_patterns("__pycache__"))
                    source = application / filename
                    text = source.read_text()
                    assert text.count(old) == 1, name
                    source.write_text(text.replace(old, new))
                    dump(directory / f"{name}.mutation.json", {"file": filename, "before": old, "after": new})
                    exit_code, report = campaign(directory, name, application)
                    assert exit_code == 1
                    summary["results"][name] = validate_mutation(name, application, report, expected, directory)
        summary["status"] = "passed"
    except Exception as error:
        summary["status"] = "failed"
        summary["error"] = repr(error)
        raise
    finally:
        assert_frozen()
        dump(directory / "summary.json", summary)


if __name__ == "__main__":
    main()
