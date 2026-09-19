import json
import sys

LINE_LIMIT = 1024 * 1024


class ProtocolError(Exception):
    pass


class Args:
    def __init__(self, values):
        self.values = values

    def __len__(self):
        return len(self.values)

    def string(self, index):
        return self._typed(index, str, "a string")

    def integer(self, index):
        value = self._typed(index, int, "a whole number")
        if isinstance(value, bool):
            raise ProtocolError(f"argument {index} is not a whole number")
        return value

    def boolean(self, index):
        return self._typed(index, bool, "a boolean")

    def _typed(self, index, kind, described):
        if index >= len(self.values):
            raise ProtocolError(f"argument {index} is missing")
        value = self.values[index]
        if not isinstance(value, kind):
            raise ProtocolError(f"argument {index} is not {described}")
        return value


class Adapter:
    def __init__(self, reset, observe):
        self._reset = reset
        self._observe = observe
        self._actions = {}

    def action(self, name, arity, handler):
        self._actions[name] = (arity, handler)
        return self

    def call(self, name, values):
        entry = self._actions.get(name)
        if entry is None:
            raise ProtocolError(f"unknown action: {name}")
        arity, handler = entry
        if len(values) != arity:
            raise ProtocolError(f"{name} takes {arity} arguments, got {len(values)}")
        handler(Args(values))

    def handle(self, request):
        operation = request.get("op")
        if operation == "reset":
            self._reset()
            return {"ok": True}
        if operation == "observe":
            return self._observe()
        if operation == "call":
            name = request.get("name")
            if not isinstance(name, str):
                raise ProtocolError("call has no action name")
            values = request.get("args", [])
            if not isinstance(values, list):
                raise ProtocolError("call arguments are not a list")
            self.call(name, values)
            return {"ok": True}
        raise ProtocolError(f"unknown op: {operation}")

    def serve(self, source=None, sink=None, logs=None):
        source = sys.stdin if source is None else source
        sink = sys.stdout if sink is None else sink
        logs = sys.stderr if logs is None else logs
        for line in source:
            if not line.strip():
                continue
            if len(line) > LINE_LIMIT:
                print("request exceeded the line limit", file=logs, flush=True)
                continue
            try:
                request = json.loads(line)
            except ValueError as failure:
                print(f"unreadable request: {failure}", file=logs, flush=True)
                continue
            if not isinstance(request, dict):
                print("request is not an object", file=logs, flush=True)
                continue
            try:
                result = self.handle(request)
            except ProtocolError as failure:
                result = {"ok": False, "error": str(failure)}
            sink.write(json.dumps({"id": request.get("id"), "result": result}) + "\n")
            sink.flush()
        return 0
