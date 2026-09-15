import json
import os
import subprocess
import sys
import time


sys.stdin.reconfigure(encoding="utf-8", errors="strict")
sys.stdout.reconfigure(encoding="utf-8", errors="strict")
mode = sys.argv[1]
calls = 0
descendant = None


def emit(request, result, response_id=None):
    if mode == "stderr_logging":
        print("application log", file=sys.stderr, flush=True)
    value = {
        "id": request["id"] if response_id is None else response_id,
        "result": result,
    }
    print(json.dumps(value, separators=(",", ":")), flush=True)


if mode == "pre_output":
    print(json.dumps({"id": None, "result": {"ok": True}}), flush=True)


for line in sys.stdin:
    request = json.loads(line)
    operation = request.get("op")
    if mode in {"normal", "pre_output", "trailing", "descendant", "crash_on_eof", "ignore_eof", "stderr_logging"}:
        if operation == "reset":
            calls = 0
            if mode == "descendant" and descendant is None:
                descendant = subprocess.Popen(
                    [sys.executable, "-c", "import time; time.sleep(2)"],
                    stdout=sys.stdout,
                    stderr=sys.stderr,
                )
            emit(request, {"ok": True})
        elif operation == "call":
            if request.get("name") == "increment":
                calls += 1
                emit(request, {"ok": True})
            elif request.get("name") == "hang":
                time.sleep(2)
            else:
                emit(request, {"ok": False, "error": "unknown request"})
        elif operation == "observe":
            emit(
                request,
                {
                    "cwd": os.getcwd(),
                    "calls": calls,
                    "descendant_pid": descendant.pid if descendant is not None else 0,
                },
            )
            if mode == "trailing":
                emit(request, {"extra": True})
        else:
            emit(request, {"ok": False, "error": "unknown request"})
    elif mode == "duplicate_ok":
        print('{"id":' + json.dumps(request["id"]) + ',"result":{"ok":false,"ok":true}}', flush=True)
    elif mode == "duplicate_result":
        print('{"id":' + json.dumps(request["id"]) + ',"result":{"ok":false,"error":"failed"},"result":{"ok":true}}', flush=True)
    elif mode == "failed_ack":
        emit(request, {"ok": False, "error": "fixture rejected reset"})
    elif mode == "malformed":
        print("{", flush=True)
    elif mode == "stdout_noise":
        print("fixture log", flush=True)
    elif mode == "json_noise":
        emit(request, {"noise": True})
    elif mode == "wrong_ack":
        emit(request, {"ok": "true"})
    elif mode == "wrong_id":
        emit(request, {"ok": True}, "wrong")
    elif mode == "eof":
        sys.exit(0)
    elif mode == "crash":
        sys.exit(7)
    elif mode == "unterminated":
        sys.stdout.write('{"id":"0","result":{"ok":true}}')
        sys.stdout.flush()
        sys.exit(0)
    elif mode == "oversized":
        print(" " * (1024 * 1024 + 1), flush=True)
    elif mode == "wrong_observation":
        if operation == "reset":
            emit(request, {"ok": True})
        else:
            emit(request, {"todos": "wrong"})
    elif mode == "timeout_read":
        time.sleep(2)
    elif mode == "timeout_write":
        if operation == "reset":
            emit(request, {"ok": True})
            time.sleep(2)


if mode == "ignore_eof":
    time.sleep(2)
elif mode == "crash_on_eof":
    sys.exit(7)
