import json
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SIZES = (10, 100, 1000)


def cli(root, verb, expected):
    command = ["cargo", "run", "--locked", "--quiet", "--bin", "blabla", "--", "--project", str(root), "--json", verb]
    started = time.perf_counter()
    result = subprocess.run(command, cwd=ROOT, capture_output=True, timeout=120)
    elapsed = time.perf_counter() - started
    assert result.returncode == expected, (command, result.returncode, result.stdout, result.stderr)
    return json.loads(result.stdout), len(result.stdout), round(elapsed * 1000, 3)


def measure(size):
    with tempfile.TemporaryDirectory(prefix="blabla-input-budget-") as directory:
        root = Path(directory)
        (root / "project.bla").write_text('project Budget\nuse behavior "behavior.bla"\nverify behavior { command ["python", "app.py"] seed 0 cases 1 steps 3 timeout_ms 2000 shrink_budget 8 }\n')
        (root / "behavior.bla").write_text('state count: int\naction increment()\nwhen increment { expect "adds-one": after.count == before.count + 1 }\n')
        (root / "app.py").write_text('''import json, sys
count = 0
for line in sys.stdin:
 r = json.loads(line)
 if r['op'] == 'reset':
  count = 0
  value = {'ok': True}
 elif r['op'] == 'call':
  count += 1
  value = {'ok': True}
 else:
  value = {'count': count}
 print(json.dumps({'id': r['id'], 'result': value}), flush=True)
''')
        files = root / "files"
        files.mkdir()
        for index in range(size):
            (files / f"{index:04}.txt").write_text("a" * 64)
        _, _, finish_ms = cli(root, "finish", 0)
        saved_path = root / ".blabla/status.json"
        saved = saved_path.read_bytes()
        baseline = json.loads(saved)["implementation_inputs"]
        expected_tree = {"app.py"} | {f"files/{index:04}.txt" for index in range(size)}
        assert {row["path"] for row in baseline if row["source"] == "tree-file"} == expected_tree
        assert [(row["source"], row["path"]) for row in baseline if row["source"] != "tree-file"] == [("command-file", str(root / "app.py"))]
        assert len(baseline) == size + 2
        unchanged, unchanged_bytes, unchanged_ms = cli(root, "status", 0)
        drift = unchanged["recorded"]["input_drift"]
        assert drift == {"availability": "available", "changes": [], "total_changes": 0, "omitted_changes": 0, "limit": 50}
        assert unchanged["recorded"]["stale"] == []
        for index in range(size):
            (files / f"{index:04}.txt").write_text("b" * 64)
        changed, changed_bytes, changed_ms = cli(root, "status", 5)
        drift = changed["recorded"]["input_drift"]
        assert drift["availability"] == "available"
        assert drift["total_changes"] == size
        assert drift["limit"] == 50
        assert len(drift["changes"]) == min(50, size)
        assert drift["omitted_changes"] == max(0, size - 50)
        assert [row["path"] for row in drift["changes"]] == [f"files/{index:04}.txt" for index in range(min(50, size))]
        assert all(row["source"] == "tree-file" and row["change"] == "changed" and row["recorded"]["fingerprint"] != row["current"]["fingerprint"] for row in drift["changes"])
        assert changed["recorded"]["stale"] == ["implementation"]
        assert saved_path.read_bytes() == saved
        return {
            "normal_files": size,
            "payload_bytes": size * 64,
            "baseline_inputs": len(baseline),
            "baseline_compact_json_bytes": len(json.dumps(baseline, separators=(",", ":")).encode()),
            "record_bytes": len(saved),
            "unchanged_status_json_bytes": unchanged_bytes,
            "unchanged_delta_count": 0,
            "changed_status_json_bytes": changed_bytes,
            "changed_total": drift["total_changes"],
            "changed_displayed": len(drift["changes"]),
            "changed_omitted": drift["omitted_changes"],
            "local_ms_including_cargo_startup": {"finish": finish_ms, "unchanged_status": unchanged_ms, "changed_status": changed_ms},
        }


def main():
    results = [measure(size) for size in SIZES]
    assert all(left["baseline_compact_json_bytes"] < right["baseline_compact_json_bytes"] for left, right in zip(results, results[1:]))
    print(json.dumps({"result": "all assertions passed", "cases": results, "timing_policy": "single local samples; includes Cargo and process startup; no threshold or old-version comparison"}, indent=2))


if __name__ == "__main__":
    main()
