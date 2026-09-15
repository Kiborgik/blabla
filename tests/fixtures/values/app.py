import json
import sys

value = None
for line in sys.stdin:
    request = json.loads(line)
    if request["op"] == "reset":
        value = None
        result = {"ok": True}
    elif request["op"] == "call":
        value = request["args"][0]
        result = {"ok": True}
    elif request["op"] == "observe":
        result = {"value": value}
    else:
        raise ValueError("unknown operation")
    print(json.dumps({"id": request["id"], "result": result}), flush=True)
