import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WIDGETS = ["first widget", "second widget"]


class Session:
    def __init__(self):
        self.process = subprocess.Popen(
            [sys.executable, "app.py"], cwd=ROOT, text=True, encoding="utf-8",
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )

    def ask(self, request):
        self.process.stdin.write(json.dumps(request) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if line == "":
            raise SystemExit(f"the application closed its output after {request!r}: {self.process.stderr.read()[:400]}")
        try:
            response = json.loads(line)
        except ValueError:
            raise SystemExit(f"the application answered {request!r} with a line that is not JSON: {line.rstrip()!r}") from None
        if not isinstance(response, dict) or "result" not in response:
            raise SystemExit(f"the application answered {request!r} without a result: {line.rstrip()!r}")
        return response["result"]

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=10)


def texts(observation):
    return [widget["text"] for widget in observation.get("widgets", [])]


first = Session()
first.ask({"op": "reset"})
for text in WIDGETS:
    first.ask({"op": "call", "name": "add", "args": [text]})
seen = texts(first.ask({"op": "observe"}))
first.close()
if seen != WIDGETS:
    raise SystemExit(f"before the restart the application holds {seen!r}, expected {WIDGETS!r}")

second = Session()
after = texts(second.ask({"op": "observe"}))
second.ask({"op": "reset"})
second.close()
if after != WIDGETS:
    raise SystemExit(f"after a restart the application holds {after!r}, expected {WIDGETS!r}")
print("restart check: the application answers in JSON and keeps every widget across a restart")
