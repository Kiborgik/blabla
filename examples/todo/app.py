import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "adapters" / "python"))

from blabla_adapter import Adapter

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


def bind(application):
    adapter = Adapter(application.reset, application.observe)
    adapter.action("add", 1, lambda args: application.add(args.string(0)))
    adapter.action("complete", 1, lambda args: application.complete(args.integer(0)))
    adapter.action("remove", 1, lambda args: application.remove(args.integer(0)))
    return adapter


if __name__ == "__main__":
    sys.exit(bind(TodoApplication(TodoStorage())).serve())
