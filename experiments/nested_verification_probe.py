import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = "gpt-6-astra"
RESULTS = []


def write(root, path, content):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def cli(root, *args, expected=0):
    command = ["cargo", "run", "--locked", "--quiet", "--bin", "blabla", "--", "--project", str(root), "--json", *args]
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=120)
    value = json.loads(result.stdout)
    assert result.returncode == expected, (args, result.returncode, value, result.stderr)
    return value


def status(root, stale):
    value = cli(root, "status", expected=5 if stale else 0)
    assert value["recorded"]["stale"] == (["implementation"] if stale else []), value
    return value


def fixture(root):
    write(root, "project.bla", f'''project Parent
use behavior "behavior.bla"
use structure "structure.bla"
process "process.bla"
ignore "child/generated/"
verify behavior {{
 command [{json.dumps(sys.executable)}, "app.py"]
 seed 0
 cases 1
 steps 4
 timeout_ms 2000
 shrink_budget 8
}}
''')
    write(root, "behavior.bla", 'state count: int\naction increment()\nwhen increment { expect "adds-one": after.count == before.count + 1 }\nalways "nonnegative" { count >= 0 }\n')
    write(root, "structure.bla", 'module child "child/public.py"\nrequire "declared-child-symbol": symbol child::available\n')
    write(root, "process.bla", f'role "orchestrator" {{ purpose "Assign" model "{MODEL}" }}\nrole "worker" {{ purpose "Work" model "{MODEL}" }}\n')
    write(root, "child/project.bla", 'project Child\n')
    write(root, "child/helper.py", 'STEP = 1\n')
    write(root, "child/public.py", 'def available():\n    return True\n')
    write(root, "child/unrelated.txt", 'before\n')
    write(root, "child/.gitignore", 'unrelated.txt\n')
    write(root, "owned.txt", 'old\n')
    write(root, "app.py", '''import json
import runpy
import sys
from pathlib import Path
step = runpy.run_path(str(Path(__file__).parent / "child/helper.py"))["STEP"]
count = 0
for line in sys.stdin:
    request = json.loads(line)
    operation = request["op"]
    if operation == "reset":
        count = 0
        result = {"ok": True}
    elif operation == "call":
        count += step
        result = {"ok": True}
    else:
        result = {"count": count}
    print(json.dumps({"id": request["id"], "result": result}), flush=True)
''')


def main():
    with tempfile.TemporaryDirectory(prefix="blabla-nested-verification-") as directory:
        root = Path(directory)
        fixture(root)
        cli(root, "task", "open", "parent", "--role", "worker", "--statement", "Change one parent file", "--scope", "owned.txt", "--deliverable", "owned.txt", "--check-argv", sys.executable, "-c", "from pathlib import Path; assert Path('owned.txt').read_text() == 'new\\n'")
        cli(root, "task", "open", "child-work", "--role", "worker", "--statement", "Concurrent child work", "--scope", "child", "--check-argv", sys.executable, "-c", "pass")
        cli(root, "task", "accept", "child-work", "--model", MODEL)
        cli(root, "task", "accept", "parent", "--model", MODEL)
        write(root, "owned.txt", 'new\n')
        cli(root, "task", "evidence", "parent", "--run")
        cli(root, "finish")
        cli(root, "challenge", "parent")
        cli(root, "task", "ready", "parent")
        status(root, False)
        RESULTS.append("unchanged parent verification and READY task are current")
        write(root, "child/unrelated.txt", 'after\n')
        status(root, True)
        challenge = cli(root, "challenge", "parent")
        assert challenge["assignment_clear"] is True, challenge
        assert challenge["grounded"] == ["verification-not-current"], challenge
        cli(root, "task", "close", "parent", "--model", MODEL, expected=2)
        RESULTS.append("nested unrelated edit stales parent verification and blocks CLOSE while assignment stays CLEAR; nested .gitignore does not exclude it")
        write(root, "child/unrelated.txt", 'before\n')
        status(root, False)
        cli(root, "task", "close", "parent", "--model", MODEL)
        RESULTS.append("restoring the one changed child input permits closure without rerunning the parent check")
        write(root, "child/project.bla", 'project ChildRenamed\n')
        status(root, True)
        write(root, "child/project.bla", 'project Child\n')
        RESULTS.append("a nested manifest is an ordinary parent implementation input")
        write(root, "child/generated/cache.txt", 'ignored\n')
        status(root, False)
        RESULTS.append("explicit parent ignore keeps generated child output outside the fingerprint")
        write(root, "child/helper.py", 'STEP = 2\n')
        status(root, True)
        failed = cli(root, "finish", expected=1)
        assert failed["project"]["state"] == "red", failed
        RESULTS.append("an implicit child runtime dependency stales the parent and actually fails its behavior contract")
        write(root, "child/helper.py", 'STEP = 1\n')
        cli(root, "finish")
        write(root, "child/public.py", 'def renamed():\n    return True\n')
        failed = cli(root, "status", expected=1)
        assert failed["structure"]["status"] == "red", failed
        RESULTS.append("a parent-declared child module is also checked live by its structural provider")
    with tempfile.TemporaryDirectory(prefix="blabla-ignored-child-") as directory:
        root = Path(directory)
        fixture(root)
        manifest = (root / "project.bla").read_text() + 'ignore "child/"\n'
        write(root, "project.bla", manifest)
        cli(root, "finish")
        write(root, "child/helper.py", 'STEP = 2\n')
        status(root, False)
        failed = cli(root, "finish", expected=1)
        assert failed["project"]["state"] == "red", failed
        RESULTS.append("blanket child ignore can leave cached behavior GREEN although a fresh run fails through an implicit child import")
        write(root, "child/helper.py", 'STEP = 1\n')
        write(root, "project.bla", manifest.replace('"app.py"]', '"app.py", "child/helper.py"]'))
        cli(root, "finish")
        record = json.loads((root / ".blabla/status.json").read_text())
        assert str(root / "child/helper.py") in record["fingerprinted_files"], record
        write(root, "child/helper.py", 'STEP = 2\n')
        status(root, True)
        RESULTS.append("an explicit command-line child file remains fingerprinted even under parent ignore")
    print(json.dumps({"cases": RESULTS, "result": "all assertions passed", "scope": "isolated fixture; no root gate or implementation changes"}, indent=2))


if __name__ == "__main__":
    main()
