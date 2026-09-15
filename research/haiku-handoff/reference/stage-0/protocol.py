import json
import sys

ARGUMENTS = {
    "bind": (str, str, str, int),
    "pulse": (str, str, int),
    "rotate": (str, str),
    "transfer": (str, str, str, int),
    "release": (str, str),
    "seal": (str, str),
    "unseal": (str, str),
    "quarantine": (str, str),
    "clear_quarantine": (str, str),
}


class Protocol:
    def __init__(self, domain, commit, reset):
        self.domain = domain
        self.commit = commit
        self.reset = reset

    def dispatch(self, request):
        operation = request["op"]
        if operation == "observe":
            return self.domain.observe()
        if operation == "reset":
            self.reset()
            return {"ok": True}
        if operation != "call":
            raise ValueError("unknown protocol operation")
        name = request["name"]
        args = request["args"]
        if name not in ARGUMENTS or not isinstance(args, list) or len(args) != len(ARGUMENTS[name]):
            raise ValueError("unknown action or invalid argument count")
        if any(type(value) is not expected for value, expected in zip(args, ARGUMENTS[name])):
            raise ValueError("incorrect argument type")
        if any(type(value) is int and abs(value) > 9_007_199_254_740_991 for value in args):
            raise ValueError("integer outside JSON-safe range")
        getattr(self.domain, name)(*args)
        self.commit()
        return {"ok": True}

    def serve(self):
        sys.stdin.reconfigure(encoding="utf-8", errors="strict")
        sys.stdout.reconfigure(encoding="utf-8", errors="strict")
        for line in sys.stdin:
            request = json.loads(line)
            try:
                result = self.dispatch(request)
            except (KeyError, TypeError, ValueError, OSError) as error:
                result = {"ok": False, "error": str(error)}
            print(json.dumps({"id": request["id"], "result": result}, ensure_ascii=False), flush=True)
