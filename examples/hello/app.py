import json
import sys


sys.stdin.reconfigure(encoding="utf-8", errors="strict")
sys.stdout.reconfigure(encoding="utf-8", errors="strict")
started = False


def emit(request, result):
    value = {"id": request["id"], "result": result}
    print(json.dumps(value, separators=(",", ":")), flush=True)


for line in sys.stdin:
    try:
        request = json.loads(line)
        operation = request.get("op")
        if operation == "reset":
            started = False
            emit(request, {"ok": True})
        elif operation == "observe":
            emit(request, {"stdout": "Hello, world!" if started else ""})
        elif operation == "call" and request.get("name") == "start" and request.get("args") == []:
            started = True
            emit(request, {"ok": True})
        else:
            emit(request, {"ok": False, "error": "unknown request"})
    except Exception as error:
        emit(request, {"ok": False, "error": str(error)})
