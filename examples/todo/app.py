import json
import os
import sys
from pathlib import Path


sys.stdin.reconfigure(encoding="utf-8", errors="strict")
sys.stdout.reconfigure(encoding="utf-8", errors="strict")


class TodoStorage:
    def __init__(self, path=None):
        self.path = Path(path) if path is not None else Path.cwd() / "todos.json"

    def load(self):
        if not self.path.exists():
            return []
        with self.path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def save(self, todos):
        temporary = self.path.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(todos, handle, ensure_ascii=False, separators=(",", ":"))
        os.replace(temporary, self.path)

    def reset(self):
        self.path.unlink(missing_ok=True)
        self.path.with_suffix(".tmp").unlink(missing_ok=True)


class TodoApplication:
    def __init__(self, storage):
        self.storage = storage
        self.todos = storage.load()

    def reset(self):
        self.storage.reset()
        self.todos = []

    def add(self, text):
        if text == "":
            return
        next_id = max((todo["id"] for todo in self.todos), default=0) + 1
        self.todos.append({"id": next_id, "text": text, "done": False})
        self.storage.save(self.todos)

    def complete(self, todo_id):
        for todo in self.todos:
            if todo["id"] == todo_id:
                if not todo["done"]:
                    todo["done"] = True
                    self.storage.save(self.todos)
                return

    def remove(self, todo_id):
        remaining = [todo for todo in self.todos if todo["id"] != todo_id]
        if len(remaining) != len(self.todos):
            self.todos = remaining
            self.storage.save(self.todos)

    def observe(self):
        return {"todos": [dict(todo) for todo in self.todos]}


class TodoAdapter:
    def __init__(self, application):
        self.application = application

    def reset(self):
        self.application.reset()

    def observe(self):
        return self.application.observe()

    def call(self, name, args):
        if name == "add" and len(args) == 1 and isinstance(args[0], str):
            self.application.add(args[0])
        elif name == "complete" and len(args) == 1 and type(args[0]) is int:
            self.application.complete(args[0])
        elif name == "remove" and len(args) == 1 and type(args[0]) is int:
            self.application.remove(args[0])
        else:
            raise ValueError("unknown action or invalid arguments")


def emit(request, result):
    value = {"id": request["id"], "result": result}
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)


def serve(adapter):
    for line in sys.stdin:
        try:
            request = json.loads(line)
            operation = request.get("op")
            if operation == "reset":
                adapter.reset()
                emit(request, {"ok": True})
            elif operation == "observe":
                emit(request, adapter.observe())
            elif operation == "call":
                adapter.call(request.get("name"), request.get("args"))
                emit(request, {"ok": True})
            else:
                emit(request, {"ok": False, "error": "unknown request"})
        except Exception as error:
            emit(request, {"ok": False, "error": str(error)})


if __name__ == "__main__":
    serve(TodoAdapter(TodoApplication(TodoStorage())))
