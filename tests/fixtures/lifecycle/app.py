import json
import os
import sys
import subprocess
import time
from pathlib import Path

sys.stdin.reconfigure(encoding="utf-8", errors="strict")
sys.stdout.reconfigure(encoding="utf-8", errors="strict")
mode = sys.argv[1]
slow = mode == "slow"
if slow:
    mode = "persistent"
marker = Path("started")
if marker.exists():
    if mode == "crash_on_restart":
        sys.exit(7)
    if mode == "timeout_on_restart":
        time.sleep(2)
marker.write_text("started")
descendant = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(2)"], stdout=sys.stdout) if mode == "descendant" else None
storage = Path("count.json")
count = json.loads(storage.read_text()) if storage.exists() and mode in {"persistent", "save_on_exit"} else 0

for line in sys.stdin:
    request = json.loads(line)
    if slow:
        time.sleep(0.02)
    if request["op"] == "reset":
        count = 0
        storage.unlink(missing_ok=True)
        result = {"ok": True}
    elif request["op"] == "observe":
        result = {"count": count, "pid": os.getpid(), "cwd": str(Path.cwd()), "descendant_pid": descendant.pid if descendant else 0}
    elif request["op"] == "call":
        if request["name"] == "increment":
            count += 1
            if mode == "persistent":
                storage.write_text(json.dumps(count))
        elif request["name"] != "restart":
            raise ValueError("unknown action")
        result = {"ok": True}
    else:
        raise ValueError("unknown operation")
    print(json.dumps({"id": request["id"], "result": result}), flush=True)

if mode == "save_on_exit":
    storage.write_text(json.dumps(count))
